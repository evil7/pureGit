/**
 * GitHub API smart layer - core (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

/**
 * GitHub API 智能封装层（v0.0.1 设计调整：GraphQL 唯一主通道）
 *
 * 策略：登录态全部功能经 GraphQL；统一经本模块 smart 函数调用，页面组件不感知具体协议。
 * - 匿名强制 REST：GraphQL 匿名恒 403（实测），token 为空直接短路 → smart 函数走 REST 数据层
 * - GraphQL 耗尽/不可达/报错 → 熔断降级 REST（现有 REST 代码复用，按新思路优化为降级链，
 *   日志经 api-log 自动打 `↪` fallback 标记）；GraphQL 主请求失败日志含 vars + error 详情行
 * - REST core 与 GraphQL 双额度分开计数（octokit.ts 统一跟踪，footer/设置页展示）
 *
 * 当前状态：第 1~2 步实施中——smart 层 GraphQL 唯一主通道 + REST 熔断降级（复用现有 rest 层）；
 * GraphQL 请求模板逐步定型（路径参数 → 变量），模板聚合边界确定后 REST 降级链同步补全。
 */

import { shouldUseGraphQL, triggerGqlCooldown } from "./octokit";
import {
  beginFallback,
  logError,
  logFallback,
  logGraphqlMain,
  logMainRequest,
  logWarn,
} from "./api-log";
import {
  graphqlRequest as rawGraphqlRequest,
  hasGraphQLErrors,
  type GraphQLResponse,
} from "../graphql";

export { hasGraphQLErrors };
export type { GraphQLResponse };

// ===== API 熔断框架（GraphQL 唯一主通道 + REST 熔断降级链）=====

/**
 * v0.0.1 设计调整：GraphQL 唯一主通道。
 * - 登录态全部功能经 GraphQL；GraphQL 耗尽/不可达/报错 → withRestFallback 熔断降级 REST（复用 rest 层，日志 ↪ 标记）
 * - 匿名强制 REST（GraphQL 匿名恒 403——REST 数据层保留的核心原因）
 * 熔断机制框架保留：cooldown（网络错误 60s）/ 额度跟踪 / 去重 / 响应缓存（octokit.ts）。
 */

/**
 * API 请求日志（dev 模式输出，统一 api-log.ts 工具）。
 * 格式：[Graph]/[Rest] + 状态 + 大小 + 耗时；熔断降级链中自动加 `↪` 前缀（api-log 管理层级）。
 */
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
 * 熔断降级链包装：GraphQL 主请求失败 → 执行 REST 降级（复用 rest 层现有实现）。
 *
 * 用法（smart 函数）：
 * ```ts
 * const resp = await graphqlRequest(XXX_QUERY, vars, token);
 * if (!hasGraphQLErrors(resp) && resp.data?.repository) return toXxx(resp.data.repository);
 * return withRestFallback(() => fetchXxx(owner, repo, token), "fetchXxx", resp);
 * ```
 * - beginFallback() 进入降级链：返回降级会话序号 id（[Fallback#n] 关联），
 *   使降级链中的 REST 日志自动加 `↪` 图标（api-log 管理）
 * - 支持嵌套降级链（fallback 内再 fallback → 栈式保存/还原）
 */
export async function withRestFallback<T>(
  restFn: () => Promise<T>,
  detail: string,
  gqlResp?: GraphQLResponse<unknown>,
): Promise<T> {
  const fb = beginFallback();
  try {
    // 降级触发日志（[Fallback#n] + error 详情）——GraphQL 失败原因，便于调试
    logFallback(detail, gqlResp?.errors?.[0]?.message ?? null, fb.id);
    return await restFn();
  } catch (e) {
    // fallback REST 也失败 → [Error]（保留 throw，不吞错误，调用方仍能收到）
    logError(detail, e);
    throw e;
  } finally {
    fb.end();
  }
}

/**
 * 带熔断框架的 GraphQL 请求（GraphQL 唯一主通道；调用方签名不变）。
 * - 匿名（无 token）→ 短路返回 errors（smart 函数走匿名 REST 数据层，硬约束非降级）
 * - GraphQL 耗尽/熔断 → 返回 errors（smart 层经 withRestFallback 降级 REST，不静默切 REST）
 * - 网络层失败 → 触发 cooldown，返回 errors
 * 日志：主请求走 logGraphqlMain（含 vars）；错误详情由降级时的 [Fallback#n] 行承担（withRestFallback）。
 */
export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string | null,
): Promise<GraphQLResponse<T>> {
  const name = queryName(query);
  // 匿名强制 REST（GitHub GraphQL 匿名恒 403，实测 ）：
  // 未登录 token 为空 → 直接短路，smart 函数走 REST 数据层（不消耗配额、不产生 403 噪音）
  if (!token) {
    logMainRequest("graphql", `${name} skip→REST(anonymous)`, "skip", 0);
    return { errors: [{ message: "GraphQL requires auth (anonymous → REST)" }] };
  }
  // GraphQL 耗尽/熔断 → 不静默切 REST，返回 errors 由 smart 层 withRestFallback 处理
  if (!shouldUseGraphQL()) {
    logMainRequest("graphql", `${name} skip→REST(fallback)`, "skip", 0);
    return { errors: [{ message: "GraphQL skipped (cooldown/exhausted)" }] };
  }
  const started = performance.now();
  try {
    const resp = await rawGraphqlRequest<T>(query, variables, token);
    const ms = Math.round(performance.now() - started);
    const size = JSON.stringify(resp).length;
    const errCount = resp.errors?.length ?? 0;
    // 主请求日志：有 errors 时状态打 error(n)（HTTP 200 但业务错误）；错误详情由降级时的 [Fallback] 行承担
    logGraphqlMain(name, variables, errCount ? `error(${errCount})` : 200, ms, size);
    return resp;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    // 仅网络层错误触发熔断；HTTP 4xx/5xx（如 token 失效）不熔断
    const degraded = isNetworkError(e);
    if (degraded) {
      triggerGqlCooldown();
    }
    logGraphqlMain(name, variables, degraded ? "network-error" : "error", ms);
    // 补充错误详情：网络错误 → [Warn]（可预期降级信号，触发熔断）；HTTP 4xx/5xx → [Error]（真实错误）
    if (degraded) {
      logWarn(name, `network error → cooldown: ${String(e)}`);
    } else {
      logError(name, e);
    }
    return { errors: [{ message: String(e) }] };
  }
}
