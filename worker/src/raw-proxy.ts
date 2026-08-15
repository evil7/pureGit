/**
 * Raw 内容代理（架构扩展 + 防滥用增强）
 *
 * 背景：raw.githubusercontent.com 前端直连在部分网络环境被墙/不可达（CORS/超时）。
 * 本端点做服务端 fetch 代理：GET /$raw/{owner}/{repo}/{ref}/{path...} →
 * raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}，透传上游 Content-Type。
 *
 * 与 /$wiki 的区别：
 *   - /$wiki：raw .../wiki/{page}.md 单文件（wiki 专用，返回 md 文本）
 *   - /$raw：任意仓库任意 ref 下任意路径（README 图片/资源、blob 附件等，按上游 Content-Type 透传）
 *
 * 系统前缀安全（修订）：
 *   - `$raw`/`$wiki` 以 `$` 符号前缀标识**内部高优先级功能性路由**——GitHub 用户名/仓库名规范
 *     不含 `$`，/$raw /$wiki 永不被 /:owner/:repo 用户级通配路由占用。
 *   - 上游白名单：仅 raw.githubusercontent.com（防 SSRF——不解析用户任意 URL）。
 *   - 仅 GET；15s 超时；可选反代开关（RAW_PROXY_ENABLE，见 index.ts requireProxyAuth）。
 *
 * 防滥用与可靠性（防滥用增强）：
 *   - **分级限流**：匿名按 IP（CF-Connecting-IP）120 req/60s、登录按会话 login 600 req/60s
 *     （KV 固定窗口计数，超限 429 + Retry-After）。
 *   - **缓存层**：Cache API（caches.default，key=请求 URL）1h TTL——命中免上游请求，
 *     减上游压力与延迟（上游已回 Cache-Control: public max-age=3600）。
 *   - **安全头**：`X-Content-Type-Options: nosniff`（防 raw 内容被嗅探成 HTML/JS 执行）。
 *   - **路径防护**：段数 ≤16 且总长 ≤2048（防超长 URL 构造）；逐段 encodeURIComponent 防穿越。
 */
import { corsHeaders } from "./cookies";
import { getSessionLogin, getSessionToken } from "./auth";

const RAW_BASE = "https://raw.githubusercontent.com";
/** 允许的 raw 上游主机（白名单，防 SSRF） */
const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "raw.githubusercontent.com."]);

/**
 * $raw 代理文件大小上限（10MB → 100MB，与 REST contents 100MB 通道对齐——
 * 保底通道必须能兜住 API 能读的最大文件）。超限 413 拒绝（防拉超大文件滥用）。
 * GraphQL blob 仍受 1MB 硬限制（前端 isTruncated 检查，不可改）。
 */
const RAW_MAX_BYTES = 100 * 1024 * 1024;
/** 上游 fetch 超时（15s → 30s，大文件安全裕度） */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** 分级限流：匿名（IP）/ 登录（login）每分钟配额 */
const ANON_LIMIT = 120;
const AUTH_LIMIT = 600;
const WINDOW_SEC = 60;

export function isRawRequest(pathname: string): boolean {
  // /$raw/{owner}/{repo}/{ref}/{path...}——path 至少 1 字符，可含目录斜杠
  return /^\/\$raw\/[^/]+\/[^/]+\/[^/]+\/.+$/.test(pathname);
}

/** 将代理请求路径重写为 raw.githubusercontent.com 目标 URL（逐段编码，保留目录） */
function rewriteRawUrl(requestUrl: URL): URL {
  const rest = requestUrl.pathname.slice("/$raw/".length);
  const [owner, repo, ref, ...pathParts] = rest.split("/");
  const path = pathParts.join("/");
  const enc = (s: string) => encodeURIComponent(decodeURIComponent(s));
  const target = new URL(
    `${RAW_BASE}/${enc(owner)}/${enc(repo)}/${enc(ref)}/${path
      .split("/")
      .map((seg) => enc(seg))
      .join("/")}`,
  );
  return target;
}

/**
 * 分级限流（KV 固定窗口计数）。
 * 匿名按 IP、登录按会话 login；超限返回 false（调用方回 429）。
 * KV 键 `rl:raw:{login|ip}:{windowStart}`，TTL = 2×窗口（兜底清理）。
 */
async function rateLimitRaw(
  env: Env,
  login: string | null,
  clientIp: string | null,
): Promise<boolean> {
  const limit = login ? AUTH_LIMIT : ANON_LIMIT;
  const identity = login ?? clientIp ?? "unknown";
  const windowStart = Math.floor(Date.now() / (WINDOW_SEC * 1000));
  const key = `rl:raw:${identity}:${windowStart}`;
  try {
    const current = Number((await env.SESSIONS.get(key)) ?? "0");
    if (current >= limit) return false;
    await env.SESSIONS.put(key, String(current + 1), {
      expirationTtl: WINDOW_SEC * 2,
    });
    return true;
  } catch {
    // 限流计数失败不阻断（fail-open，可靠性优先）
    return true;
  }
}

export async function handleRawProxy(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
      },
    });
  }

  const url = new URL(request.url);

  // 路径防护：段数 ≤16 且总长 ≤2048（防超长/超深 URL 构造）
  const restPath = url.pathname.slice("/$raw/".length);
  const segments = restPath.split("/");
  if (segments.length > 16 || restPath.length > 2048) {
    return new Response(JSON.stringify({ error: "path_too_long" }), {
      status: 414,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
      },
    });
  }

  const target = rewriteRawUrl(url);
  // 白名单校验（rewrite 已固定 host，双保险）
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new Response(JSON.stringify({ error: "upstream_forbidden" }), {
      status: 403,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
      },
    });
  }

  // 分级限流（匿名 IP 120/分；登录会话 600/分）
  const login = await getSessionLogin(request, env);
  // 会话 token：透传上游 → 登录态私有仓库 raw 可读；匿名/无会话 = null
  const sessionToken = await getSessionToken(request, env);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-real-ip");
  if (!(await rateLimitRaw(env, login, clientIp))) {
    return new Response(JSON.stringify({ error: "rate_limited", retry_after: WINDOW_SEC }), {
      status: 429,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
        "Retry-After": String(WINDOW_SEC),
      },
    });
  }

  // 缓存层（Cache API；key=请求 URL + 会话标记——防私有内容串入匿名共享缓存）
  // ⚠️ Cache API 全局共享：带 token 的私有 raw 与匿名公开 raw 必须隔离，
  // 否则登录会话的私有内容会命中给匿名请求（跨会话串读）。hash 段不发送到上游，仅作缓存键区分。
  const cache = caches.default;
  const cacheKey = new Request(`${url.toString()}#pg-${sessionToken ? "auth" : "anon"}`, {
    method: "GET",
  });
  const cached = await cache.match(cacheKey).catch(() => null);
  if (cached) return cached;

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: "*/*",
        "User-Agent": "PureGit-worker",
        // 登录会话透传（私有仓库 raw 可读）；匿名不带
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // 透传上游 Content-Type（图片/文本/二进制按实际类型）；404 透传；其余错误 502
    const upstreamType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
    if (upstream.status === 404) {
      return new Response(null, {
        status: 404,
        headers: corsHeaders(env.FRONTEND_URL),
      });
    }
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream_${upstream.status}` }), {
        status: 502,
        headers: {
          ...corsHeaders(env.FRONTEND_URL),
          "Content-Type": "application/json",
        },
      });
    }
    // 10MB 上限——Content-Length 预判 + 实际读取后双保险（分块响应无 CL 时后者兜底）
    const cl = Number(upstream.headers.get("Content-Length") ?? "0");
    if (cl > RAW_MAX_BYTES) {
      return new Response(JSON.stringify({ error: "file_too_large", max_bytes: RAW_MAX_BYTES }), {
        status: 413,
        headers: {
          ...corsHeaders(env.FRONTEND_URL),
          "Content-Type": "application/json",
        },
      });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > RAW_MAX_BYTES) {
      return new Response(JSON.stringify({ error: "file_too_large", max_bytes: RAW_MAX_BYTES }), {
        status: 413,
        headers: {
          ...corsHeaders(env.FRONTEND_URL),
          "Content-Type": "application/json",
        },
      });
    }
    const response = new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": upstreamType,
        // 防 raw 内容被嗅探成 HTML/JS 执行
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
    // 写入缓存（仅 200 缓存；1h TTL 与 Cache-Control 一致）
    await cache.put(cacheKey, response.clone()).catch(() => {});
    return response;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return new Response(
      JSON.stringify({ error: aborted ? "upstream_timeout" : "upstream_unreachable" }),
      {
        status: 504,
        headers: {
          ...corsHeaders(env.FRONTEND_URL),
          "Content-Type": "application/json",
        },
      },
    );
  }
}
