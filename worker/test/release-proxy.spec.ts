import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isReleaseRequest, handleReleaseProxy } from "../src/release-proxy";

describe("isReleaseRequest", () => {
  it("matches /$release/{owner}/{repo}/download/{tag}/{asset}", () => {
    expect(isReleaseRequest("/$release/evil7/pureGit/download/v1.0.0/app.zip")).toBe(true);
    expect(isReleaseRequest("/$release/react/react/download/v18.2.0/build.tar.gz")).toBe(true);
    // tag 可含编码斜杠（%2F 不是真斜杠，仍为单段）
    expect(isReleaseRequest("/$release/o/r/download/release%2F1.0/a.bin")).toBe(true);
  });
  it("rejects non-release paths", () => {
    expect(isReleaseRequest("/$raw/evil7/pureGit/main/x")).toBe(false);
    expect(isReleaseRequest("/$release/evil7/pureGit/download/v1.0.0")).toBe(false);
    expect(isReleaseRequest("/$release/evil7")).toBe(false);
    expect(isReleaseRequest("/evil7/pureGit/releases/download/v1/x")).toBe(false);
  });
});

describe("handleReleaseProxy", () => {
  const originalFetch = globalThis.fetch;
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

  it("forwards to github.com releases/download with nosniff + CORS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("binary-body", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const req = new Request("http://localhost:8787/$release/evil7/pureGit/download/v1.0.0/app.zip");
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("binary-body");
    const called = fetchMock.mock.calls[0][0] as string;
    expect(called).toBe("https://github.com/evil7/pureGit/releases/download/v1.0.0/app.zip");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
  });

  it("returns 404 passthrough for missing asset", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("404: Not Found", { status: 404 })) as typeof fetch;
    const req = new Request(
      "http://localhost:8787/$release/evil7/pureGit/download/v1.0.0/nope.zip",
    );
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(404);
  });

  it("rejects non-GET with 405", async () => {
    const req = new Request("http://localhost:8787/$release/evil7/pureGit/download/v1.0.0/a.zip", {
      method: "POST",
    });
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(405);
    expect((await res.json()) as { error: string }).toEqual({ error: "method_not_allowed" });
  });

  it("rejects over-long path with 414", async () => {
    const deep = "a/".repeat(30) + "file.zip";
    const req = new Request(`http://localhost:8787/$release/evil7/pureGit/download/v1/${deep}`);
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(414);
  });

  it("rate-limits anonymous by IP after quota (20/min)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("content", { status: 200 })) as typeof fetch;
    const req = new Request("http://localhost:8787/$release/evil7/pureGit/download/v1/a.zip", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await handleReleaseProxy(req, env);
    }
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("fails open if upstream unreachable (504)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as typeof fetch;
    const req = new Request("http://localhost:8787/$release/evil7/pureGit/download/v1/a.zip");
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(504);
    expect((await res.json()) as { error: string }).toEqual({ error: "upstream_unreachable" });
  });

  it("rejects asset over 2GiB with 413 (Content-Length precheck)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": String(2 * 1024 * 1024 * 1024 + 1) },
      }),
    ) as typeof fetch;
    const req = new Request("http://localhost:8787/$release/evil7/pureGit/download/v1/huge.bin");
    const res = await handleReleaseProxy(req, env);
    expect(res.status).toBe(413);
  });

  it("forwards session token upstream for authenticated requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("private asset", { status: 200 })) as typeof fetch;
    globalThis.fetch = fetchMock;
    const env2 = { ...env, SESSION_COOKIE_NAME: "puregit_session" } as unknown as Env;
    kv.set("session:s1", JSON.stringify({ token: "gho_testtoken", login: "evil7" }));
    const req = new Request("http://localhost:8787/$release/evil7/private/download/v1/a.zip", {
      headers: { Cookie: "puregit_session=s1" },
    });
    const res = await handleReleaseProxy(req, env2);
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer gho_testtoken");
  });
});
