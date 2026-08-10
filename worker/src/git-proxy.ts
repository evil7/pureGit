/**
 * CLI git 镜像端点自动代理（M4）
 *
 * 架构红线：Worker 职责之二 —— 将 git CLI 流量自动转发到 GitHub。
 * 用户通过 `git config --global url.<worker域名>/.insteadOf https://github.com/` 接入，
 * 无需安装额外客户端；只读（clone/pull）公开仓库可不带凭据，
 * push 使用 PAT 作 git 凭据（Basic auth）透传。
 *
 * git 智能 HTTP 协议请求形态（转发到 https://github.com<path>）：
 *   GET  /owner/repo.git/info/refs?service=git-upload-pack   （fetch/clone 第一步）
 *   GET  /owner/repo.git/info/refs?service=git-receive-pack  （push 第一步）
 *   POST /owner/repo.git/git-upload-pack                     （fetch 数据）
 *   POST /owner/repo.git/git-receive-pack                    （push 数据）
 */

const GITHUB_GIT_HOST = "https://github.com";

/** git 请求路径特征（owner/repo[.git]/git 端点） */
const GIT_PATH_RE =
  /^\/[^/]+\/[^/]+(?:\.git)?\/(?:info\/refs|git-upload-pack|git-receive-pack)(?:\/|$)/;

/** 判断请求是否为 git 智能 HTTP 流量（需走镜像代理） */
export function isGitRequest(pathname: string): boolean {
  return GIT_PATH_RE.test(pathname);
}

/** 将 Worker 侧 git 请求 URL 重写为 GitHub 目标 URL（保留 path 与 query） */
export function rewriteGitUrl(requestUrl: URL): URL {
  const target = new URL(GITHUB_GIT_HOST);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  return target;
}

/** 透传请求头：移除 host（由 fetch 重算），其余按 git 协议原样保留 */
function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  // fetch 会自动设置 Host；Content-Length 由请求体重建
  headers.delete("host");
  headers.delete("content-length");
  // git 智能协议要求：Content-Type（application/x-git-*）、Accept、Git-Protocol、User-Agent 均透传
  return headers;
}

/**
 * git 请求自动代理：原样转发 method/body/headers 至 GitHub，透传响应。
 */
export async function handleGitProxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = rewriteGitUrl(url);

  const init: RequestInit = {
    method: request.method,
    headers: buildForwardHeaders(request),
    // GET/HEAD 无 body；其余（POST）流式透传 request.body
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  };

  const upstream = await fetch(target.toString(), init);

  // 透传响应状态与头；Content-Type（application/x-git-upload-pack-result 等）
  // 与 Content-Length/分块由 fetch 自动处理
  const responseHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
