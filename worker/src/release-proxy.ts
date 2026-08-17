/**
 * Release 资产下载代理（流式透传，新增）
 *
 * 背景：release 资产（browser_download_url = github.com/{o}/{r}/releases/download/{tag}/{asset}）
 * 会 302 到带签名的 CDN 地址（objects.githubusercontent.com / release-assets.githubusercontent.com，
 * Azure 背书）。受限网络下 github.com 跳转或 CDN 域名可能不通/慢。
 * 本端点做服务端 fetch 代理：GET /$release/{owner}/{repo}/download/{tag}/{asset} →
 * github.com/{owner}/{repo}/releases/download/{tag}/{asset}，fetch 自动跟随 302 到签名 CDN，
 * 流式透传响应体。
 *
 * 与 /$raw 的区别：
 *   - /$raw：raw.githubusercontent.com 源码文件（≤100MB 语义，可缓存）
 *   - /$release：release 二进制资产（≤2GiB，**不缓存**——大文件命中率低且占 512MB 缓存配额）
 *
 * 安全：
 *   - `$release` 以 `$` 符号前缀标识内部功能性路由（GitHub 用户名/仓库名不含 `$`）。
 *   - 上游白名单：仅 github.com（防 SSRF）；redirect 跟随由 fetch 默认完成（签名 CDN 域不由本层白名单约束）。
 *   - 仅 GET；流式透传（不 arrayBuffer，避免 128MB 内存上限）；Content-Disposition 透传保文件名。
 *   - 大小防护：Content-Length 预判 ≤2GiB（GitHub release asset 硬上限）；无 CL 直接透传。
 *   - 超时：不设超时（wall time 无限制，流式传输本身持续活动，避免大文件下载被 30s 掐断）。
 *
 * 限流（release 大文件，匿名配额从严）：匿名按 IP 20 req/60s、登录按会话 login 200 req/60s。
 * 反代开关：独立 ENV `RELEASE_PROXY_ENABLE`（off/login/on，默认 login），与 RAW_PROXY_ENABLE 解耦。
 */
import { corsHeaders } from "./cookies";
import { getSessionLogin, getSessionToken } from "./auth";
import { streamProxy, rateLimitProxy, rateLimitedResponse } from "./stream-proxy";

const GITHUB_BASE = "https://github.com";
/** 允许的 release 上游主机（白名单，防 SSRF） */
const ALLOWED_HOSTS = new Set(["github.com", "github.com."]);

/**
 * $release 代理文件大小上限（2GiB = GitHub release asset 硬上限）。
 * 超限 413 拒绝；无 Content-Length（chunked）直接透传。
 */
const RELEASE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 分级限流：匿名（IP）/ 登录（login）每分钟配额（release 大文件，匿名从严） */
const ANON_LIMIT = 20;
const AUTH_LIMIT = 200;
const WINDOW_SEC = 60;

export function isReleaseRequest(pathname: string): boolean {
  // /$release/{owner}/{repo}/download/{tag}/{asset...}——tag 与 asset 均至少 1 字符
  return /^\/\$release\/[^/]+\/[^/]+\/download\/[^/]+\/.+$/.test(pathname);
}

/** 将代理请求路径重写为 github.com release download 目标 URL（逐段编码） */
function rewriteReleaseUrl(requestUrl: URL): URL {
  const rest = requestUrl.pathname.slice("/$release/".length);
  const [owner, repo, _download, tag, ...assetParts] = rest.split("/");
  const asset = assetParts.join("/");
  const enc = (s: string) => encodeURIComponent(decodeURIComponent(s));
  // tag 整体编码（tag 名可含 `/`，编码后 %2F 保持单段）；asset 逐段编码防穿越
  const target = new URL(
    `${GITHUB_BASE}/${enc(owner)}/${enc(repo)}/releases/download/${enc(tag)}/${asset
      .split("/")
      .map((seg) => enc(seg))
      .join("/")}`,
  );
  return target;
}

export async function handleReleaseProxy(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
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
  const restPath = url.pathname.slice("/$release/".length);
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

  const target = rewriteReleaseUrl(url);
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

  // 分级限流（匿名 IP 20/分；登录会话 200/分）
  const login = await getSessionLogin(request, env);
  // 会话 token：透传上游 → 登录态私有 release asset 可读；匿名/无会话 = null
  const sessionToken = await getSessionToken(request, env);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-real-ip");
  const limit = sessionToken ? AUTH_LIMIT : ANON_LIMIT;
  const rateKey = login ?? (sessionToken ? sessionToken.slice(0, 16) : (clientIp ?? "unknown"));
  if (!(await rateLimitProxy(env, "release", rateKey, limit, WINDOW_SEC))) {
    return rateLimitedResponse(env.FRONTEND_URL, WINDOW_SEC);
  }

  // 流式透传（不缓存——release 二进制 immutable 但命中率低、占缓存配额）
  return streamProxy({
    target: target.toString(),
    token: sessionToken,
    frontendUrl: env.FRONTEND_URL,
    maxBytes: RELEASE_MAX_BYTES,
    // 不设超时：大文件流式传输 wall time 无限制，避免 30s 掐断下载
    timeoutMs: null,
    upstreamHeaders: { Accept: "application/octet-stream" },
    passthroughHeaders: ["Content-Type", "Content-Length", "Content-Disposition"],
    extraHeaders: {
      "X-Content-Type-Options": "nosniff",
    },
    ctx,
  });
}

// ===== Release 资产上传代理（POST 流式透传 body） =====

/** 上传端点路径匹配：/$release/{owner}/{repo}/upload/{release_id}（release_id 为数字） */
export function isReleaseUploadRequest(pathname: string): boolean {
  return /^\/\$release\/[^/]+\/[^/]+\/upload\/\d+$/.test(pathname);
}

/** 将上传代理请求重写为 uploads.github.com 目标 URL（query 透传 name/label） */
function rewriteReleaseUploadUrl(requestUrl: URL): URL {
  const rest = requestUrl.pathname.slice("/$release/".length);
  const [owner, repo, _upload, releaseId] = rest.split("/");
  const enc = (s: string) => encodeURIComponent(decodeURIComponent(s));
  const target = new URL(
    `https://uploads.github.com/repos/${enc(owner)}/${enc(repo)}/releases/${releaseId}/assets`,
  );
  const name = requestUrl.searchParams.get("name");
  if (name) target.searchParams.set("name", name);
  const label = requestUrl.searchParams.get("label");
  if (label) target.searchParams.set("label", label);
  return target;
}

/**
 * Release 资产上传代理：POST /$release/{owner}/{repo}/upload/{release_id}?name=... → uploads.github.com。
 * 上传必须登录（session token 透传 Authorization）；body 流式透传（request.body，不 arrayBuffer），
 * 避免大文件（≤2GiB）占用 128MB 内存上限。上游响应为 JSON（201 成功 / 4xx 失败），可 buffer。
 */
export async function handleReleaseUploadProxy(
  request: Request,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<Response> {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(env.FRONTEND_URL), "Content-Type": "application/json" },
    });

  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = new URL(request.url);
  if (!url.searchParams.get("name")) return json(400, { error: "name_required" });

  // 上传必须登录（release 资产写入需 write 权限）
  const sessionToken = await getSessionToken(request, env);
  if (!sessionToken) return json(401, { error: "auth_required" });

  // 大小防护：Content-Length 预判 ≤2GiB（GitHub release asset 硬上限）
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > RELEASE_MAX_BYTES) {
    return json(413, { error: "file_too_large", max_bytes: RELEASE_MAX_BYTES });
  }

  const target = rewriteReleaseUploadUrl(url);
  try {
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "PureGit-worker",
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream",
      },
      body: request.body,
    });
    const body = await upstream.text();
    return json(upstream.status, body);
  } catch {
    return json(504, { error: "upstream_unreachable" });
  }
}
