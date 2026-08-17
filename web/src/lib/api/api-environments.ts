/**
 * GitHub API smart layer - 仓库 environments 管理（官方 /settings/environments）
 *
 * GraphQL 唯一主通道 + REST 熔断降级：
 * - 读取：GraphQL repository.environments 连接（name/databaseId/nodeId/protection rules）
 * - 新建：GraphQL createEnvironment（需 repository node id，先查 REPOSITORY_ID_QUERY）
 * - 删除：GraphQL deleteEnvironment（需 environment node id）；降级 REST 按 name 定位
 * 编辑（wait timer / reviewers / prevent self review）留待 environment 详情页（与
 * Secrets and variables 大项一并实现）。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  REPO_ENVIRONMENTS_QUERY,
  CREATE_ENVIRONMENT_MUTATION,
  DELETE_ENVIRONMENT_MUTATION,
  REPOSITORY_ID_QUERY,
} from "../graphql";
import { fetchEnvironments, createEnvironment, deleteEnvironment } from "../restapi";
import type { RepoEnvironment } from "../restapi";

/** GraphQL Environment 节点（databaseId 映射数字 id；id 映射 nodeId） */
interface GraphQLEnvironmentNode {
  id: string;
  databaseId: number;
  name: string;
  isPinned: boolean;
  protectionRules: { totalCount: number } | null;
}

function toEnvironment(g: GraphQLEnvironmentNode): RepoEnvironment {
  return {
    id: g.databaseId,
    nodeId: g.id,
    name: g.name,
    protectionRules: g.protectionRules?.totalCount ?? 0,
    isPinned: g.isPinned,
  };
}

/** 智能获取 environments：GraphQL 首选，失败/匿名 → 降级 REST。 */
export async function fetchEnvironmentsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoEnvironment[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { environments: { nodes: GraphQLEnvironmentNode[] } } | null;
      }> = await graphqlRequest(REPO_ENVIRONMENTS_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.environments.nodes.map(toEnvironment);
      }
      return withRestFallback(
        () => fetchEnvironments(owner, repo, token),
        "fetchEnvironmentsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchEnvironments(owner, repo, token),
        "fetchEnvironmentsSmart",
        undefined,
      );
    }
  }
  return fetchEnvironments(owner, repo, token);
}

/** 新建 environment：GraphQL createEnvironment 首选（需仓库 node id），失败降级 REST。 */
export async function createEnvironmentSmart(
  owner: string,
  repo: string,
  name: string,
  token: string,
): Promise<RepoEnvironment> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => createEnvironment(owner, repo, name, token),
      "createEnvironmentSmart",
      gqlResp,
    );
  try {
    const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    const repositoryId = idResp.data?.repository?.id;
    if (!repositoryId || hasGraphQLErrors(idResp)) return fromRest(idResp);
    const mutResp: GraphQLResponse<{
      createEnvironment: { environment: GraphQLEnvironmentNode } | null;
    }> = await graphqlRequest(CREATE_ENVIRONMENT_MUTATION, { repositoryId, name }, token);
    const node = mutResp.data?.createEnvironment?.environment;
    if (node && !hasGraphQLErrors(mutResp)) return toEnvironment(node);
    return fromRest(mutResp);
  } catch {
    return fromRest(undefined);
  }
}

/** 删除 environment：GraphQL deleteEnvironment 首选（需 node id），失败降级 REST（按 name）。 */
export async function deleteEnvironmentSmart(
  owner: string,
  repo: string,
  env: { nodeId?: string; name: string },
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => deleteEnvironment(owner, repo, env.name, token),
      "deleteEnvironmentSmart",
      gqlResp,
    );
  if (env.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_ENVIRONMENT_MUTATION,
        { id: env.nodeId },
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
