/**
 * GitHub API smart layer - 仓库 stargazers / watchers 列表
 *
 * GraphQL 连接分页首选（cursor）+ REST page 分页降级。
 * - 登录态：GraphQL repository.stargazers / watchers 连接（cursor 分页 + totalCount）
 * - 匿名：强制 REST（stargazers 公开数据匿名可读）
 * 分页抽象：`cursor` 统一为「下一页定位符」——GraphQL 下是 opaque endCursor，
 * REST 降级下是页码字符串（内部维护，UI 无感知）。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { REPO_STARGAZERS_QUERY, REPO_WATCHERS_QUERY } from "../graphql";
import { fetchStargazers, fetchWatchers } from "../restapi";
import type { GitHubUser } from "../restapi";

/** 用户列表分页结果（users 本页用户 / endCursor 下一页定位符 / hasNextPage / totalCount） */
export interface UserListPage {
  users: GitHubUser[];
  endCursor: string | null;
  hasNextPage: boolean;
  /** 总数（GraphQL 提供；REST 降级为 null） */
  totalCount: number | null;
}

const PER_PAGE = 30;

/** GraphQL 用户连接边的节点映射（login 必填，name/avatar 可空 → undefined 对齐 GitHubUser 可选字段） */
function toUser(
  n: { login: string; name?: string | null; avatarUrl?: string | null } | null,
): GitHubUser | null {
  if (!n) return null;
  return { login: n.login, name: n.name ?? undefined, avatar_url: n.avatarUrl ?? undefined };
}

/** 智能获取 stargazers：GraphQL stargazers 连接首选，失败降级 REST（page 分页）。 */
export async function fetchStargazersSmart(
  owner: string,
  repo: string,
  token?: string | null,
  cursor?: string,
): Promise<UserListPage> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) => {
    const page = cursor ? Number(cursor) : 1;
    return withRestFallback(
      async () => {
        const users = await fetchStargazers(owner, repo, PER_PAGE, page, token);
        return {
          users,
          endCursor: users.length === PER_PAGE ? String(page + 1) : null,
          hasNextPage: users.length === PER_PAGE,
          totalCount: null,
        };
      },
      "fetchStargazersSmart",
      gqlResp,
    );
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          stargazers: {
            totalCount: number;
            pageInfo: { endCursor: string | null; hasNextPage: boolean } | null;
            edges: {
              node: { login: string; name?: string | null; avatarUrl?: string | null } | null;
            }[];
          };
        } | null;
      }> = await graphqlRequest(
        REPO_STARGAZERS_QUERY,
        { owner, name: repo, first: PER_PAGE, after: cursor },
        token,
      );
      const sg = resp.data?.repository?.stargazers;
      if (sg && !hasGraphQLErrors(resp)) {
        return {
          users: sg.edges.map((e) => toUser(e.node)).filter((u): u is GitHubUser => u !== null),
          endCursor: sg.pageInfo?.endCursor ?? null,
          hasNextPage: sg.pageInfo?.hasNextPage ?? false,
          totalCount: sg.totalCount,
        };
      }
      return fromRest(resp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/** 智能获取 watchers：GraphQL watchers 连接首选，失败降级 REST（page 分页）。 */
export async function fetchWatchersSmart(
  owner: string,
  repo: string,
  token?: string | null,
  cursor?: string,
): Promise<UserListPage> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) => {
    const page = cursor ? Number(cursor) : 1;
    return withRestFallback(
      async () => {
        const users = await fetchWatchers(owner, repo, PER_PAGE, page, token);
        return {
          users,
          endCursor: users.length === PER_PAGE ? String(page + 1) : null,
          hasNextPage: users.length === PER_PAGE,
          totalCount: null,
        };
      },
      "fetchWatchersSmart",
      gqlResp,
    );
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          watchers: {
            totalCount: number;
            pageInfo: { endCursor: string | null; hasNextPage: boolean } | null;
            edges: {
              node: { login: string; name?: string | null; avatarUrl?: string | null } | null;
            }[];
          };
        } | null;
      }> = await graphqlRequest(
        REPO_WATCHERS_QUERY,
        { owner, name: repo, first: PER_PAGE, after: cursor },
        token,
      );
      const wt = resp.data?.repository?.watchers;
      if (wt && !hasGraphQLErrors(resp)) {
        return {
          users: wt.edges.map((e) => toUser(e.node)).filter((u): u is GitHubUser => u !== null),
          endCursor: wt.pageInfo?.endCursor ?? null,
          hasNextPage: wt.pageInfo?.hasNextPage ?? false,
          totalCount: wt.totalCount,
        };
      }
      return fromRest(resp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}
