/**
 * GitHub API smart layer - issue-pr（自 api-issue 拆出）
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

/**
 * GitHub API smart layer - issue (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  ISSUES_QUERY,
  ISSUE_DETAIL_QUERY,
  ISSUE_ID_QUERY,
  UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
  PULLS_QUERY,
  PULL_DETAIL_QUERY,
  RELEASES_QUERY,
  RELEASE_DETAIL_QUERY,
  LATEST_RELEASE_QUERY,
  ISSUE_DETAIL_WITH_COMMENTS_QUERY,
  PULL_DETAIL_WITH_COMMENTS_QUERY,
  ISSUE_COMMENTS_QUERY,
  ADD_COMMENT_MUTATION,
  PULL_REVIEW_COMMENTS_QUERY,
  ADD_PULL_REVIEW_COMMENT_MUTATION,
  PULL_REVIEW_SUMMARY_QUERY,
  ADD_PULL_REQUEST_REVIEW_MUTATION,
  MERGE_PULL_REQUEST_MUTATION,
  REQUEST_REVIEWS_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
  REPO_BRANCHES_QUERY,
  REPO_LABELS_QUERY,
  REPO_ASSIGNEES_QUERY,
  PR_PROJECTS_QUERY,
  PR_DEVELOPMENT_QUERY,
  PR_TIMELINE_QUERY,
  LOCK_PULL_REQUEST_MUTATION,
  UNLOCK_PULL_REQUEST_MUTATION,
} from "./graphql";
import {
  fetchBranches,
  fetchRepoLabels,
  fetchRepoAssignees,
  fetchIssueComments,
  addIssueComment,
  fetchPullReviewComments,
  addPullReviewComment,
  fetchPullReviews,
  createPullReview,
  mergePullRequest,
  requestReviewers,
  updatePullRequestState,
  lockPullRequest,
  unlockPullRequest,
  subscribeIssue,
  unsubscribeIssue,
  fetchIssues,
  fetchIssueDetail,
  fetchPulls,
  fetchPullDetail,
  fetchReleases,
  fetchReleaseDetail,
  fetchLatestRelease,
} from "./rest";
import type {
  GitHubUser,
  Issue,
  PullRequest,
  Release,
  IssueComment,
  ReviewComment,
  PullReview,
  ReviewEvent,
  PullMergeMethod,
  RepoLabel,
} from "./rest";
import { searchIssuesSmart } from "./api-search";

// ===== issue / PR / release / 搜索：GraphQL 首选 + REST 降级 =====

/** GraphQL issue 节点（列表与详情共用） */
interface GraphQLIssueNode {
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  body: string | null;
  viewerSubscription?: string | null;
  author: { login: string; avatarUrl?: string } | null;
  comments: { totalCount: number };
  labels?: { nodes: { name: string; color: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] } | null;
  milestone?: { title: string } | null;
}

/** GraphQL issue 节点 → REST Issue */
function toIssue(g: GraphQLIssueNode): Issue {
  return {
    id: -1,
    number: g.number,
    title: g.title,
    state: g.state.toLowerCase(),
    html_url: g.url,
    user: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl },
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    closed_at: g.closedAt ?? null,
    comments: g.comments?.totalCount ?? 0,
    body: g.body,
    labels: g.labels?.nodes ?? [],
    assignees: g.assignees?.nodes.map((a) => ({ login: a.login, avatar_url: a.avatarUrl })) ?? [],
    milestone: g.milestone ?? null,
    subscription: g.viewerSubscription ?? null,
  };
}

/** GraphQL PR 节点（列表与详情共用） */
interface GraphQLPullNode {
  databaseId?: number | null;
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  body: string | null;
  viewerSubscription?: string | null;
  mergedAt: string | null;
  isDraft: boolean;
  author: { login: string; avatarUrl?: string } | null;
  comments: { totalCount: number };
  reviews: { totalCount: number };
  reviewThreads: { totalCount: number };
  /** 关联的 issue 数（PR 关闭时引用的 closing references） */
  closingIssuesReferences: { totalCount: number };
  commits: { totalCount: number };
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  baseRefOid: string;
  headRepositoryOwner: { login: string } | null;
  baseRepository: { owner: { login: string } } | null;
  labels?: { nodes: { name: string; color: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] } | null;
  milestone?: { title: string } | null;
}

/** GraphQL PR 节点 → REST PullRequest（MERGED 映射为 closed + merged_at；id 用 databaseId 保证列表 key 唯一） */
function toPull(g: GraphQLPullNode): PullRequest {
  return {
    id: g.databaseId ?? -1,
    number: g.number,
    title: g.title,
    state: g.state === "MERGED" ? "closed" : g.state.toLowerCase(),
    html_url: g.url,
    user: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl },
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    closed_at: g.closedAt ?? null,
    body: g.body,
    merged_at: g.mergedAt,
    // 评论数 = issue 评论 + 评审评论 + 行内线程（对齐官方 octicon-comment 合计；REST 列表 comments 字段原生即合计）
    comments:
      (g.comments?.totalCount ?? 0) +
      (g.reviews?.totalCount ?? 0) +
      (g.reviewThreads?.totalCount ?? 0),
    /** 关联 issue 数（PR 描述中引用、可关闭的 issues） */
    linked_issues: g.closingIssuesReferences?.totalCount ?? 0,
    commits: g.commits?.totalCount ?? 0,
    additions: g.additions ?? 0,
    deletions: g.deletions ?? 0,
    changed_files: g.changedFiles ?? 0,
    draft: g.isDraft ?? false,
    subscription: g.viewerSubscription ?? null,
    head: {
      ref: g.headRefName,
      label: `${g.headRepositoryOwner?.login ?? ""}:${g.headRefName}`,
      sha: g.headRefOid,
    },
    base: {
      ref: g.baseRefName,
      label: `${g.baseRepository?.owner?.login ?? ""}:${g.baseRefName}`,
      sha: g.baseRefOid,
    },
    labels: g.labels?.nodes ?? [],
    assignees: g.assignees?.nodes.map((a) => ({ login: a.login, avatar_url: a.avatarUrl })) ?? [],
    milestone: g.milestone ?? null,
  };
}

/** GraphQL release 节点（列表与详情共用） */
interface GraphQLReleaseNode {
  databaseId: number | null;
  name: string | null;
  tagName: string;
  description: string | null;
  url: string;
  publishedAt: string;
  isDraft: boolean;
  isPrerelease: boolean;
  author: { login: string } | null;
  releaseAssets: {
    nodes: { name: string; size: number; downloadUrl: string }[];
  } | null;
}

/** GraphQL release 节点 → REST Release（⚠️ id 用 databaseId，占位 -1 会导致列表 key 重复 + activeId 全命中） */
function toRelease(g: GraphQLReleaseNode): Release {
  return {
    id: g.databaseId ?? -1,
    tag_name: g.tagName,
    name: g.name,
    body: g.description,
    html_url: g.url,
    published_at: g.publishedAt,
    draft: g.isDraft,
    prerelease: g.isPrerelease,
    author: { login: g.author?.login ?? "ghost" },
    assets:
      g.releaseAssets?.nodes.map((a) => ({
        name: a.name,
        size: a.size,
        browser_download_url: a.downloadUrl,
      })) ?? [],
  };
}

/** GraphQL IssueState 数组（open/closed/all → OPEN/CLOSED 组合） */
function issueStates(state: "open" | "closed" | "all"): string[] {
  if (state === "open") return ["OPEN"];
  if (state === "closed") return ["CLOSED"];
  return ["OPEN", "CLOSED"];
}

/** GraphQL PullRequestState 数组（open/closed/all → OPEN/CLOSED/MERGED 组合） */
function pullStates(state: "open" | "closed" | "all"): string[] {
  if (state === "open") return ["OPEN"];
  if (state === "closed") return ["CLOSED", "MERGED"];
  return ["OPEN", "CLOSED", "MERGED"];
}

/**
 * 智能获取仓库 issue 列表：GraphQL repository.issues 首选（天然排除 PR），
 * 失败自动降级 REST /repos/.../issues（客户端过滤 PR）。
 * 过滤参数（author/assignee/labels/sort/q）：GraphQL 不直接支持 → 有过滤时走 REST（免复杂 query 拼装）。
 * @param limit 单页条数（默认 30；MarkdownEditor 等需更大列表时可传）
 */
export async function fetchIssuesSmart(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  token?: string | null,
  filters?: {
    author?: string;
    assignee?: string;
    labels?: string;
    sort?: string;
    q?: string;
  },
  limit = 30,
  page = 1,
): Promise<{ items: Issue[]; openCount: number | null; closedCount: number | null }> {
  // 分页请求（page>1）或含过滤条件 → 直接 REST（GraphQL 分页需游标，非首页统一走 REST）
  if (
    page > 1 ||
    (filters &&
      (filters.author ||
        filters.assignee ||
        filters.labels ||
        (filters.sort && filters.sort !== "created") ||
        filters.q))
  ) {
    // 含 @me 语义（author:@me / assignee:@me / q 含 mentions:@me）或 q 搜索：
    // search API 支持 @me（REST /issues 的 creator/assignee 不支持 @me，也不支持 q 参数）
    // 注：page>1 分页时 filters 可能为 undefined，用可选链防御
    if (filters?.q || filters?.author?.includes("@me") || filters?.assignee?.includes("@me")) {
      // 搜索独立于 state tab（官方行为）：q 存在时不再追加 state:，结果含所有状态，
      // 除非 q 显式含 is:open/is:closed 等状态词（此时 q 自带状态过滤）
      const qParts = [
        `repo:${owner}/${repo}`,
        `is:issue`,
        filters?.author ? `author:${filters.author}` : "",
        filters?.assignee ? `assignee:${filters.assignee}` : "",
        filters?.labels ? `label:${filters.labels}` : "",
        filters?.q,
      ]
        .filter(Boolean)
        .join(" ");
      const resp = await searchIssuesSmart(qParts, token);
      return { items: resp.items, openCount: null, closedCount: null };
    }
    const items = await fetchIssues(owner, repo, state, limit, token, filters, page);
    return { items, openCount: null, closedCount: null };
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          openCount: { totalCount: number };
          closedCount: { totalCount: number };
          issues: { nodes: GraphQLIssueNode[] };
        } | null;
      }> = await graphqlRequest(
        ISSUES_QUERY,
        { owner, name: repo, states: issueStates(state), first: limit },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const repoData = resp.data.repository;
        return {
          items: repoData.issues.nodes.map(toIssue),
          openCount: repoData.openCount.totalCount,
          closedCount: repoData.closedCount.totalCount,
        };
      }
    } catch {
      // 降级 REST
    }
  }
  const items = await fetchIssues(owner, repo, state, limit, token);
  return { items, openCount: null, closedCount: null };
}

/** 智能获取 issue 详情：GraphQL issue(number) 首选，失败降级 REST。 */
export async function fetchIssueDetailSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<Issue> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { issue: GraphQLIssueNode | null } | null;
      }> = await graphqlRequest(ISSUE_DETAIL_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.issue) {
        return toIssue(resp.data.repository.issue);
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchIssueDetail(owner, repo, number, token);
}

/**
 * 切换 issue 订阅状态（GraphQL updateSubscription 首选；REST PUT/DELETE 仅兜底）。
 * @returns 订阅后的状态（true=已订阅）
 */
export async function setIssueSubscriptionSmart(
  owner: string,
  repo: string,
  number: number,
  subscribed: boolean,
  token: string,
): Promise<boolean> {
  if (token) {
    try {
      // 先查 issue node id（GraphQL mutation 需要）
      const idResp: GraphQLResponse<{
        repository: { issue: { id: string } | null } | null;
      }> = await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
      const id = idResp.data?.repository?.issue?.id;
      if (id && !hasGraphQLErrors(idResp)) {
        const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
          UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
          { id, state: subscribed ? "UNSUBSCRIBED" : "SUBSCRIBED" },
          token,
        );
        if (!hasGraphQLErrors(mutResp)) return !subscribed;
      }
    } catch {
      // 降级 REST
    }
  }
  // REST 兜底：订阅 PUT / 取消 DELETE
  if (subscribed) {
    await unsubscribeIssue(owner, repo, number, token);
  } else {
    await subscribeIssue(owner, repo, number, token);
  }
  return !subscribed;
}

/** 官方 Sort 菜单值 → REST /pulls sort + direction（best/newest 不传，默认即 newest） */
function restPullSort(sort?: string): {
  sort?: "created" | "updated" | "popularity" | "long-running";
  direction?: "asc" | "desc";
} {
  switch (sort) {
    case "created-asc":
      return { sort: "created", direction: "asc" };
    case "comments":
      return { sort: "popularity" };
    case "comments-asc":
      return { sort: "popularity", direction: "asc" };
    case "updated":
      return { sort: "updated" };
    case "updated-asc":
      return { sort: "updated", direction: "asc" };
    default:
      return {}; // newest / best / undefined
  }
}

/** 官方 Sort 菜单值 → search q 内 sort: qualifier（best/newest 不追加，默认即 newest） */
function searchSortQualifier(sort?: string): string {
  if (sort && sort !== "created" && sort !== "best") return `sort:${sort}`;
  return "";
}

/** 官方 Sort 菜单值 → GraphQL PullRequestOrderField（GitHub 无按评论数排序 → comments 归并 CREATED_AT） */
function graphqlPullOrderField(sort?: string): string {
  if (sort === "updated" || sort === "updated-asc") return "UPDATED_AT";
  return "CREATED_AT";
}

/** 官方 Sort 菜单值 → GraphQL OrderDirection（*-asc 升序，其余降序） */
function graphqlPullOrderDir(sort?: string): string {
  return sort?.endsWith("-asc") ? "ASC" : "DESC";
}

/** 智能获取仓库 PR 列表：GraphQL repository.pullRequests 首选，失败降级 REST。 */
/**
 * 智能获取仓库 PR 列表（v0.0.1 设计调整：GraphQL 唯一主通道）
 *
 * 通道决策：
 * - 分页（page>1）→ REST（GraphQL 列表分页需游标，首屏 first:30 内翻页由前端滚动加载，非分页参数场景）
 * - 过滤条件（author/labels/milestone/assignee/q）→ search GraphQL（searchIssuesSmart；REST /pulls 无便捷过滤）
 * - 登录态 → GraphQL 唯一主通道（PULLS_QUERY 模板 + 变量）；GraphQL 失败 → withRestFallback 降级 REST
 * - 匿名 → REST 数据层（GraphQL 匿名恒 403，硬约束）
 */
export async function fetchPullsSmart(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  token?: string | null,
  filters?: {
    author?: string;
    labels?: string;
    milestone?: string;
    assignee?: string;
    sort?: string;
    q?: string;
  },
  page = 1,
): Promise<{ items: PullRequest[]; openCount: number | null; closedCount: number | null }> {
  const { sort: restSort, direction } = restPullSort(filters?.sort);
  // 分页请求（page>1）→ 直接 REST（GraphQL 分页需游标）
  if (page > 1) {
    const items = await fetchPulls(owner, repo, state, 30, token, page, restSort, direction);
    return { items, openCount: null, closedCount: null };
  }
  // 有过滤条件 → search API（REST /pulls 不支持 q/author=@me/labels/milestone/assignee 便捷过滤）
  if (
    filters &&
    (filters.author || filters.labels || filters.milestone || filters.assignee || filters.q)
  ) {
    // 搜索独立于 state tab（官方行为）：q 存在时不再追加 state:，结果含所有状态
    const qParts = [
      `repo:${owner}/${repo}`,
      `is:pr`,
      filters.author ? `author:${filters.author}` : "",
      filters.labels ? `label:${filters.labels}` : "",
      filters.milestone ? `milestone:${filters.milestone}` : "",
      filters.assignee ? `assignee:${filters.assignee}` : "",
      filters.q,
      searchSortQualifier(filters.sort),
    ]
      .filter(Boolean)
      .join(" ");
    const resp = await searchIssuesSmart(qParts, token);
    // Issue → 最小 PullRequest（search 结果缺 PR 特有字段，行渲染用到的字段已映射）
    const items: PullRequest[] = resp.items
      .filter((i) => i.pull_request)
      .map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        html_url: i.html_url,
        user: i.user,
        created_at: i.created_at,
        updated_at: i.updated_at,
        body: i.body,
        merged_at: i.state === "closed" ? i.closed_at : null,
        comments: i.comments,
        commits: 0,
        additions: 0,
        deletions: 0,
        changed_files: 0,
        labels: i.labels ?? [],
      }));
    return { items, openCount: null, closedCount: null };
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          openCount: { totalCount: number };
          closedCount: { totalCount: number };
          pullRequests: { nodes: GraphQLPullNode[] };
        } | null;
      }> = await graphqlRequest(
        PULLS_QUERY,
        {
          owner,
          name: repo,
          states: pullStates(state),
          first: 30,
          orderField: graphqlPullOrderField(filters?.sort),
          orderDir: graphqlPullOrderDir(filters?.sort),
        },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const repoData = resp.data.repository;
        return {
          items: repoData.pullRequests.nodes.map(toPull),
          openCount: repoData.openCount.totalCount,
          closedCount: repoData.closedCount.totalCount,
        };
      }
      // GraphQL 失败 → 熔断降级 REST（复用 rest 层 fetchPulls；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => {
          const items = await fetchPulls(owner, repo, state, 30, token, 1, restSort, direction);
          return { items, openCount: null, closedCount: null };
        },
        "fetchPullsSmart",
        resp,
      );
    } catch {
      // 网络层错误（graphqlRequest 已触发 cooldown）→ 熔断降级 REST
      return withRestFallback(
        async () => {
          const items = await fetchPulls(owner, repo, state, 30, token, 1, restSort, direction);
          return { items, openCount: null, closedCount: null };
        },
        "fetchPullsSmart",
        undefined,
      );
    }
  }
  const items = await fetchPulls(owner, repo, state, 30, token, 1, restSort, direction);
  return { items, openCount: null, closedCount: null };
}

/** 智能获取 PR 详情：GraphQL pullRequest(number) 主通道 + REST 熔断降级（匿名走 REST 硬约束）。 */
export async function fetchPullDetailSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullRequest> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { pullRequest: GraphQLPullNode | null } | null;
      }> = await graphqlRequest(PULL_DETAIL_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.pullRequest) {
        return toPull(resp.data.repository.pullRequest);
      }
      // GraphQL 失败 → 熔断降级 REST（复用 rest 层 fetchPullDetail；日志自动 ↪ 前缀）
      return withRestFallback(
        () => fetchPullDetail(owner, repo, number, token),
        "fetchPullDetailSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchPullDetail(owner, repo, number, token),
        "fetchPullDetailSmart",
        undefined,
      );
    }
  }
  return fetchPullDetail(owner, repo, number, token);
}

/** 智能获取 Releases 列表：GraphQL repository.releases 首选（需登录，匿名走 REST 60/h），失败降级 REST。 */
export async function fetchReleasesSmart(
  owner: string,
  repo: string,
  token?: string | null,
  page = 1,
): Promise<Release[]> {
  if (page > 1) {
    return fetchReleases(owner, repo, 20, token, page);
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { releases: { nodes: GraphQLReleaseNode[] } } | null;
      }> = await graphqlRequest(RELEASES_QUERY, { owner, name: repo, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.releases.nodes.map(toRelease);
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchReleases(owner, repo, 20, token);
}

/** 智能获取最新 Release + 总数（About 侧栏 Releases 分区入口）：GraphQL totalCount+nodes(first:1)
 * 一次查询首选（需登录），失败降级 REST per_page=1（body[0]=最新，Link header=总数）。 */
export async function fetchLatestReleaseSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ count: number; latest: Release | null }> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          releases: { totalCount: number; nodes: GraphQLReleaseNode[] };
        } | null;
      }> = await graphqlRequest(LATEST_RELEASE_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const rel = resp.data.repository.releases;
        return { count: rel.totalCount, latest: rel.nodes[0] ? toRelease(rel.nodes[0]) : null };
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchLatestRelease(owner, repo, token);
}

/** 智能获取 Release 详情：GraphQL release(tagName) 首选，失败降级 REST。 */
export async function fetchReleaseDetailSmart(
  owner: string,
  repo: string,
  tag: string,
  token?: string | null,
): Promise<Release> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { release: GraphQLReleaseNode | null } | null;
      }> = await graphqlRequest(RELEASE_DETAIL_QUERY, { owner, name: repo, tagName: tag }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.release) {
        return toRelease(resp.data.repository.release);
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchReleaseDetail(owner, repo, tag, token);
}

interface GraphQLCommentNode {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string } | null;
  url: string;
}

function toIssueComment(g: GraphQLCommentNode): IssueComment {
  return {
    id: -1,
    body: g.body,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    user: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl ?? "" },
    html_url: g.url,
  };
}

/** 智能获取 issue/PR 评论：GraphQL issue.comments 首选，失败降级 REST。 */
export async function fetchIssueCommentsSmart(
  owner: string,
  repo: string,
  number: number,
  token: string | null,
): Promise<IssueComment[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { issue: { comments: { nodes: GraphQLCommentNode[] } } | null } | null;
      }> = await graphqlRequest(ISSUE_COMMENTS_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.issue) {
        return resp.data.repository.issue.comments.nodes.map(toIssueComment);
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchIssueComments(owner, repo, number, token);
}

/** 智能发表 issue/PR 评论：GraphQL addComment 首选（需先查 node id），失败降级 REST。 */
export async function addIssueCommentSmart(
  owner: string,
  repo: string,
  number: number,
  body: string,
  token: string,
): Promise<IssueComment> {
  try {
    // 先查 issue node id（addComment 需要 subjectId）
    const idResp: GraphQLResponse<{
      repository: { issue: { id: string } | null } | null;
    }> = await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
    const id = idResp.data?.repository?.issue?.id;
    if (id && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<{
        addComment: { commentEdge: { node: GraphQLCommentNode } } | null;
      }> = await graphqlRequest(ADD_COMMENT_MUTATION, { subjectId: id, body }, token);
      const node = mutResp.data?.addComment?.commentEdge?.node;
      if (node && !hasGraphQLErrors(mutResp)) return toIssueComment(node);
    }
  } catch {
    // 降级 REST
  }
  return addIssueComment(owner, repo, number, body, token);
}

/** GraphQL 评审评论节点 → REST ReviewComment（side 由 position/originalPosition 推断；线程 id/解决状态透传） */
interface GraphQLReviewCommentNode {
  id: string;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  position: number | null;
  originalPosition: number | null;
  author: { login: string; avatarUrl: string } | null;
}

/** GraphQL 评审线程节点（含 isResolved；供 DiffView 线程解决 UI） */
interface GraphQLReviewThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: GraphQLReviewCommentNode[] };
}

function toReviewComment(
  g: GraphQLReviewCommentNode,
  threadId?: string,
  isResolved?: boolean,
): ReviewComment {
  // position 存在 → 新文件（RIGHT）；仅 originalPosition → 旧文件（LEFT）；都无 → 默认 RIGHT
  const side: "LEFT" | "RIGHT" =
    g.originalPosition != null && g.position == null ? "LEFT" : "RIGHT";
  return {
    id: -1,
    body: g.body,
    user: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl ?? "" },
    created_at: g.createdAt,
    path: g.path,
    line: g.line ?? 0,
    side,
    threadId,
    threadResolved: isResolved,
  };
}

/** 智能获取 PR 行内评审评论：GraphQL reviewThreads 首选，失败降级 REST。 */
export async function fetchPullReviewCommentsSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<ReviewComment[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          pullRequest: {
            reviewThreads: { nodes: GraphQLReviewThreadNode[] };
          } | null;
        } | null;
      }> = await graphqlRequest(PULL_REVIEW_COMMENTS_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.pullRequest) {
        const out: ReviewComment[] = [];
        for (const t of resp.data.repository.pullRequest.reviewThreads.nodes) {
          for (const c of t.comments.nodes) out.push(toReviewComment(c, t.id, t.isResolved));
        }
        return out;
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchPullReviewComments(owner, repo, number, token);
}

/** 智能发表 PR 行内评审评论：GraphQL addPullRequestReviewComment 首选，失败降级 REST。 */
export async function addPullReviewCommentSmart(
  owner: string,
  repo: string,
  number: number,
  params: {
    body: string;
    commit_id: string;
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
  },
  token: string,
): Promise<ReviewComment> {
  try {
    // 先查 pullRequest node id（addPullRequestReviewComment 需要 pullRequestId）
    const pidResp: GraphQLResponse<{
      repository: { pullRequest: { id: string } | null } | null;
    }> = await graphqlRequest(
      /* GraphQL */ `
        query PullRequestId($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
            }
          }
        }
      `,
      { owner, name: repo, number },
      token,
    );
    const pid = pidResp.data?.repository?.pullRequest?.id;
    if (pid && !hasGraphQLErrors(pidResp)) {
      const mutResp: GraphQLResponse<{
        addPullRequestReviewComment: {
          comment: {
            id: string;
            body: string;
            createdAt: string;
            path: string;
            line: number | null;
            author: { login: string; avatarUrl: string } | null;
          };
        } | null;
      }> = await graphqlRequest(
        ADD_PULL_REVIEW_COMMENT_MUTATION,
        {
          pullRequestId: pid,
          body: params.body,
          path: params.path,
          line: params.line,
          side: params.side,
        },
        token,
      );
      const c = mutResp.data?.addPullRequestReviewComment?.comment;
      if (c && !hasGraphQLErrors(mutResp)) {
        return {
          id: -1,
          body: c.body,
          user: { login: c.author?.login ?? "ghost", avatar_url: c.author?.avatarUrl ?? "" },
          created_at: c.createdAt,
          path: c.path,
          line: c.line ?? params.line,
          side: params.side,
        };
      }
    }
  } catch {
    // 降级 REST
  }
  return addPullReviewComment(owner, repo, number, params, token);
}

/** 智能获取仓库分支：GraphQL repository.refs 首选，失败降级 REST。 */
export async function fetchBranchesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ name: string; commit: { sha: string } }[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          refs: { nodes: { name: string; target: { oid: string } }[] };
        } | null;
      }> = await graphqlRequest(REPO_BRANCHES_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        // ref name = refs/heads/{name} → 去前缀
        return resp.data.repository.refs.nodes.map((r) => ({
          name: r.name.replace(/^refs\/heads\//, ""),
          commit: { sha: r.target.oid },
        }));
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchBranches(owner, repo, 100, token);
}

/** 智能获取仓库 labels：GraphQL repository.labels 首选，失败降级 REST。 */
export async function fetchRepoLabelsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoLabel[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          labels: { nodes: { name: string; color: string; description?: string | null }[] };
        } | null;
      }> = await graphqlRequest(REPO_LABELS_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.labels.nodes.map((l) => ({
          id: -1,
          name: l.name,
          color: l.color,
          description: l.description ?? null,
        }));
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchRepoLabels(owner, repo, token);
}

/** 智能获取仓库可指派用户：GraphQL assignableUsers 首选，失败降级 REST。 */
export async function fetchRepoAssigneesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<GitHubUser[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { assignableUsers: { nodes: { login: string; avatarUrl: string }[] } } | null;
      }> = await graphqlRequest(REPO_ASSIGNEES_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.assignableUsers.nodes.map((u) => ({
          login: u.login,
          avatar_url: u.avatarUrl,
        }));
      }
    } catch {
      // 降级 REST
    }
  }
  return fetchRepoAssignees(owner, repo, token);
}

/** 智能获取当前用户 SSH keys：GraphQL viewer.sshKeys 首选，失败降级 REST。 */
export async function fetchIssueDetailWithCommentsSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<{ issue: Issue; comments: IssueComment[] }> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          issue: (GraphQLIssueNode & { comments: { nodes: GraphQLCommentNode[] } }) | null;
        } | null;
      }> = await graphqlRequest(
        ISSUE_DETAIL_WITH_COMMENTS_QUERY,
        { owner, name: repo, number },
        token,
      );
      const g = resp.data?.repository?.issue;
      if (!hasGraphQLErrors(resp) && g) {
        return { issue: toIssue(g), comments: g.comments.nodes.map(toIssueComment) };
      }
    } catch {
      // 降级 REST 分步
    }
  }
  const issue = await fetchIssueDetail(owner, repo, number, token);
  const comments = await fetchIssueComments(owner, repo, number, token ?? null);
  return { issue, comments };
}

/** 智能获取 PR 详情 + 评论：GraphQL 单次嵌套查询首选（detail+comments 一次完成），失败降级 REST 分步。 */
export async function fetchPullDetailWithCommentsSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<{ pr: PullRequest; comments: IssueComment[] }> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          pullRequest: (GraphQLPullNode & { comments: { nodes: GraphQLCommentNode[] } }) | null;
        } | null;
      }> = await graphqlRequest(
        PULL_DETAIL_WITH_COMMENTS_QUERY,
        { owner, name: repo, number },
        token,
      );
      const g = resp.data?.repository?.pullRequest;
      if (!hasGraphQLErrors(resp) && g) {
        return { pr: toPull(g), comments: g.comments.nodes.map(toIssueComment) };
      }
    } catch {
      // 降级 REST 分步
    }
  }
  const pr = await fetchPullDetail(owner, repo, number, token);
  const comments = await fetchIssueComments(owner, repo, number, token ?? null);
  return { pr, comments };
}

// ===== B1 评审工作流 smart 层：GraphQL 首选 + REST 降级 =====

/** PR 评审摘要（reviewDecision + reviews + reviewRequests + mergeable + pullRequestId） */
export interface PullReviewSummary {
  pullRequestId: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  reviews: PullReview[];
  reviewRequests: { login: string; avatarUrl: string }[];
}

/** GraphQL reviews 节点 → REST PullReview（state 枚举对齐 REST：APPROVED/CHANGES_REQUESTED/COMMENTED/DISMISSED） */
interface GraphQLReviewNode {
  id: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string | null;
  submittedAt: string | null;
  author: { login: string; avatarUrl: string } | null;
}

/** 智能获取 PR 评审摘要：GraphQL reviewDecision+reviews 首选，失败降级 REST（reviewDecision 由 reviews 推断）。 */
export async function fetchPullReviewSummarySmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullReviewSummary | null> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          pullRequest: {
            id: string;
            reviewDecision: string | null;
            mergeable: string | null;
            reviews: { nodes: GraphQLReviewNode[] };
            reviewRequests: {
              nodes: {
                requestedReviewer: {
                  __typename: string;
                  login?: string;
                  avatarUrl?: string;
                  name?: string;
                } | null;
              }[];
            };
          } | null;
        } | null;
      }> = await graphqlRequest(PULL_REVIEW_SUMMARY_QUERY, { owner, name: repo, number }, token);
      const g = resp.data?.repository?.pullRequest;
      if (!hasGraphQLErrors(resp) && g) {
        return {
          pullRequestId: g.id,
          reviewDecision: (g.reviewDecision as PullReviewSummary["reviewDecision"]) ?? null,
          mergeable: (g.mergeable as PullReviewSummary["mergeable"]) ?? null,
          reviews: g.reviews.nodes.map((r) => ({
            id: -1,
            user: r.author ? { login: r.author.login, avatar_url: r.author.avatarUrl } : null,
            body: r.body ?? "",
            state: r.state,
            submitted_at: r.submittedAt ?? undefined,
          })),
          reviewRequests: g.reviewRequests.nodes
            .map((n) => n.requestedReviewer)
            .filter((x): x is { __typename: string; login?: string; avatarUrl?: string } =>
              Boolean(x?.login),
            )
            .map((x) => ({ login: x.login!, avatarUrl: x.avatarUrl ?? "" })),
        };
      }
    } catch {
      // 降级 REST
    }
  }
  // REST 降级：reviews 列表 + reviewDecision 由最新非 COMMENTED 评审推断（REST 无 reviewDecision 字段）
  const reviews = await fetchPullReviews(owner, repo, number, token);
  const latest = reviews.find((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED");
  return {
    pullRequestId: "",
    reviewDecision: latest ? (latest.state as PullReviewSummary["reviewDecision"]) : null,
    mergeable: null,
    reviews,
    reviewRequests: [],
  };
}

/** 智能提交评审（三态）：GraphQL submitPullRequestReview 首选，失败降级 REST create-review。 */
export async function submitPullReviewSmart(
  owner: string,
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
  token: string,
): Promise<PullReview> {
  try {
    // 前置：pullRequestId（submitPullRequestReview 需要）
    const pidResp: GraphQLResponse<{
      repository: { pullRequest: { id: string } | null } | null;
    }> = await graphqlRequest(
      /* GraphQL */ `
        query PullRequestId($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
            }
          }
        }
      `,
      { owner, name: repo, number },
      token,
    );
    const pid = pidResp.data?.repository?.pullRequest?.id;
    if (pid && !hasGraphQLErrors(pidResp)) {
      const mutResp: GraphQLResponse<{
        addPullRequestReview: { pullRequestReview: GraphQLReviewNode } | null;
      }> = await graphqlRequest(
        ADD_PULL_REQUEST_REVIEW_MUTATION,
        { pullRequestId: pid, event, body: body || null },
        token,
      );
      const r = mutResp.data?.addPullRequestReview?.pullRequestReview;
      if (r && !hasGraphQLErrors(mutResp)) {
        return {
          id: -1,
          user: r.author ? { login: r.author.login, avatar_url: r.author.avatarUrl } : null,
          body: r.body ?? "",
          state: r.state,
          submitted_at: r.submittedAt ?? undefined,
        };
      }
    }
  } catch {
    // 降级 REST
  }
  return createPullReview(owner, repo, number, { event, body }, token);
}

/** 智能合并 PR：GraphQL mergePullRequest 首选，失败降级 REST pulls/merge。 */
export async function mergePullRequestSmart(
  owner: string,
  repo: string,
  number: number,
  method: PullMergeMethod,
  token: string,
  pullRequestId?: string,
): Promise<{ merged: boolean; message: string }> {
  if (token && pullRequestId) {
    try {
      const mutResp: GraphQLResponse<{
        mergePullRequest: { pullRequest: { state: string; mergedAt: string | null } } | null;
      }> = await graphqlRequest(
        MERGE_PULL_REQUEST_MUTATION,
        { pullRequestId, mergeMethod: method.toUpperCase() },
        token,
      );
      const m = mutResp.data?.mergePullRequest?.pullRequest;
      if (!hasGraphQLErrors(mutResp) && m) {
        return { merged: m.mergedAt != null || m.state === "MERGED", message: "" };
      }
    } catch {
      // 降级 REST
    }
  }
  return mergePullRequest(owner, repo, number, method, token);
}

/** 智能请求评审者：GraphQL requestReviews 首选，失败降级 REST。 */
export async function requestReviewersSmart(
  owner: string,
  repo: string,
  number: number,
  reviewers: string[],
  token: string,
  pullRequestId?: string,
): Promise<void> {
  if (token && pullRequestId && reviewers.length) {
    try {
      // 前置：用户 node id（requestReviews 需 userIds）
      const userIds: string[] = [];
      for (const login of reviewers) {
        const u: GraphQLResponse<{ user: { id: string } | null }> = await graphqlRequest(
          /* GraphQL */ `
            query UserId($login: String!) {
              user(login: $login) {
                id
              }
            }
          `,
          { login },
          token,
        );
        if (u.data?.user?.id && !hasGraphQLErrors(u)) userIds.push(u.data.user.id);
      }
      if (userIds.length) {
        const mutResp: GraphQLResponse<{ requestReviews: { pullRequest: { id: string } } }> =
          await graphqlRequest(REQUEST_REVIEWS_MUTATION, { pullRequestId, userIds }, token);
        if (!hasGraphQLErrors(mutResp) && mutResp.data?.requestReviews) return;
      }
    } catch {
      // 降级 REST
    }
  }
  await requestReviewers(owner, repo, number, reviewers, token);
}

/** 智能更新 PR 状态（关闭/重新打开）：GraphQL 无直接 mutation（closePullRequest 需 node id），统一 REST。 */
export async function updatePullRequestStateSmart(
  owner: string,
  repo: string,
  number: number,
  state: "open" | "closed",
  token: string,
): Promise<PullRequest> {
  return updatePullRequestState(owner, repo, number, state, token);
}

/** 解决/取消解决评审线程（GraphQL-only——REST 无端点；需 reviewThread node id，由评论的 threadId 提供）。 */
export async function setReviewThreadResolvedSmart(
  threadId: string,
  resolved: boolean,
  token: string,
): Promise<void> {
  try {
    const resp: GraphQLResponse<{
      resolveReviewThread?: { thread: { id: string; isResolved: boolean } };
      unresolveReviewThread?: { thread: { id: string; isResolved: boolean } };
    }> = await graphqlRequest(
      resolved ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION,
      { threadId },
      token,
    );
    if (!hasGraphQLErrors(resp)) return;
  } catch {
    // GraphQL 失败静默（REST 无等价端点可降级——仅记录）
  }
  throw new Error("线程解决失败（GraphQL 不可用）");
}

// ===== PR 详情侧栏增强（B1 补：Lock / Projects / Development） =====

/** 智能锁定/解锁对话：GraphQL lockLockable 首选（需 pullRequestId），失败降级 REST issues/lock。 */
export async function setPullLockedSmart(
  owner: string,
  repo: string,
  number: number,
  locked: boolean,
  token: string,
  pullRequestId?: string,
): Promise<void> {
  if (token && pullRequestId) {
    try {
      const mutResp: GraphQLResponse<{
        lockLockable?: { lockedRecord: { id: string; locked: boolean } };
        unlockLockable?: { unlockedRecord: { id: string; locked: boolean } };
      }> = await graphqlRequest(
        locked ? LOCK_PULL_REQUEST_MUTATION : UNLOCK_PULL_REQUEST_MUTATION,
        { lockableId: pullRequestId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
    } catch {
      // 降级 REST
    }
  }
  if (locked) await lockPullRequest(owner, repo, number, token);
  else await unlockPullRequest(owner, repo, number, token);
}

/** PR 关联 ProjectsV2（GraphQL-only 只读；失败静默空——侧栏非核心，参照 ForkInfoBar 静默先例）。 */
export type PullProjectItem = {
  id: string;
  project: { number: number; title: string; url: string; public: boolean };
  status: string | null;
};
export async function fetchPullProjectsSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<PullProjectItem[]> {
  if (!token) return [];
  try {
    const resp: GraphQLResponse<{
      repository: {
        pullRequest: {
          projectItems: {
            nodes: Array<{
              id: string;
              project: { number: number; title: string; url: string; public: boolean };
              fieldValueByName: { __typename: string; name?: string } | null;
            }>;
          } | null;
        } | null;
      } | null;
    }> = await graphqlRequest(PR_PROJECTS_QUERY, { owner, name: repo, number }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest?.projectItems) return [];
    return resp.data.repository.pullRequest.projectItems.nodes.map((n) => ({
      id: n.id,
      project: n.project,
      status:
        n.fieldValueByName && "name" in n.fieldValueByName
          ? (n.fieldValueByName.name ?? null)
          : null,
    }));
  } catch {
    return [];
  }
}

/** PR 开发关联（GraphQL-only 只读：closingIssuesReferences + linkedBranches；失败静默空）。 */
export type PullDevelopment = {
  issues: { number: number; title: string; state: string; url: string }[];
  branches: string[];
};
export async function fetchPullDevelopmentSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<PullDevelopment> {
  if (!token) return { issues: [], branches: [] };
  try {
    const resp: GraphQLResponse<{
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: Array<{ number: number; title: string; state: string; url: string }>;
          } | null;
          linkedBranches: { nodes: Array<{ ref: { name: string } | null }> } | null;
        } | null;
      } | null;
    }> = await graphqlRequest(PR_DEVELOPMENT_QUERY, { owner, name: repo, number }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest) {
      return { issues: [], branches: [] };
    }
    const pr = resp.data.repository.pullRequest;
    return {
      issues: (pr.closingIssuesReferences?.nodes ?? []).map((n) => ({
        number: n.number,
        title: n.title,
        state: n.state,
        url: n.url,
      })),
      branches: (pr.linkedBranches?.nodes ?? [])
        .map((n) => n.ref?.name)
        .filter((b): b is string => Boolean(b)),
    };
  } catch {
    return { issues: [], branches: [] };
  }
}

// ===== PR Conversation 时间线（PullTimeline；GraphQL-only，失败降级 null → 页面回退现有评论渲染） =====

/** 时间线事件（归一后的轻量结构，覆盖官方 Conversation 常用事件类型）。 */
export type PullTimelineEvent =
  | {
      kind: "comment";
      id: string;
      author: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      body: string;
    }
  | {
      kind: "review";
      id: string;
      author: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      submittedAt: string | null;
      state: string;
      body: string | null;
    }
  | {
      kind: "review-thread";
      id: string;
      isResolved: boolean;
      path: string | null;
      line: number | null;
      originalLine: number | null;
      startLine: number | null;
      comments: Array<{
        id: string;
        author: { login: string; avatarUrl: string | null } | null;
        createdAt: string;
        body: string;
      }>;
    }
  | {
      kind: "commit";
      id: string;
      oid: string;
      messageHeadline: string;
      committedDate: string;
      author: { login: string | null; avatarUrl: string | null; name: string | null } | null;
    }
  | {
      kind: "merged";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      mergeRefName: string | null;
    }
  | {
      kind: "closed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "reopened";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "assigned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      assignee: string | null;
    }
  | {
      kind: "unassigned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      assignee: string | null;
    }
  | {
      kind: "labeled";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      label: { name: string; color: string } | null;
    }
  | {
      kind: "unlabeled";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      label: { name: string; color: string } | null;
    }
  | {
      kind: "milestoned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      milestoneTitle: string | null;
    }
  | {
      kind: "demilestoned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      milestoneTitle: string | null;
    }
  | {
      kind: "review-requested";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "review-request-removed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "locked";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "unlocked";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "renamed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      previousTitle: string;
      currentTitle: string;
    }
  | {
      kind: "force-pushed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "ready-for-review";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    };

/** 时间线查询（GraphQL-only：REST 无 timeline 通道；失败返回 null → 页面回退评论+评审拼接渲染）。 */
export async function fetchPullTimelineSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<PullTimelineEvent[] | null> {
  if (!token) return null;
  try {
    const resp: GraphQLResponse<{
      repository: {
        pullRequest: { timelineItems: { nodes: unknown[] } | null } | null;
      } | null;
    }> = await graphqlRequest(PR_TIMELINE_QUERY, { owner, name: repo, number }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest?.timelineItems) return null;
    const nodes = resp.data.repository.pullRequest.timelineItems.nodes;
    const events: PullTimelineEvent[] = [];
    for (const raw of nodes) {
      const n = raw as Record<string, unknown> & { __typename?: string };
      // 方括号访问规避 no-underscore-dangle（GraphQL 类型名标识）
      const t = n["__typename"];
      const actor = (a: unknown) => {
        if (!a) return null;
        const x = a as { login?: string; avatarUrl?: string | null };
        return { login: x.login ?? "", avatarUrl: x.avatarUrl ?? null };
      };
      const at = (v: unknown) => (typeof v === "string" ? v : "");
      if (t === "IssueComment") {
        const body = typeof n.body === "string" ? n.body : "";
        if (body.trim()) {
          events.push({
            kind: "comment",
            id: String(n.id),
            author: actor(n.author),
            createdAt: at(n.createdAt),
            body,
          });
        }
      } else if (t === "PullRequestReview") {
        events.push({
          kind: "review",
          id: String(n.id),
          author: actor(n.author),
          createdAt: at(n.createdAt),
          submittedAt: typeof n.submittedAt === "string" ? n.submittedAt : null,
          state: String(n.state),
          body: typeof n.body === "string" && n.body ? n.body : null,
        });
      } else if (t === "PullRequestReviewThread") {
        const commentsRaw = (n.comments as { nodes?: unknown[] } | null)?.nodes ?? [];
        events.push({
          kind: "review-thread",
          id: String(n.id),
          isResolved: Boolean(n.isResolved),
          path: typeof n.path === "string" ? n.path : null,
          line: typeof n.line === "number" ? n.line : null,
          originalLine: typeof n.originalLine === "number" ? n.originalLine : null,
          startLine: typeof n.startLine === "number" ? n.startLine : null,
          comments: commentsRaw.map((c) => {
            const cc = c as Record<string, unknown> & { author?: unknown };
            return {
              id: String(cc.id),
              author: actor(cc.author),
              createdAt: typeof cc.createdAt === "string" ? cc.createdAt : "",
              body: typeof cc.body === "string" ? cc.body : "",
            };
          }),
        });
      } else if (t === "PullRequestCommit") {
        const commit = n.commit as {
          oid?: unknown;
          messageHeadline?: unknown;
          committedDate?: unknown;
          author?: unknown;
        } | null;
        const ca = commit?.author as {
          user?: { login?: string; avatarUrl?: string | null } | null;
          name?: string | null;
        } | null;
        events.push({
          kind: "commit",
          id: String(n.id),
          oid: String(commit?.oid ?? "").slice(0, 7),
          messageHeadline: String(commit?.messageHeadline ?? ""),
          committedDate: typeof commit?.committedDate === "string" ? commit.committedDate : "",
          author: ca?.user
            ? { login: ca.user.login ?? null, avatarUrl: ca.user.avatarUrl ?? null, name: null }
            : { login: null, avatarUrl: null, name: ca?.name ?? null },
        });
      } else if (t === "MergedEvent") {
        events.push({
          kind: "merged",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          mergeRefName: typeof n.mergeRefName === "string" ? n.mergeRefName : null,
        });
      } else if (t === "ClosedEvent") {
        events.push({
          kind: "closed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "ReopenedEvent") {
        events.push({
          kind: "reopened",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "AssignedEvent") {
        events.push({
          kind: "assigned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          assignee: extractLogin(n.assignee),
        });
      } else if (t === "UnassignedEvent") {
        events.push({
          kind: "unassigned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          assignee: extractLogin(n.assignee),
        });
      } else if (t === "LabeledEvent" || t === "UnlabeledEvent") {
        const label = n.label as { name?: string; color?: string } | null;
        events.push({
          kind: t === "LabeledEvent" ? "labeled" : "unlabeled",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          label: label
            ? { name: String(label.name ?? ""), color: String(label.color ?? "") }
            : null,
        });
      } else if (t === "MilestonedEvent" || t === "DemilestonedEvent") {
        events.push({
          kind: t === "MilestonedEvent" ? "milestoned" : "demilestoned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          milestoneTitle: typeof n.milestoneTitle === "string" ? n.milestoneTitle : null,
        });
      } else if (t === "ReviewRequestedEvent") {
        events.push({
          kind: "review-requested",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "ReviewRequestRemovedEvent") {
        events.push({
          kind: "review-request-removed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "LockedEvent") {
        events.push({
          kind: "locked",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "UnlockedEvent") {
        events.push({
          kind: "unlocked",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "RenamedTitleEvent") {
        events.push({
          kind: "renamed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          previousTitle: String(n.previousTitle ?? ""),
          currentTitle: String(n.currentTitle ?? ""),
        });
      } else if (t === "HeadRefForcePushedEvent") {
        events.push({
          kind: "force-pushed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "ReadyForReviewEvent") {
        events.push({
          kind: "ready-for-review",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      }
    }
    return events;
  } catch {
    return null;
  }
}

/** 从 Assignee union 节点提取 login */
function extractLogin(v: unknown): string | null {
  if (!v) return null;
  const x = v as { login?: string };
  return typeof x.login === "string" ? x.login : null;
}
