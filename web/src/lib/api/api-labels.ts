/**
 * GitHub API smart layer - labels / milestones 管理（自过滤下拉数据拆出的写操作）
 * label：GraphQL createLabel/updateLabel/deleteLabel 首选 + REST 降级；
 * milestone：GraphQL 无 mutation → REST-only（红线例外）。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  CREATE_LABEL_MUTATION,
  UPDATE_LABEL_MUTATION,
  DELETE_LABEL_MUTATION,
  REPOSITORY_ID_QUERY,
} from "../graphql";
import {
  createLabel,
  updateLabel,
  deleteLabel,
  createMilestone,
  updateMilestone,
  deleteMilestone,
} from "../restapi";
import type { RepoLabel, RepoMilestone, LabelInput, MilestoneInput } from "../restapi";

/** GraphQL label 节点（create/update mutation 返回；REST 兼容映射） */
interface GraphQLLabelNode {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

function toLabel(g: GraphQLLabelNode): RepoLabel {
  return {
    id: -1,
    nodeId: g.id,
    name: g.name,
    color: g.color,
    description: g.description ?? null,
  };
}

/** 新建 label：GraphQL createLabel 首选（需仓库 node id），失败降级 REST。 */
export async function createLabelSmart(
  owner: string,
  repo: string,
  input: LabelInput,
  token: string,
): Promise<RepoLabel> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => createLabel(owner, repo, input, token), "createLabelSmart", gqlResp);
  try {
    const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    const repositoryId = idResp.data?.repository?.id;
    if (!repositoryId || hasGraphQLErrors(idResp)) return fromRest(idResp);
    const mutResp: GraphQLResponse<{
      createLabel: { label: GraphQLLabelNode } | null;
    }> = await graphqlRequest(
      CREATE_LABEL_MUTATION,
      {
        repositoryId,
        name: input.name,
        color: input.color,
        description: input.description ?? null,
      },
      token,
    );
    const node = mutResp.data?.createLabel?.label;
    if (node && !hasGraphQLErrors(mutResp)) return toLabel(node);
    return fromRest(mutResp);
  } catch {
    return fromRest(undefined);
  }
}

/** 更新 label：GraphQL updateLabel 首选（需 label node id），失败降级 REST（按 name 定位）。 */
export async function updateLabelSmart(
  owner: string,
  repo: string,
  label: { nodeId?: string; name: string },
  input: LabelInput,
  token: string,
): Promise<RepoLabel> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => updateLabel(owner, repo, label.name, input, token),
      "updateLabelSmart",
      gqlResp,
    );
  if (label.nodeId) {
    try {
      const mutResp: GraphQLResponse<{
        updateLabel: { label: GraphQLLabelNode } | null;
      }> = await graphqlRequest(
        UPDATE_LABEL_MUTATION,
        {
          id: label.nodeId,
          name: input.name,
          color: input.color,
          description: input.description ?? null,
        },
        token,
      );
      const node = mutResp.data?.updateLabel?.label;
      if (node && !hasGraphQLErrors(mutResp)) return toLabel(node);
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/** 删除 label：GraphQL deleteLabel 首选（需 label node id），失败降级 REST（按 name 定位）。 */
export async function deleteLabelSmart(
  owner: string,
  repo: string,
  label: { nodeId?: string; name: string },
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => deleteLabel(owner, repo, label.name, token),
      "deleteLabelSmart",
      gqlResp,
    );
  if (label.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_LABEL_MUTATION,
        { id: label.nodeId },
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

// ===== milestone：GraphQL 无 mutation → REST-only（红线例外），smart 层透明转发 =====

/** 新建 milestone（REST-only） */
export async function createMilestoneSmart(
  owner: string,
  repo: string,
  input: MilestoneInput,
  token: string,
): Promise<RepoMilestone> {
  return createMilestone(owner, repo, input, token);
}

/** 更新 milestone（REST-only；含 open/close 状态切换） */
export async function updateMilestoneSmart(
  owner: string,
  repo: string,
  number: number,
  input: MilestoneInput,
  token: string,
): Promise<RepoMilestone> {
  return updateMilestone(owner, repo, number, input, token);
}

/** 删除 milestone（REST-only） */
export async function deleteMilestoneSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  return deleteMilestone(owner, repo, number, token);
}
