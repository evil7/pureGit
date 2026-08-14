/**
 * GitHub API smart layer - search（自 api-issue 拆出）
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  SEARCH_REPOS_QUERY,
  SEARCH_USERS_QUERY,
  SEARCH_ISSUES_QUERY,
  SEARCH_PULLS_QUERY,
  SEARCH_DISCUSSIONS_QUERY,
} from "../graphql";
import {
  searchRepositories,
  searchUsers,
  searchIssues,
  fetchTrendingRepositories,
} from "../restapi";
import type {
  GitHubUser,
  Repository,
  Issue,
  SearchResponse,
  DiscussionSearchItem,
} from "../restapi";
// ===== 搜索：GraphQL search 首选 + REST /search 降级 =====

/** GraphQL 搜索仓库节点 */
interface GraphQLSearchRepo {
  databaseId: number | null;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  updatedAt: string;
  isPrivate: boolean;
}

function toSearchRepo(g: GraphQLSearchRepo): Repository {
  return {
    id: g.databaseId ?? -1,
    name: g.name,
    full_name: g.nameWithOwner,
    owner: { login: g.nameWithOwner.split("/")[0] },
    description: g.description,
    html_url: g.url,
    homepage: null,
    stargazers_count: g.stargazerCount,
    forks_count: g.forkCount,
    language: g.primaryLanguage?.name ?? null,
    topics: [],
    updated_at: g.updatedAt,
    pushed_at: g.updatedAt,
    license: null,
    default_branch: "main",
    private: g.isPrivate,
  };
}

/** 智能搜索仓库：登录时 GraphQL search 首选，失败/未登录降级 REST。 */
export async function searchRepositoriesSmart(
  q: string,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<Repository>> {
  // 分页请求（page>1）→ 直接 REST（GraphQL search 分页需 after 游标）
  if (page > 1) {
    return searchRepositories(q, 20, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        search: { repositoryCount: number; nodes: GraphQLSearchRepo[] };
      }> = await graphqlRequest(SEARCH_REPOS_QUERY, { q, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.search) {
        return {
          total_count: resp.data.search.repositoryCount,
          incomplete_results: false,
          items: resp.data.search.nodes.map(toSearchRepo),
        };
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => searchRepositories(q, 20, token),
        "searchRepositoriesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => searchRepositories(q, 20, token),
        "searchRepositoriesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return searchRepositories(q, 20, token);
}

/** 智能搜索用户：登录时 GraphQL search 首选，失败/未登录降级 REST。 */
export async function searchUsersSmart(
  q: string,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<GitHubUser>> {
  // 分页请求（page>1）→ 直接 REST
  if (page > 1) {
    return searchUsers(q, 20, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        search: {
          userCount: number;
          nodes: {
            login: string;
            name: string | null;
            avatarUrl: string | null;
            bio: string | null;
            description: string | null;
          }[];
        };
      }> = await graphqlRequest(SEARCH_USERS_QUERY, { q, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.search) {
        return {
          total_count: resp.data.search.userCount,
          incomplete_results: false,
          items: resp.data.search.nodes.map((n) => ({
            login: n.login,
            name: n.name ?? undefined,
            avatar_url: n.avatarUrl ?? undefined,
            // User 有 bio、Organization 有 description，二者归一为 bio 展示
            bio: n.bio ?? n.description ?? undefined,
          })),
        };
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(() => searchUsers(q, 20, token), "searchUsersSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(() => searchUsers(q, 20, token), "searchUsersSmart", undefined);
    }
  }
  // 匿名强制 REST
  return searchUsers(q, 20, token);
}

/** GraphQL 搜索 issue/PR 节点（含所属仓库） */
interface GraphQLSearchIssue {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  closedAt: string | null;
  comments: { totalCount: number };
  author: { login: string } | null;
  labels?: { nodes: { name: string; color: string }[] };
  repository: { nameWithOwner: string };
}

/** 智能搜索 issue/PR：登录时 GraphQL search 首选，失败/未登录降级 REST。 */
export async function searchIssuesSmart(
  q: string,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<Issue>> {
  // 分页请求（page>1）→ 直接 REST
  if (page > 1) {
    return searchIssues(q, 20, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        search: { issueCount: number; nodes: GraphQLSearchIssue[] };
      }> = await graphqlRequest(SEARCH_ISSUES_QUERY, { q, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.search) {
        return {
          total_count: resp.data.search.issueCount,
          incomplete_results: false,
          items: resp.data.search.nodes.map((n) => ({
            // search 节点无 databaseId → 用仓库+编号派生唯一 id（React key 需要）
            id: searchIssueId(n.repository.nameWithOwner, n.number),
            number: n.number,
            title: n.title,
            state: n.state.toLowerCase(),
            html_url: n.url,
            user: { login: n.author?.login ?? "ghost" },
            created_at: n.createdAt,
            updated_at: n.createdAt,
            closed_at: n.closedAt ?? null,
            comments: n.comments?.totalCount ?? 0,
            body: null,
            labels: n.labels?.nodes ?? [],
            // 附带所属仓库，便于搜索结果展示来源
            repository: { full_name: n.repository.nameWithOwner },
          })),
        };
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(() => searchIssues(q, 20, token), "searchIssuesSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(() => searchIssues(q, 20, token), "searchIssuesSmart", undefined);
    }
  }
  // 匿名强制 REST
  return searchIssues(q, 20, token);
}

/** GraphQL search 节点无 databaseId → 由 owner/name + number 派生稳定唯一 id */
export function searchIssueId(fullName: string, number: number): number {
  let h = 0;
  for (let i = 0; i < fullName.length; i++) h = (h * 31 + fullName.charCodeAt(i)) | 0;
  return h ^ (number * 2654435761);
}

/** 智能搜索 PR：登录时 GraphQL search（`... on PullRequest` 片段）首选，失败/未登录降级 REST。
 * 与 searchIssuesSmart 的差异：PR 非 Issue 子类型，必须用 `... on PullRequest` 片段（`... on Issue` 不匹配 PR）。 */
export async function searchPullsSmart(
  q: string,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<Issue>> {
  // 分页请求（page>1）→ 直接 REST
  if (page > 1) {
    return searchIssues(q, 20, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        search: { issueCount: number; nodes: GraphQLSearchIssue[] };
      }> = await graphqlRequest(SEARCH_PULLS_QUERY, { q, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.search) {
        return {
          total_count: resp.data.search.issueCount,
          incomplete_results: false,
          items: resp.data.search.nodes.map((n) => ({
            id: searchIssueId(n.repository.nameWithOwner, n.number),
            number: n.number,
            title: n.title,
            state: n.state.toLowerCase(),
            html_url: n.url,
            user: { login: n.author?.login ?? "ghost" },
            created_at: n.createdAt,
            updated_at: n.createdAt,
            closed_at: n.closedAt ?? null,
            comments: n.comments?.totalCount ?? 0,
            body: null,
            labels: n.labels?.nodes ?? [],
            // PR 标记（列表渲染用 PR 图标 + 跳 /pull/{n}）
            pull_request: {},
            repository: { full_name: n.repository.nameWithOwner },
          })),
        };
      }
      return withRestFallback(() => searchIssues(q, 20, token), "searchPullsSmart", resp);
    } catch {
      return withRestFallback(() => searchIssues(q, 20, token), "searchPullsSmart", undefined);
    }
  }
  // 匿名强制 REST（searchIssues 经 issuesAndPullRequests 返回 PR）
  return searchIssues(q, 20, token);
}

/** GraphQL 搜索讨论节点（附来源仓库） */
interface GraphQLSearchDiscussion {
  number: number;
  title: string;
  createdAt: string;
  category: { id: string; name: string; emoji: string };
  author: { login: string; avatarUrl: string } | null;
  answerChosenAt: string | null;
  comments: { totalCount: number };
  upvoteCount: number;
  repository: { nameWithOwner: string };
}

/** 智能搜索讨论：GraphQL search(type: DISCUSSION) 唯一通道（REST 无 discussion 端点）。 */
export async function searchDiscussionsSmart(
  q: string,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<DiscussionSearchItem>> {
  // 分页请求（page>1）→ GraphQL search 需游标，暂无续接；保底抛错由页面提示（讨论搜索仅首屏）
  if (page > 1) {
    return { total_count: 0, incomplete_results: false, items: [] };
  }
  if (token) {
    const resp: GraphQLResponse<{
      search: { discussionCount: number; nodes: GraphQLSearchDiscussion[] };
    }> = await graphqlRequest(SEARCH_DISCUSSIONS_QUERY, { q, first: 20 }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.search) {
      return {
        total_count: resp.data.search.discussionCount,
        incomplete_results: false,
        items: resp.data.search.nodes.map((n) => ({
          number: n.number,
          title: n.title,
          createdAt: n.createdAt,
          category: {
            id: n.category.id,
            name: n.category.name,
            emoji: n.category.emoji,
          },
          author: { login: n.author?.login ?? "ghost", avatar_url: n.author?.avatarUrl ?? "" },
          answered: Boolean(n.answerChosenAt),
          commentsCount: n.comments?.totalCount ?? 0,
          upvoteCount: n.upvoteCount,
          repository: { full_name: n.repository.nameWithOwner },
        })),
      };
    }
    // GraphQL 唯一通道无 REST 降级 → 抛错（页面 InlineError 展示）
    throw new Error(resp.errors?.[0]?.message ?? "discussions 搜索失败");
  }
  // 匿名：GraphQL 恒 403 且无 REST discussion 端点 → 返回空（页面提示登录）
  return { total_count: 0, incomplete_results: false, items: [] };
}

/** 智能获取趋势仓库（热点）：GraphQL search 首选（`created:>since sort:stars`）+ REST 降级。
 * 趋势本身无官方 API，用 search 按 star 排序模拟（近 days 天创建）；登录态走 GraphQL，匿名/降级走 REST。
 * @param page 分页（首页 1）；page>1 直走 REST（GraphQL search 分页需 after 游标，与 searchRepositoriesSmart 同模式） */
export async function fetchTrendingRepositoriesSmart(
  days = 30,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const q = `created:>${since} sort:stars`;
  // 分页请求（page>1）→ 直接 REST（GraphQL search 分页需 after 游标）
  if (page > 1) {
    return fetchTrendingRepositories(days, perPage, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{ search: { nodes: GraphQLSearchRepo[] } }> =
        await graphqlRequest(SEARCH_REPOS_QUERY, { q, first: perPage }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.search) {
        return resp.data.search.nodes.map(toSearchRepo);
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchTrendingRepositories(days, perPage, token),
        "fetchTrendingRepositoriesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchTrendingRepositories(days, perPage, token),
        "fetchTrendingRepositoriesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchTrendingRepositories(days, perPage, token);
}

/** GraphQL 评论节点 → REST IssueComment */
