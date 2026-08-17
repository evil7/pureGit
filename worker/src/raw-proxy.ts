/**
 * Raw 内容代理（纯透传）—— GET /$raw/{owner}/{repo}/{ref}/{path}
 *
 * 中心思想（架构纠正）：`$raw` 回归**纯 worker 反代**（透传 raw.githubusercontent.com），
 * 不再承担「api contents / 302」智能路由职责——获取文件内容由前端直发 API
 * （登录带 token / 匿名不带），`$raw` 仅代表 worker proxy，受 RAW_PROXY_ENABLE 门控。
 *
 * 职责：
 * - 流式透传 raw.githubusercontent.com（带会话 token，私有仓库可读）
 * - 分级限流（匿名 IP / 登录会话）
 * - 仅 GET；Content-Type 透传（图片/文本/二进制）
 *
 * 安全：
 * - `$raw` 以 `$` 符号前缀标识内部功能性路由（GitHub 用户名/仓库名不含 `$`）。
 * - 上游白名单：仅 raw.githubusercontent.com（防 SSRF——不解析用户任意 URL）。
 * - 鉴权门控在 index.ts `requireProxyAuth`（off=403 / login=匿名 401 / on=全放）。
 * - 流式透传（不 arrayBuffer，避免 128MB 内存上限）。
 */
import { corsHeaders } from "./cookies";
import { getSessionLogin, getSessionToken } from "./auth";
import { rateLimitProxy, rateLimitedResponse } from "./stream-proxy";

const RAW_BASE = "https://raw.githubusercontent.com";
/** 上游 fetch 超时（30s，大文件安全裕度） */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** 分级限流：匿名（IP）/ 登录（login）每分钟配额 */
const ANON_LIMIT = 120;
const AUTH_LIMIT = 600;
const WINDOW_SEC = 60;

export function isRawRequest(pathname: string): boolean {
  // /$raw/{owner}/{repo}/{ref}/{path...}——path 至少 1 字符，可含目录斜杠
  return /^\/\$raw\/[^/]+\/[^/]+\/[^/]+\/.+$/.test(pathname);
}

/** 解析 /$raw/{owner}/{repo}/{ref}/{path} 为四段（逐段 decode） */
function parseRawPath(pathname: string): {
  owner: string;
  repo: string;
  ref: string;
  path: string;
} {
  const rest = pathname.slice("/$raw/".length);
  const [ownerRaw, repoRaw, refRaw, ...pathParts] = rest.split("/");
  return {
    owner: decodeURIComponent(ownerRaw),
    repo: decodeURIComponent(repoRaw),
    ref: decodeURIComponent(refRaw),
    path: pathParts.map((p) => decodeURIComponent(p)).join("/"),
  };
}

/** 逐段编码 helper */
const enc = (s: string) => encodeURIComponent(s);

/** 构造 raw.githubusercontent.com 直连 URL */
function buildRawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${RAW_BASE}/${enc(owner)}/${enc(repo)}/${enc(ref)}/${path
    .split("/")
    .map((seg) => enc(seg))
    .join("/")}`;
}

/**
 * 透传 raw.githubusercontent.com（带 token，私有仓库可读，流式）。
 * 返回确定结果 Response（200 流式 / 404 文件不存在 / 502 上游错误 / 504 超时）。
 */
async function proxyRaw(rawUrl: string, token: string | null, env: Env): Promise<Response> {
  try {
    const upstream = await fetch(rawUrl, {
      headers: {
        Accept: "*/*",
        "User-Agent": "PureGit-worker",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.status === 404) {
      return new Response(null, { status: 404, headers: corsHeaders(env.FRONTEND_URL) });
    }
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream_${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders(env.FRONTEND_URL), "Content-Type": "application/json" },
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        ...(upstream.headers.get("Content-Length")
          ? { "Content-Length": upstream.headers.get("Content-Length")! }
          : {}),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return new Response(
      JSON.stringify({ error: aborted ? "upstream_timeout" : "upstream_unreachable" }),
      {
        status: 504,
        headers: { ...corsHeaders(env.FRONTEND_URL), "Content-Type": "application/json" },
      },
    );
  }
}

export async function handleRawProxy(
  request: Request,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders(env.FRONTEND_URL), "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);

  // 路径防护：段数 ≤16 且总长 ≤2048（防超长/超深 URL 构造）
  const restPath = url.pathname.slice("/$raw/".length);
  const segments = restPath.split("/");
  if (segments.length > 16 || restPath.length > 2048) {
    return new Response(JSON.stringify({ error: "path_too_long" }), {
      status: 414,
      headers: { ...corsHeaders(env.FRONTEND_URL), "Content-Type": "application/json" },
    });
  }

  const { owner, repo, ref, path } = parseRawPath(url.pathname);
  const rawUrl = buildRawUrl(owner, repo, ref, path);

  // 分级限流（匿名 IP 120/分；登录会话 600/分）
  const login = await getSessionLogin(request, env);
  const token = await getSessionToken(request, env);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-real-ip");
  const limit = token ? AUTH_LIMIT : ANON_LIMIT;
  const rateKey = login ?? (token ? token.slice(0, 16) : (clientIp ?? "unknown"));
  if (!(await rateLimitProxy(env, "raw", rateKey, limit, WINDOW_SEC))) {
    return rateLimitedResponse(env.FRONTEND_URL, WINDOW_SEC);
  }

  // 透传 raw（带 token；私有仓库可读）
  return proxyRaw(rawUrl, token, env);
}
