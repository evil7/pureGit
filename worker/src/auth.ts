/**
 * GitHub OAuth2 令牌管理
 *
 * 职责边界（架构红线）：
 * - client_secret 仅存在于 Worker 环境（Secret），绝不进入前端
 * - access token 存 KV（键 = 会话 id），前端经 /$auth/session 取回存内存
 * - httpOnly cookie 只存会话 id，不存 token 本身
 *
 * 持久会话（TTL 7 天安全收紧）：
 * - GitHub OAuth App token 本身永不过期（无 refresh，仅 GitHub 端撤销才失效）
 * - KV 会话与 cookie 使用 **TTL 7 天**，实现「短周期持久登录」——
 *   过期后需重新授权（收紧会话窗口，降低 token 长期滞留风险）；本地登出/撤销即删
 * - 会话记录设备/IP/时间元数据（/$auth/sessions 列表 + 本地登出 + 撤销）
 */

import { buildDeleteCookie, buildSessionCookie, corsHeaders, parseCookies } from "./cookies";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";

/** 会话有效期（秒）— 7 天（修订：365 天 → 7 天，安全收紧）：GitHub OAuth App
 * token 本身永不过期，但 KV 会话/cookie/expiresAt 统一 7 天——同设备 7 天内免重新授权，
 * 过期自动重新登录；本地登出/撤销即删，避免 KV 死键无限膨胀 */
const SESSION_TTL = 7 * 24 * 60 * 60;
/** state 防 CSRF 有效期（秒） */
const STATE_TTL = 600;

/**
 * 校验请求是否带有效会话（proxy 匿名闸复用）。
 * 返回会话中记录的 login（未登录/会话失效返回 null）。仅读取，不更新 lastSeen。
 */
export async function getSessionLogin(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as SessionData;
    return session.login ?? null;
  } catch {
    return null;
  }
}

/**
 * 校验请求是否带有效会话并返回完整 token（/$raw 代理透传上游用——
 * 登录态私有仓库 raw 可读）。未登录/会话失效返回 null。仅读取，不更新 lastSeen。
 * ⚠️ 仅 Worker 内部使用（透传到 raw.githubusercontent.com 上游），绝不回显给前端。
 */
export async function getSessionToken(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as SessionData;
    return session.token ?? null;
  } catch {
    return null;
  }
}

/** 偏好同步白名单键（仅 UI 偏好；绝不含 token/密钥） */
const PREFS_KEYS = ["theme", "lang", "codeTheme", "apiMode", "dateFormat", "feedFilter"] as const;

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_OAUTH_CALLBACK: string;
  SESSION_COOKIE_NAME: string;
  FRONTEND_URL: string;
  SESSIONS: KVNamespace;
}

interface SessionData {
  token: string;
  login: string;
  /** GitHub 用户数字 ID（/user id；改名/换登录名不变，偏好键等稳定定位用） */
  userId?: number;
  avatarUrl?: string;
  expiresAt: number;
  /** 登录时申请的权限（仅 mode，默认涵盖 private/org/资料/邮箱） */
  scopes: LoginScopes;
  /** GitHub 实际授予的 scope 列表（token 交换响应 `scope` 字段；用户可编辑授权，可能少于请求；旧会话缺失） */
  grantedScopes?: string[];
  /** 登录方式：oauth（GitHub 授权页）/ pat（直接输入 PAT）。旧会话缺失 = oauth */
  authMethod?: "oauth" | "pat";
  /** 前端生成的匿名设备标识（localStorage pg_device_id，非 token；清除站点数据后视为新设备） */
  deviceId?: string;
  /** 原始 User-Agent（前端解析展示设备标签，如「Chrome on Windows」） */
  ua?: string;
  /** 登录时的出口 IP（CF-Connecting-IP；本地 dev 可能缺失） */
  ip?: string;
  /** 登录时请求来源国家（Cloudflare request.cf.country，ISO 3166-1 alpha-2；本地 dev 缺失） */
  country?: string;
  /** 会话创建时间（毫秒时间戳） */
  createdAt: number;
  /** 最后活跃时间（毫秒时间戳；/$auth/session 节流更新） */
  lastSeenAt?: number;
}

/** 登录权限（默认涵盖账户相关 private 库 + 组织信息 + 资料 + 邮箱，仅读写切分） */
export interface LoginScopes {
  /** 只读模式（read）/ 完全控制（write） */
  mode: "read" | "write";
}

/**
 * 依据登录请求参数构造权限选择（默认：只读模式）
 * 注意：保留 ?private=&org=&edit=&gist= 参数兼容旧链接，但仅解析 mode（新设计默认涵盖）
 */
function buildLoginScopes(url: URL): LoginScopes {
  return {
    mode: url.searchParams.get("mode") === "write" ? "write" : "read",
  };
}

/** 权限选择 → GitHub OAuth scope 字符串（空格分隔）
 *
 * 只读模式：`repo read:org read:user user:email read:public_key read:gpg_key read:project`
 *   - repo：访问 private 库（GitHub 无只读 repo scope，授予后由应用层强制只读）
 *   - read:org：组织信息只读
 *   - read:user user:email：用户资料与邮箱只读
 *   - read:public_key：SSH keys 只读（列出）
 *   - read:gpg_key：GPG keys 只读（补）
 *   - read:project：Projects v2 只读（实测：GraphQL projectsV2 字段强制要求，repo 不涵盖）
 * 完全控制：`repo admin:org user gist admin:public_key delete_repo workflow notifications admin:gpg_key project`
 *   - admin:org：组织资料/成员设置与修改（含 read:org 能力）
 *   - user：读写个人资料（隐含 user:email，故不再冗余列出）
 *   - gist：Gist 创建/编辑
 *   - admin:public_key：SSH keys 完整管理（列/加/删，含 read/write 能力）
 *   - delete_repo：删除仓库（仓库设置页删除功能必需）
 *   - workflow：编辑 GitHub Actions workflow 文件（文件编辑功能必需）
 *   - notifications：通知已读/订阅写操作（补；读取免费无需 scope）
 *   - admin:gpg_key：GPG keys 完整管理（补；read 模式对应 read:gpg_key）
 *   - project：Projects v2 读写（补：GraphQL projectsV2 字段强制要求）
 */
function buildGitHubScope(s: LoginScopes): string {
  if (s.mode === "write") {
    return "repo admin:org user gist admin:public_key delete_repo workflow notifications admin:gpg_key project";
  }
  return "repo read:org read:user user:email read:public_key read:gpg_key read:project";
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

/** GET /$auth/login — 302 跳转 GitHub 授权页（state 防 CSRF；支持 scope 选择参数 + redirect 回原页） */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const scopes = buildLoginScopes(url);
  // redirect 参数：登录成功后回原页（仅允许站内路径，防开放重定向）
  const rawRedirect = url.searchParams.get("redirect") ?? "";
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/";
  const state = crypto.randomUUID();
  // state KV 值 = 请求的权限 + redirect + deviceId（回调时写回会话并跳转；旧值 "1" 兼容）
  await env.SESSIONS.put(
    `state:${state}`,
    JSON.stringify({
      scopes,
      redirect,
      deviceId: url.searchParams.get("deviceId") ?? "",
    }),
    {
      expirationTtl: STATE_TTL,
    },
  );

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.GITHUB_OAUTH_CALLBACK,
    scope: buildGitHubScope(scopes),
    state,
  });

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302);
}

/** GET /$auth/callback — 校验 state → 换 token → 存 KV → 下发 cookie → 302 回前端
 * （request 用于记录设备 UA 与出口 IP，供会话列表展示） */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return json({ error: "missing_code_or_state" }, 400);
  }

  // 校验 state（防 CSRF），一次性使用；state 值携带请求的权限选择
  const validState = await env.SESSIONS.get(`state:${state}`);
  if (!validState) {
    return json({ error: "invalid_state" }, 403);
  }
  await env.SESSIONS.delete(`state:${state}`);

  // 解析权限选择 + deviceId（旧 state 值 "1" → 默认只读；旧 JSON 含勾选字段 → 仅取 mode）
  let scopes: LoginScopes = { mode: "read" };
  let redirect = "/";
  let deviceId = "";
  try {
    const parsed = JSON.parse(validState) as
      | Partial<LoginScopes>
      | { scopes?: Partial<LoginScopes>; redirect?: string; deviceId?: string };
    if ("scopes" in parsed && parsed.scopes) {
      // 新格式：{ scopes, redirect, deviceId }
      scopes = { mode: parsed.scopes.mode === "write" ? "write" : "read" };
      const r = parsed.redirect ?? "";
      redirect = r.startsWith("/") && !r.startsWith("//") ? r : "/";
      deviceId = typeof parsed.deviceId === "string" ? parsed.deviceId : "";
    } else {
      // 旧格式：直接是 scopes 对象
      scopes = {
        mode: (parsed as Partial<LoginScopes>).mode === "write" ? "write" : "read",
      };
    }
  } catch {
    // 兼容旧格式
  }

  // 用 code + client_secret 换取 access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_OAUTH_CALLBACK,
    }),
  });
  if (!tokenRes.ok) {
    return json({ error: "token_exchange_failed", detail: `HTTP ${tokenRes.status}` }, 400);
  }

  let tokenData: { access_token?: string; error?: string; scope?: string };
  try {
    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch {
    return json({ error: "token_exchange_failed", detail: "invalid_json" }, 400);
  }
  if (!tokenData.access_token) {
    return json({ error: "token_exchange_failed", detail: tokenData.error }, 400);
  }

  // 真实授予 scope：用户可编辑授权（granted ≠ requested），以 token 响应 `scope` 字段为准
  // （官方文档：请求会 normalized，如 user 隐含 user:email；逗号或空格分隔均兼容）
  const grantedScopes = (tokenData.scope ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 获取用户基本信息（login、头像、数字 ID）。失败不阻断登录——
  // api.github.com 网络受限时降级，登录名由前端拿 token 后自行补齐。
  // （OAuth 回调中 Worker 发往 GitHub 的唯一 API 请求；其余业务请求全在前端直连）
  let login = "";
  let avatarUrl: string | undefined;
  let userId: number | undefined;
  try {
    const started = Date.now();
    const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ms = Date.now() - started;
    console.log(`[PureGit API] [REST] GET /user ${userRes.status} ${ms}ms (worker OAuth callback)`);
    if (userRes.ok) {
      const user = (await userRes.json()) as {
        login?: string;
        avatar_url?: string;
        id?: number;
      };
      login = user.login ?? "";
      avatarUrl = user.avatar_url;
      userId = typeof user.id === "number" ? user.id : undefined;
    }
  } catch {
    // 网络受限：不阻断登录
    console.log(`[PureGit API] [REST] GET /user ERR (worker OAuth callback)`);
  }

  // 设备/IP/国家记录（会话列表展示；IP 取 Cloudflare 头，本地 dev 可能缺失 → 前端显示「未知」）
  const ua = request.headers.get("User-Agent") ?? "";
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "";
  // 请求来源国家（Cloudflare 地理信息；ISO 3166-1 alpha-2，如 CN/US；本地 dev 无 cf 属性）
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? "";

  // 存会话到 KV，下发 httpOnly cookie（仅会话 id）
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const session: SessionData = {
    token: tokenData.access_token,
    login,
    userId,
    avatarUrl,
    expiresAt: now + SESSION_TTL * 1000,
    scopes,
    grantedScopes,
    authMethod: "oauth",
    deviceId,
    ua,
    ip,
    country,
    createdAt: now,
    lastSeenAt: now,
  };
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  const isHttps = env.GITHUB_OAUTH_CALLBACK.startsWith("https://");
  const cookie = buildSessionCookie(env.SESSION_COOKIE_NAME, sessionId, SESSION_TTL, isHttps);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.FRONTEND_URL}${redirect}`,
      "Set-Cookie": cookie,
    },
  });
}

/**
 * POST /$auth/pat — PAT 直接登录（新增）
 *
 * 场景：GitHub 主站（github.com）网络受限时 OAuth 授权页不可达，但
 * api.github.com 可达——用户可粘贴 Personal Access Token（PAT）直接登录。
 *
 * 安全设计（与 OAuth 同等对待，红线 1）：
 * - PAT 仅经 HTTPS POST 到 Worker；Worker 用 PAT 调 `GET /user` 验证
 * - 验证通过后 PAT **只存 KV 会话**（服务端，等效 OAuth token 存法），
 *   下发 httpOnly cookie（仅会话 id）；前端照旧经 /$auth/session 恢复
 * - 响应不回显明文 PAT 副本——`token` 字段即 PAT 本身（前端调用 API 需要），
 *   与 OAuth token 同等对待；登出即删 KV 会话（PAT 随之移除）
 * - 前端不落 localStorage 明文；标签页级 sessionStorage 缓存沿用 既有约定
 *
 * 权限判定：读 `X-OAuth-Scopes` 响应头（classic PAT 返回，逗号分隔），
 * 含写 scope（admin:org/user/gist/admin:public_key/delete_repo/workflow/
 * notifications/admin:gpg_key 任一）→ mode=write，否则 read。
 * fine-grained PAT 不返回该头 → 保守判 read（只读），与 OAuth 少授同理。
 */
export async function handlePatLogin(request: Request, env: Env): Promise<Response> {
  // 仅 POST
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, corsHeaders(env.FRONTEND_URL));
  }

  // 解析 body（PAT + 设备标识；失败 400）
  let pat = "";
  let deviceId = "";
  try {
    const body = (await request.json()) as { pat?: unknown; deviceId?: unknown };
    pat = typeof body.pat === "string" ? body.pat.trim() : "";
    deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  } catch {
    return json({ error: "invalid_json" }, 400, corsHeaders(env.FRONTEND_URL));
  }
  if (!pat) {
    return json({ error: "missing_pat" }, 400, corsHeaders(env.FRONTEND_URL));
  }

  // 用 PAT 验证身份 + 读取真实权限（X-OAuth-Scopes 头）
  let userRes: Response;
  try {
    const started = Date.now();
    userRes = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    const ms = Date.now() - started;
    console.log(`[PureGit API] [REST] GET /user ${userRes.status} ${ms}ms (worker PAT login)`);
  } catch {
    console.log(`[PureGit API] [REST] GET /user ERR (worker PAT login)`);
    // api.github.com 网络受限 → 无法验证，提示稍后重试
    return json({ error: "pat_verify_failed" }, 502, corsHeaders(env.FRONTEND_URL));
  }
  if (userRes.status === 401 || userRes.status === 403) {
    return json({ error: "invalid_pat" }, 401, corsHeaders(env.FRONTEND_URL));
  }
  if (!userRes.ok) {
    return json(
      { error: "pat_verify_failed", detail: `HTTP ${userRes.status}` },
      502,
      corsHeaders(env.FRONTEND_URL),
    );
  }

  const user = (await userRes.json()) as {
    login?: string;
    avatar_url?: string;
    id?: number;
  };
  if (!user.login) {
    return json(
      { error: "pat_verify_failed", detail: "no_login" },
      502,
      corsHeaders(env.FRONTEND_URL),
    );
  }

  // 真实权限：X-OAuth-Scopes（classic PAT；fine-grained 缺失 → 保守 read）
  const scopesHeader = userRes.headers.get("X-OAuth-Scopes") ?? "";
  const grantedScopes = scopesHeader
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const writeScopes = [
    "admin:org",
    "user",
    "gist",
    "admin:public_key",
    "delete_repo",
    "workflow",
    "notifications",
    "admin:gpg_key",
  ];
  const mode: "read" | "write" = grantedScopes.some((s) => writeScopes.includes(s))
    ? "write"
    : "read";

  // 设备/IP/国家记录（会话列表展示；与 OAuth 回调同构）
  const ua = request.headers.get("User-Agent") ?? "";
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "";
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? "";

  // 存会话到 KV，下发 httpOnly cookie（仅会话 id）——PAT 等效 OAuth token 存 KV
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const session: SessionData = {
    token: pat,
    login: user.login,
    userId: typeof user.id === "number" ? user.id : undefined,
    avatarUrl: user.avatar_url,
    expiresAt: now + SESSION_TTL * 1000,
    scopes: { mode },
    grantedScopes,
    authMethod: "pat",
    deviceId,
    ua,
    ip,
    country,
    createdAt: now,
    lastSeenAt: now,
  };
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  const isHttps = env.GITHUB_OAUTH_CALLBACK.startsWith("https://");
  const cookie = buildSessionCookie(env.SESSION_COOKIE_NAME, sessionId, SESSION_TTL, isHttps);

  return json(
    {
      authenticated: true,
      token: pat,
      user: {
        login: user.login,
        avatarUrl: user.avatar_url,
        userId: typeof user.id === "number" ? user.id : undefined,
      },
      scopes: { mode },
      grantedScopes,
      expiresAt: session.expiresAt,
    },
    200,
    {
      ...corsHeaders(env.FRONTEND_URL),
      "Set-Cookie": cookie,
    },
  );
}

/** GET /$auth/session — 读 cookie → 查 KV → 返回 token（前端恢复内存令牌）
 * ctx：异步节流更新 lastSeenAt（≥1h 才写回，避免每次刷新都写 KV） */
export async function handleSession(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  if (!sessionId) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  let session: SessionData;
  try {
    session = JSON.parse(raw) as SessionData;
  } catch {
    await env.SESSIONS.delete(`session:${sessionId}`);
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  // 节流更新最后活跃时间（异步，不阻塞响应；写入时保留原始 TTL）
  const now = Date.now();
  if (!session.lastSeenAt || now - session.lastSeenAt > 60 * 60 * 1000) {
    const updated = { ...session, lastSeenAt: now };
    ctx.waitUntil(
      env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(updated), {
        expirationTtl: SESSION_TTL,
      }),
    );
  }

  return json(
    {
      authenticated: true,
      token: session.token,
      user: { login: session.login, avatarUrl: session.avatarUrl, userId: session.userId },
      scopes: session.scopes,
      // GitHub 实际授予的 scope 列表（旧会话可能缺失）
      grantedScopes: session.grantedScopes,
      // 会话过期时间（毫秒时间戳）：前端缓存据此判断是否需重新请求
      expiresAt: session.expiresAt,
    },
    200,
    corsHeaders(env.FRONTEND_URL),
  );
}

/**
 * POST /$auth/session — 补全会话用户元数据
 *
 * 背景：OAuth/PAT 登录时 api.github.com 网络受限 → 回调中 `GET /user` 降级
 * （login/userId/avatarUrl 为空，注释见 handleCallback）。前端拿到 token 后
 * 自行补齐用户信息（useAuth fetchCurrentUserSmart），但此前**只更新内存/缓存**，
 * 未写回 KV session → debug 白名单（按 userId）与偏好键（prefs:{userId}）均无法
 * 命中降级会话（user metadata 遗漏 用户定位）。
 *
 * 本端点：前端补全后回写 KV session。白名单校验防伪造：
 * - login：GitHub 命名规范（字母数字+连字符，1~39，不以连字符开头/结尾）
 * - userId：正整数数字 ID（1~16 位）
 * - avatarUrl：https:// 开头，长度 ≤ 512
 * 仅补缺省（session 中已有该字段则不覆盖，防降级会话篡改既有身份）。
 */
const SESSION_LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

export async function handleSessionPatch(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env.FRONTEND_URL);

  // 会话鉴权：cookie → KV session
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  if (!sessionId) {
    return json({ error: "unauthenticated" }, 401, cors);
  }
  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) {
    return json({ error: "unauthenticated" }, 401, cors);
  }
  let session: SessionData;
  try {
    session = JSON.parse(raw) as SessionData;
  } catch {
    return json({ error: "unauthenticated" }, 401, cors);
  }

  let body: { login?: unknown; userId?: unknown; avatarUrl?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }

  // 白名单校验
  const login =
    typeof body.login === "string" && body.login.length <= 39 && SESSION_LOGIN_RE.test(body.login)
      ? body.login
      : undefined;
  let userId: number | undefined;
  if (typeof body.userId === "number" && Number.isInteger(body.userId) && body.userId > 0) {
    userId = body.userId;
  } else if (typeof body.userId === "string" && /^\d{1,16}$/.test(body.userId)) {
    userId = Number(body.userId);
  }
  const avatarUrl =
    typeof body.avatarUrl === "string" &&
    body.avatarUrl.startsWith("https://") &&
    body.avatarUrl.length <= 512
      ? body.avatarUrl
      : undefined;

  if (!login && userId === undefined && !avatarUrl) {
    return json({ error: "invalid_fields" }, 400, cors);
  }

  // 真实性验证（防冒名）：用会话 token 请求 /user 取真实身份，
  // 与前端声称的 login/userId 比对。不一致或网络失败 → 拒绝写回（fail-closed）。
  // 背景：OAuth 回调时 worker GET /user 网络受限降级 → 会话元数据为空 → 前端补全；
  // 补全发生时前端 fetchCurrentUserSmart 已成功（网络恢复），worker 同 token 应可调通。
  // 若不验证，任何登录用户可冒充任意 userId（debug 白名单/prefs 键定位依赖 userId）。
  if (!session.token) {
    return json({ error: "unauthenticated" }, 401, cors);
  }
  let realLogin: string | null = null;
  let realUserId: number | null = null;
  try {
    const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (userRes.ok) {
      const u = (await userRes.json()) as { login?: string; id?: unknown };
      if (typeof u.login === "string" && typeof u.id === "number") {
        realLogin = u.login;
        realUserId = u.id;
      }
    }
  } catch {
    // 网络失败 → 保持 null（fail-closed）
  }
  // 声称值必须与真实身份一致（声称 userId 与真实 id 不符 → 拒绝；声称 login 同理）
  if ((login && login !== realLogin) || (userId !== undefined && userId !== realUserId)) {
    return json({ error: "identity_mismatch" }, 403, cors);
  }

  // 仅补缺省（已有值不覆盖）
  const updated: SessionData = { ...session };
  if (login && !session.login) updated.login = login;
  if (userId !== undefined && session.userId === undefined) updated.userId = userId;
  if (avatarUrl && !session.avatarUrl) updated.avatarUrl = avatarUrl;

  // 无变化 → 直接 ok（避免无谓 KV 写）
  if (JSON.stringify(updated) === JSON.stringify(session)) {
    return json({ ok: true }, 200, cors);
  }

  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(updated), {
    expirationTtl: SESSION_TTL,
  });
  return json({ ok: true }, 200, cors);
}

/** POST /$auth/logout — 删 KV 键 + 清除 cookie */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  if (sessionId) {
    await env.SESSIONS.delete(`session:${sessionId}`);
  }

  return json({ ok: true }, 200, {
    ...corsHeaders(env.FRONTEND_URL),
    "Set-Cookie": buildDeleteCookie(env.SESSION_COOKIE_NAME),
  });
}

/**
 * POST /$auth/logout/all — 登出全部设备（删当前用户全部 KV 会话 + 清 cookie）
 *
 * - 归属校验：只能删除与当前 cookie 会话同 login 的会话（含当前设备）
 * - GitHub 端 token 保留（与单设备登出一致；真撤销走 /$auth/revoke）
 * - 幂等：无有效会话 → 401；删除后返回实际删除数
 */
export async function handleLogoutAll(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  const current = parseSession(sessionId ? await env.SESSIONS.get(`session:${sessionId}`) : null);
  if (!sessionId || !current) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  // 枚举全部会话 → 删除与当前 login 相同的（含当前设备；其他用户会话不受影响）
  const list = await env.SESSIONS.list({ prefix: "session:" });
  const entries = await Promise.all(
    list.keys.map(async (k) => ({
      name: k.name,
      login: parseSession(await env.SESSIONS.get(k.name))?.login ?? null,
    })),
  );
  const mine = entries.filter((e) => e.login === current.login);
  await Promise.all(mine.map((e) => env.SESSIONS.delete(e.name)));

  return json({ ok: true, removed: mine.length }, 200, {
    ...corsHeaders(env.FRONTEND_URL),
    "Set-Cookie": buildDeleteCookie(env.SESSION_COOKIE_NAME),
  });
}

/** 会话元数据（绝不含 token —— 列表接口最小暴露） */
function toSessionMeta(s: SessionData, id: string, isCurrent: boolean) {
  return {
    id,
    isCurrent,
    mode: s.scopes?.mode ?? "read",
    authMethod: s.authMethod ?? "oauth",
    deviceId: s.deviceId ?? "",
    ua: s.ua ?? "",
    ip: s.ip ?? "",
    country: s.country ?? "",
    createdAt: s.createdAt ?? 0,
    lastSeenAt: s.lastSeenAt ?? 0,
  };
}

/** 解析会话 JSON；损坏返回 null */
function parseSession(raw: string | null): SessionData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

/**
 * GET /$auth/sessions — 当前用户全部会话元数据（不含 token；凭据管理页「登录凭据」列表）
 *
 * 实现：枚举 `session:` 前缀键（个人用户量级个位数~几十，list+get 足够），
 * 过滤与当前 cookie 会话同 login 的会话；标记当前会话。
 */
export async function handleSessionsList(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const currentId = cookies[env.SESSION_COOKIE_NAME];
  const current = parseSession(currentId ? await env.SESSIONS.get(`session:${currentId}`) : null);
  if (!currentId || !current) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  const sessions = [toSessionMeta(current, currentId, true)];
  const list = await env.SESSIONS.list({ prefix: "session:" });
  for (const key of list.keys) {
    if (key.name === `session:${currentId}`) continue;
    const s = parseSession(await env.SESSIONS.get(key.name));
    if (s && s.login === current.login) {
      // id 去掉 `session:` 前缀（logout 端点会重新拼接）
      sessions.push(toSessionMeta(s, key.name.slice("session:".length), false));
    }
  }

  return json({ sessions }, 200, corsHeaders(env.FRONTEND_URL));
}

/**
 * POST /$auth/sessions/:id/logout — 本地登出指定设备（仅删 KV 会话，GitHub 端 token 保留）
 *
 * - 归属校验：只能操作与当前 cookie 会话同 login 的会话
 * - 登出的是当前设备 → 顺带清 cookie（等于登出本机）
 */
export async function handleSessionLogout(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const cookies = parseCookies(request);
  const currentId = cookies[env.SESSION_COOKIE_NAME];
  const current = parseSession(currentId ? await env.SESSIONS.get(`session:${currentId}`) : null);
  if (!currentId || !current) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  // 目标不存在 → 视为已登出，返回成功（幂等）
  const target = parseSession(await env.SESSIONS.get(`session:${id}`));
  if (!target) {
    return json({ ok: true }, 200, corsHeaders(env.FRONTEND_URL));
  }
  // 归属校验：只能登出自己名下的会话
  if (target.login !== current.login) {
    return json({ error: "forbidden" }, 403, corsHeaders(env.FRONTEND_URL));
  }

  await env.SESSIONS.delete(`session:${id}`);
  const headers: Record<string, string> = { ...corsHeaders(env.FRONTEND_URL) };
  if (id === currentId) {
    headers["Set-Cookie"] = buildDeleteCookie(env.SESSION_COOKIE_NAME);
  }
  return json({ ok: true }, 200, headers);
}

/**
 * POST /$auth/revoke — 撤销 PureGit OAuth App 授权（凭据管理页危险区）
 *
 * 1. GitHub 端真撤销当前会话 token（官方 `DELETE /applications/{client_id}/token`，
 *    Basic Auth 用 client_id:client_secret，均在 Worker 侧）
 * 2. 删除该用户全部本地 KV 会话 + 清 cookie（所有设备立即退出）
 */
export async function handleRevokeApp(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  const session = parseSession(sessionId ? await env.SESSIONS.get(`session:${sessionId}`) : null);
  if (!sessionId || !session) {
    return json({ authenticated: false }, 401, corsHeaders(env.FRONTEND_URL));
  }

  // 1. GitHub 端撤销 token（204 成功；404 = 已在 GitHub 端撤销，同样视为成功）
  const basic = btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`);
  const revokeRes = await fetch(
    `https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: session.token }),
    },
  );
  if (revokeRes.status !== 204 && revokeRes.status !== 404) {
    return json(
      { error: "revoke_failed", detail: `HTTP ${revokeRes.status}` },
      502,
      corsHeaders(env.FRONTEND_URL),
    );
  }

  // 2. 删除该用户全部本地 KV 会话（含当前）
  const list = await env.SESSIONS.list({ prefix: "session:" });
  const entries = await Promise.all(
    list.keys.map(async (k) => ({
      name: k.name,
      login: parseSession(await env.SESSIONS.get(k.name))?.login ?? null,
    })),
  );
  await Promise.all(
    entries.filter((e) => e.login === session.login).map((e) => env.SESSIONS.delete(e.name)),
  );

  return json({ ok: true }, 200, {
    ...corsHeaders(env.FRONTEND_URL),
    "Set-Cookie": buildDeleteCookie(env.SESSION_COOKIE_NAME),
  });
}

/**
 * GET/PUT /$auth/prefs — 用户偏好云同步（创建 / 键改为 userId）
 *
 * 存储：KV 键 `prefs:{userId}`（**用户级**，不过期；GitHub 用户数字 ID 永不变——
 * 登录名可改名/换用，userId 稳定 用户确认）。旧 `prefs:{login}` 键读时兼容。
 * 与 session:{id} 的区别：会话是设备级（每台设备一个），偏好是用户级——
 * 同一用户多设备登录共享同一份偏好，换设备自动同步。
 *
 * - GET：读 cookie 会话 → userId（缺省回退 login 键读旧数据）→ 返回 `{ prefs }`（无则 null）
 * - PUT：body `{ prefs, userId?, login? }` → 白名单校验（PREFS_KEYS，仅字符串）→ 写 `prefs:{userId}`
 * - 遗留会话兼容：网络受限时 OAuth 回调拿不到 login/id（会话字段为空），
 *   PUT 允许前端补传 userId（数字）定位偏好键（userId 非敏感、prefs 无权限影响，风险可接受）；
 *   会话字段非空则强制用会话值，防伪造
 * - 安全：prefs 仅 UI 偏好（theme/lang/codeTheme/apiMode/dateFormat），绝不含 token/密钥；
 *   白名单丢弃未知键，防任意字段注入
 */
export async function handlePrefs(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env.FRONTEND_URL);

  // 会话鉴权：cookie → KV session
  const cookies = parseCookies(request);
  const sessionId = cookies[env.SESSION_COOKIE_NAME];
  const session = parseSession(sessionId ? await env.SESSIONS.get(`session:${sessionId}`) : null);
  if (!sessionId || !session) {
    return json({ error: "unauthenticated" }, 401, cors);
  }
  // 定位用户级偏好键：会话 userId 优先；缺 userId（旧会话）回退 login 键
  const userIdKey = session.userId ? `prefs:${session.userId}` : "";
  const loginKey = session.login ? `prefs:${session.login}` : "";

  if (request.method === "GET") {
    // 读：userId 键优先；未命中回退 login 键（前旧数据）；仍无则 null
    let prefsKey = userIdKey || loginKey;
    if (!prefsKey) {
      // 遗留会话（无 userId/login）：允许 `?userId=` 或 `?login=` 定位（与 PUT 对称）
      const q = new URL(request.url).searchParams;
      const qUserId = q.get("userId") ?? "";
      const qLogin = q.get("login") ?? "";
      if (/^\d{1,16}$/.test(qUserId)) {
        prefsKey = `prefs:${qUserId}`;
      } else if (qLogin && qLogin.length <= 64) {
        prefsKey = `prefs:${qLogin}`;
      } else {
        return json({ error: "unauthenticated" }, 401, cors);
      }
    }
    let stored = await env.SESSIONS.get(prefsKey);
    // userId 键未命中 → 旧 login 键兜底读
    if (!stored && userIdKey && loginKey && prefsKey === userIdKey) {
      stored = await env.SESSIONS.get(loginKey);
    }
    if (!stored) {
      return json({ prefs: null }, 200, cors);
    }
    try {
      return json({ prefs: JSON.parse(stored) }, 200, cors);
    } catch {
      return json({ prefs: null }, 200, cors);
    }
  }

  if (request.method === "PUT") {
    let prefs: Record<string, unknown>;
    let bodyUserId = "";
    let bodyLogin = "";
    try {
      const body = (await request.json()) as {
        prefs?: unknown;
        userId?: unknown;
        login?: unknown;
      };
      if (!body.prefs || typeof body.prefs !== "object" || Array.isArray(body.prefs)) {
        return json({ error: "invalid_prefs" }, 400, cors);
      }
      prefs = body.prefs as Record<string, unknown>;
      bodyUserId = typeof body.userId === "string" ? body.userId.trim() : "";
      bodyLogin = typeof body.login === "string" ? body.login.trim() : "";
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    // 写：会话 userId 优先；缺（遗留会话）允许前端补传 userId 或 login
    let prefsKey = userIdKey;
    if (!prefsKey) {
      if (/^\d{1,16}$/.test(bodyUserId)) {
        prefsKey = `prefs:${bodyUserId}`;
      } else if (bodyLogin && bodyLogin.length <= 64) {
        prefsKey = `prefs:${bodyLogin}`;
      } else {
        return json({ error: "unauthenticated" }, 401, cors);
      }
    }

    // 白名单：仅保留合法键且值为短字符串（丢弃未知键）
    const clean: Record<string, string> = {};
    for (const k of PREFS_KEYS) {
      const v = prefs[k];
      if (typeof v === "string" && v.length > 0 && v.length <= 64) {
        clean[k] = v;
      }
    }
    if (Object.keys(clean).length === 0) {
      return json({ error: "invalid_prefs" }, 400, cors);
    }
    clean.updatedAt = String(Date.now());

    // 不过期（用户级偏好常驻）；整体序列化保存
    await env.SESSIONS.put(prefsKey, JSON.stringify(clean));
    return json({ ok: true }, 200, cors);
  }

  return json({ error: "method_not_allowed" }, 405, cors);
}
