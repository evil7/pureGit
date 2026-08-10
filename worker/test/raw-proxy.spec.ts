import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isRawRequest, handleRawProxy } from "../src/raw-proxy";

describe("isRawRequest", () => {
  it("matches /$raw/{owner}/{repo}/{ref}/{path...}", () => {
    expect(isRawRequest("/$raw/evil7/pureGit/main/README.md")).toBe(true);
    expect(isRawRequest("/$raw/react/react/main/package.json")).toBe(true);
    expect(isRawRequest("/$raw/evil7/pureGit/main/docs/guide.md")).toBe(true);
  });
  it("rejects non-raw paths", () => {
    expect(isRawRequest("/auth/login")).toBe(false);
    expect(isRawRequest("/$raw/evil7/pureGit/main")).toBe(false);
    expect(isRawRequest("/$raw/evil7")).toBe(false);
    expect(isRawRequest("/evil7/pureGit/blob/main/x")).toBe(false);
  });
});

describe("handleRawProxy", () => {
  const originalFetch = globalThis.fetch;
  // KV mock（限流计数 + 会话读取）
  const kv = new Map<string, string>();
  const env = {
    FRONTEND_URL: "http://127.0.0.1:5173",
    SESSIONS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
        kv.set(k, v);
        void opts;
      },
    },
  } as unknown as Env;

  beforeEach(() => {
    kv.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards to raw.githubusercontent.com with nosniff + CORS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("console.log('hi')", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/script.js");
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
    // rewrite 到 raw.githubusercontent.com
    const called = fetchMock.mock.calls[0][0] as string;
    expect(called).toBe("https://raw.githubusercontent.com/evil7/pureGit/main/script.js");
    // E34 安全头
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
  });

  it("returns 404 passthrough for missing upstream file", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("404: Not Found", { status: 404 })) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/Nope.md");
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(404);
  });

  it("rejects non-GET with 405", async () => {
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/README.md", {
      method: "POST",
    });
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(405);
    expect((await res.json()) as { error: string }).toEqual({
      error: "method_not_allowed",
    });
  });

  it("rejects over-long path with 414", async () => {
    const deep = "a/".repeat(30) + "file.md"; // >16 段
    const req = new Request(`http://localhost:8787/$raw/evil7/pureGit/main/${deep}`);
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(414);
    expect((await res.json()) as { error: string }).toEqual({
      error: "path_too_long",
    });
  });

  it("rate-limits anonymous by IP after quota (120/min)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("content", { status: 200 })) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/f.txt", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    // 匿名 120 次后第 121 次应 429
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) {
      last = await handleRawProxy(req, env);
    }
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
    expect(last!.headers.get("Retry-After")).toBe("60");
  });

  it("fails open if upstream unreachable (504)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/f.txt");
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(504);
    expect((await res.json()) as { error: string }).toEqual({
      error: "upstream_unreachable",
    });
  });

  it("rejects file over 100MB with 413 (Content-Length precheck)", async () => {
    // 101MB 文件（Content-Length 预判拦截，无需读取 body）
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": String(101 * 1024 * 1024) },
      }),
    ) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/big.bin");
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; max_bytes: number };
    expect(body.error).toBe("file_too_large");
    expect(body.max_bytes).toBe(100 * 1024 * 1024);
  });

  it("allows files up to 100MB (no Content-Length, byteLength fallback)", async () => {
    // 2MB 实际内容（无 CL，走 byteLength 兜底检查）
    const big = "x".repeat(2 * 1024 * 1024);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(big, { status: 200, headers: { "Content-Type": "text/plain" } }),
      ) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/med.txt");
    const res = await handleRawProxy(req, env);
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(2 * 1024 * 1024);
  });

  it("forwards session token upstream for authenticated requests (2026-08-10 E34h)", async () => {
    // 登录会话（cookie → KV 会话）→ 上游 fetch 必须带 Authorization: Bearer（私有仓库 raw 可读）
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("private content", { status: 200 })) as typeof fetch;
    globalThis.fetch = fetchMock;
    const env2 = {
      ...env,
      SESSION_COOKIE_NAME: "puregit_session",
    } as unknown as Env;
    kv.set("session:s1", JSON.stringify({ token: "gho_testtoken", login: "evil7" }));
    const req = new Request("http://localhost:8787/$raw/evil7/private-repo/main/secret.txt", {
      headers: { Cookie: "puregit_session=s1" },
    });
    const res = await handleRawProxy(req, env2);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("private content");
    // 上游 fetch 带会话 token（headers 为普通对象字面量，非 Headers 实例）
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer gho_testtoken");
  });
});
