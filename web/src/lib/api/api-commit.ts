/**
 * GitHub API smart layer - commit 详情页补充（关联 PR / CI 状态 / 评论）
 * GraphQL 首选（object(expression) → Commit），失败降级 REST；匿名强制 REST。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  COMMIT_ASSOCIATED_PRS_QUERY,
  COMMIT_STATUS_QUERY,
  COMMIT_COMMENTS_QUERY,
  ADD_COMMENT_MUTATION,
} from "../graphql";
import {
  listCommitAssociatedPRs,
  getCommitStatus,
  listCommitComments,
  createCommitComment,
  updateCommitComment,
  deleteCommitComment,
} from "../restapi";
import type { IssueComment } from "../restapi";
import { toIssueComment, type GraphQLCommentNode } from "./api-issue";

/** 关联 PR（信息展示用；GraphQL associatedPullRequests / REST list-pull-requests-associated-with-commit） */
export async function fetchCommitAssociatedPRsSmart(
  owner: string,
  repo: string,
  sha: string,
  token?: string | null,
): Promise<{ number: number; title: string; url: string }[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            associatedPullRequests: {
              nodes: { number: number; title: string; url: string }[];
            };
          } | null;
        } | null;
      }> = await graphqlRequest(
        COMMIT_ASSOCIATED_PRS_QUERY,
        { owner, name: repo, expression: sha },
        token,
      );
      const nodes = resp.data?.repository?.object?.associatedPullRequests?.nodes;
      if (!hasGraphQLErrors(resp) && nodes) {
        return nodes.map((n) => ({ number: n.number, title: n.title, url: n.url }));
      }
      return withRestFallback(
        () => listCommitAssociatedPRs(owner, repo, sha, token),
        "fetchCommitAssociatedPRsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => listCommitAssociatedPRs(owner, repo, sha, token),
        "fetchCommitAssociatedPRsSmart",
        undefined,
      );
    }
  }
  return listCommitAssociatedPRs(owner, repo, sha, token);
}

/** commit CI 状态摘要（GraphQL statusCheckRollup / REST get-combined-status-for-ref） */
export interface CommitStatusSummary {
  state: string;
  checks: { name: string; state: string; description: string | null; url: string | null }[];
}

export async function fetchCommitStatusSmart(
  owner: string,
  repo: string,
  sha: string,
  token?: string | null,
): Promise<CommitStatusSummary | null> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            statusCheckRollup: {
              state: string;
              contexts: {
                nodes: Array<Record<string, unknown>>;
              };
            } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(COMMIT_STATUS_QUERY, { owner, name: repo, expression: sha }, token);
      const rollup = resp.data?.repository?.object?.statusCheckRollup;
      if (!hasGraphQLErrors(resp) && rollup) {
        const checks = (rollup.contexts?.nodes ?? [])
          .map((n) => {
            // CheckRun 与 StatusContext 归一（字段名不同）
            if (typeof n.name === "string" || typeof n.context === "string") {
              const name = (n.name ?? n.context ?? "") as string;
              const state = (n.conclusion ?? n.state ?? "") as string;
              const description = (n.description ?? null) as string | null;
              const url = (n.detailsUrl ?? n.targetUrl ?? null) as string | null;
              return { name, state, description, url };
            }
            return null;
          })
          .filter(
            (
              c,
            ): c is {
              name: string;
              state: string;
              description: string | null;
              url: string | null;
            } => c !== null,
          );
        return { state: rollup.state, checks };
      }
      return withRestFallback(
        () => getCommitStatus(owner, repo, sha, token),
        "fetchCommitStatusSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => getCommitStatus(owner, repo, sha, token),
        "fetchCommitStatusSmart",
        undefined,
      );
    }
  }
  return getCommitStatus(owner, repo, sha, token);
}

/** commit 评论列表 + commit node id（发表评论用；GraphQL Commit.comments / REST list-comments-for-commit） */
export async function fetchCommitCommentsSmart(
  owner: string,
  repo: string,
  sha: string,
  token?: string | null,
): Promise<{ commitId: string | null; comments: IssueComment[] }> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            id: string;
            comments: { nodes: GraphQLCommentNode[] };
          } | null;
        } | null;
      }> = await graphqlRequest(
        COMMIT_COMMENTS_QUERY,
        { owner, name: repo, expression: sha },
        token,
      );
      const obj = resp.data?.repository?.object;
      if (!hasGraphQLErrors(resp) && obj) {
        return { commitId: obj.id, comments: (obj.comments?.nodes ?? []).map(toIssueComment) };
      }
      return withRestFallback(
        async () => ({
          commitId: null,
          comments: await listCommitComments(owner, repo, sha, token),
        }),
        "fetchCommitCommentsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        async () => ({
          commitId: null,
          comments: await listCommitComments(owner, repo, sha, token),
        }),
        "fetchCommitCommentsSmart",
        undefined,
      );
    }
  }
  return { commitId: null, comments: await listCommitComments(owner, repo, sha, token) };
}

/** 发表 commit 评论：GraphQL addComment 首选（需 commit node id），失败降级 REST createCommitComment。 */
export async function addCommitCommentSmart(
  owner: string,
  repo: string,
  sha: string,
  body: string,
  token: string,
): Promise<IssueComment> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => createCommitComment(owner, repo, sha, body, token),
      "addCommitCommentSmart",
      gqlResp,
    );
  try {
    // 先查 commit node id（复用评论查询的内嵌 id）
    const idResp: GraphQLResponse<{
      repository: { object: { id: string } | null } | null;
    }> = await graphqlRequest(COMMIT_COMMENTS_QUERY, { owner, name: repo, expression: sha }, token);
    const commitId = idResp.data?.repository?.object?.id;
    if (commitId && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<{
        addComment: { commentEdge: { node: GraphQLCommentNode } | null } | null;
      }> = await graphqlRequest(ADD_COMMENT_MUTATION, { subjectId: commitId, body }, token);
      const node = mutResp.data?.addComment?.commentEdge?.node;
      if (node && !hasGraphQLErrors(mutResp)) return toIssueComment(node);
      return fromRest(mutResp);
    }
    return fromRest(idResp);
  } catch {
    return fromRest(undefined);
  }
}

/**
 * 编辑 commit 评论：REST-only。
 * GraphQL 无 CommitComment 的 update/delete mutation（仅有 IssueComment 的），
 * 故编辑/删除只能走 REST 数字 id，无 GraphQL 主通道。
 */
export async function updateCommitCommentSmart(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
  token: string,
): Promise<void> {
  await updateCommitComment(owner, repo, commentId, body, token);
}

/** 删除 commit 评论：REST-only（同上，GraphQL 无适配）。 */
export async function deleteCommitCommentSmart(
  owner: string,
  repo: string,
  commentId: number,
  token: string,
): Promise<void> {
  await deleteCommitComment(owner, repo, commentId, token);
}
