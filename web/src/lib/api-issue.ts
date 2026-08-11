/**
 * GitHub API smart layer - issue-pr（自 api-issue 拆出）
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

/**
 * GitHub API smart layer - issue (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
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
  REPO_BRANCHES_QUERY,
  REPO_LABELS_QUERY,
  REPO_ASSIGNEES_QUERY,
} from "./graphql";
import {
  fetchBranches,
  fetchRepoLabels,
  fetchRepoAssignees,
  fetchIssueComments,
  addIssueComment,
  fetchPullReviewComments,
  addPullReviewComment,
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

/** GraphQL PR 节点 → REST PullRequest（MERGED 映射为 closed + merged_at） */
function toPull(g: GraphQLPullNode): PullRequest {
  return {
    id: -1,
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
    comments: g.comments?.totalCount ?? 0,
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

/** 智能获取仓库 PR 列表：GraphQL repository.pullRequests 首选，失败降级 REST。 */
export async function fetchPullsSmart(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  token?: string | null,
  filters?: { author?: string; labels?: string; sort?: string; q?: string },
  page = 1,
): Promise<{ items: PullRequest[]; openCount: number | null; closedCount: number | null }> {
  // 分页请求（page>1）→ 直接 REST（GraphQL 分页需游标）
  if (page > 1) {
    const items = await fetchPulls(owner, repo, state, 30, token, page);
    return { items, openCount: null, closedCount: null };
  }
  // 有过滤条件 → search API（REST /pulls 不支持 q/author=@me/labels 便捷过滤）
  if (filters && (filters.author || filters.labels || filters.q)) {
    // 搜索独立于 state tab（官方行为）：q 存在时不再追加 state:，结果含所有状态
    const qParts = [
      `repo:${owner}/${repo}`,
      `is:pr`,
      filters.author ? `author:${filters.author}` : "",
      filters.labels ? `label:${filters.labels}` : "",
      filters.q,
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
        { owner, name: repo, states: pullStates(state), first: 30 },
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
    } catch {
      // 降级 REST
    }
  }
  const items = await fetchPulls(owner, repo, state, 30, token);
  return { items, openCount: null, closedCount: null };
}

/** 智能获取 PR 详情：GraphQL pullRequest(number) 首选，失败降级 REST。 */
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
    } catch {
      // 降级 REST
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

/** GraphQL 评审评论节点 → REST ReviewComment（side 由 position/originalPosition 推断） */
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

function toReviewComment(g: GraphQLReviewCommentNode): ReviewComment {
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
            reviewThreads: { nodes: { comments: { nodes: GraphQLReviewCommentNode[] } }[] };
          } | null;
        } | null;
      }> = await graphqlRequest(PULL_REVIEW_COMMENTS_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.pullRequest) {
        const out: ReviewComment[] = [];
        for (const t of resp.data.repository.pullRequest.reviewThreads.nodes) {
          for (const c of t.comments.nodes) out.push(toReviewComment(c));
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
