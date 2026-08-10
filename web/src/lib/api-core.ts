/**
 * GitHub API smart layer - core (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

/**
 * GitHub API 智能封装层（Octokit + 用户可选主模式）
 *
 * 策略：主模式由用户偏好设置（GraphQL 优先 / REST 优先，默认 GraphQL）；
 * 统一经本模块 smart 函数调用，页面组件不感知具体协议。
 * - 匿名强制 REST：GraphQL 匿名恒 403（实测），token 为空直接短路 → smart 函数降级 REST
 * - 主模式 graphql：GraphQL 首选，不可达/超时/熔断/耗尽时自动冗余切换 REST（不改设置项）
 * - 主模式 rest：直接走 REST（GraphQL 不用）
 * - REST core 与 GraphQL 双额度分开计数（octokit.ts 统一跟踪，footer/设置页展示）
 *
 * 当前状态：REST 已全面可用（rest.ts），GraphQL 查询模板已就绪（graphql.ts）。
 * 双端点 API 一律 smart 包装（见 docs/api-compat.md §2）；单端点走 REST 数据层。
 */

import { shouldUseGraphQL, triggerGqlCooldown } from "./octokit";
import {
  graphqlRequest as rawGraphqlRequest,
  hasGraphQLErrors,
  type GraphQLResponse,
} from "./graphql";

export { hasGraphQLErrors };
export type { GraphQLResponse };

// ===== API 模式熔断：主模式 + 自动切换）=====

/**
 * 主模式 graphql（默认）：GraphQL 首选，耗尽/不可达/熔断时自动降级 REST（60s 冷却）。
 * 主模式 rest：直接走 REST（GraphQL 不用）。
 * 均不改变用户设置（偏好设置页开关），仅运行时决策。
 */

/**
 * API 请求日志（dev 模式输出，格式同 rest.ts 的 [PureGit API]）。
 * 便于本地排障：一眼看出请求走了 GraphQL 还是 REST、耗时、状态、返回大小。
 */
function apiLog(
  kind: "REST" | "GraphQL",
  detail: string,
  status: number | string,
  ms: number,
  size?: number,
  err?: unknown,
): void {
  if (!import.meta.env.DEV) return;
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  const errStr = err ? ` ${err instanceof Error ? err.message : String(err)}` : "";
  console.log(`[PureGit API] [${kind}] ${detail} ${status} ${ms}ms${sizeStr}${errStr}`);
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** 从 query 提取操作名（query Xxx / mutation Xxx → Xxx） */
function queryName(query: string): string {
  const m = query.match(/(?:query|mutation)\s+(\w+)/);
  return m?.[1] ?? "anonymous";
}

/** 判断错误是否为网络层（不可达/超时/断连）—— 这类错误才触发熔断 */
function isNetworkError(e: unknown): boolean {
  return (
    e instanceof TypeError || // fetch failed（DNS/连接拒绝/网络不可达）
    (e instanceof DOMException && e.name === "AbortError") // 超时中止
  );
}

/**
 * 带模式判断的 GraphQL 请求（替代原 graphqlRequest；调用方签名不变）。
 * - 主模式 rest / GraphQL 耗尽 / 熔断 → 短路返回 errors（smart 函数自然降级 REST）
 * - 主模式 graphql → 尝试 GraphQL，网络层失败触发熔断
 */
export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string | null,
): Promise<GraphQLResponse<T>> {
  const name = queryName(query);
  // 匿名强制 REST（GitHub GraphQL 匿名恒 403，实测 ）：
  // 未登录 token 为空 → 直接短路，smart 函数自然降级 REST（不消耗配额、不产生 403 噪音）
  if (!token) {
    apiLog("GraphQL", name, "skip→REST(anonymous)", 0);
    return { errors: [{ message: "GraphQL requires auth (anonymous → REST)" }] };
  }
  // 非 GraphQL 主模式（rest / 耗尽 / 熔断）→ 短路，smart 函数降级 REST
  if (!shouldUseGraphQL()) {
    apiLog("GraphQL", name, "skip→REST", 0);
    return { errors: [{ message: "GraphQL skipped (mode/cooldown/exhausted)" }] };
  }
  const started = performance.now();
  try {
    const resp = await rawGraphqlRequest<T>(query, variables, token);
    const ms = Math.round(performance.now() - started);
    const size = JSON.stringify(resp).length;
    const errCount = resp.errors?.length ?? 0;
    apiLog(
      "GraphQL",
      name,
      errCount ? `error(${errCount})` : 200,
      ms,
      size,
      errCount ? resp.errors?.[0].message : undefined,
    );
    return resp;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    // 仅网络层错误触发熔断；HTTP 4xx/5xx（如 token 失效）不熔断
    const degraded = isNetworkError(e);
    if (degraded) {
      triggerGqlCooldown();
    }
    apiLog("GraphQL", name, degraded ? "network-error→REST" : "error", ms, undefined, e);
    return { errors: [{ message: String(e) }] };
  }
}
