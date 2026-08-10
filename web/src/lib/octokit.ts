/**
 * Octokit SDK 统一入口
 *
 * 架构：
 * - REST 客户端：@octokit/rest（Octokit，Bearer token）
 * - GraphQL 客户端：@octokit/graphql（graphql()，同 token）
 * - 页面/组件一律经 lib 封装函数调用，不直接接触本模块（保持导入面稳定）
 *
 * API 模式（用户偏好，偏好设置页切换）：
 * - `rest`：主用 REST，GraphQL 仅作兜底（REST 耗尽/失败时）
 * - `graphql`：主用 GraphQL，REST 兜底（GraphQL 点数耗尽/不可达时）
 * - 默认 `graphql`（未登录 token 为 null 时自动 REST）
 *
 * 额度跟踪（响应头 x-ratelimit-*）：
 * - REST 与 GraphQL 各自独立计数（官方文档确认，GET /rate_limit 返回 resources.core 与 resources.graphql）
 * - 某模式 remaining===0 时触发自动切换至另一模式（熔断 60s），不改变用户设置
 */
import { Octokit } from "@octokit/rest";
import { graphql as gql } from "@octokit/graphql";
import { notifyModeFallback } from "./toast";

export type ApiMode = "graphql" | "rest";

/** Octokit RequestError 结构（非 2xx 抛出；rest.ts 适配层据此包装 ApiError） */
export interface ApiErrorLike {
  status: number;
  response?: {
    headers: Record<string, string>;
    data: unknown;
  };
}

const MODE_KEY = "puregit_api_mode";

/** 读取 API 模式偏好（localStorage；默认 graphql） */
export function getApiMode(): ApiMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "rest" ? "rest" : "graphql";
  } catch {
    return "graphql";
  }
}

/** 保存 API 模式偏好 */
export function setApiMode(mode: ApiMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  // 云同步（本地已生效；未登录静默跳过；动态 import 避免循环依赖）
  void import("./prefs-sync").then((m) => m.requestPrefsPush());
}

/** 两种 API 的额度状态（响应头实时更新） */
export interface RateBucket {
  limit: number;
  remaining: number;
  used: number;
  reset: number; // epoch 秒
}

export interface ApiUsage {
  rest: RateBucket;
  graphql: RateBucket;
  /** 最近一次请求走的是哪种 API */
  lastMode: ApiMode | null;
}

const emptyBucket = (): RateBucket => ({ limit: 0, remaining: 0, used: 0, reset: 0 });

/** 全局额度跟踪（统一 limit 缓存：每次 REST/GraphQL 响应头解析写入，footer/设置页订阅展示） */
const usage: ApiUsage = { rest: emptyBucket(), graphql: emptyBucket(), lastMode: null };

/** 订阅者（footer/设置页）：额度缓存每次更新后通知，组件 setState 刷新 */
const usageListeners = new Set<() => void>();

function emitUsageChange(): void {
  for (const cb of usageListeners) cb();
}

/**
 * 订阅额度缓存变化（每次接口响应头 x-ratelimit-* 或 /rate_limit 回填后触发）。
 * 返回退订函数；组件在 useEffect 中订阅并在 cleanup 退订。
 */
export function subscribeUsageChange(cb: () => void): () => void {
  usageListeners.add(cb);
  return () => {
    usageListeners.delete(cb);
  };
}

/** 从响应头解析 x-ratelimit-*（REST 响应或 GraphQL 响应共用）。
 * ⚠️ 缺失头保留原值（不写 0）：非 api.github.com 响应（worker /auth 等）不带 x-ratelimit-*，
 * 若整体清零会把已跟踪的正确额度覆盖成 0。 */
function trackRate(headers: Record<string, string>, mode: ApiMode): void {
  const h = headers;
  const limit = Number(h["x-ratelimit-limit"] ?? NaN);
  const remaining = Number(h["x-ratelimit-remaining"] ?? NaN);
  const used = Number(h["x-ratelimit-used"] ?? NaN);
  const reset = Number(h["x-ratelimit-reset"] ?? NaN);
  const cur = usage[mode];
  usage[mode] = {
    limit: Number.isFinite(limit) ? limit : cur.limit,
    remaining: Number.isFinite(remaining) ? remaining : cur.remaining,
    used: Number.isFinite(used) ? used : cur.used,
    reset: Number.isFinite(reset) ? reset : cur.reset,
  };
  usage.lastMode = mode;
  emitUsageChange();
}

/** 读取当前额度（供 footer/设置页展示） */
export function getApiUsage(): ApiUsage {
  return {
    rest: { ...usage.rest },
    graphql: { ...usage.graphql },
    lastMode: usage.lastMode,
  };
}

/** 手动设置额度（GET /rate_limit 或 GraphQL rateLimit 查询结果回填；写入后通知订阅者） */
export function setApiUsage(rest?: Partial<RateBucket>, graphql?: Partial<RateBucket>): void {
  if (rest) usage.rest = { ...usage.rest, ...rest };
  if (graphql) usage.graphql = { ...usage.graphql, ...graphql };
  emitUsageChange();
}

/** 是否已有额度数据（任一模式 limit>0；footer/设置页据此判断是否需 /rate_limit 兜底） */
export function hasApiUsageData(): boolean {
  return usage.rest.limit > 0 || usage.graphql.limit > 0;
}

/** 某模式是否已耗尽（remaining===0 且 limit>0） */
export function isExhausted(mode: ApiMode): boolean {
  const b = usage[mode];
  return b.limit > 0 && b.remaining <= 0;
}

// ===== 熔断（自动切换，60s 冷却；不改变用户设置）=====
const FALLBACK_COOLDOWN_MS = 60_000;
let restCooldownUntil = 0;
let gqlCooldownUntil = 0;

export function isRestCooldown(): boolean {
  return Date.now() < restCooldownUntil;
}
export function isGqlCooldown(): boolean {
  return Date.now() < gqlCooldownUntil;
}
export function triggerRestCooldown(): void {
  restCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS;
}
export function triggerGqlCooldown(): void {
  gqlCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS;
}

/**
 * 决策：当前是否应优先走 GraphQL？
 * 规则（修订：接口状态自动切换，无手动模式）：
 * - 始终 GraphQL 优先；GraphQL 耗尽/熔断 → 自动降级 REST（不改变任何设置）
 * - 熔断/耗尽时触发统一 toast（防刷，见 notifyModeFallback）
 */
export function shouldUseGraphQL(): boolean {
  if (isGqlCooldown()) {
    notifyModeFallback("rest");
    return false;
  }
  if (isExhausted("graphql")) {
    notifyModeFallback("rest");
    return false;
  }
  return true;
}

/** 决策：是否应优先走 REST（供纯 REST 封装与兜底判定；GraphQL 不可用时才 true） */
export function shouldUseRest(): boolean {
  if (isGqlCooldown()) {
    notifyModeFallback("rest");
    return true;
  }
  if (isExhausted("graphql")) {
    notifyModeFallback("rest");
    return true;
  }
  return false;
}

// ===== 客户端工厂 =====

/** noop 日志（静默预期 404 等噪音） */
const noopLog = (): void => undefined;

/** in-flight 请求去重表：同一（方法+路径+查询串[+GraphQL 查询体]+token）的并发幂等请求只发一次 */
const inflight = new Map<string, Promise<Response>>();

/**
 * 短期响应缓存（幂等请求）：请求完成后缓存重建的 Response。
 * 覆盖 StrictMode 双挂载 / Suspense 懒加载重挂（RepoLayout 子树被丢弃重挂）/ 组件间重复请求（branches/readme/contents）等
 * 场景——同窗口内的后续重复请求直接命中缓存，零网络。
 */
interface ResponseEntry {
  expires: number;
  status: number;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
}
const responseCache = new Map<string, ResponseEntry>();
/** 缓存 TTL：过短覆盖不了 Suspense 重挂，过长导致写操作后陈旧；5s 为平衡点 */
const CACHE_TTL_MS = 5000;
/** 缓存条目上限（超过触发过期清理） */
const CACHE_MAX = 60;

/** 从 init 提取 Bearer token（用于 key 区分会话，防跨 token 串数据） */
function extractAuthToken(init?: RequestInit): string {
  const h = init?.headers as Record<string, string> | undefined;
  const auth = h?.Authorization ?? h?.authorization ?? "";
  return auth.slice(0, 40);
}

/**
 * 计算可去重 key（返回 null 表示不去重，直接发）。
 * - GET：全部可去重（幂等）——StrictMode 双挂载 / 并发重复 / Suspense 重挂命中
 * - POST：仅 GraphQL 查询（body 含 query 且非 mutation）按 body 去重；写操作（mutation/其他 POST）不去重
 * - key 含 token 前缀：不同会话（登出/登录）的响应隔离，防止私有数据串读
 */
function dedupeKey(method: string, url: string | URL | Request, init?: RequestInit): string | null {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const base = `${method} ${u.pathname}${u.search} ::${extractAuthToken(init)}`;
  if (method === "GET") return base;
  if (method === "POST") {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes("mutation")) return null; // 写操作不去重，避免副作用重复
    return `${base} ::${body}`;
  }
  return null;
}

/** 短期缓存写入（仅缓存 2xx 与 404；404 是 starred/subscription 判定的合法结果，同样避免重发） */
function cacheResponse(key: string, res: Response): void {
  if (!(res.ok || res.status === 404)) return; // 限流（403/429）/5xx 不缓存，避免重复命中错误
  res
    .clone()
    .arrayBuffer()
    .then((body) => {
      if (responseCache.size > CACHE_MAX) {
        const now = Date.now();
        for (const [k, v] of responseCache) if (v.expires < now) responseCache.delete(k);
      }
      const headers: Array<[string, string]> = [];
      res.headers.forEach((v, k) => headers.push([k, v]));
      responseCache.set(key, {
        expires: Date.now() + CACHE_TTL_MS,
        status: res.status,
        headers,
        body,
      });
    })
    .catch(() => {
      /* 缓存失败忽略（响应体不可读等），仅失去缓存收益 */
    });
}

/** 缓存命中 → 重建独立 Response（每调用方 body 可独立读取） */
function cachedFetch(key: string): Response | null {
  const entry = responseCache.get(key);
  if (!entry || entry.expires < Date.now()) return null;
  return new Response(entry.body, {
    status: entry.status,
    headers: new Headers(entry.headers),
  });
}

/**
 * 统一 fetch：短期缓存 + in-flight 去重 + 日志 + 额度跟踪。
 * - 日志：REST 全量；GraphQL 跳过 /graphql 路径（api.ts 的 graphqlRequest 已打带查询名的日志，避免双日志）
 * - 额度：REST/GraphQL 响应头各自写入 usage
 */
function trackedFetch(
  url: string | URL | Request,
  init: RequestInit | undefined,
  mode: ApiMode,
): Promise<Response> {
  const method = ((init?.method as string | undefined) ?? "GET").toUpperCase();
  const key = dedupeKey(method, url, init);

  // 1) 短期缓存命中 → 直接返回（Suspense 重挂 / 组件间重复请求零网络）
  if (key) {
    const hit = cachedFetch(key);
    if (hit) return Promise.resolve(hit);
  }

  // 2) in-flight 去重：同一请求并发中 → 复用
  const existing = key ? inflight.get(key) : undefined;
  if (existing) {
    // 从「未消费的原始 res」clone 一份给本调用方。
    // 不能直接共享原始 res——Octokit 每侧都会读 body，共享会导致第二侧读到已消费流（误判失败）。
    return existing.then((res) => res.clone());
  }

  const started = performance.now();
  const run = (): Promise<Response> =>
    fetch(url, init).then((res) => {
      let path = "";
      try {
        path = new URL(String(url)).pathname;
      } catch {
        path = String(url);
      }
      if (!(mode === "graphql" && path === "/graphql")) {
        const label = mode === "graphql" ? "GraphQL" : "REST";
        // 异步读取 clone 文本取大小（不消耗原响应流）；失败忽略
        res
          .clone()
          .text()
          .then((t) => {
            apiLog(
              label,
              `${method} ${path}`,
              res.status,
              Math.round(performance.now() - started),
              t.length,
            );
          })
          .catch(() => {
            apiLog(label, `${method} ${path}`, res.status, Math.round(performance.now() - started));
          });
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      trackRate(headers, mode);
      // 3) 缓存幂等响应（供后续重复请求命中）
      if (key) cacheResponse(key, res);
      return res;
    });

  if (!key) return run();
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  // 发起者也拿 clone：原始 res 始终保留在 inflight 内（不被消费），供后续命中者 clone
  return p.then((res) => res.clone());
}

/**
 * 创建 Octokit REST 客户端（每次调用新实例，避免 token 过期缓存）
 * - log.error 静默：@octokit/plugin-request-log 会对非 2xx 自动 console.error
 *   （预期 404 如 /user/starred 判定、/subscription 未订阅会刷噪音；业务层已处理语义）
 * - fetch 钩子：in-flight 去重 + 日志 + 额度跟踪
 */
export function createRestClient(token?: string | null): Octokit {
  return new Octokit({
    auth: token ?? undefined,
    log: {
      debug: noopLog,
      info: noopLog,
      warn: console.warn.bind(console),
      error: noopLog,
    },
    request: {
      timeout: 8000,
      fetch: (url: string | URL | Request, init?: RequestInit): Promise<Response> =>
        trackedFetch(url, init, "rest"),
    },
  });
}

/** 创建 GraphQL 客户端（@octokit/graphql，同 token；fetch 钩子同上） */
export function createGraphqlClient(token?: string | null): typeof gql {
  return gql.defaults({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    request: {
      timeout: 8000,
      fetch: (url: string | URL | Request, init?: RequestInit): Promise<Response> =>
        trackedFetch(url, init, "graphql"),
    },
  });
}

/** API 请求日志（dev 模式；格式同旧 lib 层，保持终端/控制台可读性） */
function apiLog(
  kind: "REST" | "GraphQL",
  detail: string,
  status: number | string,
  ms: number,
  size?: number,
): void {
  if (!import.meta.env.DEV) return;
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  console.log(`[PureGit API] [${kind}] ${detail} ${status} ${ms}ms${sizeStr}`);
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}
