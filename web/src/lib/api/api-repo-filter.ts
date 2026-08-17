/**
 * GitHub API smart layer - 仓库过滤下拉数据（自 api-issue.ts 拆出）
 * labels / milestones / assignees 单项 + 复合过滤数据（列表页/新建页共用），
 * GraphQL 首选 + REST 降级。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  REPO_LABELS_QUERY,
  REPO_ASSIGNEES_QUERY,
  REPO_MILESTONES_QUERY,
  REPO_FILTER_DATA_QUERY,
} from "../graphql";
import {
  fetchRepoLabels,
  fetchRepoAssignees,
  fetchRepoMilestones,
  fetchRepoLabelCount,
  fetchRepoMilestoneCount,
} from "../restapi";
import type { GitHubUser, RepoLabel, RepoMilestone } from "../restapi";

/** 智能获取仓库里程碑：GraphQL repository.milestones 首选，失败降级 REST。 */
export async function fetchRepoMilestonesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoMilestone[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          milestones: {
            nodes: { number: number; title: string; state: string; description?: string | null }[];
          };
        } | null;
      }> = await graphqlRequest(REPO_MILESTONES_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.milestones.nodes.map((m) => ({
          number: m.number,
          title: m.title,
          // 归一化为 REST 语义（小写 open/closed），避免与 REST 降级路径大小写不一致
          state: m.state.toLowerCase(),
          description: m.description ?? null,
        }));
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoMilestones(owner, repo, token),
        "fetchRepoMilestonesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoMilestones(owner, repo, token),
        "fetchRepoMilestonesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchRepoMilestones(owner, repo, token);
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
          labels: {
            nodes: { id: string; name: string; color: string; description?: string | null }[];
          };
        } | null;
      }> = await graphqlRequest(REPO_LABELS_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.labels.nodes.map((l) => ({
          id: -1,
          nodeId: l.id,
          name: l.name,
          color: l.color,
          description: l.description ?? null,
        }));
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoLabels(owner, repo, token),
        "fetchRepoLabelsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoLabels(owner, repo, token),
        "fetchRepoLabelsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
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
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoAssignees(owner, repo, token),
        "fetchRepoAssigneesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoAssignees(owner, repo, token),
        "fetchRepoAssigneesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchRepoAssignees(owner, repo, token);
}

/** 仓库过滤下拉复合数据（labels/milestones/assignees + 前两者计数） */
export interface RepoFilterData {
  labels: RepoLabel[];
  labelsCount: number;
  milestones: RepoMilestone[];
  milestonesCount: number;
  assignees: GitHubUser[];
}

/**
 * 智能获取仓库过滤下拉复合数据（Pulls/Issues 列表页 + 新建 Issue 页共用）。
 * 一次 GraphQL 同时拿 labels / milestones / assignableUsers + 前两者 totalCount，
 * 替代原先 fetchRepoLabelsSmart + fetchRepoMilestonesSmart + fetchRepoAssigneesSmart +
 * fetchRepoLabelCount + fetchRepoMilestoneCount 五次请求（labels/milestones 计数由 GraphQL
 * totalCount 直接覆盖，不再走 REST per_page=1 读 Link header 计数）。
 * 失败 → withRestFallback 降级 REST 分步（复用 rest 层；计数 Link header 失败回退列表长度）。
 */
export async function fetchRepoFilterDataSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoFilterData> {
  // REST 降级分步
  const fromRest = async (): Promise<RepoFilterData> => {
    const [labels, milestones, assignees, labelsCount, milestonesCount] = await Promise.all([
      fetchRepoLabels(owner, repo, token),
      fetchRepoMilestones(owner, repo, token),
      fetchRepoAssignees(owner, repo, token),
      fetchRepoLabelCount(owner, repo, token),
      fetchRepoMilestoneCount(owner, repo, token),
    ]);
    return {
      labels,
      labelsCount: labelsCount ?? labels.length,
      milestones,
      milestonesCount: milestonesCount ?? milestones.length,
      assignees,
    };
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          labels: {
            totalCount: number;
            nodes: { name: string; color: string; description?: string | null }[];
          };
          milestones: {
            totalCount: number;
            nodes: { number: number; title: string; state: string; description?: string | null }[];
          };
          assignableUsers: { nodes: { login: string; avatarUrl: string }[] };
        } | null;
      }> = await graphqlRequest(REPO_FILTER_DATA_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const r = resp.data.repository;
        return {
          labels: r.labels.nodes.map((l) => ({
            id: -1,
            name: l.name,
            color: l.color,
            description: l.description ?? null,
          })),
          labelsCount: r.labels.totalCount,
          milestones: r.milestones.nodes.map((m) => ({
            number: m.number,
            title: m.title,
            state: m.state.toLowerCase(),
            description: m.description ?? null,
          })),
          milestonesCount: r.milestones.totalCount,
          assignees: r.assignableUsers.nodes.map((u) => ({
            login: u.login,
            avatar_url: u.avatarUrl,
          })),
        };
      }
      // GraphQL 失败 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchRepoFilterDataSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchRepoFilterDataSmart", undefined);
    }
  }
  // 匿名强制 REST 分步
  return fromRest();
}
