/**
 * Wiki 内容代理（扩展——架构红线 2 更新见 architecture.md）
 *
 * 背景：Wiki 无官方 REST/GraphQL API，内容仅存于独立 git 仓库
 * `{owner}/{repo}.wiki.git`，raw 通道 `raw.githubusercontent.com/wiki/{owner}/{repo}/{page}.md`
 * 可读；但前端直连 raw 被网络环境拦截（CORS/不可达）。
 * 本端点做服务端 fetch 代理：GET /$wiki/{owner}/{repo}/{page} → 返回 md 纯文本。
 *
 * 路径约定（修订）：`$wiki` 以 `$` 符号前缀标识**内部高优先级功能性路由**——
 * GitHub 用户名/仓库名规范不含 `$`，/ $wiki 永不被 /:owner/:repo 用户级通配路由占用。
 *
 * 特殊页：`_Sidebar`（wiki 页面列表）、`_Footer` 与普通页同规则。
 * 安全：owner/repo/page 逐段 encodeURIComponent，防路径穿越。
 */
import { corsHeaders } from "./cookies";

const RAW_WIKI_BASE = "https://raw.githubusercontent.com/wiki";

export function isWikiRequest(pathname: string): boolean {
  // /$wiki/{owner}/{repo}/{page}——page 至少 1 字符，可含目录斜杠（多级 wiki 页）
  return /^\/\$wiki\/[^/]+\/[^/]+\/.+$/.test(pathname);
}

export async function handleWikiProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
      },
    });
  }

  // /$wiki/{owner}/{repo}/{page}（page 已含多级目录，如 docs/Home → 需 decode 后保留斜杠）
  const prefix = "/$wiki/";
  const rest = url.pathname.slice(prefix.length);
  const [ownerRaw, repoRaw, ...pageParts] = rest.split("/");
  const page = pageParts.join("/");
  if (!ownerRaw || !repoRaw || !page) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "application/json",
      },
    });
  }
  const owner = decodeURIComponent(ownerRaw);
  const repo = decodeURIComponent(repoRaw);
  // 页面名保留目录斜杠（wiki 支持多级页），但逐段编码防穿越
  const encodedPage = page
    .split("/")
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join("/");

  try {
    const upstream = await fetch(
      `${RAW_WIKI_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodedPage}.md`,
      {
        headers: {
          Accept: "text/plain, text/markdown, */*",
          "User-Agent": "PureGit-worker",
        },
        // ⚠️ 超时兜底（workerd 默认无超时）：raw 在受限网络可能不可达，
        // 15s 后 504，前端友好提示（本机 wrangler dev 实测 raw 不可达）
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (upstream.status === 404) {
      return new Response(JSON.stringify({ error: "wiki_page_not_found" }), {
        status: 404,
        headers: {
          ...corsHeaders(env.FRONTEND_URL),
          "Content-Type": "application/json",
        },
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
    const text = await upstream.text();
    return new Response(text, {
      status: 200,
      headers: {
        ...corsHeaders(env.FRONTEND_URL),
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
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
