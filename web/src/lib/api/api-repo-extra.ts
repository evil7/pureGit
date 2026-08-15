/**
 * GitHub API smart layer - repo 扩展（自 api-repo.ts 拆出）
 * topics / 订阅 / 最近分支 / 删除 / Security 安全公告。
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
  RECENT_BRANCHES_QUERY,
  REPO_BRANCHES_PAGE_QUERY,
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
  fetchBranches,
} from "../restapi";
import type { RepoSubscription, SecurityAdvisory, ReadmeInfo } from "../restapi";

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

/** 分支详情（分支管理页 /branches 展示：名称 + 是否默认 + 最后提交信息/作者/时间 + 相对默认分支 ahead/behind） */
export interface BranchDetail {
  name: string;
  isDefault: boolean;
  sha: string;
  committedDate: string | null;
  message: string | null;
  authorLogin: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  /** 领先默认分支的提交数（null = REST 降级/匿名无此数据） */
  aheadBy: number | null;
  /** 落后默认分支的提交数 */
  behindBy: number | null;
}

/** 分支分页结果（游标续接；REST 降级/匿名时 endCursor=null、restPage 递增驱动下一页） */
export interface PagedBranches {
  branches: BranchDetail[];
  endCursor: string | null;
  hasNextPage: boolean;
  /** REST 降级/匿名时的下一页页码（GraphQL 成功为 null）；组件据此 loadMore 递进 */
  restPage: number | null;
}

/** 每页分支数（对齐官方「每页约 10 个、翻页递进加载」，防一次拉全量压垮 API） */
const BRANCHES_PAGE_SIZE = 10;

/** REST 分支 → BranchDetail（REST 仅 name+sha，无提交详情/无 ahead/behind → 置空；页面降级渲染） */
function toBranchFromRest(
  bs: { name: string; commit: { sha: string } }[],
  defaultBranch: string,
): BranchDetail[] {
  return bs.map((b) => ({
    name: b.name,
    isDefault: b.name === defaultBranch,
    sha: b.commit.sha,
    committedDate: null,
    message: null,
    authorLogin: null,
    authorName: null,
    authorAvatarUrl: null,
    aheadBy: null,
    behindBy: null,
  }));
}

/**
 * 智能获取仓库分支分页（含提交信息 + 相对默认分支 ahead/behind）：
 * GraphQL REPO_BRANCHES_PAGE_QUERY 首选（每页 10 + 内联 Ref.compare 一次拿 ahead/behind），
 * 失败/匿名 → 熔断降级 REST fetchBranches（仅 name+sha，无 ahead/behind，按 page 递进）。
 * cursor = GraphQL 续接游标；restPage = REST 降级/匿名页码（首屏 1）。返回统一 PagedBranches。
 */
export async function fetchBranchesDetailSmart(
  owner: string,
  repo: string,
  defaultBranch: string,
  cursor: string | null,
  restPage: number,
  token?: string | null,
): Promise<PagedBranches> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>): Promise<PagedBranches> =>
    withRestFallback(
      async () => {
        const bs = await fetchBranches(owner, repo, BRANCHES_PAGE_SIZE, token, restPage);
        return {
          branches: toBranchFromRest(bs, defaultBranch),
          endCursor: null,
          // REST 无游标：按「批次是否拉满」判断是否还有下一页
          hasNextPage: bs.length >= BRANCHES_PAGE_SIZE,
          restPage: restPage + 1,
        };
      },
      "fetchBranchesDetailSmart",
      gqlResp,
    );

  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          refs: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            nodes: Array<{
              name: string;
              target: {
                oid: string;
                committedDate: string | null;
                message: string | null;
                author: {
                  name: string | null;
                  avatarUrl: string | null;
                  user: { login: string } | null;
                } | null;
              } | null;
              compare: { aheadBy: number; behindBy: number } | null;
            }>;
          } | null;
        } | null;
      }> = await graphqlRequest(
        REPO_BRANCHES_PAGE_QUERY,
        { owner, name: repo, defaultBranch, after: cursor ?? null },
        token,
      );
      const refs = resp.data?.repository?.refs;
      if (!hasGraphQLErrors(resp) && refs) {
        return {
          branches: (refs.nodes ?? [])
            .map((n) => {
              const name = n.name.replace(/^refs\/heads\//, "");
              const t = n.target;
              return {
                name,
                isDefault: name === defaultBranch,
                sha: t?.oid ?? "",
                committedDate: t?.committedDate ?? null,
                message: t?.message ?? null,
                authorLogin: t?.author?.user?.login ?? null,
                authorName: t?.author?.name ?? null,
                authorAvatarUrl: t?.author?.avatarUrl ?? null,
                // Ref.compare(headRef: defaultBranch) 语义：base=当前分支、head=默认分支 →
                // aheadBy=默认领先当前（=当前「落后」）、behindBy=默认落后当前（=当前「领先」），故交换映射
                aheadBy: n.compare ? n.compare.behindBy : null,
                behindBy: n.compare ? n.compare.aheadBy : null,
              };
            })
            .filter((b) => b.name),
          endCursor: refs.pageInfo?.endCursor ?? null,
          hasNextPage: refs.pageInfo?.hasNextPage ?? false,
          restPage: null,
        };
      }
      return fromRest(resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return fromRest(undefined);
    }
  }
  // 匿名强制 REST（GraphQL 匿名恒 403，硬约束非降级）
  const bs = await fetchBranches(owner, repo, BRANCHES_PAGE_SIZE, token, restPage);
  return {
    branches: toBranchFromRest(bs, defaultBranch),
    endCursor: null,
    hasNextPage: bs.length >= BRANCHES_PAGE_SIZE,
    restPage: restPage + 1,
  };
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
 * GraphQL 无对应查询 → 直接 REST。
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
