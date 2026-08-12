/**
 * PureGit Worker 入口
 *
 * 职责（架构红线）：① OAuth2 令牌管理 ② CLI git 镜像代理 ③ Wiki 代理（/$wiki）④ Raw 代理（/$raw）+ 健康检查（/$healthz）
 * 1. OAuth2 令牌管理（/$auth/login、/$auth/callback、/$auth/session、/$auth/logout）
 * 2. CLI git 镜像端点自动代理（M4 实施，暂未接入）
 * 3. Wiki 内容代理（/$wiki/...，raw.githubusercontent.com/wiki——无官方 API，
 *    ADR 扩展；服务端 fetch 解决前端 raw 被墙）
 * 4. Raw 内容代理（/$raw/...，任意仓库任意 ref 下任意路径；README 图片降级等）
 * 5. 健康检查（/$healthz，通用在线探活）
 *
 * ⚠️ API 调试工具（/$debug）已于 改为**纯前端路由**（App.tsx lazy 页），
 * Worker 不再参与——前端直连 api.github.com（当前会话 token 或匿名），无鉴权需求，
 * `DEBUG_ROUTE_ENABLE` 环境变量已删除。
 *
 * 路由优先级：系统前缀保留段（/$auth、/$wiki、/$raw、/$healthz、git 端点）> 用户级通配。
 *   - 系统前缀：/$auth、/$wiki、/$raw、/$healthz、git 端点（owner/repo.git/...）
 *   - `$` 符号前缀论证：GitHub 用户名/仓库名规范不含 `$`（仅字母数字+连字符）→ /$auth /$wiki
 *     /$raw 永不被 /:owner/:repo 用户通配路由占用（系统路由 = 单段符号前缀 + 固定语义；
 *     /auth 为自定义鉴权系统（非 GitHub 复刻面），统一 /$auth 系统前缀语义）
 *   - 判断顺序：auth（switch）→ 系统代理（/$wiki、/$raw 匿名闸）→ git 端点 →
 *     前端静态资源（SPA fallback）。
 */

import {
  handleCallback,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handlePatLogin,
  handlePrefs,
  handleRevokeApp,
  handleSession,
  handleSessionLogout,
  handleSessionPatch,
  handleSessionsList,
  getSessionLogin,
} from "./auth";
import { corsHeaders } from "./cookies";
import { handleGitProxy, isGitRequest } from "./git-proxy";
import { handleWikiProxy, isWikiRequest } from "./wiki-proxy";
import { handleRawProxy, isRawRequest } from "./raw-proxy";

/**
 * Proxy 匿名闸：/$wiki 与 /$raw 代理接口防滥用。
 * PROXY_ALLOW_ANON !== "true" 时强制要求有效会话（登录），未登录返回 401。
 * 返回 null = 放行；返回 Response = 拦截（401）。
 */
async function requireProxyAuth(request: Request, env: Env): Promise<Response | null> {
  // 默认允许匿名（公开内容可读，保持 wiki/raw 体验）；部署方可将
  // PROXY_ALLOW_ANON 设为 "false" 强制登录（防代理被当肉鸡刷流量）。
  // （wrangler types 把 vars 推断为字面量 "true"，经可选类型读取避免误报）
  const allowAnon = (env as { PROXY_ALLOW_ANON?: string }).PROXY_ALLOW_ANON;
  if (allowAnon !== "false") return null;
  const login = await getSessionLogin(request, env);
  if (login) return null;
  return new Response(JSON.stringify({ error: "auth_required" }), {
    status: 401,
    headers: {
      ...corsHeaders(env.FRONTEND_URL),
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env.FRONTEND_URL),
      });
    }

    // 健康检查（/$healthz）：无条件轻量响应，不经过任何业务逻辑
    // （通用在线探活端点：外部监控程序/本机调试均可探活，返回即时 JSON）
    if (url.pathname === "/$healthz") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "puregit-worker",
          ts: Date.now(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    switch (url.pathname) {
      case "/$auth/login":
        return handleLogin(request, env);
      case "/$auth/callback":
        return handleCallback(request, env);
      case "/$auth/pat":
        return handlePatLogin(request, env);
      case "/$auth/session":
        // GET 恢复会话 / POST 补全用户元数据（前端补齐 login/userId 写回）
        return request.method === "POST"
          ? handleSessionPatch(request, env)
          : handleSession(request, env, ctx);
      case "/$auth/logout/all":
        return handleLogoutAll(request, env);
      case "/$auth/logout":
        return handleLogout(request, env);
      case "/$auth/sessions":
        return handleSessionsList(request, env);
      case "/$auth/prefs":
        return handlePrefs(request, env);
      case "/$auth/revoke":
        return handleRevokeApp(request, env);
      default:
        // POST /$auth/sessions/:id/logout — 本地登出指定设备
        const sessionLogout = url.pathname.match(/^\/\$auth\/sessions\/([^/]+)\/logout$/);
        if (sessionLogout && request.method === "POST") {
          return handleSessionLogout(request, env, decodeURIComponent(sessionLogout[1]));
        }
        break;
    }

    // ── 系统代理前缀（优先于 git/用户级通配；含匿名闸）──────
    if (isWikiRequest(url.pathname)) {
      const gate = await requireProxyAuth(request, env);
      if (gate) return gate;
      return handleWikiProxy(request, env);
    }
    if (isRawRequest(url.pathname)) {
      const gate = await requireProxyAuth(request, env);
      if (gate) return gate;
      return handleRawProxy(request, env);
    }

    // CLI git 镜像端点自动代理（M4）：owner/repo.git/... 请求转发至 GitHub
    if (isGitRequest(url.pathname)) {
      return handleGitProxy(request);
    }

    // 前端静态资源：env.ASSETS 由 wrangler assets 注入（构建产物 dist/client）。
    // run_worker_first 路由数组已把 /assets/** 留给边缘直服，其余先进本 Worker。
    // 独立部署（无 ASSETS binding）时兜底返回服务信息。
    const assets = (env as { ASSETS?: Fetcher }).ASSETS;
    if (assets) {
      let asset = await assets.fetch(request);
      if (asset.status !== 404) return asset;
      // SPA 回退（智能分发）：非匹配请求统一走内部 404 体系（不自定义静态 404）——
      // - 无文件扩展名的深层路由（/settings/xxx、/owner/repo）→ 返回 index.html
      //   交给前端路由；未知前端路径由应用内 NotFoundPage（animejs 粒子 404）呈现
      // - 带扩展名的路径（如缺失的 /foo.js）→ 仅当浏览器以 Accept: text/html
      //   导航时回退（前端路由页面）；纯资源请求保持 404（not_found_handling 默认 none）
      const accept = request.headers.get("Accept") ?? "";
      const wantsHtml = accept.includes("text/html") || accept.includes("application/xhtml+xml");
      if (request.method === "GET" && (!url.pathname.match(/\.[a-zA-Z0-9]{1,8}$/) || wantsHtml)) {
        asset = await assets.fetch(
          new Request(new URL("/index.html", url), {
            method: "GET",
            headers: request.headers,
          }),
        );
        if (asset.status !== 404) return asset;
      }
      // 缺失资源：原样返回 ASSETS 的 404 响应
      return asset;
    }

    // 无 ASSETS binding（纯 worker 独立部署/调试）：返回服务信息
    return new Response(JSON.stringify({ ok: true, service: "PureGit-worker" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
