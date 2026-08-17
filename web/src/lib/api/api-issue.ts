/**
 * GitHub API smart layer - issue / PR（自 api-issue 拆出）
 * 基础列表/详情/评论/写操作；评审工作流/详情侧栏/时间线/commits 已拆至 api-review.ts；
 * release 已拆至 api-release.ts；分支列表已拆至 api-repo-extra.ts。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  ISSUES_QUERY,
  ISSUE_COUNTS_QUERY,
  ISSUE_DETAIL_QUERY,
  ISSUE_ID_QUERY,
  UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
  PULLS_QUERY,
  PULL_COUNTS_QUERY,
  PULL_DETAIL_QUERY,
  ISSUE_DETAIL_WITH_COMMENTS_QUERY,
  PULL_DETAIL_WITH_COMMENTS_QUERY,
  ISSUE_COMMENTS_QUERY,
  ADD_COMMENT_MUTATION,
  UPDATE_ISSUE_COMMENT_MUTATION,
  DELETE_ISSUE_COMMENT_MUTATION,
  PULL_REVIEW_COMMENTS_QUERY,
  ADD_PULL_REVIEW_COMMENT_MUTATION,
  UPDATE_PULL_REVIEW_COMMENT_MUTATION,
  DELETE_PULL_REVIEW_COMMENT_MUTATION,
  ADD_PULL_REVIEW_THREAD_REPLY_MUTATION,
  SEARCH_ISSUES_QUERY,
  SEARCH_PULLS_QUERY,
  LOCK_PULL_REQUEST_MUTATION,
  UNLOCK_PULL_REQUEST_MUTATION,
  DELETE_ISSUE_MUTATION,
  PIN_ISSUE_MUTATION,
  UNPIN_ISSUE_MUTATION,
  TRANSFER_ISSUE_MUTATION,
  REPOSITORY_ID_QUERY,
} from "../graphql";
import {
  fetchIssueComments,
  addIssueComment,
  updateIssueComment,
  deleteIssueComment,
  fetchPullReviewComments,
  addPullReviewComment,
  updateReviewComment,
  deleteReviewComment,
  createReplyForReviewComment,
  subscribeIssue,
  unsubscribeIssue,
  fetchIssues,
  fetchIssueDetail,
  fetchPulls,
  fetchPullDetail,
  fetchMyIssues,
  fetchMyPulls,
  lockIssue,
  unlockIssue,
} from "../restapi";
import type { Issue, PullRequest, IssueComment, ReviewComment } from "../restapi";
import { toCheckRunsSummary } from "../restapi";
import { searchIssuesSmart, searchIssueId } from "./api-search";
import type { GraphQLReviewNode } from "./api-review";

// ===== issue / PR / release / 搜索：GraphQL 首选 + REST 降级 =====

/** GraphQL issue 节点（列表与详情共用） */
interface GraphQLIssueNode {
  databaseId?: number | null;
  id?: string;
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  body: string | null;
  locked?: boolean;
  isPinned?: boolean;
  viewerSubscription?: string | null;
  reactionGroups?: {
    content: string;
    reactors: { totalCount: number };
    viewerHasReacted?: boolean;
  }[];
  viewerHasReacted?: boolean;
  author: { login: string; avatarUrl?: string } | null;
  comments: { totalCount: number };
  labels?: { nodes: { name: string; color: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] } | null;
  milestone?: { title: string; number?: number } | null;
}

/** GraphQL issue 节点 → REST Issue（id 用 databaseId 保证列表 key 唯一） */
function toIssue(g: GraphQLIssueNode): Issue {
  return {
    id: g.databaseId ?? -1,
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
    milestone: g.milestone ? { title: g.milestone.title, number: g.milestone.number } : null,
    subscription: g.viewerSubscription ?? null,
    locked: g.locked ?? false,
    isPinned: g.isPinned ?? false,
    nodeId: g.id,
    reactions:
      g.reactionGroups?.map((r) => ({
        content: r.content,
        count: r.reactors.totalCount,
        viewerHasReacted: r.viewerHasReacted ?? false,
      })) ?? [],
    viewerHasReacted: g.viewerHasReacted ?? false,
  };
}

/** GraphQL PR 节点（列表与详情共用） */
export interface GraphQLPullNode {
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
  /** 评审：列表查询取 totalCount（评论数合计）/ 详情完整查询取 nodes（供 reviewSummary 评审列表） */
  reviews: { totalCount?: number; nodes?: GraphQLReviewNode[] };
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
  /** 批量 CI 状态（列表查询内联 statusCheckRollup；详情查询无此字段 = undefined） */
  headRef?: {
    target: {
      statusCheckRollup?: {
        contexts: {
          nodes: { status: string; conclusion: string | null }[];
        } | null;
      } | null;
    } | null;
  } | null;
  labels?: { nodes: { name: string; color: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] } | null;
  milestone?: { title: string; number?: number } | null;
  /** 总评论数（官方 totalCommentsCount：issue 评论 + 行内评审评论合计；Conversation tab 计数） */
  totalCommentsCount?: number;
  /** PR 详情完整查询（PULL_DETAIL_FULL_QUERY）附加：评审摘要字段（Reviewers 栏 / 合并判定 / merge 操作 node id） */
  id?: string;
  reviewDecision?: string | null;
  mergeable?: string | null;
  reviewRequests?: {
    nodes: {
      requestedReviewer: {
        __typename: string;
        login?: string;
        avatarUrl?: string;
        name?: string;
      } | null;
    }[];
  };
}

/** GraphQL PR 节点 → REST PullRequest（MERGED 映射为 closed + merged_at；id 用 databaseId 保证列表 key 唯一） */
export function toPull(g: GraphQLPullNode): PullRequest {
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
    // 总评论数（官方 totalCommentsCount 精确字段；列表查询无此字段时回退 comments 合计）
    total_comments: g.totalCommentsCount ?? g.comments?.totalCount ?? 0,
    // CI 汇总：列表查询内联了 headRef.statusCheckRollup → 转换（无 rollup/无 contexts = 无 CI → null）；
    // 查询未内联 headRef（详情等）→ undefined（未携带，行组件回退单查）
    checks: g.headRef
      ? toCheckRunsSummary(g.headRef.target?.statusCheckRollup?.contexts?.nodes ?? null)
      : undefined,
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
    milestone: g.milestone ? { title: g.milestone.title, number: g.milestone.number } : null,
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

/** 用户级「我的 issues」列表（/issues/{tab}）：GraphQL viewer.issues(filterBy) 首选 + REST 降级。
 * filter 映射 REST /issues?filter=：assigned→assignee:@me / created→createdBy:@me / mentioned→mentioned:@me / recent→无（全部关联）。
 * cursor 传续接游标（after）；首屏不传。返回 { items, endCursor, hasNextPage } 供「显示更多」续接。 */
export async function fetchMyIssuesSmart(
  token: string,
  filter: "assigned" | "created" | "mentioned" | "recent" = "created",
  cursor?: string | null,
): Promise<{ items: Issue[]; endCursor: string | null; hasNextPage: boolean }> {
  // filter 映射官方 qualifier：assigned→assignee:@me / created→author:@me / mentioned→mentions:@me / recent→involves:@me
  const qualifier =
    filter === "assigned"
      ? "assignee:@me"
      : filter === "created"
        ? "author:@me"
        : filter === "mentioned"
          ? "mentions:@me"
          : "involves:@me";
  const q = `is:issue ${qualifier}`;
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        const items = await fetchMyIssues(token, filter, 50, cursor ? 2 : 1);
        return { items, endCursor: null, hasNextPage: false };
      },
      "fetchMyIssuesSmart",
      gqlResp,
    );
  try {
    const resp: GraphQLResponse<{
      search: {
        nodes: {
          databaseId?: number | null;
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
        }[];
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
      };
    }> = await graphqlRequest(SEARCH_ISSUES_QUERY, { q, first: 50, after: cursor ?? null }, token);
    const search = resp.data?.search;
    if (!hasGraphQLErrors(resp) && search) {
      return {
        items: search.nodes.map((n) => ({
          // search 节点无 databaseId → 用仓库+编号派生稳定 id（React key 需要）
          id: n.databaseId ?? searchIssueId(n.repository.nameWithOwner, n.number),
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
          repository: { full_name: n.repository.nameWithOwner },
        })),
        endCursor: search.pageInfo?.endCursor ?? null,
        hasNextPage: search.pageInfo?.hasNextPage ?? false,
      };
    }
    return fromRest(resp);
  } catch {
    return fromRest(undefined);
  }
}

/** 用户级「我的 PR」列表（/pulls/{nav}）：GraphQL search is:pr 首选 + REST 降级。
 * filter 映射官方 qualifier：authored→author:@me / assigned→assignee:@me / involves→involves:@me / reviews→review-requested:@me / inbox→无。
 * page>1 分页走 REST（GraphQL search 分页需游标，与 searchIssuesSmart 同模式）。 */
export async function fetchMyPullsSmart(
  token: string,
  filter: "inbox" | "authored" | "assigned" | "involves" | "reviews" = "inbox",
  page = 1,
): Promise<Issue[]> {
  if (page > 1) {
    return fetchMyPulls(token, filter, 50, page);
  }
  const qualifier =
    filter === "authored"
      ? "author:@me"
      : filter === "assigned"
        ? "assignee:@me"
        : filter === "involves"
          ? "involves:@me"
          : filter === "reviews"
            ? "review-requested:@me"
            : "";
  const q = `is:pr${qualifier ? ` ${qualifier}` : ""}`;
  try {
    const resp: GraphQLResponse<{
      search: {
        nodes: {
          databaseId?: number | null;
          number: number;
          title: string;
          url: string;
          state: string;
          createdAt: string;
          updatedAt: string;
          closedAt: string | null;
          comments: { totalCount: number };
          repository: { nameWithOwner: string };
        }[];
      };
    }> = await graphqlRequest(SEARCH_PULLS_QUERY, { q, first: 50 }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.search) {
      return resp.data.search.nodes
        .filter((n) => n && n.number != null)
        .map((n) => ({
          id: n.databaseId ?? searchIssueId(n.repository.nameWithOwner, n.number),
          number: n.number,
          title: n.title,
          state: n.state.toLowerCase(),
          html_url: n.url,
          user: { login: "ghost" },
          created_at: n.createdAt,
          updated_at: n.updatedAt,
          closed_at: n.closedAt ?? null,
          comments: n.comments?.totalCount ?? 0,
          body: null,
          labels: [],
          pull_request: {},
          repository: { full_name: n.repository.nameWithOwner },
        }));
    }
    return withRestFallback(() => fetchMyPulls(token, filter, 50, 1), "fetchMyPullsSmart", resp);
  } catch {
    return withRestFallback(
      () => fetchMyPulls(token, filter, 50, 1),
      "fetchMyPullsSmart",
      undefined,
    );
  }
}

/**
 * 轻量 issue 计数（列表分页用）：仅取 repository open/closed issue 的 totalCount（无列表体）。
 * 分页请求（page>1）走 REST 不含总数，由本函数补全计数供分页器计算总页数；
 * 失败/匿名返回 null（页面层保留已有计数，Pager 不消失）。
 */
export async function fetchIssueCountsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ openCount: number; closedCount: number } | null> {
  if (!token) return null;
  try {
    const resp: GraphQLResponse<{
      repository: {
        openCount: { totalCount: number };
        closedCount: { totalCount: number };
      } | null;
    }> = await graphqlRequest(ISSUE_COUNTS_QUERY, { owner, name: repo }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.repository) {
      return {
        openCount: resp.data.repository.openCount.totalCount,
        closedCount: resp.data.repository.closedCount.totalCount,
      };
    }
  } catch {
    /* 网络异常 → null（页面层保留旧计数 / 降级不显示分页器） */
  }
  return null;
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
      const resp = await searchIssuesSmart(qParts, token, page);
      return { items: resp.items, openCount: null, closedCount: null };
    }
    const items = await fetchIssues(owner, repo, state, limit, token, filters, page);
    // 分页（page>1 且无过滤）REST 响应不含 open/closed 总数 → 并发补一次轻量 GraphQL 计数
    //（供页面分页器计算总页数；失败/匿名返回 null，页面层保留已有计数防 Pager 消失）
    const noFilters =
      !filters ||
      (!filters.author &&
        !filters.assignee &&
        !filters.labels &&
        !filters.q &&
        (!filters.sort || filters.sort === "created"));
    if (page > 1 && noFilters && token) {
      const counts = await fetchIssueCountsSmart(owner, repo, token);
      return {
        items,
        openCount: counts?.openCount ?? null,
        closedCount: counts?.closedCount ?? null,
      };
    }
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
      // GraphQL 失败 → 熔断降级 REST（复用 rest 层 fetchIssues；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => {
          const items = await fetchIssues(owner, repo, state, limit, token);
          return { items, openCount: null, closedCount: null };
        },
        "fetchIssuesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          const items = await fetchIssues(owner, repo, state, limit, token);
          return { items, openCount: null, closedCount: null };
        },
        "fetchIssuesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
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
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchIssueDetail(owner, repo, number, token),
        "fetchIssueDetailSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchIssueDetail(owner, repo, number, token),
        "fetchIssueDetailSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchIssueDetail(owner, repo, number, token);
}

/**
 * 智能锁定/解锁 issue 对话：GraphQL lockLockable/unlockLockable 首选（需 issue node id），
 * 失败降级 REST issues/lock|unlock（对 issue/PR 通用）。
 */
export async function setIssueLockedSmart(
  owner: string,
  repo: string,
  number: number,
  locked: boolean,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        if (locked) await lockIssue(owner, repo, number, token);
        else await unlockIssue(owner, repo, number, token);
      },
      "setIssueLockedSmart",
      gqlResp,
    );
  try {
    const idResp: GraphQLResponse<{ repository: { issue: { id: string } | null } | null }> =
      await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
    const issueId = idResp.data?.repository?.issue?.id;
    if (issueId && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        locked ? LOCK_PULL_REQUEST_MUTATION : UNLOCK_PULL_REQUEST_MUTATION,
        { lockableId: issueId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    }
    return fromRest(idResp);
  } catch {
    return fromRest(undefined);
  }
}

/**
 * 删除 issue：GraphQL-only（REST 无删除 issue 端点；需 admin 权限）。
 * GraphQL 失败直接抛错（无 REST 可降级）。
 */
export async function deleteIssueSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  const idResp: GraphQLResponse<{ repository: { issue: { id: string } | null } | null }> =
    await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
  const issueId = idResp.data?.repository?.issue?.id;
  if (!issueId || hasGraphQLErrors(idResp)) {
    throw new Error(idResp.errors?.[0]?.message ?? "无法获取 issue id");
  }
  const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
    DELETE_ISSUE_MUTATION,
    { issueId },
    token,
  );
  if (hasGraphQLErrors(mutResp)) {
    throw new Error(mutResp.errors?.[0]?.message ?? "删除失败");
  }
}

/**
 * 置顶/取消置顶 issue：GraphQL-only（REST 无端点；需 admin + 公开仓库）。
 * GraphQL 失败直接抛错（无 REST 可降级）。
 */
export async function setIssuePinnedSmart(
  owner: string,
  repo: string,
  number: number,
  pinned: boolean,
  token: string,
): Promise<void> {
  const idResp: GraphQLResponse<{ repository: { issue: { id: string } | null } | null }> =
    await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
  const issueId = idResp.data?.repository?.issue?.id;
  if (!issueId || hasGraphQLErrors(idResp)) {
    throw new Error(idResp.errors?.[0]?.message ?? "无法获取 issue id");
  }
  const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
    pinned ? PIN_ISSUE_MUTATION : UNPIN_ISSUE_MUTATION,
    { issueId },
    token,
  );
  if (hasGraphQLErrors(mutResp)) {
    throw new Error(mutResp.errors?.[0]?.message ?? "置顶操作失败");
  }
}

/**
 * 转移 issue 到另一仓库：GraphQL-only（REST 无端点；需 admin）。
 * 内部先查 issue 与目标仓库 node id，再执行 transferIssue；失败直接抛错（无 REST 可降级）。
 * @returns 转移后 issue 的 url（用于导航/提示）
 */
export async function transferIssueSmart(
  owner: string,
  repo: string,
  number: number,
  targetOwner: string,
  targetName: string,
  token: string,
): Promise<string> {
  const idResp: GraphQLResponse<{ repository: { issue: { id: string } | null } | null }> =
    await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
  const issueId = idResp.data?.repository?.issue?.id;
  if (!issueId || hasGraphQLErrors(idResp)) {
    throw new Error(idResp.errors?.[0]?.message ?? "无法获取 issue id");
  }
  const targetResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
    REPOSITORY_ID_QUERY,
    { owner: targetOwner, name: targetName },
    token,
  );
  const repositoryId = targetResp.data?.repository?.id;
  if (!repositoryId || hasGraphQLErrors(targetResp)) {
    throw new Error(targetResp.errors?.[0]?.message ?? "目标仓库不存在");
  }
  const mutResp: GraphQLResponse<{ transferIssue?: { issue: { url: string } | null } }> =
    await graphqlRequest(TRANSFER_ISSUE_MUTATION, { issueId, repositoryId }, token);
  if (hasGraphQLErrors(mutResp)) {
    throw new Error(mutResp.errors?.[0]?.message ?? "转移失败");
  }
  return mutResp.data?.transferIssue?.issue?.url ?? "";
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
        // mutation 失败 → 熔断降级 REST（订阅 PUT / 取消 DELETE）
        return withRestFallback(
          async () => {
            if (subscribed) {
              await unsubscribeIssue(owner, repo, number, token);
            } else {
              await subscribeIssue(owner, repo, number, token);
            }
            return !subscribed;
          },
          "setIssueSubscriptionSmart",
          mutResp,
        );
      }
      // node id 缺失 → 熔断降级 REST
      return withRestFallback(
        async () => {
          if (subscribed) {
            await unsubscribeIssue(owner, repo, number, token);
          } else {
            await subscribeIssue(owner, repo, number, token);
          }
          return !subscribed;
        },
        "setIssueSubscriptionSmart",
        idResp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          if (subscribed) {
            await unsubscribeIssue(owner, repo, number, token);
          } else {
            await subscribeIssue(owner, repo, number, token);
          }
          return !subscribed;
        },
        "setIssueSubscriptionSmart",
        undefined,
      );
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

/** 官方 Sort 菜单值 → GraphQL IssueOrderField（pullRequests 连接复用 Issue 排序枚举；无按评论数排序 → comments 归并 CREATED_AT） */
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
    // 分页 REST 响应不含 open/closed 总数 → 并发补一次轻量 GraphQL 计数
    //（无过滤时页面分页器需要 totalPages；失败/匿名返回 null，页面层保留已有计数）
    const noFilters =
      !filters ||
      (!filters.author &&
        !filters.labels &&
        !filters.milestone &&
        !filters.assignee &&
        !filters.q &&
        !filters.sort);
    if (noFilters && token) {
      const counts = await fetchPullsCountsSmart(owner, repo, token);
      return {
        items,
        openCount: counts?.openCount ?? null,
        closedCount: counts?.closedCount ?? null,
      };
    }
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
    const resp = await searchIssuesSmart(qParts, token, page);
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

/**
 * 轻量 PR 计数（列表分页用）：仅取 repository open/closed PR 的 totalCount（无列表体）。
 * 语义与 PULLS_QUERY 一致（closed 含 merged）；失败/匿名返回 null（页面层保留已有计数）。
 */
export async function fetchPullsCountsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ openCount: number; closedCount: number } | null> {
  if (!token) return null;
  try {
    const resp: GraphQLResponse<{
      repository: {
        openCount: { totalCount: number };
        closedCount: { totalCount: number };
      } | null;
    }> = await graphqlRequest(PULL_COUNTS_QUERY, { owner, name: repo }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.repository) {
      return {
        openCount: resp.data.repository.openCount.totalCount,
        closedCount: resp.data.repository.closedCount.totalCount,
      };
    }
  } catch {
    /* 网络异常 → null（页面层保留旧计数 / 降级不显示分页器） */
  }
  return null;
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

export interface GraphQLCommentNode {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string } | null;
  url: string;
  reactionGroups?: {
    content: string;
    reactors: { totalCount: number };
    viewerHasReacted?: boolean;
  }[];
  viewerHasReacted?: boolean;
}

export function toIssueComment(g: GraphQLCommentNode): IssueComment {
  return {
    id: -1,
    nodeId: g.id,
    body: g.body,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    user: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl ?? "" },
    html_url: g.url,
    reactions:
      g.reactionGroups?.map((r) => ({
        content: r.content,
        count: r.reactors.totalCount,
        viewerHasReacted: r.viewerHasReacted ?? false,
      })) ?? [],
    viewerHasReacted: g.viewerHasReacted ?? false,
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
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchIssueComments(owner, repo, number, token),
        "fetchIssueCommentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchIssueComments(owner, repo, number, token),
        "fetchIssueCommentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
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
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => addIssueComment(owner, repo, number, body, token),
      "addIssueCommentSmart",
      gqlResp,
    );
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
      // mutation 失败 → 熔断降级 REST
      return fromRest(mutResp);
    }
    // node id 缺失 → 熔断降级 REST
    return fromRest(idResp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 编辑 issue/PR 评论：GraphQL updateIssueComment 首选（需 node id），失败降级 REST（数字 id）。 */
export async function updateIssueCommentSmart(
  owner: string,
  repo: string,
  comment: { nodeId?: string; id: number },
  body: string,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        await updateIssueComment(owner, repo, comment.id, body, token);
      },
      "updateIssueCommentSmart",
      gqlResp,
    );
  if (comment.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        UPDATE_ISSUE_COMMENT_MUTATION,
        { id: comment.nodeId, body },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/** 删除 issue/PR 评论：GraphQL deleteIssueComment 首选（需 node id），失败降级 REST（数字 id）；不可恢复。 */
export async function deleteIssueCommentSmart(
  owner: string,
  repo: string,
  comment: { nodeId?: string; id: number },
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => deleteIssueComment(owner, repo, comment.id, token),
      "deleteIssueCommentSmart",
      gqlResp,
    );
  if (comment.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_ISSUE_COMMENT_MUTATION,
        { id: comment.nodeId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
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
    id: -1, // GraphQL 无 REST database id；唯一 key 走 nodeId
    nodeId: g.id,
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
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchPullReviewComments(owner, repo, number, token),
        "fetchPullReviewCommentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchPullReviewComments(owner, repo, number, token),
        "fetchPullReviewCommentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
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
          id: -1, // GraphQL 无 REST database id；唯一 key 走 nodeId
          nodeId: c.id,
          body: c.body,
          user: { login: c.author?.login ?? "ghost", avatar_url: c.author?.avatarUrl ?? "" },
          created_at: c.createdAt,
          path: c.path,
          line: c.line ?? params.line,
          side: params.side,
        };
      }
      // mutation 失败 → 熔断降级 REST
      return withRestFallback(
        () => addPullReviewComment(owner, repo, number, params, token),
        "addPullReviewCommentSmart",
        mutResp,
      );
    }
    // pullRequest node id 缺失 → 熔断降级 REST
    return withRestFallback(
      () => addPullReviewComment(owner, repo, number, params, token),
      "addPullReviewCommentSmart",
      pidResp,
    );
  } catch {
    // 网络层错误 → 熔断降级 REST
    return withRestFallback(
      () => addPullReviewComment(owner, repo, number, params, token),
      "addPullReviewCommentSmart",
      undefined,
    );
  }
}

/**
 * 编辑 PR 行内评审评论：GraphQL updatePullRequestReviewComment 首选（需 nodeId），
 * 失败降级 REST（数字 id）。
 */
export async function updatePullReviewCommentSmart(
  owner: string,
  repo: string,
  comment: { nodeId?: string; id: number },
  body: string,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        await updateReviewComment(owner, repo, comment.id, body, token);
      },
      "updatePullReviewCommentSmart",
      gqlResp,
    );
  if (comment.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        UPDATE_PULL_REVIEW_COMMENT_MUTATION,
        { id: comment.nodeId, body },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/**
 * 删除 PR 行内评审评论：GraphQL deletePullRequestReviewComment 首选（需 nodeId），
 * 失败降级 REST（数字 id）；不可恢复。
 */
export async function deletePullReviewCommentSmart(
  owner: string,
  repo: string,
  comment: { nodeId?: string; id: number },
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => deleteReviewComment(owner, repo, comment.id, token),
      "deletePullReviewCommentSmart",
      gqlResp,
    );
  if (comment.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_PULL_REVIEW_COMMENT_MUTATION,
        { id: comment.nodeId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/**
 * 回复 PR 行内评审评论：GraphQL addPullRequestReviewThreadReply 首选（需线程 threadId），
 * 失败降级 REST createReplyForReviewComment（数字 id）。
 */
export async function replyPullReviewCommentSmart(
  owner: string,
  repo: string,
  number: number,
  comment: { nodeId?: string; threadId?: string; id: number },
  body: string,
  token: string,
): Promise<ReviewComment> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => createReplyForReviewComment(owner, repo, number, comment.id, body, token),
      "replyPullReviewCommentSmart",
      gqlResp,
    );
  if (comment.threadId) {
    try {
      const mutResp: GraphQLResponse<{
        addPullRequestReviewThreadReply: {
          comment: {
            id: string;
            body: string;
            createdAt: string;
            path: string;
            line: number | null;
            author: { login: string; avatarUrl: string } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(
        ADD_PULL_REVIEW_THREAD_REPLY_MUTATION,
        { threadId: comment.threadId, body },
        token,
      );
      const c = mutResp.data?.addPullRequestReviewThreadReply?.comment;
      if (c && !hasGraphQLErrors(mutResp)) {
        return {
          id: -1, // GraphQL 无 REST database id；唯一 key 走 nodeId
          nodeId: c.id,
          body: c.body,
          user: { login: c.author?.login ?? "ghost", avatar_url: c.author?.avatarUrl ?? "" },
          created_at: c.createdAt,
          path: c.path,
          line: c.line ?? 0,
          side: "RIGHT",
          threadId: comment.threadId,
        };
      }
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

// 仓库过滤下拉数据（fetchRepoMilestonesSmart / fetchRepoLabelsSmart / fetchRepoAssigneesSmart /
// RepoFilterData / fetchRepoFilterDataSmart）已拆至 ./api-repo-filter.ts。

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
      // GraphQL 失败 → 熔断降级 REST 分步（复用 rest 层；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => {
          const issue = await fetchIssueDetail(owner, repo, number, token);
          const comments = await fetchIssueComments(owner, repo, number, token ?? null);
          return { issue, comments };
        },
        "fetchIssueDetailWithCommentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(
        async () => {
          const issue = await fetchIssueDetail(owner, repo, number, token);
          const comments = await fetchIssueComments(owner, repo, number, token ?? null);
          return { issue, comments };
        },
        "fetchIssueDetailWithCommentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST 分步
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
      // GraphQL 失败 → 熔断降级 REST 分步（复用 rest 层；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => {
          const pr = await fetchPullDetail(owner, repo, number, token);
          const comments = await fetchIssueComments(owner, repo, number, token ?? null);
          return { pr, comments };
        },
        "fetchPullDetailWithCommentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(
        async () => {
          const pr = await fetchPullDetail(owner, repo, number, token);
          const comments = await fetchIssueComments(owner, repo, number, token ?? null);
          return { pr, comments };
        },
        "fetchPullDetailWithCommentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST 分步
  const pr = await fetchPullDetail(owner, repo, number, token);
  const comments = await fetchIssueComments(owner, repo, number, token ?? null);
  return { pr, comments };
}
