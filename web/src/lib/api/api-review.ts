/**
 * GitHub API smart layer - PR 评审与详情（自 api-issue.ts 拆出）
 * fetchPullDetailFullSmart + 评审工作流 / 详情侧栏增强 / Conversation 时间线 / commits / check-runs / 协作者。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import {
  ISSUE_ID_QUERY,
  PULL_DETAIL_FULL_QUERY,
  PULL_REVIEW_SUMMARY_QUERY,
  ADD_PULL_REQUEST_REVIEW_MUTATION,
  MERGE_PULL_REQUEST_MUTATION,
  REQUEST_REVIEWS_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
  PR_COMMITS_QUERY,
  PR_CHECK_RUNS_QUERY,
  REPO_COLLABORATORS_QUERY,
  PR_PROJECTS_QUERY,
  PR_DEVELOPMENT_QUERY,
  PR_TIMELINE_QUERY,
  LOCK_PULL_REQUEST_MUTATION,
  UNLOCK_PULL_REQUEST_MUTATION,
  CLOSE_PULL_REQUEST_MUTATION,
  REOPEN_PULL_REQUEST_MUTATION,
  CLOSE_ISSUE_MUTATION,
  REOPEN_ISSUE_MUTATION,
} from "../graphql";
import {
  fetchIssueComments,
  fetchPullReviews,
  fetchPullRequestedReviewers,
  fetchPullCommits,
  fetchPullCheckRuns,
  fetchCollaborators,
  createPullReview,
  mergePullRequest,
  requestReviewers,
  updatePullRequestState,
  updateIssueState,
  lockPullRequest,
  unlockPullRequest,
  fetchPullDetail,
} from "../restapi";
import type {
  Issue,
  PullRequest,
  IssueComment,
  PullReview,
  ReviewEvent,
  PullMergeMethod,
  PullCommit,
  CheckRunsSummary,
  Collaborator,
} from "../restapi";
import { toCheckRunsSummary } from "../restapi";
import { toPull, toIssueComment } from "./api-issue";
import type { GraphQLPullNode, GraphQLCommentNode } from "./api-issue";

/**
 * PR 详情完整复合查询（detail + comments + reviewSummary 一次 GraphQL 请求）。
 * 替代 PullDetailPage 原先 fetchPullDetailWithCommentsSmart + fetchPullReviewSummarySmart 两次请求——
 * 省一次网络往返 + 配额；timeline 保持独立（timelineItems 巨大且失败语义独立）。
 * 失败降级 REST 分步（复用 rest 层，日志 ↪ 标记）；reviewSummary 由 toReviewSummary 转换。
 */
export async function fetchPullDetailFullSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<{ pr: PullRequest; comments: IssueComment[]; reviewSummary: PullReviewSummary | null }> {
  // REST 降级分步（reviewSummary 由 reviews 列表推断 reviewDecision）
  const fromRest = async (): Promise<{
    pr: PullRequest;
    comments: IssueComment[];
    reviewSummary: PullReviewSummary | null;
  }> => {
    const [pr, comments, reviewSummary] = await Promise.all([
      fetchPullDetail(owner, repo, number, token),
      fetchIssueComments(owner, repo, number, token ?? null),
      reviewSummaryFromRest(owner, repo, number, token),
    ]);
    return { pr, comments, reviewSummary };
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          pullRequest: (GraphQLPullNode & { comments: { nodes: GraphQLCommentNode[] } }) | null;
        } | null;
      }> = await graphqlRequest(PULL_DETAIL_FULL_QUERY, { owner, name: repo, number }, token);
      const g = resp.data?.repository?.pullRequest;
      if (!hasGraphQLErrors(resp) && g) {
        return {
          pr: toPull(g),
          comments: g.comments.nodes.map(toIssueComment),
          reviewSummary: toReviewSummary(g),
        };
      }
      // GraphQL 失败 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchPullDetailFullSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchPullDetailFullSmart", undefined);
    }
  }
  // 匿名强制 REST 分步
  return fromRest();
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

/** GraphQL reviews 节点 → REST PullReview（state 枚举对齐 REST：APPROVED/CHANGES_REQUESTED/COMMENTED/DISMISSED）
 * export 供 api-issue.ts 的 GraphQLPullNode.reviews.nodes 引用（跨文件类型）。 */
export interface GraphQLReviewNode {
  id: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string | null;
  submittedAt: string | null;
  author: { login: string; avatarUrl: string } | null;
}

/** 评审摘要 GraphQL 节点（PULL_REVIEW_SUMMARY_QUERY 与 PULL_DETAIL_FULL_QUERY 共用字段） */
interface GraphQLReviewSummaryNode {
  id?: string;
  reviewDecision?: string | null;
  mergeable?: string | null;
  reviews?: { nodes?: GraphQLReviewNode[] };
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

/** GraphQL 评审摘要节点 → PullReviewSummary（pullRequestId 供 merge/review 操作；reviewRequests 过滤无 login 的 Team） */
function toReviewSummary(g: GraphQLReviewSummaryNode): PullReviewSummary {
  return {
    pullRequestId: g.id ?? "",
    reviewDecision: (g.reviewDecision as PullReviewSummary["reviewDecision"]) ?? null,
    mergeable: (g.mergeable as PullReviewSummary["mergeable"]) ?? null,
    reviews: (g.reviews?.nodes ?? []).map((r) => ({
      id: -1,
      user: r.author ? { login: r.author.login, avatar_url: r.author.avatarUrl } : null,
      body: r.body ?? "",
      state: r.state,
      submitted_at: r.submittedAt ?? undefined,
    })),
    reviewRequests: (g.reviewRequests?.nodes ?? [])
      .map((n) => n.requestedReviewer)
      .filter((x): x is { __typename: string; login?: string; avatarUrl?: string } =>
        Boolean(x?.login),
      )
      .map((x) => ({ login: x.login!, avatarUrl: x.avatarUrl ?? "" })),
  };
}

/** REST 降级：reviews 列表 + reviewRequests + reviewDecision 由最新非 COMMENTED 评审推断（REST 无 reviewDecision 字段） */
async function reviewSummaryFromRest(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullReviewSummary> {
  const [reviews, reviewRequests] = await Promise.all([
    fetchPullReviews(owner, repo, number, token),
    fetchPullRequestedReviewers(owner, repo, number, token),
  ]);
  const latest = reviews.find((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED");
  return {
    pullRequestId: "",
    reviewDecision: latest ? (latest.state as PullReviewSummary["reviewDecision"]) : null,
    mergeable: null,
    reviews,
    reviewRequests,
  };
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
        repository: { pullRequest: GraphQLReviewSummaryNode | null } | null;
      }> = await graphqlRequest(PULL_REVIEW_SUMMARY_QUERY, { owner, name: repo, number }, token);
      const g = resp.data?.repository?.pullRequest;
      if (!hasGraphQLErrors(resp) && g) {
        return toReviewSummary(g);
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => reviewSummaryFromRest(owner, repo, number, token),
        "fetchPullReviewSummarySmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => reviewSummaryFromRest(owner, repo, number, token),
        "fetchPullReviewSummarySmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return reviewSummaryFromRest(owner, repo, number, token);
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
      // mutation 失败 → 熔断降级 REST
      return withRestFallback(
        () => createPullReview(owner, repo, number, { event, body }, token),
        "submitPullReviewSmart",
        mutResp,
      );
    }
    // pullRequest node id 缺失 → 熔断降级 REST
    return withRestFallback(
      () => createPullReview(owner, repo, number, { event, body }, token),
      "submitPullReviewSmart",
      pidResp,
    );
  } catch {
    // 网络层错误 → 熔断降级 REST
    return withRestFallback(
      () => createPullReview(owner, repo, number, { event, body }, token),
      "submitPullReviewSmart",
      undefined,
    );
  }
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
      // mutation 失败 → 熔断降级 REST
      return withRestFallback(
        () => mergePullRequest(owner, repo, number, method, token),
        "mergePullRequestSmart",
        mutResp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => mergePullRequest(owner, repo, number, method, token),
        "mergePullRequestSmart",
        undefined,
      );
    }
  }
  // pullRequestId 缺失 → REST
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
        // mutation 失败 → 熔断降级 REST
        await withRestFallback(
          () => requestReviewers(owner, repo, number, reviewers, token),
          "requestReviewersSmart",
          mutResp,
        );
        return;
      }
      // 用户 node id 全部缺失 → 熔断降级 REST
      await withRestFallback(
        () => requestReviewers(owner, repo, number, reviewers, token),
        "requestReviewersSmart",
        undefined,
      );
      return;
    } catch {
      // 网络层错误 → 熔断降级 REST
      await withRestFallback(
        () => requestReviewers(owner, repo, number, reviewers, token),
        "requestReviewersSmart",
        undefined,
      );
    }
  }
  // 无 pullRequestId / 匿名 → REST
  await requestReviewers(owner, repo, number, reviewers, token);
}

/** 智能更新 PR 状态（关闭/重新打开）：GraphQL closePullRequest/reopenPullRequest 首选（需 pullRequestId），
 * 无 pullRequestId（如 REST 降级详情）/ GraphQL 失败 → 熔断降级 REST PATCH /pulls/{n}。 */
export async function updatePullRequestStateSmart(
  owner: string,
  repo: string,
  number: number,
  state: "open" | "closed",
  token: string,
  pullRequestId?: string,
): Promise<PullRequest> {
  if (token && pullRequestId) {
    try {
      const resp: GraphQLResponse<{
        closePullRequest?: { pullRequest: { id: string; state: string } };
        reopenPullRequest?: { pullRequest: { id: string; state: string } };
      }> = await graphqlRequest(
        state === "closed" ? CLOSE_PULL_REQUEST_MUTATION : REOPEN_PULL_REQUEST_MUTATION,
        { pullRequestId },
        token,
      );
      if (!hasGraphQLErrors(resp)) {
        const pr = (resp.data?.closePullRequest ?? resp.data?.reopenPullRequest)?.pullRequest;
        // 调用点乐观更新（忽略返回值），仅回填 state
        if (pr) return { state: pr.state.toLowerCase() } as PullRequest;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => updatePullRequestState(owner, repo, number, state, token),
        "updatePullRequestStateSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => updatePullRequestState(owner, repo, number, state, token),
        "updatePullRequestStateSmart",
        undefined,
      );
    }
  }
  // 无 pullRequestId / 匿名 → REST
  return updatePullRequestState(owner, repo, number, state, token);
}

/** 智能更新 issue 状态（关闭/重新打开）：GraphQL closeIssue/reopenIssue 首选（需 ISSUE_ID_QUERY 前置查 node id），
 * 前置查 id 或 mutation 失败 → 熔断降级 REST PATCH /issues/{n}。 */
export async function updateIssueStateSmart(
  owner: string,
  repo: string,
  number: number,
  state: "closed" | "open",
  token: string,
): Promise<Issue> {
  if (token) {
    try {
      // 前置：issue node id（GraphQL mutation 需要）
      const idResp: GraphQLResponse<{
        repository: { issue: { id: string } | null } | null;
      }> = await graphqlRequest(ISSUE_ID_QUERY, { owner, name: repo, number }, token);
      const issueId = idResp.data?.repository?.issue?.id;
      if (issueId && !hasGraphQLErrors(idResp)) {
        const mutResp: GraphQLResponse<{
          closeIssue?: { issue: { id: string; state: string } };
          reopenIssue?: { issue: { id: string; state: string } };
        }> = await graphqlRequest(
          state === "closed" ? CLOSE_ISSUE_MUTATION : REOPEN_ISSUE_MUTATION,
          { issueId },
          token,
        );
        if (!hasGraphQLErrors(mutResp)) {
          const issue = (mutResp.data?.closeIssue ?? mutResp.data?.reopenIssue)?.issue;
          // 调用点乐观更新（忽略返回值），仅回填 state
          if (issue) return { state: issue.state.toLowerCase() } as Issue;
        }
        // mutation 失败 → 熔断降级 REST
        return withRestFallback(
          () => updateIssueState(owner, repo, number, state, token),
          "updateIssueStateSmart",
          mutResp,
        );
      }
      // node id 缺失 → 熔断降级 REST
      return withRestFallback(
        () => updateIssueState(owner, repo, number, state, token),
        "updateIssueStateSmart",
        idResp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => updateIssueState(owner, repo, number, state, token),
        "updateIssueStateSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return updateIssueState(owner, repo, number, state, token);
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
  } catch (e) {
    // GraphQL 失败（REST 无等价端点可降级）→ 记录后抛错
    logWarn("setReviewThreadResolvedSmart", `评审线程解决失败: ${String(e)}`);
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
      // mutation 失败 → 熔断降级 REST
      return withRestFallback(
        async () => {
          if (locked) await lockPullRequest(owner, repo, number, token);
          else await unlockPullRequest(owner, repo, number, token);
        },
        "setPullLockedSmart",
        mutResp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          if (locked) await lockPullRequest(owner, repo, number, token);
          else await unlockPullRequest(owner, repo, number, token);
        },
        "setPullLockedSmart",
        undefined,
      );
    }
  }
  // 无 pullRequestId → REST
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
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest?.projectItems) {
      // GraphQL errors（侧栏非核心）→ 静默空，补 [Warn] 保留错误详情
      logWarn("fetchPullProjectsSmart", `GraphQL errors: ${resp.errors?.[0]?.message ?? "未知"}`);
      return [];
    }
    return resp.data.repository.pullRequest.projectItems.nodes.map((n) => ({
      id: n.id,
      project: n.project,
      status:
        n.fieldValueByName && "name" in n.fieldValueByName
          ? (n.fieldValueByName.name ?? null)
          : null,
    }));
  } catch (e) {
    // 侧栏非核心 → 静默空，补 [Warn] 保留诊断
    logWarn("fetchPullProjectsSmart", `PR Projects 查询失败（静默空）: ${String(e)}`);
    return [];
  }
}

/** PR 开发关联（GraphQL-only 只读：closingIssuesReferences；PullRequest 无 linkedBranches 字段，关联分支不可得）。 */
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
        } | null;
      } | null;
    }> = await graphqlRequest(PR_DEVELOPMENT_QUERY, { owner, name: repo, number }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest) {
      // GraphQL errors（侧栏非核心）→ 静默空，补 [Warn] 保留错误详情
      logWarn(
        "fetchPullDevelopmentSmart",
        `GraphQL errors: ${resp.errors?.[0]?.message ?? "未知"}`,
      );
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
      // PullRequest 无 linkedBranches 字段（GitHub schema 实测），关联分支不可得 → 恒空
      branches: [],
    };
  } catch (e) {
    // 侧栏非核心 → 静默空，补 [Warn] 保留诊断
    logWarn("fetchPullDevelopmentSmart", `PR Development 查询失败（静默空）: ${String(e)}`);
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
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest?.timelineItems) {
      // GraphQL errors → 降级 null（页面回退三段式渲染），补 [Warn] 保留错误详情
      logWarn("fetchPullTimelineSmart", `GraphQL errors: ${resp.errors?.[0]?.message ?? "未知"}`);
      return null;
    }
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
  } catch (e) {
    // 时间线 GraphQL-only，失败降级 null → 页面回退评论拼接；补 [Warn] 保留诊断
    logWarn("fetchPullTimelineSmart", `PR 时间线查询失败（降级 null）: ${String(e)}`);
    return null;
  }
}

/** 从 Assignee union 节点提取 login */
function extractLogin(v: unknown): string | null {
  if (!v) return null;
  const x = v as { login?: string };
  return typeof x.login === "string" ? x.login : null;
}

// ===== PR commits / CI check-runs / 仓库协作者（GraphQL 主通道 + REST 降级） =====

/** 智能获取 PR commit 列表：GraphQL PullRequest.commits 首选，失败降级 REST（GET /pulls/{n}/commits）。 */
export async function fetchPullCommitsSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullCommit[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          pullRequest: {
            commits: {
              nodes: {
                commit: {
                  oid: string;
                  message: string;
                  committedDate: string;
                  author: {
                    name?: string | null;
                    email?: string | null;
                    date?: string | null;
                    user: { login: string } | null;
                    avatarUrl: string;
                  } | null;
                  committer: { user: { login: string } | null } | null;
                };
              }[];
            };
          } | null;
        } | null;
      }> = await graphqlRequest(PR_COMMITS_QUERY, { owner, name: repo, number }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.pullRequest) {
        return resp.data.repository.pullRequest.commits.nodes.map((n) => ({
          sha: n.commit.oid,
          commit: {
            message: n.commit.message,
            author: {
              name: n.commit.author?.name ?? "",
              email: n.commit.author?.email ?? "",
              date: n.commit.author?.date ?? "",
            },
          },
          author: n.commit.author?.user
            ? { login: n.commit.author.user.login, avatar_url: n.commit.author.avatarUrl }
            : null,
          committer: n.commit.committer?.user ? { login: n.commit.committer.user.login } : null,
        }));
      }
      return withRestFallback(
        () => fetchPullCommits(owner, repo, number, token),
        "fetchPullCommitsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchPullCommits(owner, repo, number, token),
        "fetchPullCommitsSmart",
        undefined,
      );
    }
  }
  return fetchPullCommits(owner, repo, number, token);
}

/** 智能获取 PR CI check-runs 汇总：GraphQL Commit.statusCheckRollup 首选，失败降级 REST。 */
export async function fetchPullCheckRunsSmart(
  owner: string,
  repo: string,
  sha: string,
  token?: string | null,
): Promise<CheckRunsSummary | null> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            statusCheckRollup: {
              contexts: { nodes: { status: string; conclusion: string | null }[] };
            };
          } | null;
        } | null;
      }> = await graphqlRequest(PR_CHECK_RUNS_QUERY, { owner, name: repo, expression: sha }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.object) {
        const runs = resp.data.repository.object.statusCheckRollup?.contexts?.nodes ?? [];
        return toCheckRunsSummary(runs);
      }
      return withRestFallback(
        () => fetchPullCheckRuns(owner, repo, sha, token),
        "fetchPullCheckRunsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchPullCheckRuns(owner, repo, sha, token),
        "fetchPullCheckRunsSmart",
        undefined,
      );
    }
  }
  return fetchPullCheckRuns(owner, repo, sha, token);
}

/**
 * 批量获取多个 PR head commit 的 CI check-runs 汇总（列表页批量合并，替代逐行单查）。
 *
 * 实现：单次 GraphQL 请求内用**别名重复 object(expression)**（c0/c1/c2… 各对应一个 sha），
 * 一次网络往返返回全部 commit 的 statusCheckRollup —— 列表页 30 行 PR 由 30 次请求合并为 1 次。
 * 注：PullRequest.headRef.target.statusCheckRollup 批量内联在 GitHub 侧不稳定（部分返回 null），
 * object(expression) 别名是可靠通道（详情页单查同通道已验证）。
 *
 * 分片：object 别名过多会超 GraphQL 成本限制（statusCheckRollup 计费），每批 10 个，循环直至取完。
 * 降级：整批 GraphQL 失败 → 逐 sha 走 fetchPullCheckRunsSmart（REST 熔断链，日志自动 ↪ 标记）。
 */
export async function fetchPullCheckRunsBatchSmart(
  owner: string,
  repo: string,
  shas: string[],
  token?: string | null,
): Promise<Map<string, CheckRunsSummary | null>> {
  const out = new Map<string, CheckRunsSummary | null>();
  if (!token || shas.length === 0) return out;
  const BATCH = 10;
  for (let i = 0; i < shas.length; i += BATCH) {
    const batch = shas.slice(i, i + BATCH);
    // 别名 object(expression)：cN 与 sha 下标一一对应（GraphQL 不支持表达式数组，动态拼接）
    const aliasFields = batch
      .map(
        (sha, j) =>
          `c${i + j}: object(expression: ${JSON.stringify(sha)}) { ... on Commit { statusCheckRollup { contexts(first: 100) { nodes { ... on CheckRun { status conclusion } } } } } }`,
      )
      .join("\n");
    const query = `query PullChecksBatch($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${aliasFields}
      }
    }`;
    try {
      const resp: GraphQLResponse<{
        repository: Record<
          string,
          {
            statusCheckRollup: {
              contexts: { nodes: { status: string; conclusion: string | null }[] };
            } | null;
          } | null
        > | null;
      }> = await graphqlRequest(query, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        for (let k = 0; k < batch.length; k++) {
          const node = resp.data.repository[`c${i + k}`];
          out.set(
            batch[k],
            node?.statusCheckRollup
              ? toCheckRunsSummary(node.statusCheckRollup.contexts.nodes)
              : null,
          );
        }
        continue; // 本批成功 → 下一批
      }
      // 本批 GraphQL 失败 → 逐 sha 单查（熔断链）
      for (const sha of batch) {
        out.set(sha, await fetchPullCheckRunsSmart(owner, repo, sha, token));
      }
    } catch {
      for (const sha of batch) {
        out.set(sha, await fetchPullCheckRunsSmart(owner, repo, sha, token));
      }
    }
  }
  return out;
}

/** 智能获取仓库协作者：GraphQL Repository.collaborators 首选，失败降级 REST（reviewer 选人数据源）。 */
export async function fetchCollaboratorsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Collaborator[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { collaborators: { nodes: { login: string; avatarUrl: string }[] } } | null;
      }> = await graphqlRequest(REPO_COLLABORATORS_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.collaborators.nodes.map((c) => ({
          login: c.login,
          avatar_url: c.avatarUrl,
        }));
      }
      return withRestFallback(
        () => fetchCollaborators(owner, repo, token),
        "fetchCollaboratorsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchCollaborators(owner, repo, token),
        "fetchCollaboratorsSmart",
        undefined,
      );
    }
  }
  return fetchCollaborators(owner, repo, token);
}
