import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isRawRequest, handleRawProxy } from "../src/raw-proxy";

const RAW = "https://raw.githubusercontent.com";

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

describe("handleRawProxy（纯透传）", () => {
  const originalFetch = globalThis.fetch;
  const kv = new Map<string, string>();
  const baseEnv = {
    FRONTEND_URL: "http://127.0.0.1:5173",
    SESSION_COOKIE_NAME: "puregit_session",
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

  /** 构造带登录会话 cookie 的请求（会话 s1 → token gho_testtoken） */
  function authedReq(path: string): Request {
    kv.set("session:s1", JSON.stringify({ token: "gho_testtoken", login: "evil7" }));
    return new Request(`http://localhost:8787${path}`, {
      headers: { Cookie: "puregit_session=s1" },
    });
  }

  it("登录：透传 raw 带 token（私有仓库可读）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("raw-content", { status: 200, headers: { "Content-Type": "text/plain" } }),
      );
    globalThis.fetch = fetchMock as typeof fetch;
    const res = await handleRawProxy(authedReq("/$raw/evil7/private/main/a.txt"), baseEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("raw-content");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${RAW}/evil7/private/main/a.txt`);
    expect(init.headers.Authorization).toBe("Bearer gho_testtoken");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("匿名：透传 raw 不带 token（公开仓库）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("public-content", { status: 200, headers: { "Content-Type": "text/plain" } }),
      );
    globalThis.fetch = fetchMock as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/README.md");
    const res = await handleRawProxy(req, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("public-content");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${RAW}/evil7/pureGit/main/README.md`);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("透传 404 → 直接 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const res = await handleRawProxy(authedReq("/$raw/evil7/pureGit/main/Nope.md"), baseEnv);
    expect(res.status).toBe(404);
  });

  it("透传上游错误（5xx）→ 502", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const res = await handleRawProxy(authedReq("/$raw/evil7/pureGit/main/a.txt"), baseEnv);
    expect(res.status).toBe(502);
  });

  it("透传网络错误 → 504", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    globalThis.fetch = fetchMock as typeof fetch;
    const res = await handleRawProxy(authedReq("/$raw/evil7/pureGit/main/a.txt"), baseEnv);
    expect(res.status).toBe(504);
  });

  it("rejects non-GET with 405", async () => {
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/README.md", {
      method: "POST",
    });
    const res = await handleRawProxy(req, baseEnv);
    expect(res.status).toBe(405);
  });

  it("rejects over-long path with 414", async () => {
    const deep = "a/".repeat(30) + "file.md";
    const req = new Request(`http://localhost:8787/$raw/evil7/pureGit/main/${deep}`);
    const res = await handleRawProxy(req, baseEnv);
    expect(res.status).toBe(414);
  });

  it("rate-limits anonymous by IP after quota (120/min)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("content", { status: 200 })) as typeof fetch;
    const req = new Request("http://localhost:8787/$raw/evil7/pureGit/main/f.txt", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) {
      last = await handleRawProxy(req, baseEnv);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBe("60");
  });
});
