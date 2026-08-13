/**
 * GitHub API smart layer - repo 扩展（自 api-repo.ts 拆出）
 * Projects v2 / topics / 订阅 / 最近分支 / 删除 / Security 安全公告。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import {
  REPOSITORY_QUERY,
  REPOSITORY_ID_QUERY,
  UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
  DELETE_REPOSITORY_MUTATION,
  REPO_TOPICS_QUERY,
  REPO_PROJECTS_V2_QUERY,
  RECENT_BRANCHES_QUERY,
  UPDATE_REPOSITORY_TOPICS_MUTATION,
} from "../graphql";
import {
  replaceRepoTopics,
  fetchRepoTopics,
  fetchRepoSubscription,
  setRepoSubscription,
  deleteRepository,
  fetchSecurityAdvisories,
  fetchSecurityAdvisory,
  fetchSecurityMd,
} from "../restapi";
import type { RepoSubscription, SecurityAdvisory, ReadmeInfo } from "../restapi";

// ===== Projects v2（legacy REST 已随官方公告下线，仅 GraphQL 可用；repo scope 已涵盖）=====

/** 仓库 Projects v2 列表项（GraphQL projectsV2 节点） */
export interface RepoProjectV2 {
  id: string;
  title: string;
  number: number;
  shortDescription: string | null;
  url: string;
  closed: boolean;
  updatedAt: string;
  public: boolean;
}

/**
 * 获取仓库 Projects v2 列表（固定 GraphQL——无 REST 等价，smart 层直连 GraphQL）。
 * 未登录/失败抛错（页面按需处理）；匿名强制 REST 的短路由 graphqlRequest 处理。
 */
export async function fetchRepoProjectsV2Smart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoProjectV2[]> {
  const resp: GraphQLResponse<{
    repository: { projectsV2: { nodes: RepoProjectV2[] } | null } | null;
  }> = await graphqlRequest(REPO_PROJECTS_V2_QUERY, { owner, name: repo, first: 50 }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.repository?.projectsV2) {
    throw new Error(resp.errors?.[0]?.message ?? "Projects v2 query failed");
  }
  return resp.data.repository.projectsV2.nodes ?? [];
}

/** 智能获取仓库主题：GraphQL repositoryTopics 首选，失败降级 REST。 */
export async function fetchRepoTopicsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<string[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { repositoryTopics: { nodes: { topic: { name: string } }[] } } | null;
      }> = await graphqlRequest(REPO_TOPICS_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.repositoryTopics.nodes.map((t) => t.topic.name);
      }
      // GraphQL 失败 → 熔断降级 REST（fetchRepoTopics 签名要求 string token）
      return withRestFallback(
        () => fetchRepoTopics(owner, repo, token),
        "fetchRepoTopicsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchRepoTopics(owner, repo, token),
        "fetchRepoTopicsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST（需 token，无则空）
  if (token) return fetchRepoTopics(owner, repo, token);
  return [];
}

/** 智能替换仓库主题：GraphQL updateRepositoryTopics 首选（需 repositoryId），失败降级 REST。 */
export async function replaceRepoTopicsSmart(
  owner: string,
  repo: string,
  token: string,
  names: string[],
): Promise<string[]> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => replaceRepoTopics(owner, repo, token, names),
      "replaceRepoTopicsSmart",
      gqlResp,
    );
  try {
    const idResp: GraphQLResponse<{
      repository: { id: string } | null;
    }> = await graphqlRequest(REPOSITORY_ID_QUERY, { owner, name: repo }, token);
    const rid = idResp.data?.repository?.id;
    if (rid && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<{
        updateTopics: {
          repository: {
            repositoryTopics: { nodes: { topic: { name: string } }[] };
          } | null;
        } | null;
      }> = await graphqlRequest(
        UPDATE_REPOSITORY_TOPICS_MUTATION,
        { repositoryId: rid, topicNames: names },
        token,
      );
      const topics = mutResp.data?.updateTopics?.repository?.repositoryTopics?.nodes;
      if (topics && !hasGraphQLErrors(mutResp)) return topics.map((t) => t.topic.name);
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

/** 智能查询仓库订阅状态：GraphQL viewerSubscription（REPOSITORY_QUERY）首选，失败降级 REST。 */
export async function fetchRepoSubscriptionSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<RepoSubscription> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => fetchRepoSubscription(owner, repo, token),
      "fetchRepoSubscriptionSmart",
      gqlResp,
    );
  try {
    const resp: GraphQLResponse<{
      repository: { viewerSubscription: string | null } | null;
    }> = await graphqlRequest(REPOSITORY_QUERY, { owner, name: repo }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.repository) {
      const s = resp.data.repository.viewerSubscription;
      return {
        subscribed: s === "SUBSCRIBED" || s === "IGNORED",
        ignored: s === "IGNORED",
      };
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 智能设置仓库订阅：GraphQL updateSubscription 首选（需 repositoryId），失败降级 REST。 */
export async function setRepoSubscriptionSmart(
  owner: string,
  repo: string,
  token: string,
  body: { subscribed?: boolean; ignored?: boolean },
): Promise<RepoSubscription> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => setRepoSubscription(owner, repo, token, body),
      "setRepoSubscriptionSmart",
      gqlResp,
    );
  try {
    const idResp: GraphQLResponse<{
      repository: { id: string } | null;
    }> = await graphqlRequest(REPOSITORY_ID_QUERY, { owner, name: repo }, token);
    const rid = idResp.data?.repository?.id;
    if (rid && !hasGraphQLErrors(idResp)) {
      const state = body.ignored ? "IGNORED" : body.subscribed ? "SUBSCRIBED" : "UNSUBSCRIBED";
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
        { id: rid, state },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) {
        return {
          subscribed: state === "SUBSCRIBED" || state === "IGNORED",
          ignored: state === "IGNORED",
        };
      }
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

/** 最近推送分支（GraphQL refs committedDate 排序；仅登录查询，失败/匿名静默返回空——提示条非核心，参照 ForkInfoBar 静默先例）。 */
export type RecentBranch = { name: string; committedDate: string };
export async function fetchRecentBranchesSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<RecentBranch[]> {
  if (!token) return [];
  try {
    const resp: GraphQLResponse<{
      repository: {
        defaultBranchRef: { name: string } | null;
        refs: { nodes: Array<{ name: string; target: { committedDate: string } | null }> } | null;
      } | null;
    }> = await graphqlRequest(RECENT_BRANCHES_QUERY, { owner, name: repo }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.refs) {
      // GraphQL errors（提示条非核心）→ 静默空，补 [Warn] 保留错误详情
      logWarn("fetchRecentBranchesSmart", `GraphQL errors: ${resp.errors?.[0]?.message ?? "未知"}`);
      return [];
    }
    const def = resp.data.repository.defaultBranchRef?.name ?? "main";
    return resp.data.repository.refs.nodes
      .filter((n) => n.name !== def && n.target?.committedDate)
      .map((n) => ({ name: n.name, committedDate: n.target!.committedDate }))
      .sort((a, b) => (a.committedDate < b.committedDate ? 1 : -1));
  } catch (e) {
    // 提示条非核心 → 静默返回空，但补 [Warn] 避免丢失诊断信息
    logWarn("fetchRecentBranchesSmart", `最近分支查询失败（静默空）: ${String(e)}`);
    return [];
  }
}

/** 智能删除仓库：GraphQL deleteRepository 首选（需 repositoryId），失败降级 REST。 */
export async function deleteRepositorySmart(
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => deleteRepository(owner, repo, token), "deleteRepositorySmart", gqlResp);
  try {
    const idResp: GraphQLResponse<{
      repository: { id: string } | null;
    }> = await graphqlRequest(REPOSITORY_ID_QUERY, { owner, name: repo }, token);
    const rid = idResp.data?.repository?.id;
    if (rid && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_REPOSITORY_MUTATION,
        { repositoryId: rid },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
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

// ===== D1 Security 安全公告（REST only——GraphQL 无 security advisory 通道，不可抗力 §4.14；smart 层统一入口）=====

/**
 * 智能列出仓库安全公告（published；公开仓库匿名可读）。
 * GraphQL 无对应查询 → 直接 REST（与 api-compat.md §4.14 一致）。
 */
export async function fetchSecurityAdvisoriesSmart(
  owner: string,
  repo: string,
  token?: string | null,
  perPage = 30,
  page = 1,
): Promise<SecurityAdvisory[]> {
  return fetchSecurityAdvisories(owner, repo, token, perPage, page);
}

/** 智能获取安全公告详情（REST only，同列表）。 */
export async function fetchSecurityAdvisorySmart(
  owner: string,
  repo: string,
  ghsaId: string,
  token?: string | null,
): Promise<SecurityAdvisory> {
  return fetchSecurityAdvisory(owner, repo, ghsaId, token);
}

/** 智能获取 SECURITY.md（contents API；无文件返回 null）。 */
export async function fetchSecurityMdSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<ReadmeInfo | null> {
  return fetchSecurityMd(owner, repo, token);
}
