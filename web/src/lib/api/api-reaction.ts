/**
 * GitHub API smart layer - 表情反应（add/remove reaction）
 * addReaction / removeReaction GraphQL-only：REST 删除需先 list 出 reaction_id 才能删、且按
 * subject 类型分 25 个端点，降级成本高收益低；GraphQL 两 mutation 以 subjectId + content 即可
 * 增删，完整可用。失败抛错，由 UI 层提示。
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { ADD_REACTION_MUTATION, REMOVE_REACTION_MUTATION } from "../graphql";
import type { ReactionGroup } from "../restapi";

/** 反应写入后的最新状态（subject 的 reactionGroups + 当前用户是否已反应） */
export interface ReactionState {
  reactions: ReactionGroup[];
  viewerHasReacted: boolean;
}

/** GraphQL addReaction/removeReaction 的 subject 载荷（Reactable 接口字段） */
interface ReactionSubjectPayload {
  reactionGroups?: {
    content: string;
    reactors: { totalCount: number };
    viewerHasReacted?: boolean;
  }[];
  viewerHasReacted?: boolean;
}

function toReactionState(s: ReactionSubjectPayload | null | undefined): ReactionState {
  return {
    reactions:
      s?.reactionGroups?.map((r) => ({
        content: r.content,
        count: r.reactors.totalCount,
        viewerHasReacted: r.viewerHasReacted ?? false,
      })) ?? [],
    viewerHasReacted: s?.viewerHasReacted ?? false,
  };
}

async function mutateReaction(
  subjectId: string,
  content: string,
  token: string,
  add: boolean,
): Promise<ReactionState> {
  const resp: GraphQLResponse<{
    addReaction?: { subject: ReactionSubjectPayload | null } | null;
    removeReaction?: { subject: ReactionSubjectPayload | null } | null;
  }> = await graphqlRequest(
    add ? ADD_REACTION_MUTATION : REMOVE_REACTION_MUTATION,
    { subjectId, content },
    token,
  );
  if (hasGraphQLErrors(resp)) {
    throw new Error(resp.errors?.[0]?.message ?? "反应操作失败");
  }
  const payload = add ? resp.data?.addReaction?.subject : resp.data?.removeReaction?.subject;
  return toReactionState(payload);
}

/** 添加表情反应（subjectId = 任意 Reactable 的 node id；返回最新反应状态供 UI 乐观刷新） */
export async function addReactionSmart(
  subjectId: string,
  content: string,
  token: string,
): Promise<ReactionState> {
  return mutateReaction(subjectId, content, token, true);
}

/** 移除表情反应（content 精确匹配要撤销的表情） */
export async function removeReactionSmart(
  subjectId: string,
  content: string,
  token: string,
): Promise<ReactionState> {
  return mutateReaction(subjectId, content, token, false);
}
