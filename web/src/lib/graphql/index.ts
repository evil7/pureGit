/**
 * GitHub GraphQL 请求模板库 + 客户端（@octokit/graphql · v0.0.1 设计调整）
 *
 * 架构：**GraphQL 唯一主通道**（登录态全部经 GraphQL；失败 → withRestFallback 熔断降级 REST）。
 * 本模块职责：
 * - **请求模板库**：查询/变更模板常量（路径参数 → 变量，如 PULLS_QUERY + {owner, name, states...}），
 *   板块（api-*.ts）直接 import 模板名，不手拼查询字符串
 * - **客户端**：graphqlRequest<T> 经 SDK 发出（自动标准请求头 + 响应头额度跟踪 octokit.ts）
 * - 保持 GraphQLResponse / hasGraphQLErrors 契约（api.ts 依赖）
 * - 匿名强制 REST：token 为空时由 api-core.ts 短路，本模块不发出 GraphQL
 */
import { createGraphqlClient } from "../api/octokit";

/** GraphQL 响应包装（保持旧契约） */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; path?: (string | number)[] }[];
}

/**
 * 执行 GraphQL 请求（query 或 mutation），经 @octokit/graphql。
 * 返回 GraphQLResponse 形态：HTTP 错误（4xx/5xx）抛错（api.ts 捕获降级）；
 * GraphQL errors 字段正常返回（调用方 hasGraphQLErrors 判断）。
 */
export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string | null,
): Promise<GraphQLResponse<T>> {
  // 匿名强制 REST（实测）：GitHub GraphQL 端点匿名请求恒 403。
  // 未登录（token 为空）一律短路返回 errors → smart 层 hasGraphQLErrors 自动降级 REST，
  // 任何调用方（api-*.ts smart 层 / repo-raw.ts）匿名时都不再发出 GraphQL 请求
  if (!token) {
    return { errors: [{ message: "GraphQL requires authentication (anonymous → REST)" }] };
  }
  const client = createGraphqlClient(token);
  // @octokit/graphql：成功返回 data；GraphQL errors 抛 GraphqlResponseError（带 data/errors）
  try {
    const data = await client<T>(query, variables);
    return { data };
  } catch (e) {
    const err = e as {
      name?: string;
      data?: unknown;
      errors?: { message: string; path?: (string | number)[] }[];
      status?: number;
    };
    // GraphQL 层错误（errors 数组）→ 包装为 GraphQLResponse（不抛，供 hasGraphQLErrors）
    if (err && Array.isArray(err.errors) && err.errors.length > 0) {
      return { data: err.data as T | undefined, errors: err.errors };
    }
    throw e; // 网络错误/HTTP 错误原样抛出
  }
}

/** 校验 GraphQL 响应是否有错误 */
export function hasGraphQLErrors<T>(resp: GraphQLResponse<T>): boolean {
  return Boolean(resp.errors && resp.errors.length > 0);
}

// ===== 模板 barrel（按业务域拆分） =====
export * from "./queries-common";
export * from "./project";
export * from "./issue-pr";
export * from "./discussions";
export * from "./search";
export * from "./feed";
export * from "./account";
export * from "./review";
export * from "./meta";
