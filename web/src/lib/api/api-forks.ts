/**
 * GitHub API smart layer - 仓库 forks 列表（官方 /forks）
 *
 * GraphQL 连接分页首选（cursor）+ REST page 分页降级。
 * - 登录态：GraphQL repository.forks 连接（cursor 分页 + totalCount）
 * - 匿名：强制 REST（forks 公开数据匿名可读）
 * 分页抽象：`cursor` 统一为「下一页定位符」——GraphQL 下是 opaque endCursor，
 * REST 降级下是页码字符串（内部维护，UI 无感知）。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { REPO_FORKS_QUERY } from "../graphql";
import { fetchForks } from "../restapi";
import type { RepoFork } from "../restapi";

/** fork 列表分页结果（forks 本页 / endCursor 下一页定位符 / hasNextPage / totalCount） */
export interface ForkListPage {
  forks: RepoFork[];
  endCursor: string | null;
  hasNextPage: boolean;
  /** 总数（GraphQL 提供；REST 降级为 null） */
  totalCount: number | null;
}

const PER_PAGE = 30;

/** GraphQL fork 节点映射为 RepoFork（收窄字段） */
function toFork(n: {
  name: string;
  nameWithOwner: string;
  description?: string | null;
  primaryLanguage?: { name: string } | null;
  stargazerCount: number;
  url: string;
  owner: { login: string; avatarUrl: string };
}): RepoFork {
  return {
    name: n.name,
    full_name: n.nameWithOwner,
    owner: { login: n.owner.login, avatar_url: n.owner.avatarUrl },
    description: n.description ?? null,
    language: n.primaryLanguage?.name ?? null,
    stargazers_count: n.stargazerCount,
    html_url: n.url,
  };
}

/** 智能获取 forks：GraphQL forks 连接首选，失败降级 REST（page 分页）。 */
export async function fetchForksSmart(
  owner: string,
  repo: string,
  token?: string | null,
  cursor?: string,
): Promise<ForkListPage> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) => {
    const page = cursor ? Number(cursor) : 1;
    return withRestFallback(
      async () => {
        const forks = await fetchForks(owner, repo, PER_PAGE, page, token);
        return {
          forks,
          endCursor: forks.length === PER_PAGE ? String(page + 1) : null,
          hasNextPage: forks.length === PER_PAGE,
          totalCount: null,
        };
      },
      "fetchForksSmart",
      gqlResp,
    );
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          forks: {
            totalCount: number;
            pageInfo: { endCursor: string | null; hasNextPage: boolean } | null;
            edges: {
              node: {
                name: string;
                nameWithOwner: string;
                description?: string | null;
                primaryLanguage?: { name: string } | null;
                stargazerCount: number;
                url: string;
                owner: { login: string; avatarUrl: string };
              };
            }[];
          };
        } | null;
      }> = await graphqlRequest(
        REPO_FORKS_QUERY,
        { owner, name: repo, first: PER_PAGE, after: cursor },
        token,
      );
      const fk = resp.data?.repository?.forks;
      if (fk && !hasGraphQLErrors(resp)) {
        return {
          forks: fk.edges.map((e) => toFork(e.node)),
          endCursor: fk.pageInfo?.endCursor ?? null,
          hasNextPage: fk.pageInfo?.hasNextPage ?? false,
          totalCount: fk.totalCount,
        };
      }
      return fromRest(resp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}
