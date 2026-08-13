/**
 * GitHub REST API - core（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

/**
 * GitHub API 封装（Octokit SDK · 重构）
 *
 * 架构红线：前端全部功能由 OAuth access token 完成，请求直连 GitHub API
 * （Bearer token）。Worker 仅承担 OAuth2 登录与 CLI 镜像代理。
 *
 * 本层所有 REST 请求经 @octokit/rest（createRestClient）发出：
 * - 自动标准请求头（Accept/X-GitHub-Api-Version/User-Agent）
 * - 响应头解析（x-ratelimit-* → octokit.ts 全局额度跟踪）
 * - 错误标准化（RequestError → ApiError 包装，保持 isRateLimit 契约）
 * 导出签名与旧实现完全一致，页面无需改动。
 */
import { createRestClient, type ApiErrorLike, getApiUsage } from "../api/octokit";
import { notifyRateLimit } from "../ui/toast";
import { getPrefsToken } from "../auth/prefs-sync";
import { triggerLoginSpotlight } from "@/lib/auth/login-spotlight";
import type { Octokit } from "@octokit/rest";

export const GITHUB_API = "https://api.github.com";

/** 请求超时（毫秒）— 网络受限时快速失败而非无限挂起 */
const REQUEST_TIMEOUT = 8000;

/** Octokit Response 适配：保持与原生 fetch Response 近似的读取接口 */
interface RestResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}
/** 从 init 提取 Bearer token（无则 null） */
function extractToken(init?: RequestInit): string | null {
  const h = init?.headers as Record<string, string> | undefined;
  const auth = h?.Authorization ?? h?.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

/** 从 init 提取业务请求头（去掉鉴权/长度，交 Octokit 处理） */
function extractHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers as Record<string, string> | undefined;
  if (h) {
    for (const k of Object.keys(h)) {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk === "content-length") continue;
      out[k] = h[k];
    }
  }
  return out;
}

/**
 * 统一 REST 请求（经 Octokit SDK）。
 * 语义与原 fetchWithTimeout 一致：非 2xx **不抛错**（返回 ok=false 的适配对象，
 * 由调用方 githubFetch 检查 ok 抛 ApiError）；网络错误/超时才抛。
 */
async function restRequest(url: string, init?: RequestInit): Promise<RestResponseLike> {
  const method = (init?.method ?? "GET").toUpperCase();
  const parsed = new URL(url);
  const token = extractToken(init);
  const octokit = createRestClient(token);

  // body：JSON 字符串 → 对象（Octokit 需要结构化 body）
  let data: unknown;
  if (init?.body != null && typeof init.body === "string") {
    try {
      data = JSON.parse(init.body);
    } catch {
      data = init.body;
    }
  }

  const started = performance.now();
  try {
    const res = await octokit.request({
      method: method as "GET",
      url: parsed.pathname + parsed.search,
      headers: extractHeaders(init),
      ...(data !== undefined ? { data } : {}),
      request: { timeout: REQUEST_TIMEOUT },
    });
    void started;
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: {
        get: (name: string) => (res.headers as Record<string, string>)[name.toLowerCase()] ?? null,
      },
      text: async () => (typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "")),
      json: async <T>() => res.data as T,
    };
  } catch (e) {
    // Octokit 对非 2xx 抛 RequestError → 包装为非 ok 响应（保持旧语义）
    const err = e as ApiErrorLike;
    if (err && typeof err.status === "number" && err.response) {
      const resp = err.response;
      const body = resp.data;
      return {
        status: err.status,
        ok: false,
        headers: {
          get: (name: string) =>
            (resp.headers as Record<string, string> | undefined)?.[name.toLowerCase()] ?? null,
        },
        text: async () => (typeof body === "string" ? body : JSON.stringify(body ?? "")),
        json: async <T>() => body as T,
      };
    }
    throw e; // 网络错误/超时原样抛出
  }
}

/**
 * 兼容别名：旧 `fetchWithTimeout` 语义 = 经 Octokit 的 REST 请求（非 2xx 返回 ok=false）。
 * 供 github.ts 内 24 处直接调用特殊语义函数（204/404 判定、Link 头解析、自定义 Accept 等）复用，
 * 保持导出与调用零改动。
 */
export const fetchWithTimeout = restRequest;

/** GitHub API 错误（携带 HTTP 状态码、限流标记与原始响应体，供全局错误页分类展示） */
export class ApiError extends Error {
  status: number;
  isRateLimit: boolean;
  /** 原始响应体文本（GitHub 错误 JSON 的原始字符串，错误页可展开显示） */
  rawBody: string;
  /** 原始响应体解析后的 JSON（展示用；解析失败为 null） */
  parsed: Record<string, unknown> | null;

  constructor(status: number, detail = "") {
    super(`GitHub API ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
    this.status = status;
    this.rawBody = detail;
    this.parsed = parseJsonSafe(detail);
    // 403（rate limit 消息）或 429（Too Many Requests）视为限流
    this.isRateLimit = status === 429 || (status === 403 && /rate limit/i.test(detail ?? ""));
  }

  /** 404：资源不存在（全局 404 页触发） */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /** 401：未认证/凭据失效 */
  isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 403 非限流：无权限（私有仓库/受限组织等） */
  isForbidden(): boolean {
    return this.status === 403 && !this.isRateLimit;
  }

  /** 5xx：服务端故障（维护/网关错误） */
  isServerError(): boolean {
    return this.status >= 500;
  }
}

/** 安全解析 JSON（错误体可能非 JSON） */
function parseJsonSafe(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 归一化任意错误为 ApiError（供全局错误页 useRouteError 分类）。
 * - ApiError 原样返回（REST/GraphQL 适配层抛出的标准错误）
 * - 网络错误（TypeError/DOMException 等）→ status 0 的 ApiError（通用错误页）
 */
export function normalizeApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ApiError(0, msg);
}

/**
 * 将 API 异常转为用户可读错误信息；限流时给出明确提示。
 * 页面 catch 处统一调用，保证未登录时的高可用体验。
 * 限流同时触发统一 toast（防刷，见 notifyRateLimit）。
 *
 * 限流文案（定稿）：
 * - 括号内仅「N次/小时」（N 取 x-ratelimit-limit），不做重置倒计时
 * - 未登录：完整句「…（N次/小时），登录后可获得更高配额（5000 次/小时）」
 *   + 全局触发登录聚光灯动画（30s 节流）引导右上角登录按钮
 * - 已登录：基础句「…（N次/小时）」
 */
export function apiErrorMessage(e: unknown, fallback = "加载失败，请稍后重试"): string {
  if (e instanceof ApiError && e.isRateLimit) {
    notifyRateLimit();
    const limit = getApiUsage().rest.limit || 60;
    // 未登录：全局聚光灯引导登录（节流，避免并发限流刷动画）
    if (!getPrefsToken()) {
      triggerSpotlightThrottled();
      return `GitHub API 请求过于频繁或超出官方限制（${limit}次/小时），登录后可获得更高配额（5000 次/小时）`;
    }
    return `GitHub API 请求过于频繁或超出官方限制（${limit}次/小时）`;
  }
  return fallback;
}

/** 限流时未登录全局聚光灯节流（30s 内一次，与 notifyRateLimit 防刷一致） */
let lastSpotlightAt = 0;
function triggerSpotlightThrottled(): void {
  const now = Date.now();
  if (now - lastSpotlightAt < 30_000) return;
  lastSpotlightAt = now;
  triggerLoginSpotlight();
}

export interface GitHubUser {
  login: string;
  /** GitHub 用户数字 ID（偏好云同步稳定定位用） */
  id?: number;
  name?: string;
  avatar_url?: string;
  bio?: string;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  email?: string | null;
  plan?: { name: string } | null;
  pronouns?: string | null;
  /** 用户/组织（REST /users/{login} 对组织也返回 200，type 区分——主页自动检测依据） */
  type?: "User" | "Organization";
}

/** 带 token 的 GitHub API 请求（前端直连） */
export async function githubFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await restRequest(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  // 204/空响应体（DELETE 等无返回体操作）→ 返回 undefined，避免 JSON.parse 炸
  const body = await res.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

/**
 * GitHub API 请求（公开数据；登录时传 token 走 5000 次/时额度，避免匿名 60 次/时限流）
 */
export async function githubFetchPublic<T>(
  path: string,
  init?: RequestInit,
  token?: string | null,
): Promise<T> {
  const res = await restRequest(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  // 204/空响应体 → undefined（同 githubFetch）
  const body = await res.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

/**
 * Octokit 类型化方法通道（白名单迁移示范）
 *
 * 与 restRequest（octokit.request + 手拼 URL）的区别：
 * - 直接调用 `octokit.rest.<resource>.<method>(params)` 类型化方法，
 *   URL 模板/参数编码/返回类型由 @octokit 生成代码保证（不再手拼 URL）。
 * - 同一 createRestClient → trackedFetch 钩子（日志/额度/去重/缓存）自动生效。
 * - 错误语义与 githubFetch 一致：非 2xx 抛 ApiError（调用方按 isNotFound 等分类）；
 *   网络错误/超时原样抛出。
 *
 * ⚠️ 返回类型桥接：Octokit 生成类型比项目自定义接口更宽（可空/可选字段更细），
 * 直接约束 `{ data: T }` 会大面积类型冲突 → 用 `any` 桥接返回（调用方接口负责收窄）。
 * 这正是「类型化 URL 模板 + 项目自有窄接口」的既定分工。
 *
 * 白名单路由：rest-*.ts 中凡是 Octokit 官方类型化方法覆盖的固定端点，
 * 一律经本通道调用（禁止新增手拼 URL 的 githubFetch/fetchWithTimeout 调用）。
 */
export async function typedRequest<T>(
  token: string | null | undefined,
  run: (octokit: Octokit) => Promise<{ data: any }>,
): Promise<T> {
  const octokit = createRestClient(token ?? undefined);
  try {
    const res = await run(octokit);
    return res.data as T;
  } catch (e) {
    const err = e as ApiErrorLike;
    if (err && typeof err.status === "number" && err.response) {
      const body = err.response.data;
      const detail = typeof body === "string" ? body : body != null ? JSON.stringify(body) : "";
      throw new ApiError(err.status, detail);
    }
    throw e; // 网络错误/超时原样抛出
  }
}

/** 获取当前登录用户（需 token） */
export async function fetchCurrentUser(token: string): Promise<GitHubUser> {
  return githubFetch<GitHubUser>("/user", token);
}

/** GitHub REST rate limit 信息（GET /rate_limit；core 为常规 API 额度） */
export interface RateLimitInfo {
  resources: {
    core: { limit: number; remaining: number; reset: number; used: number };
    search?: { limit: number; remaining: number; reset: number };
    graphql?: { limit: number; remaining: number; reset: number };
  };
}

/**
 * 查询 GitHub API 调用额度剩余（footer 展示用）。
 * 登录传 token（5000 次/时 core 额度）；匿名 60 次/时。失败时抛 ApiError（footer 显示 API 不可达）。
 */
export async function fetchRateLimit(token: string | null): Promise<RateLimitInfo> {
  return githubFetchPublic<RateLimitInfo>("/rate_limit", {}, token ?? undefined);
}

/** 仓库统计（公开数据；footer 显示本项目 star/fork 数用） */
export interface RepoStats {
  stargazers_count: number;
  forks_count: number;
}

/** 获取公开仓库的 star/fork 计数（匿名即可；仓库不存在/私有时失败） */
export async function fetchPublicRepoStats(
  owner: string,
  name: string,
  token?: string | null,
): Promise<RepoStats> {
  return githubFetchPublic<RepoStats>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {},
    token ?? undefined,
  );
}
