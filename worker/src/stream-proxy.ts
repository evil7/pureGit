/**
 * 统一流式反代内核（$raw / $release 共用）
 *
 * 背景：raw / release 大文件反代若用 arrayBuffer() 全量缓冲，免费版 128MB 内存上限
 * 会直接 exceedMemory——release ≤2GiB 更是必爆。因此统一改为**流式透传**（直传
 * upstream.body），大小防护只做 Content-Length 预判（chunked 无 CL 时无法回退校验，接受）。
 *
 * 核心语义：
 * - 流式透传：new Response(upstream.body)，任何路径不 arrayBuffer/.text()（零缓冲，不超内存）
 * - redirect 自动跟随：fetch 默认 follow——github.com download → objects/azure 签名 URL 由本层解析
 * - 鉴权透传：登录会话 token → Authorization（私有 raw / release 可读）
 * - 大小防护：Content-Length > maxBytes → 413；无 CL → 直接透传
 * - 缓存：可选（raw 小文件保留；release 不缓存）——ctx.waitUntil 不阻塞流式返回
 * - 超时：可选（raw 30s；release 大文件传 null 不设超时，依赖 wall time 无限制）
 */
import { corsHeaders } from "./cookies";

/** 流式反代选项（raw / release 各自构造后传入） */
export interface StreamProxyOptions {
  /** 上游目标 URL（fetch 自动跟随 redirect） */
  target: string;
  /** 登录会话 token（透传 Authorization，私有仓库可读）；匿名 null */
  token: string | null;
  /** 前端 CORS origin */
  frontendUrl: string;
  /** 文件大小上限（Content-Length 预判；无 CL 直接透传） */
  maxBytes: number;
  /** 上游 fetch 超时（毫秒）；null = 不设超时（release 大文件流式） */
  timeoutMs: number | null;
  /** 上游请求附加头（Accept 等） */
  upstreamHeaders?: Record<string, string>;
  /** 透传的上游响应头白名单（Content-Type / Content-Length / Content-Disposition） */
  passthroughHeaders?: string[];
  /** 附加响应头（如 nosniff） */
  extraHeaders?: Record<string, string>;
  /** Cache API 缓存配置（null/undefined = 不缓存） */
  cache?: { key: string; ttl: number } | null;
  /** 请求上下文（cache.put 走 waitUntil，不阻塞流式返回） */
  ctx?: ExecutionContext;
}

/** 从上游响应透传白名单头到新响应头（保留原始头值） */
function pickPassthroughHeaders(upstream: Response, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value != null) out[name] = value;
  }
  return out;
}

/**
 * 统一流式反代：上游 fetch → 状态分流（404/502/413）→ 流式透传（可选缓存）。
 * 返回 Response；调用方（raw/release）负责 URL 重写、白名单、限流与缓存读取。
 */
export async function streamProxy(opts: StreamProxyOptions): Promise<Response> {
  const {
    target,
    token,
    frontendUrl,
    maxBytes,
    timeoutMs,
    upstreamHeaders = {},
    passthroughHeaders: passthrough = [],
    extraHeaders = {},
    cache = null,
    ctx,
  } = opts;

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: "*/*",
        "User-Agent": "PureGit-worker",
        ...upstreamHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });

    // 404 透传（raw 缺失文件 / release 缺失 asset）
    if (upstream.status === 404) {
      return new Response(null, { status: 404, headers: corsHeaders(frontendUrl) });
    }
    // 其余上游错误 → 502（保留错误码信息）
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream_${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders(frontendUrl), "Content-Type": "application/json" },
      });
    }
    // 大小防护：Content-Length 预判（流式无法回退校验；chunked 无 CL 直接透传）
    const cl = Number(upstream.headers.get("Content-Length") ?? "0");
    if (cl > maxBytes) {
      return new Response(JSON.stringify({ error: "file_too_large", max_bytes: maxBytes }), {
        status: 413,
        headers: { ...corsHeaders(frontendUrl), "Content-Type": "application/json" },
      });
    }

    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(frontendUrl),
        ...pickPassthroughHeaders(upstream, passthrough),
        ...extraHeaders,
      },
    });

    // 缓存（可选）：waitUntil 异步写入，不阻塞流式返回；无 ctx 时 await 兜底
    if (cache) {
      const cacheKey = new Request(cache.key, { method: "GET" });
      const write = caches.default.put(cacheKey, response.clone()).catch(() => {});
      if (ctx) {
        ctx.waitUntil(write);
      } else {
        await write;
      }
    }
    return response;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return new Response(
      JSON.stringify({ error: aborted ? "upstream_timeout" : "upstream_unreachable" }),
      {
        status: 504,
        headers: { ...corsHeaders(frontendUrl), "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * 通用分级限流（KV 固定窗口计数）——raw / release 共用。
 * identity = 会话 login（登录）或客户端 IP（匿名）；超限返回 false（调用方回 429）。
 * KV 键 `rl:{scope}:{identity}:{windowStart}`，TTL = 2×窗口（兜底清理）。
 * fail-open：计数失败不阻断（可靠性优先）。
 */
export async function rateLimitProxy(
  env: Env,
  scope: string,
  identity: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${scope}:${identity}:${windowStart}`;
  try {
    const current = Number((await env.SESSIONS.get(key)) ?? "0");
    if (current >= limit) return false;
    await env.SESSIONS.put(key, String(current + 1), {
      expirationTtl: windowSec * 2,
    });
    return true;
  } catch {
    return true;
  }
}

/** 构造 429 限流响应（raw / release 共用） */
export function rateLimitedResponse(frontendUrl: string, windowSec: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited", retry_after: windowSec }), {
    status: 429,
    headers: {
      ...corsHeaders(frontendUrl),
      "Content-Type": "application/json",
      "Retry-After": String(windowSec),
    },
  });
}
