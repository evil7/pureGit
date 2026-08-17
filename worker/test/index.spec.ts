import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("PureGit worker", () => {
  it("serves the frontend SPA on / (assets mode)", async () => {
    // S53 后 wrangler.jsonc 配置 assets（web/dist/client）→ 生产行为：/ 返回前端 index.html
    // （旧断言 service JSON 仅适用于无 assets 部署，已过时）
    const request = new IncomingRequest("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type") ?? "").toContain("text/html");
  });

  it("/$healthz returns liveness probe (no auth, no business logic)", async () => {
    const response = await SELF.fetch("https://example.com/$healthz");
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      ok: boolean;
      service: string;
      ts: number;
      proxies: { raw: string; release: string };
    };
    expect(data.ok).toBe(true);
    expect(data.service).toBe("puregit-worker");
    expect(typeof data.ts).toBe("number");
    // 反代能力矩阵：默认 login（供前端收敛 $raw/$release 通道，各自独立管控）
    expect(data.proxies.raw).toBe("login");
    expect(data.proxies.release).toBe("login");
  });

  it("/$raw login 模式：会话 login 为空（OAuth /user 降级）仍放行（不误判 401）", async () => {
    // 写入 login 为空、token 存在的会话（模拟 OAuth 回调时 /user 网络降级）
    const sessionId = "s_login_empty";
    await env.SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        token: "gho_testtoken",
        login: "",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        scopes: { mode: "read" },
      }),
    );
    // mock raw 上游（避免真实外呼）
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("raw-ok", { status: 200 })),
    );
    try {
      const response = await SELF.fetch("https://example.com/$raw/evil7/pureGit/main/README.md", {
        headers: { Cookie: `puregit_session=${sessionId}` },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("raw-ok");
    } finally {
      vi.unstubAllGlobals();
      await env.SESSIONS.delete(`session:${sessionId}`);
    }
  });

  it("/$auth/login redirects to GitHub authorize (integration style)", async () => {
    const response = await SELF.fetch("https://example.com/$auth/login", {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith("https://github.com/login/oauth/authorize")).toBe(true);
    expect(location).toContain("client_id=");
    expect(location).toContain("state=");
  });

  it("/$auth/session returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/session");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("/$auth/logout returns ok", async () => {
    const response = await SELF.fetch("https://example.com/$auth/logout", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("/$auth/pat returns 400 without body", async () => {
    const response = await SELF.fetch("https://example.com/$auth/pat", {
      method: "POST",
    });
    expect(response.status).toBe(400);
  });

  it("/$auth/pat signs in with a valid PAT (mocked /user)", async () => {
    // mock api.github.com /user：返回 login + X-OAuth-Scopes（classic PAT 权限头）
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith("https://api.github.com/user")) {
          return new Response(
            JSON.stringify({
              login: "evil7",
              avatar_url: "https://example.com/avatar.png",
            }),
            {
              status: 200,
              headers: { "X-OAuth-Scopes": "repo, user" },
            },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    try {
      const response = await SELF.fetch("https://example.com/$auth/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: "ghp_test123", deviceId: "dev1" }),
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        token: string;
        user: { login: string };
        scopes: { mode: string };
      };
      // token 即 PAT（前端调用 API 需要），与 OAuth token 同等对待
      expect(data.token).toBe("ghp_test123");
      expect(data.user.login).toBe("evil7");
      // X-OAuth-Scopes 含 user → 推断 write
      expect(data.scopes.mode).toBe("write");
      // 下发 httpOnly 会话 cookie（仅会话 id，非 token）
      const setCookie = response.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain("puregit_session=");
      expect(setCookie).toContain("HttpOnly");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("/$auth/pat rejects an invalid PAT (mocked 401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith("https://api.github.com/user")) {
          return new Response("Bad credentials", { status: 401 });
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    try {
      const response = await SELF.fetch("https://example.com/$auth/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: "ghp_invalid" }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_pat" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("SPA-fallbacks unknown paths to index.html (assets mode)", async () => {
    // 无扩展名路径 → 回退前端路由（index.html）；与上同理，旧 service JSON 断言已过时
    const response = await SELF.fetch("https://example.com/whatever");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type") ?? "").toContain("text/html");
  });
});

// 持久会话 + 会话列表/本地登出/撤销（cloudflare:test 的 env 为真实 KV 绑定）
describe("PureGit worker sessions", () => {
  const makeSession = (login: string, extra: Record<string, unknown> = {}) => ({
    token: "gho_test_token",
    login,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    scopes: { mode: "read" },
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ip: "1.2.3.4",
    deviceId: "dev-1",
    ...extra,
  });

  it("/$auth/sessions returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/sessions");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("/$auth/sessions/:id/logout returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/sessions/abc/logout", {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("/$auth/revoke returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/revoke", {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("/$auth/logout/all returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/logout/all", {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("logout/all removes all same-login sessions (current + others), keeps alien, clears cookie", async () => {
    const cookieName = env.SESSION_COOKIE_NAME;
    await env.SESSIONS.put("session:cur-all", JSON.stringify(makeSession("octocat")));
    await env.SESSIONS.put("session:other-all", JSON.stringify(makeSession("octocat")));
    await env.SESSIONS.put("session:alien-all", JSON.stringify(makeSession("someone-else")));

    const response = await SELF.fetch("https://example.com/$auth/logout/all", {
      method: "POST",
      headers: { Cookie: `${cookieName}=cur-all` },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { removed?: number };
    expect(data.removed).toBe(2);
    // 当前 + 其他设备全部删除；其他用户会话不受影响
    expect(await env.SESSIONS.get("session:cur-all")).toBeNull();
    expect(await env.SESSIONS.get("session:other-all")).toBeNull();
    expect(await env.SESSIONS.get("session:alien-all")).not.toBeNull();
    // 清 cookie（当前设备登出）
    expect(response.headers.get("Set-Cookie") ?? "").toContain(cookieName);
    expect(response.headers.get("Set-Cookie") ?? "").toContain("Max-Age=0");
  });

  it("lists only same-login sessions with meta (no token leaked)", async () => {
    const cookieName = env.SESSION_COOKIE_NAME;
    await env.SESSIONS.put(
      "session:current-1",
      JSON.stringify(makeSession("octocat", { deviceId: "dev-current", country: "CN" })),
    );
    await env.SESSIONS.put(
      "session:other-1",
      JSON.stringify(makeSession("octocat", { deviceId: "dev-other" })),
    );
    // 其他用户的会话不应出现在列表中
    await env.SESSIONS.put("session:alien-1", JSON.stringify(makeSession("someone-else")));

    const response = await SELF.fetch("https://example.com/$auth/sessions", {
      headers: { Cookie: `${cookieName}=current-1` },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      sessions: Array<Record<string, unknown>>;
    };
    expect(data.sessions).toHaveLength(2);
    const current = data.sessions.find((s) => s.isCurrent);
    expect(current?.id).toBe("current-1");
    expect(current?.deviceId).toBe("dev-current");
    expect(current?.ip).toBe("1.2.3.4");
    // 国家码透出（会话列表展示 IP 来源国家）
    expect(current?.country).toBe("CN");
    // 列表绝不返回 token
    expect(current).not.toHaveProperty("token");
    const other = data.sessions.find((s) => !s.isCurrent);
    expect(other?.id).toBe("other-1");
  });

  it("logs out another device session locally (KV removed, current kept)", async () => {
    const cookieName = env.SESSION_COOKIE_NAME;
    await env.SESSIONS.put("session:current-2", JSON.stringify(makeSession("octocat")));
    await env.SESSIONS.put("session:other-2", JSON.stringify(makeSession("octocat")));

    const response = await SELF.fetch("https://example.com/$auth/sessions/other-2/logout", {
      method: "POST",
      headers: { Cookie: `${cookieName}=current-2` },
    });
    expect(response.status).toBe(200);
    expect(await env.SESSIONS.get("session:other-2")).toBeNull();
    expect(await env.SESSIONS.get("session:current-2")).not.toBeNull();
  });

  it("forbids logging out another user's session", async () => {
    const cookieName = env.SESSION_COOKIE_NAME;
    await env.SESSIONS.put("session:current-3", JSON.stringify(makeSession("octocat")));
    await env.SESSIONS.put("session:alien-3", JSON.stringify(makeSession("someone-else")));

    const response = await SELF.fetch("https://example.com/$auth/sessions/alien-3/logout", {
      method: "POST",
      headers: { Cookie: `${cookieName}=current-3` },
    });
    expect(response.status).toBe(403);
    expect(await env.SESSIONS.get("session:alien-3")).not.toBeNull();
  });

  it("POST /$auth/session patches missing user metadata (login/userId/avatar)", async () => {
    // 降级会话（OAuth 回调网络受限 → login/userId 为空）
    const cookieName = env.SESSION_COOKIE_NAME;
    await env.SESSIONS.put(
      "session:patch-1",
      JSON.stringify(makeSession("", { userId: undefined, avatarUrl: undefined })),
    );

    // mock api.github.com /user：验证声称身份与 token 真实身份一致才写回
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.startsWith("https://api.github.com/user")) {
          return new Response(JSON.stringify({ login: "evil7", id: 6292673 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    try {
      const response = await SELF.fetch("https://example.com/$auth/session", {
        method: "POST",
        headers: {
          Cookie: `${cookieName}=patch-1`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: "evil7",
          userId: 6292673,
          avatarUrl: "https://avatars.githubusercontent.com/u/6292673?v=4",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      // KV 已写回
      const stored = JSON.parse((await env.SESSIONS.get("session:patch-1")) as string) as Record<
        string,
        unknown
      >;
      expect(stored.login).toBe("evil7");
      expect(stored.userId).toBe(6292673);
      expect(stored.avatarUrl).toContain("avatars.githubusercontent.com");

      // 后续 GET /$auth/session 返回补全后的 userId
      const getRes = await SELF.fetch("https://example.com/$auth/session", {
        headers: { Cookie: `${cookieName}=patch-1` },
      });
      const data = (await getRes.json()) as { user: Record<string, unknown> };
      expect(data.user.userId).toBe(6292673);
      expect(data.user.login).toBe("evil7");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /$auth/session rejects invalid fields and forged identity", async () => {
    const cookieName = env.SESSION_COOKIE_NAME;
    // 已含 login/userId 的会话
    await env.SESSIONS.put(
      "session:patch-2",
      JSON.stringify(makeSession("evil7", { userId: 6292673, avatarUrl: undefined })),
    );

    // 无效字段（login 带非法字符、userId 负数）→ 400（格式校验，无需 /user）
    const bad = await SELF.fetch("https://example.com/$auth/session", {
      method: "POST",
      headers: {
        Cookie: `${cookieName}=patch-2`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login: "-bad-", userId: -1 }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_fields" });

    // 伪造身份（声称 hacker/999，但 token 真实身份是 evil7/6292673）→ 403 拒绝
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.startsWith("https://api.github.com/user")) {
          return new Response(JSON.stringify({ login: "evil7", id: 6292673 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    try {
      const forged = await SELF.fetch("https://example.com/$auth/session", {
        method: "POST",
        headers: {
          Cookie: `${cookieName}=patch-2`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ login: "hacker", userId: 999 }),
      });
      expect(forged.status).toBe(403);
      expect(await forged.json()).toEqual({ error: "identity_mismatch" });

      // session 未被污染（仍为 evil7/6292673）
      const stored = JSON.parse((await env.SESSIONS.get("session:patch-2")) as string) as Record<
        string,
        unknown
      >;
      expect(stored.login).toBe("evil7");
      expect(stored.userId).toBe(6292673);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /$auth/session returns 401 without cookie / invalid session", async () => {
    const noCookie = await SELF.fetch("https://example.com/$auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "evil7", userId: 6292673 }),
    });
    expect(noCookie.status).toBe(401);

    const badSession = await SELF.fetch("https://example.com/$auth/session", {
      method: "POST",
      headers: {
        Cookie: `${env.SESSION_COOKIE_NAME}=nonexistent`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login: "evil7", userId: 6292673 }),
    });
    expect(badSession.status).toBe(401);
  });
});

// ADR 2026-08-07 / 2026-08-10：用户偏好云同步（/$auth/prefs，KV 键 prefs:{userId}，login 兼容读）
describe("PureGit worker prefs sync", () => {
  const cookieName = env.SESSION_COOKIE_NAME;
  const makeSession = (login: string, userId?: number) => ({
    token: "gho_test_token",
    login,
    ...(userId != null ? { userId } : {}),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    scopes: { mode: "read" },
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    ua: "test",
    ip: "1.2.3.4",
    deviceId: "dev-1",
  });

  it("GET /$auth/prefs returns 401 without cookie", async () => {
    const response = await SELF.fetch("https://example.com/$auth/prefs");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("stores under prefs:{userId} (whitelist incl. dateFormat), old login key read-compatible", async () => {
    // 旧数据（2026-08-10 前 prefs:{login}）——userId 会话应能读到
    await env.SESSIONS.put("prefs:octocat", JSON.stringify({ theme: "dark", updatedAt: "1" }));
    await env.SESSIONS.put("session:prefs-1", JSON.stringify(makeSession("octocat", 123456)));
    const headers = { Cookie: `${cookieName}=prefs-1` };

    // 初始：userId 键未命中 → 回退 login 键（旧数据兼容）
    let res = await SELF.fetch("https://example.com/$auth/prefs", { headers });
    expect(res.status).toBe(200);
    const init = (await res.json()) as { prefs: Record<string, string> };
    expect(init.prefs.theme).toBe("dark");

    // PUT：整体序列化 + 白名单（theme/lang/codeTheme/apiMode/dateFormat）丢弃未知键
    res = await SELF.fetch("https://example.com/$auth/prefs", {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        prefs: {
          theme: "dark",
          lang: "zh-CN",
          codeTheme: "oneDark",
          apiMode: "graphql",
          dateFormat: "relative",
          evil: "injected",
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // GET 确认：白名单 5 键 + updatedAt，未知键被丢弃
    res = await SELF.fetch("https://example.com/$auth/prefs", { headers });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { prefs: Record<string, string> };
    expect(data.prefs.theme).toBe("dark");
    expect(data.prefs.lang).toBe("zh-CN");
    expect(data.prefs.codeTheme).toBe("oneDark");
    expect(data.prefs.apiMode).toBe("graphql");
    expect(data.prefs.dateFormat).toBe("relative");
    expect(data.prefs.updatedAt).toBeDefined();
    expect(data.prefs).not.toHaveProperty("evil");

    // KV 直接验证：写入 userId 键（数字 ID，非 login）
    const stored = await env.SESSIONS.get("prefs:123456");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as Record<string, string>;
    expect(parsed.theme).toBe("dark");
    expect(parsed.dateFormat).toBe("relative");
  });

  it("PUT rejects non-object / empty prefs (400)", async () => {
    await env.SESSIONS.put("session:prefs-2", JSON.stringify(makeSession("octocat", 123456)));
    const headers = {
      Cookie: `${cookieName}=prefs-2`,
      "Content-Type": "application/json",
    };

    let res = await SELF.fetch("https://example.com/$auth/prefs", {
      method: "PUT",
      headers,
      body: JSON.stringify({ prefs: "not-an-object" }),
    });
    expect(res.status).toBe(400);

    res = await SELF.fetch("https://example.com/$auth/prefs", {
      method: "PUT",
      headers,
      body: JSON.stringify({ prefs: { junk: "only-unknown-keys" } }),
    });
    expect(res.status).toBe(400);
  });

  it("legacy session (no userId/login) can PUT with body userId, GET with query userId", async () => {
    await env.SESSIONS.put("session:prefs-3", JSON.stringify(makeSession("")));
    // PUT 带前端补传 userId → 成功（定位 prefs:{userId}）
    let res = await SELF.fetch("https://example.com/$auth/prefs", {
      method: "PUT",
      headers: {
        Cookie: `${cookieName}=prefs-3`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefs: { theme: "dark" },
        userId: "999",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const stored = await env.SESSIONS.get("prefs:999");
    expect(stored).not.toBeNull();

    // GET 带 ?userId= → 成功拉取
    res = await SELF.fetch("https://example.com/$auth/prefs?userId=999", {
      headers: { Cookie: `${cookieName}=prefs-3` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { prefs: Record<string, string> };
    expect(data.prefs.theme).toBe("dark");

    // PUT 不带 userId → 401（无法定位用户）
    res = await SELF.fetch("https://example.com/$auth/prefs", {
      method: "PUT",
      headers: {
        Cookie: `${cookieName}=prefs-3`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefs: { theme: "dark" } }),
    });
    expect(res.status).toBe(401);

    // GET 无 userId → 401（遗留会话无法定位，前端静默）
    res = await SELF.fetch("https://example.com/$auth/prefs", {
      headers: { Cookie: `${cookieName}=prefs-3` },
    });
    expect(res.status).toBe(401);
  });
});
