/**
 * GitHub API smart layer - repo (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import {
  REPOSITORY_QUERY,
  REPO_STATS_QUERY,
  LATEST_COMMIT_QUERY,
  REPO_HEADER_QUERY,
  FILE_COMMIT_QUERY,
  REPO_WITH_RELEASES_QUERY,
  CREATE_REPOSITORY_MUTATION,
  UPDATE_REPOSITORY_MUTATION,
  ARCHIVE_REPOSITORY_MUTATION,
  UNARCHIVE_REPOSITORY_MUTATION,
  CREATE_PULL_REQUEST_MUTATION,
  CREATE_PULL_REQUEST_IDS_QUERY,
  REPOSITORY_ID_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_STAR_MUTATION,
  REMOVE_STAR_MUTATION,
  RELEASES_COUNT_QUERY,
} from "../graphql";
import {
  createRepository,
  updateRepository,
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
  fetchPublicRepoStats,
  fetchLatestCommit,
  fetchFileCommit,
  fetchBranches,
} from "../restapi";
import type { Repository, Release, RepoStats } from "../restapi";

// ===== 仓库创建/管理 + 文件写操作 =====

/** 智能获取公开仓库 star/fork 计数（footer 本项目统计）：GraphQL 首选（轻量）+ REST 降级（匿名/失败）。 */ export async function fetchPublicRepoStatsSmart(
  owner: string,
  name: string,
  token?: string | null,
): Promise<RepoStats> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { stargazerCount: number; forkCount: number } | null;
      }> = await graphqlRequest(REPO_STATS_QUERY, { owner, name }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return {
          stargazers_count: resp.data.repository.stargazerCount,
          forks_count: resp.data.repository.forkCount,
        };
      }
      return withRestFallback(
        () => fetchPublicRepoStats(owner, name, token),
        "fetchPublicRepoStatsSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchPublicRepoStats(owner, name, token),
        "fetchPublicRepoStatsSmart",
        undefined,
      );
    }
  }
  return fetchPublicRepoStats(owner, name, token);
}

/** 智能获取仓库最新提交（文件列表顶部信息行）：GraphQL object(expression) 首选 + REST 降级（匿名/失败）。 */
export async function fetchLatestCommitSmart(
  owner: string,
  name: string,
  branch = "HEAD",
  token?: string | null,
): Promise<Awaited<ReturnType<typeof fetchLatestCommit>>> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            oid: string;
            message: string;
            committedDate: string;
            author: { avatarUrl: string; user: { login: string } | null } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(LATEST_COMMIT_QUERY, { owner, name, expression: branch }, token);
      const c = resp.data?.repository?.object;
      if (!hasGraphQLErrors(resp) && c) {
        return {
          sha: c.oid,
          commit: { message: c.message, committer: { date: c.committedDate } },
          author: c.author?.user
            ? { login: c.author.user.login, avatar_url: c.author.avatarUrl }
            : null,
        };
      }
      return withRestFallback(
        () => fetchLatestCommit(owner, name, branch, token),
        "fetchLatestCommitSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchLatestCommit(owner, name, branch, token),
        "fetchLatestCommitSmart",
        undefined,
      );
    }
  }
  return fetchLatestCommit(owner, name, branch, token);
}

/** 智能获取指定文件的最近提交（blob 文件头信息行）：GraphQL object(expression: "branch:path").history 首选 + REST 降级。 */
export async function fetchFileCommitSmart(
  owner: string,
  name: string,
  path: string,
  branch = "HEAD",
  token?: string | null,
): Promise<Awaited<ReturnType<typeof fetchFileCommit>>> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            history: {
              nodes: {
                oid: string;
                message: string;
                committedDate: string;
                author: { avatarUrl: string; user: { login: string } | null } | null;
              }[];
            };
          } | null;
        } | null;
      }> = await graphqlRequest(
        FILE_COMMIT_QUERY,
        { owner, name, expression: branch, path },
        token,
      );
      const c = resp.data?.repository?.object?.history?.nodes?.[0];
      if (!hasGraphQLErrors(resp) && c) {
        return {
          sha: c.oid,
          commit: { message: c.message, committer: { date: c.committedDate } },
          author: c.author?.user
            ? { login: c.author.user.login, avatar_url: c.author.avatarUrl }
            : null,
        };
      }
      return withRestFallback(
        () => fetchFileCommit(owner, name, path, branch, token),
        "fetchFileCommitSmart",
        resp,
      );
    } catch {
      return withRestFallback(
        () => fetchFileCommit(owner, name, path, branch, token),
        "fetchFileCommitSmart",
        undefined,
      );
    }
  }
  return fetchFileCommit(owner, name, path, branch, token);
}

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
  viewerPermission?: string;
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
    viewer_permission: (g.viewerPermission as Repository["viewer_permission"]) ?? null,
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

/** 仓库代码首页头部数据（分支列表 + 最新提交） */
export interface RepoHeaderData {
  branches: string[];
  latestCommit: Awaited<ReturnType<typeof fetchLatestCommit>>;
}

/**
 * 仓库代码首页复合查询——分支列表 + 最新提交（一次 GraphQL REPO_HEADER_QUERY）。
 * 替代 RepoActionBar 的 fetchBranchesSmart + LatestCommitLine 的 fetchLatestCommitSmart 两次请求（登录态 2→1）。
 * 登录：refs + object(expression) 一次拿；失败/匿名 → 熔断降级 REST 分步（fetchBranches + fetchLatestCommit 并行）。
 */
export async function fetchRepoHeaderSmart(
  owner: string,
  name: string,
  branch = "HEAD",
  token?: string | null,
): Promise<RepoHeaderData> {
  const fromRest = async (): Promise<RepoHeaderData> => {
    const [branches, latestCommit] = await Promise.all([
      fetchBranches(owner, name, 100, token).then((bs) => bs.map((b) => b.name)),
      fetchLatestCommit(owner, name, branch, token),
    ]);
    return { branches, latestCommit };
  };
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          refs: { nodes: { name: string; target: { oid: string } }[] } | null;
          object: {
            oid: string;
            message: string;
            committedDate: string;
            author: { avatarUrl: string; user: { login: string } | null } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(REPO_HEADER_QUERY, { owner, name, expression: branch }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const r = resp.data.repository;
        const branches = (r.refs?.nodes ?? []).map((n) => n.name.replace(/^refs\/heads\//, ""));
        const c = r.object;
        const latestCommit = c
          ? {
              sha: c.oid,
              commit: { message: c.message, committer: { date: c.committedDate } },
              author: c.author?.user
                ? { login: c.author.user.login, avatar_url: c.author.avatarUrl }
                : null,
            }
          : null;
        return { branches, latestCommit };
      }
      return withRestFallback(fromRest, "fetchRepoHeaderSmart", resp);
    } catch {
      return withRestFallback(fromRest, "fetchRepoHeaderSmart", undefined);
    }
  }
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

/** fork 仓库（GraphQL 无 mutation，直接 REST POST /forks），返回 fork 后的完整名称。
 * organization 可选：默认 fork 到本人；传组织名 → fork 到该组织 */
export async function forkRepositorySmart(
  token: string,
  owner: string,
  repo: string,
  organization?: string,
): Promise<string> {
  const forked = await forkRepository(token, owner, repo, organization);
  return forked.full_name;
}

/** 创建 PR（GraphQL createPullRequest 主通道 + REST 熔断）——
 * 同仓库：REPOSITORY_ID_QUERY 前置查 base id → createPullRequest mutation；
 * 跨仓库（head 为 "owner:branch"）：CREATE_PULL_REQUEST_IDS_QUERY 复合查询一次拿 base + head 双 id → mutation。 */
export async function createPullRequestSmart(
  token: string,
  owner: string,
  repo: string,
  body: { title: string; body?: string; head: string; base: string },
): Promise<number> {
  const restFallback = () => createPullRequest(token, owner, repo, body).then((p) => p.number);

  if (token) {
    // 解析 head：同仓库 "branch" / 跨仓库 "owner:branch"（fork PR，REST 同语义）
    const colonIdx = body.head.indexOf(":");
    const headOwner = colonIdx > 0 ? body.head.slice(0, colonIdx) : null;
    const headBranch = colonIdx > 0 ? body.head.slice(colonIdx + 1) : body.head;

    try {
      // 跨仓库：复合查询一次拿 base + head 双 repository id
      if (headOwner) {
        const idsResp: GraphQLResponse<{
          base: { id: string } | null;
          head: { id: string } | null;
        }> = await graphqlRequest(
          CREATE_PULL_REQUEST_IDS_QUERY,
          { owner, name: repo, headOwner },
          token,
        );
        const baseId = idsResp.data?.base?.id;
        const headRepoId = idsResp.data?.head?.id;
        if (baseId && headRepoId && !hasGraphQLErrors(idsResp)) {
          const mutResp: GraphQLResponse<{
            createPullRequest: { pullRequest: { number: number } } | null;
          }> = await graphqlRequest(
            CREATE_PULL_REQUEST_MUTATION,
            {
              repositoryId: baseId,
              headRepositoryId: headRepoId,
              baseRefName: body.base,
              headRefName: headBranch,
              title: body.title,
              body: body.body,
            },
            token,
          );
          if (!hasGraphQLErrors(mutResp) && mutResp.data?.createPullRequest) {
            return mutResp.data.createPullRequest.pullRequest.number;
          }
          return withRestFallback(restFallback, "createPullRequestSmart", mutResp);
        }
        return withRestFallback(restFallback, "createPullRequestSmart", idsResp);
      }

      // 同仓库：只查 base repositoryId
      const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
        REPOSITORY_ID_QUERY,
        { owner, name: repo },
        token,
      );
      const baseId = idResp.data?.repository?.id;
      if (baseId && !hasGraphQLErrors(idResp)) {
        const mutResp: GraphQLResponse<{
          createPullRequest: { pullRequest: { number: number } } | null;
        }> = await graphqlRequest(
          CREATE_PULL_REQUEST_MUTATION,
          {
            repositoryId: baseId,
            baseRefName: body.base,
            headRefName: body.head,
            title: body.title,
            body: body.body,
          },
          token,
        );
        if (!hasGraphQLErrors(mutResp) && mutResp.data?.createPullRequest) {
          return mutResp.data.createPullRequest.pullRequest.number;
        }
        return withRestFallback(restFallback, "createPullRequestSmart", mutResp);
      }
      return withRestFallback(restFallback, "createPullRequestSmart", idResp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(restFallback, "createPullRequestSmart", undefined);
    }
  }
  // 匿名强制 REST
  return restFallback();
}

/** 更新仓库字段（复用 REST 层 fields 类型） */
type UpdateRepositoryFields = Parameters<typeof updateRepository>[3];

/**
 * 智能更新仓库（hybrid：GraphQL 主通道 + REST 增补，熔断全 REST）。
 * - GraphQL 覆盖：name/description/homepageUrl/has*Enabled（updateRepository mutation）+ archived（archive/unarchive mutation）。
 * - REST 增补：private / default_branch（GraphQL 无 mutation 通道）。
 * - 熔断（查 id 失败 / mutation 失败 / 网络错误）→ 整体降级 REST PATCH。
 */
export async function updateRepositorySmart(
  owner: string,
  repo: string,
  token: string,
  fields: UpdateRepositoryFields,
): Promise<Repository> {
  if (!token) {
    // 匿名强制 REST
    return updateRepository(owner, repo, token, fields);
  }

  // 字段分流：graph 可处理 vs rest-only 增补
  const restOnly: UpdateRepositoryFields = {};
  if (fields.private !== undefined) restOnly.private = fields.private;
  if (fields.default_branch !== undefined) restOnly.default_branch = fields.default_branch;
  const hasRestOnly = fields.private !== undefined || fields.default_branch !== undefined;

  const graphVars: Record<string, unknown> = {};
  // name 未变化时不传（避免触发 no-op rename——GitHub 后端对同名 rename 偶发 500「Something went wrong」）
  if (fields.name !== undefined && fields.name !== repo) graphVars.name = fields.name;
  if (fields.description !== undefined) graphVars.description = fields.description;
  if (fields.homepage !== undefined) graphVars.homepageUrl = fields.homepage;
  if (fields.has_issues !== undefined) graphVars.hasIssuesEnabled = fields.has_issues;
  if (fields.has_discussions !== undefined)
    graphVars.hasDiscussionsEnabled = fields.has_discussions;
  if (fields.has_wiki !== undefined) graphVars.hasWikiEnabled = fields.has_wiki;
  if (fields.has_projects !== undefined) graphVars.hasProjectsEnabled = fields.has_projects;
  const hasGraphFields = Object.keys(graphVars).length > 0;
  const hasArchived = fields.archived !== undefined;

  // 纯 rest-only（如 confirmVisibility 只传 private）→ 直接 REST
  if (!hasGraphFields && !hasArchived) {
    return updateRepository(owner, repo, token, fields);
  }

  try {
    // 前置查 repositoryId
    const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    const repositoryId = idResp.data?.repository?.id;
    if (!repositoryId || hasGraphQLErrors(idResp)) {
      return withRestFallback(
        () => updateRepository(owner, repo, token, fields),
        "updateRepositorySmart",
        idResp,
      );
    }

    let gqlNode: GraphQLRepository | null = null;
    // graph 主请求：updateRepository mutation（name/description/homepage/has_*）
    if (hasGraphFields) {
      const mutResp: GraphQLResponse<{
        updateRepository: { repository: GraphQLRepository } | null;
      }> = await graphqlRequest(UPDATE_REPOSITORY_MUTATION, { repositoryId, ...graphVars }, token);
      if (hasGraphQLErrors(mutResp)) {
        return withRestFallback(
          () => updateRepository(owner, repo, token, fields),
          "updateRepositorySmart",
          mutResp,
        );
      }
      gqlNode = mutResp.data?.updateRepository?.repository ?? null;
    }
    // archived 独立 mutation
    if (hasArchived) {
      const archResp: GraphQLResponse<{
        archiveRepository?: { repository: GraphQLRepository } | null;
        unarchiveRepository?: { repository: GraphQLRepository } | null;
      }> = await graphqlRequest(
        fields.archived ? ARCHIVE_REPOSITORY_MUTATION : UNARCHIVE_REPOSITORY_MUTATION,
        { repositoryId },
        token,
      );
      if (hasGraphQLErrors(archResp)) {
        return withRestFallback(
          () => updateRepository(owner, repo, token, fields),
          "updateRepositorySmart",
          archResp,
        );
      }
      gqlNode =
        archResp.data?.archiveRepository?.repository ??
        archResp.data?.unarchiveRepository?.repository ??
        gqlNode;
    }

    // REST 增补：private / default_branch（GraphQL 无 mutation 通道）。
    // 注意：若 graph 已改名（name 字段），REST 增补须用新名（改名后旧名 404）。
    if (hasRestOnly) {
      const effectiveRepo = fields.name || repo;
      return updateRepository(owner, effectiveRepo, token, restOnly);
    }

    // 纯 graph 成功 → 从 graph 节点映射
    if (gqlNode) return toRepository(gqlNode, owner);
  } catch {
    // 网络层错误 → 熔断全 REST
    return withRestFallback(
      () => updateRepository(owner, repo, token, fields),
      "updateRepositorySmart",
      undefined,
    );
  }

  // 兜底（graph 节点缺失等异常）→ 全 REST
  return updateRepository(owner, repo, token, fields);
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
