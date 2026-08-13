/**
 * GitHub API smart layer - repo (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import {
  REPOSITORY_QUERY,
  REPO_WITH_RELEASES_QUERY,
  CREATE_REPOSITORY_MUTATION,
  REPOSITORY_ID_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_STAR_MUTATION,
  REMOVE_STAR_MUTATION,
  RELEASES_COUNT_QUERY,
  UPDATE_REPOSITORY_TOPICS_MUTATION,
  UPDATE_ISSUE_SUBSCRIPTION_MUTATION,
  DELETE_REPOSITORY_MUTATION,
  REPO_TOPICS_QUERY,
  REPO_PROJECTS_V2_QUERY,
  RECENT_BRANCHES_QUERY,
} from "./graphql";
import {
  ApiError,
  createRepository,
  fetchRepository,
  createIssue,
  createPullRequest,
  forkRepository,
  checkStarred,
  setStarred,
  fetchReleasesCount,
  fetchLatestRelease,
  fetchLanguages,
  fetchOpenPullsCount,
  replaceRepoTopics,
  fetchRepoTopics,
  fetchRepoSubscription,
  setRepoSubscription,
  deleteRepository,
  fetchSecurityAdvisories,
  fetchSecurityAdvisory,
  fetchSecurityMd,
  fetchFileContent,
  fetchFileMeta,
  fetchDirContents,
  fetchReadme,
} from "./rest";
import { FILE_RAW_QUERY, FILE_EDIT_QUERY, TREE_ENTRIES_QUERY, repoRawBase } from "./repo-raw";
import { fetchRawContentSmart } from "./raw-proxy";
import type {
  Repository,
  RepoSubscription,
  SecurityAdvisory,
  ReadmeInfo,
  Release,
  DirEntry,
} from "./rest";

// ===== 仓库创建/管理 + 文件写操作 =====

/**
 * 智能创建仓库：个人 GraphQL createRepository 首选 + REST 降级；
 * 组织（owner 非当前登录名）直接 REST POST /orgs/{org}/repos（GraphQL 需 ownerId 复杂）。
 * 返回 { name, full_name } 供跳转。
 */
export async function createRepositorySmart(
  token: string,
  opts: {
    name: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
    /** 目标 owner：不传/个人登录名 → 个人仓库；组织名 → 组织仓库 */
    owner?: string;
  },
  login?: string,
): Promise<{ name: string; full_name: string }> {
  const isOrg = Boolean(opts.owner && opts.owner !== login);
  // 组织仓库：REST 直接创建（GraphQL 需组织 node id，不引入复杂度）
  if (isOrg) {
    const r = await createRepository(
      token,
      {
        name: opts.name,
        description: opts.description,
        private: opts.private,
        auto_init: opts.autoInit,
        owner: opts.owner,
      },
      login,
    );
    return { name: r.name, full_name: r.full_name };
  }
  try {
    const resp: GraphQLResponse<{
      createRepository: {
        repository: {
          name: string;
          nameWithOwner: string;
        };
      };
    }> = await graphqlRequest(
      CREATE_REPOSITORY_MUTATION,
      {
        input: {
          name: opts.name,
          description: opts.description ?? "",
          visibility: opts.private ? "PRIVATE" : "PUBLIC",
          autoInit: opts.autoInit ?? false,
        },
      },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.createRepository?.repository) {
      const r = resp.data.createRepository.repository;
      return { name: r.name, full_name: r.nameWithOwner };
    }
    // GraphQL 失败 → 熔断降级 REST（复用 rest 层 createRepository；日志自动 ↪ 前缀）
    return withRestFallback(
      async () => {
        const r = await createRepository(
          token,
          {
            name: opts.name,
            description: opts.description,
            private: opts.private,
            auto_init: opts.autoInit,
            owner: opts.owner,
          },
          login,
        );
        return { name: r.name, full_name: r.full_name };
      },
      "createRepositorySmart",
      resp,
    );
  } catch {
    // 网络层错误 → 熔断降级 REST
    return withRestFallback(
      async () => {
        const r = await createRepository(
          token,
          {
            name: opts.name,
            description: opts.description,
            private: opts.private,
            auto_init: opts.autoInit,
            owner: opts.owner,
          },
          login,
        );
        return { name: r.name, full_name: r.full_name };
      },
      "createRepositorySmart",
      undefined,
    );
  }
}
/** GraphQL 仓库节点（按需字段） */
export interface GraphQLRepository {
  databaseId: number | null;
  name: string;
  nameWithOwner: string;
  description: string | null;
  homepageUrl: string | null;
  url: string;
  owner?: { login: string; avatarUrl: string | null };
  stargazerCount: number;
  forkCount: number;
  watchers?: { totalCount: number };
  viewerSubscription?: string;
  viewerHasStarred?: boolean;
  primaryLanguage: { name: string } | null;
  languages?: { edges: { size: number; node: { name: string } }[] };
  repositoryTopics?: { nodes: { topic: { name: string } }[] };
  licenseInfo: { spdxId: string } | null;
  updatedAt: string;
  defaultBranchRef: { name: string } | null;
  isPrivate: boolean;
  isArchived?: boolean;
  /** 归档日期（GraphQL archivedAt；未归档 null） */
  archivedAt?: string | null;
  /** 是否 fork 仓库 */
  isFork?: boolean;
  /** fork 上游（非 fork 时 null） */
  parent?: {
    nameWithOwner: string;
    defaultBranchRef: { name: string } | null;
  } | null;
  diskUsage?: number;
  hasIssuesEnabled?: boolean;
  hasDiscussionsEnabled?: boolean;
  hasWikiEnabled?: boolean;
  hasProjectsEnabled?: boolean;
  /** tab 计数：open issues / open PRs（REPOSITORY_QUERY 并入，GraphQL 精确语义） */
  openIssues?: { totalCount: number };
  openPullRequests?: { totalCount: number };
}

/** GraphQL 仓库 → REST 兼容结构 */
export function toRepository(g: GraphQLRepository, owner: string): Repository {
  const langs: Record<string, number> = {};
  for (const edge of g.languages?.edges ?? []) {
    langs[edge.node.name] = edge.size;
  }
  return {
    id: g.databaseId ?? -1, // GraphQL databaseId；旧查询/降级无字段时兜底 -1
    name: g.name,
    full_name: g.nameWithOwner,
    owner: {
      login: owner,
      avatar_url: g.owner?.avatarUrl ?? undefined,
    },
    description: g.description,
    html_url: g.url,
    homepage: g.homepageUrl,
    stargazers_count: g.stargazerCount,
    forks_count: g.forkCount,
    subscribers_count: g.watchers?.totalCount ?? 0,
    language: g.primaryLanguage?.name ?? null,
    topics: g.repositoryTopics?.nodes.map((n) => n.topic.name),
    updated_at: g.updatedAt,
    pushed_at: g.updatedAt,
    license: g.licenseInfo ? { spdx_id: g.licenseInfo.spdxId } : null,
    default_branch: g.defaultBranchRef?.name ?? "main",
    private: g.isPrivate,
    fork: g.isFork,
    parent: g.parent
      ? {
          full_name: g.parent.nameWithOwner,
          default_branch: g.parent.defaultBranchRef?.name ?? "main",
        }
      : null,
    archived: g.isArchived,
    archived_at: g.archivedAt ?? null,
    size: g.diskUsage,
    viewer_has_starred: g.viewerHasStarred,
    has_issues: g.hasIssuesEnabled,
    has_discussions: g.hasDiscussionsEnabled,
    has_wiki: g.hasWikiEnabled,
    has_projects: g.hasProjectsEnabled,
    open_issues_count: g.openIssues?.totalCount,
    open_pulls_count: g.openPullRequests?.totalCount,
    viewer_subscription: g.viewerSubscription ?? null,
  };
}

/**
 * 智能获取仓库信息：GraphQL 首选，失败自动降级 REST。
 * 返回 { data, langs }（langs 为语言字节映射，GraphQL 或 REST 取其一）。
 */
export async function fetchRepositorySmart(
  owner: string,
  name: string,
  token?: string | null,
): Promise<{ data: Repository; langs: Record<string, number> }> {
  // ---- 首选 GraphQL（需登录——匿名 GraphQL 403，直接走 REST 60/h） ----
  if (token) {
    try {
      const resp: GraphQLResponse<{ repository: GraphQLRepository | null }> = await graphqlRequest(
        REPOSITORY_QUERY,
        { owner, name },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const g = resp.data.repository;
        const langs: Record<string, number> = {};
        for (const edge of g.languages?.edges ?? []) {
          langs[edge.node.name] = edge.size;
        }
        return { data: toRepository(g, owner), langs };
      }
      // GraphQL 失败 → 熔断降级 REST（复用 rest 层；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => {
          // pulls 计数精确补查（REST open_issues_count 含 PRs，不能拆分；pulls?state=open 独立精确）
          const [data, langs, pullsCount] = await Promise.all([
            fetchRepository(owner, name, token),
            fetchLanguages(owner, name, token).catch(() => ({})),
            fetchOpenPullsCount(owner, name, token),
          ]);
          return {
            data: pullsCount != null ? { ...data, open_pulls_count: pullsCount } : data,
            langs,
          };
        },
        "fetchRepositorySmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          const [data, langs, pullsCount] = await Promise.all([
            fetchRepository(owner, name, token),
            fetchLanguages(owner, name, token).catch(() => ({})),
            fetchOpenPullsCount(owner, name, token),
          ]);
          return {
            data: pullsCount != null ? { ...data, open_pulls_count: pullsCount } : data,
            langs,
          };
        },
        "fetchRepositorySmart",
        undefined,
      );
    }
  }

  // ---- 匿名强制 REST（GraphQL 恒 403，硬约束非降级）----
  const [data, langs, pullsCount] = await Promise.all([
    fetchRepository(owner, name, token),
    fetchLanguages(owner, name, token).catch(() => ({})),
    fetchOpenPullsCount(owner, name, token),
  ]);
  return {
    data: pullsCount != null ? { ...data, open_pulls_count: pullsCount } : data,
    langs,
  };
}

/** GraphQL release 节点（列表/详情/最新共用；供 api-repo 复合查询与 api-issue releases 板块共享） */
export interface GraphQLReleaseNode {
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
export function toRelease(g: GraphQLReleaseNode): Release {
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

/**
 * 仓库主页复合查询（Repository + 最新 release 一次 GraphQL 请求）。
 * 替代 RepoLayout 原先 fetchRepositorySmart + fetchLatestReleaseSmart 两次请求——省一次网络往返 + 配额。
 * 返回仓库元数据 + 语言映射 + releases 总数/最新节点；失败降级 REST 分步（复用 rest 层，日志 ↪ 标记）。
 */
export async function fetchRepoHomeSmart(
  owner: string,
  name: string,
  token?: string | null,
): Promise<{
  data: Repository;
  langs: Record<string, number>;
  releasesCount: number;
  latestRelease: Release | null;
}> {
  // REST 降级分步（fetchLatestRelease 内部 catch 不抛错，返回 { count: 0, latest: null }）
  const fromRest = async (): Promise<{
    data: Repository;
    langs: Record<string, number>;
    releasesCount: number;
    latestRelease: Release | null;
  }> => {
    const [repoData, langs, pullsCount, release] = await Promise.all([
      fetchRepository(owner, name, token),
      fetchLanguages(owner, name, token).catch(() => ({})),
      fetchOpenPullsCount(owner, name, token),
      fetchLatestRelease(owner, name, token),
    ]);
    return {
      data: pullsCount != null ? { ...repoData, open_pulls_count: pullsCount } : repoData,
      langs,
      releasesCount: release.count,
      latestRelease: release.latest,
    };
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository:
          | (GraphQLRepository & {
              releases: { totalCount: number; nodes: GraphQLReleaseNode[] } | null;
            })
          | null;
      }> = await graphqlRequest(REPO_WITH_RELEASES_QUERY, { owner, name }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const g = resp.data.repository;
        const langs: Record<string, number> = {};
        for (const edge of g.languages?.edges ?? []) {
          langs[edge.node.name] = edge.size;
        }
        const rel = g.releases;
        return {
          data: toRepository(g, owner),
          langs,
          releasesCount: rel?.totalCount ?? 0,
          latestRelease: rel?.nodes?.[0] ? toRelease(rel.nodes[0]) : null,
        };
      }
      // GraphQL 失败 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchRepoHomeSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchRepoHomeSmart", undefined);
    }
  }
  // 匿名强制 REST 分步
  return fromRest();
}

// ===== M3 写操作：GraphQL 首选 + REST 降级 =====

/** 查询仓库 GraphQL node id（供 star / createIssue / createDiscussion mutation 使用） */
export async function fetchRepositoryIdSmart(
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const resp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.repository) {
      return resp.data.repository.id;
    }
  } catch (e) {
    // 降级 REST（返回 null，由调用方走 REST）
    logWarn("fetchRepositoryIdSmart", `GraphQL node id 查询失败（降级 REST）: ${String(e)}`);
  }
  return null;
}

/** 创建 issue（GraphQL createIssue 首选 + REST POST 降级），成功返回 issue number */
export async function createIssueSmart(
  token: string,
  owner: string,
  repo: string,
  body: { title: string; body?: string; labels?: string[]; assignees?: string[] },
): Promise<number> {
  // 带 labels/assignees → 直接 REST（GraphQL createIssue 需 labelIds/assigneeIds 节点 ID，查询成本高）
  if (body.labels?.length || body.assignees?.length) {
    const issue = await createIssue(token, owner, repo, body);
    return issue.number;
  }
  // ---- 首选 GraphQL ----
  const repositoryId = await fetchRepositoryIdSmart(token, owner, repo);
  if (repositoryId) {
    try {
      const resp: GraphQLResponse<{
        createIssue: { issue: { number: number } } | null;
      }> = await graphqlRequest(
        CREATE_ISSUE_MUTATION,
        { repositoryId, title: body.title, body: body.body ?? null },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.createIssue) {
        return resp.data.createIssue.issue.number;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        async () => (await createIssue(token, owner, repo, body)).number,
        "createIssueSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => (await createIssue(token, owner, repo, body)).number,
        "createIssueSmart",
        undefined,
      );
    }
  }
  // ---- 降级 REST（node id 查询失败）----
  const issue = await createIssue(token, owner, repo, body);
  return issue.number;
}
/** 检测当前用户是否已 star（REST GET，204/404 判定） */
export async function isStarredSmart(token: string, owner: string, repo: string): Promise<boolean> {
  return checkStarred(token, owner, repo);
}

/**
 * star / unstar（GraphQL mutation 首选 + REST PUT/DELETE 降级）。
 * starred=true 添加，false 移除；返回更新后的 stargazerCount。
 */
export async function setStarredSmart(
  token: string,
  owner: string,
  repo: string,
  starred: boolean,
): Promise<number | null> {
  // ---- 首选 GraphQL ----
  const repositoryId = await fetchRepositoryIdSmart(token, owner, repo);
  if (repositoryId) {
    try {
      const mutation = starred ? ADD_STAR_MUTATION : REMOVE_STAR_MUTATION;
      const resp: GraphQLResponse<{
        addStar?: { starrable: { stargazerCount: number } };
        removeStar?: { starrable: { stargazerCount: number } };
      }> = await graphqlRequest(mutation, { id: repositoryId }, token);
      const starrable = resp.data?.addStar?.starrable ?? resp.data?.removeStar?.starrable;
      if (!hasGraphQLErrors(resp) && starrable) {
        return starrable.stargazerCount;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        async () => {
          await setStarred(token, owner, repo, starred);
          return null;
        },
        "setStarredSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          await setStarred(token, owner, repo, starred);
          return null;
        },
        "setStarredSmart",
        undefined,
      );
    }
  }
  // ---- 降级 REST（node id 查询失败）----
  await setStarred(token, owner, repo, starred);
  return null;
}

/** fork 仓库（GraphQL 无 mutation，直接 REST POST /forks），返回 fork 后的完整名称 */
export async function forkRepositorySmart(
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const forked = await forkRepository(token, owner, repo);
  return forked.full_name;
}

/** 创建 PR（GraphQL createPullRequest 需多步取 id，直接用 REST POST /pulls） */
export async function createPullRequestSmart(
  token: string,
  owner: string,
  repo: string,
  body: { title: string; body?: string; head: string; base: string },
): Promise<number> {
  const pr = await createPullRequest(token, owner, repo, body);
  return pr.number;
}

// ===== 页面级合并优化（单次多节点嵌套请求替代多次请求） =====

/** 智能获取 Releases 计数：GraphQL totalCount 首选（需登录），失败降级 REST。 */
export async function fetchReleasesCountSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { releases: { totalCount: number } } | null;
      }> = await graphqlRequest(RELEASES_COUNT_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.releases.totalCount;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleasesCount(owner, repo, token),
        "fetchReleasesCountSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleasesCount(owner, repo, token),
        "fetchReleasesCountSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchReleasesCount(owner, repo, token);
}

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
        updateRepositoryTopics: {
          repositoryTopics: { nodes: { topic: { name: string } }[] };
        } | null;
      }> = await graphqlRequest(
        UPDATE_REPOSITORY_TOPICS_MUTATION,
        { repositoryId: rid, topicNames: names },
        token,
      );
      const topics = mutResp.data?.updateRepositoryTopics?.repositoryTopics?.nodes;
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
): Promise<SecurityAdvisory[]> {
  return fetchSecurityAdvisories(owner, repo, token, perPage);
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

// ===== blob 文件内容（$raw 内部路由优先 + 状态分流 + 路径审计日志）=====

/**
 * 文件内容通道审计日志（dev 模式输出，格式对齐 [PureGit API]）。
 * 记录文件内容实际命中的读取路径（direct-raw / worker-$raw-proxy / graphql-blob / rest-contents），
 * 便于核实内部功能路径的真实触发方式（用户要求：对读取方式做审计）。
 */
function fileContentLog(detail: string, channel: string, size: number): void {
  if (!import.meta.env.DEV) return;
  console.log(`[PureGit API] [FileContent] ${detail} → ${channel} ${size}B`);
}

/**
 * GitHub API 文件内容通道上限（修订，官方 2022-05 起 REST 提升至 100MB）：
 * - API_REST_MAX_BYTES = 100MB：REST contents + raw Accept 上限（1MB~100MB 必须 raw Accept，
 *   fetchFileContent 已满足）；>100MB 接口直接拒绝。
 * - API_GQL_MAX_BYTES = 1MB：GraphQL Blob.text 硬限制——>1MB 时 isTruncated=true、text 只含部分
 *   （官方 确认：text 非 null 但截断），必须检查 isTruncated 防静默返回残缺内容。
 * 文件树（git/trees 递归）自带 size 字段，knownSize 已知超限时跳过对应通道（免无谓 API 尝试）。
 */
export const API_REST_MAX_BYTES = 100 * 1024 * 1024;
export const API_GQL_MAX_BYTES = 1024 * 1024;

/**
 * 智能获取文件原始内容（blob 页主加载通道）——**API 优先 + 按登录态保底**。
 *
 * 分层（用户定稿：登录 = API smart hack 优先、$raw 保底；匿名 = REST hack 优先、raw 直连保底）：
 * - **登录**：① GraphQL blob（`Blob.text` + isTruncated 检查，5000 点配额，≤1MB）
 *   → ② REST contents（raw Accept，100MB 通道，私有仓库可读）
 *   → ③ Worker /$raw 代理保底（跳过直连——受限网络直连超时浪费 5s；worker 带会话 token，绕墙 + Cache API）。
 * - **匿名**（GraphQL 恒 403 守卫短路）：① REST contents（raw Accept，公开仓库，60/h 配额——
 *   api.github.com 实测可达，用户定稿主通道）→ ② raw 直连保底（零配额零成本；**仅直连不转代理**）。
 * - **knownSize 门控**：>100MB（REST 硬限制）→ 直接保底通道；>1MB（GraphQL 必截断）→ 跳过 GraphQL 直接 REST。
 * 每次命中通道打 fileContentLog（dev 审计）。
 */
export async function fetchFileContentSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  knownSize?: number,
): Promise<string> {
  const detail = `${owner}/${repo} ${branch}:${path}`;
  // 保底通道（登录 $raw 代理 / 匿名 raw 直连）——用户定稿
  const fallback = async (): Promise<string> => {
    if (token) {
      // 登录保底：$raw 代理（directFirst=false 跳过直连，受限网络直连超时浪费 5s）
      const raw = await fetchRawContentSmart(owner, repo, branch, path, false);
      if (raw != null) {
        fileContentLog(detail, "fallback→$raw-proxy", raw.length);
        return raw;
      }
      fileContentLog(detail, "fallback→$raw-proxy→null", 0);
      throw new ApiError(413, "文件获取失败（超过通道上限或网络不可达）");
    }
    // 匿名保底：raw 直连（零配额；仅直连不转代理，用户定稿）
    const raw = await fetchRawContentSmart(owner, repo, branch, path, true, false);
    if (raw != null) {
      fileContentLog(detail, "fallback→raw-direct", raw.length);
      return raw;
    }
    fileContentLog(detail, "fallback→raw-direct→null", 0);
    throw new ApiError(404, "文件获取失败（公开文件不可达，请登录后重试）");
  };
  // ①-0 size 门控：>100MB（REST 硬限制）→ 直接保底通道
  if (knownSize != null && knownSize > API_REST_MAX_BYTES) {
    fileContentLog(detail, "size-gated(>100MB)→fallback", 0);
    return fallback();
  }
  // ① GraphQL：仅登录且 ≤1MB（>1MB 必截断，跳过省一次无效查询）
  if (token && !(knownSize != null && knownSize > API_GQL_MAX_BYTES)) {
    try {
      const resp: GraphQLResponse<{
        repository: { object: { text: string | null; isTruncated: boolean } | null } | null;
      }> = await graphqlRequest(
        FILE_RAW_QUERY,
        { owner, name: repo, expr: `${branch}:${path}` },
        token,
      );
      const obj = resp.data?.repository?.object;
      // text 完整（非截断）才返回；截断（>1MB）/ errors → 降级 REST
      if (!hasGraphQLErrors(resp) && obj?.text != null && !obj.isTruncated) {
        fileContentLog(detail, "graphql-blob", obj.text.length);
        return obj.text;
      }
      fileContentLog(detail, "graphql-blob→skip(truncated/err)", 0);
    } catch {
      fileContentLog(detail, "graphql-blob→err", 0);
    }
  } else {
    fileContentLog(
      detail,
      token ? "graphql-blob→skip(size>1MB)" : "graphql-blob→skip(anonymous)",
      0,
    );
  }
  // ② REST contents（raw Accept，100MB 通道；登录匿名都走——api.github.com 实测可达）
  try {
    const rest = await fetchFileContent(owner, repo, path, token, branch);
    fileContentLog(detail, "rest-contents", rest.length);
    return rest;
  } catch {
    fileContentLog(detail, "rest-contents→err", 0);
  }
  // ③ 保底通道（登录 $raw 代理 / 匿名 raw 直连）
  return fallback();
}

// ===== 目录列举 / README（登录 GraphQL 主通道 + REST 熔断）=====

/** GraphQL TreeEntry 结构子集（Tree.entries 查询返回节点） */
interface TreeEntryNode {
  name: string;
  path: string | null;
  type: string;
  size: number | null;
}

/** GraphQL Tree.entries 节点 → DirEntry（type "tree"→dir，其余 blob/commit→file） */
function toDirEntry(e: TreeEntryNode): DirEntry {
  return {
    name: e.name,
    path: e.path ?? e.name,
    type: e.type === "tree" ? "dir" : "file",
    size: e.size ?? 0,
  };
}

/**
 * 智能获取目录条目列表（TreePage / CodeIndex 目录列表主通道）。
 * 登录：GraphQL repository.object(expression:"HEAD:path") → Tree.entries 首选（v0.0.1 登录强制 Graph 主通道）；
 * 匿名 / GraphQL 失败 → 熔断降级 REST fetchDirContents（匿名强制 REST）。
 */
export async function fetchDirContentsSmart(
  owner: string,
  repo: string,
  path = "",
  branch = "HEAD",
  token?: string | null,
): Promise<DirEntry[]> {
  if (token) {
    try {
      const expr = path ? `${branch}:${path}` : `${branch}:`;
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(TREE_ENTRIES_QUERY, { owner, name: repo, expr }, token);
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        return entries.map(toDirEntry);
      }
      // GraphQL 失败（如 path 是文件而非目录）→ 熔断降级 REST
      return withRestFallback(
        () => fetchDirContents(owner, repo, path, branch, token),
        "fetchDirContentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchDirContents(owner, repo, path, branch, token),
        "fetchDirContentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchDirContents(owner, repo, path, branch, token);
}

/**
 * 智能获取 README（CodeIndex / TreePage 子目录 README 主通道）。
 * 登录：GraphQL 两步——① Tree.entries 定位 README 文件（REST /readme 自动定位 → GraphQL 需手动枚举，
 *   按 name 前缀 readme 匹配 blob）② fetchFileContentSmart 拿内容（GraphQL blob + REST/$raw 保底）。
 * 匿名 / GraphQL 失败 → 熔断降级 REST fetchReadme（自动定位，无需手动枚举）。
 */
export async function fetchReadmeSmart(
  owner: string,
  repo: string,
  token?: string | null,
  dir = "",
): Promise<ReadmeInfo | null> {
  if (token) {
    try {
      const expr = dir ? `HEAD:${dir}` : "HEAD:";
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(TREE_ENTRIES_QUERY, { owner, name: repo, expr }, token);
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        // README 定位：blob 且 name 以 readme 开头（大小写不敏感，REST /readme 同规则的前缀匹配）
        const readme = entries.find((e) => e.type === "blob" && /^readme\./i.test(e.name));
        if (readme) {
          const readmePath = readme.path ?? (dir ? `${dir}/${readme.name}` : readme.name);
          const content = await fetchFileContentSmart(owner, repo, readmePath, token);
          return {
            content,
            path: readmePath,
            rawBase: repoRawBase(owner, repo, "HEAD") + (dir ? `/${dir}` : ""),
          };
        }
        // 目录存在但无 README → null（与 REST /readme 404 语义一致）
        return null;
      }
      // GraphQL 失败 → 熔断降级 REST（自动定位 README）
      return withRestFallback(() => fetchReadme(owner, repo, token, dir), "fetchReadmeSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchReadme(owner, repo, token, dir),
        "fetchReadmeSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchReadme(owner, repo, token, dir);
}

// ===== 编辑页数据一次查（blob 内容 + metadata）=====

/** 编辑页数据（内容 + blob sha） */
export interface FileEditData {
  /** 文件内容（skipContent=true 或 >1MB/非文本时为 null） */
  content: string | null;
  /** blob sha（PUT createOrUpdateFileContents 的 sha 参数；与 REST contents.sha 语义一致） */
  sha: string;
}

/**
 * 编辑页数据：一次 GraphQL 同时拿 blob 内容(text) + sha(oid)，降级链完备。
 * - oid 与 REST contents.sha 同为 blob SHA（GitHub 官方文档），可直接用于 PUT 提交；
 * - >1MB：isTruncated=true（text 只含部分，官方 确认）→ 不返回残缺内容，
 *   内容经 fetchFileContentSmart（REST/$raw）补齐，sha 用 oid；
 * - 误填目录路径（object 为 Tree，fragment 不匹配）→ 无 oid → 降级 REST 报错（同 REST 行为）；
 * - 匿名 / GraphQL 失败：降级 REST fetchFileMeta 拿 sha + fetchFileContentSmart 内容通道；
 * - skipContent=true（blob→编辑注入路径）：仅取 sha（GraphQL 仍返回 text 字段，解析时忽略）。
 */
export async function fetchFileEditSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  skipContent = false,
): Promise<FileEditData> {
  // ① 登录 GraphQL 首选：object { ... on Blob { oid text isTruncated } }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: { oid: string; text: string | null; isTruncated: boolean } | null;
        } | null;
      }> = await graphqlRequest(
        FILE_EDIT_QUERY,
        { owner, name: repo, expr: `${branch}:${path}` },
        token,
      );
      const obj = resp.data?.repository?.object;
      if (obj?.oid) {
        // sha 到手；text 完整（非截断）则一并返回（skipContent 时调用方不要内容）
        if (skipContent) return { content: null, sha: obj.oid };
        if (obj.text != null && !obj.isTruncated) {
          return { content: obj.text, sha: obj.oid };
        }
        // isTruncated（>1MB）→ 不返回残缺内容，经 smart 通道补齐，sha 用 oid
        const c = await fetchFileContentSmart(owner, repo, path, token, branch);
        return { content: c, sha: obj.oid };
      }
      // object 为 null（路径不存在）或非 Blob（目录）→ 降级 REST（行为与 REST contents 一致）
    } catch {
      /* 降级 */
    }
  }
  // ② 降级：REST contents 拿 sha + smart 通道内容（编辑场景 token 必在：WriteGate 门控）
  const meta = await fetchFileMeta(owner, repo, path, token!);
  if (skipContent) return { content: null, sha: meta.sha };
  const c = await fetchFileContentSmart(owner, repo, path, token, branch);
  return { content: c, sha: meta.sha };
}
