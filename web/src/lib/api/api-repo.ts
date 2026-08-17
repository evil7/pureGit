/**
 * GitHub API smart layer - repo (split from api.ts,)
 * Board file. See api.ts barrel.
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
  FILE_HISTORY_QUERY,
  REPO_WITH_RELEASES_QUERY,
  CREATE_REPOSITORY_MUTATION,
  UPDATE_REPOSITORY_MUTATION,
  UPDATE_REPOSITORY_WEB_COMMIT_SIGNOFF_SETTING_MUTATION,
  ARCHIVE_REPOSITORY_MUTATION,
  UNARCHIVE_REPOSITORY_MUTATION,
  CREATE_PULL_REQUEST_MUTATION,
  CREATE_PULL_REQUEST_IDS_QUERY,
  REPOSITORY_ID_QUERY,
  CREATE_ISSUE_MUTATION,
  ADD_STAR_MUTATION,
  REMOVE_STAR_MUTATION,
  VIEWER_FORK_DETECT_QUERY,
} from "../graphql";
import {
  createRepository,
  createRepositoryFromTemplate,
  updateRepository,
  fetchRepository,
  createIssue,
  createPullRequest,
  forkRepository,
  checkStarred,
  setStarred,
  fetchLatestRelease,
  fetchLanguages,
  fetchOpenPullsCount,
  fetchPublicRepoStats,
  fetchLatestCommit,
  fetchFileCommit,
  fetchFileCommits,
  fetchBranches,
  checkImmutableReleases,
  enableImmutableReleases,
  disableImmutableReleases,
  renameBranch,
  deleteBranchProtection,
} from "../restapi";
import type { Repository, Release, RepoStats, CreateRepoInput } from "../restapi";
import { toRelease } from "./api-release";
import type { GraphQLReleaseNode } from "./api-release";

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

/** 文件提交历史单项（GraphQL history 节点与 REST listCommits 归一） */
export interface FileCommitItem {
  sha: string;
  message: string;
  committedDate: string;
  authorLogin: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
}

/** 文件提交历史分页结果（GraphQL 游标 + REST 页码双轨，供 CommitsPage 加载更多） */
export interface PagedFileCommits {
  commits: FileCommitItem[];
  endCursor: string | null;
  hasNextPage: boolean;
  restPage: number | null;
}

/** 文件历史每页条数（对齐官方 commits 列表默认 30/页） */
const FILE_HISTORY_PAGE_SIZE = 30;

/** REST RepoCommit → FileCommitItem（authorLogin 为空时回退 git 提交 author.name） */
function toFileCommitItem(c: {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string; avatar_url: string } | null;
}): FileCommitItem {
  return {
    sha: c.sha,
    message: c.commit.message,
    committedDate: c.commit.author?.date ?? "",
    authorLogin: c.author?.login ?? null,
    authorName: c.commit.author?.name ?? null,
    authorAvatarUrl: c.author?.avatar_url ?? null,
  };
}

/**
 * 智能获取指定文件的提交历史（blob History 页）：
 * GraphQL object(expression: branch).history(path) 分页首选（游标），失败/匿名 → 熔断降级 REST
 * listCommits(sha, path) 分页（页码）。返回 PagedFileCommits（endCursor/restPage 双轨续接）。
 */
export async function fetchFileCommitsSmart(
  owner: string,
  name: string,
  branch: string,
  path: string,
  cursor: string | null,
  restPage: number,
  token?: string | null,
): Promise<PagedFileCommits> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>): Promise<PagedFileCommits> =>
    withRestFallback(
      async () => {
        const cs = await fetchFileCommits(
          owner,
          name,
          branch,
          path,
          FILE_HISTORY_PAGE_SIZE,
          restPage,
          token,
        );
        return {
          commits: cs.map(toFileCommitItem),
          endCursor: null,
          // REST 无游标：按「批次是否拉满」判断是否还有下一页
          hasNextPage: cs.length >= FILE_HISTORY_PAGE_SIZE,
          restPage: restPage + 1,
        };
      },
      "fetchFileCommitsSmart",
      gqlResp,
    );

  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: {
            history: {
              pageInfo: { endCursor: string | null; hasNextPage: boolean };
              nodes: Array<{
                oid: string;
                message: string;
                committedDate: string;
                author: {
                  name: string | null;
                  avatarUrl: string;
                  user: { login: string } | null;
                } | null;
              }>;
            } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(
        FILE_HISTORY_QUERY,
        {
          owner,
          name,
          expression: branch,
          path,
          first: FILE_HISTORY_PAGE_SIZE,
          after: cursor ?? null,
        },
        token,
      );
      const h = resp.data?.repository?.object?.history;
      if (!hasGraphQLErrors(resp) && h) {
        return {
          commits: (h.nodes ?? []).map((n) => ({
            sha: n.oid,
            message: n.message,
            committedDate: n.committedDate,
            authorLogin: n.author?.user?.login ?? null,
            authorName: n.author?.name ?? null,
            authorAvatarUrl: n.author?.avatarUrl ?? null,
          })),
          endCursor: h.pageInfo?.endCursor ?? null,
          hasNextPage: h.pageInfo?.hasNextPage ?? false,
          restPage: null,
        };
      }
      return fromRest(resp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/** 创建仓库（smart 层入参，camelCase；GraphQL 无适配字段由 post-create PATCH 承担） */
export interface CreateRepoSmartInput {
  name: string;
  description?: string;
  homepage?: string;
  private?: boolean;
  hasIssues?: boolean;
  hasDiscussions?: boolean;
  hasWiki?: boolean;
  hasProjects?: boolean;
  autoInit?: boolean;
  gitignoreTemplate?: string;
  licenseTemplate?: string;
  allowSquashMerge?: boolean;
  allowMergeCommit?: boolean;
  allowRebaseMerge?: boolean;
  allowAutoMerge?: boolean;
  deleteBranchOnMerge?: boolean;
  isTemplate?: boolean;
  /** 目标 owner：不传/个人登录名 → 个人仓库；组织名 → 组织仓库 */
  owner?: string;
}

/** camelCase smart 入参 → REST snake_case CreateRepoInput */
function toCreateRepoInput(opts: CreateRepoSmartInput): CreateRepoInput {
  return {
    name: opts.name,
    description: opts.description,
    homepage: opts.homepage,
    private: opts.private,
    has_issues: opts.hasIssues,
    has_discussions: opts.hasDiscussions,
    has_wiki: opts.hasWiki,
    has_projects: opts.hasProjects,
    auto_init: opts.autoInit,
    gitignore_template: opts.gitignoreTemplate,
    license_template: opts.licenseTemplate,
    allow_squash_merge: opts.allowSquashMerge,
    allow_merge_commit: opts.allowMergeCommit,
    allow_rebase_merge: opts.allowRebaseMerge,
    allow_auto_merge: opts.allowAutoMerge,
    delete_branch_on_merge: opts.deleteBranchOnMerge,
    is_template: opts.isTemplate,
    owner: opts.owner,
  };
}

/** GraphQL createRepository 无适配字段（homepage/merge/is_template）→ post-create PATCH 补写 */
async function patchGapFields(
  token: string,
  fullName: string,
  opts: CreateRepoSmartInput,
): Promise<void> {
  const [o, r] = fullName.split("/");
  if (!o || !r) return;
  const patch: UpdateRepositoryFields = {};
  if (opts.homepage !== undefined) patch.homepage = opts.homepage;
  if (opts.allowSquashMerge !== undefined) patch.allow_squash_merge = opts.allowSquashMerge;
  if (opts.allowMergeCommit !== undefined) patch.allow_merge_commit = opts.allowMergeCommit;
  if (opts.allowRebaseMerge !== undefined) patch.allow_rebase_merge = opts.allowRebaseMerge;
  if (opts.allowAutoMerge !== undefined) patch.allow_auto_merge = opts.allowAutoMerge;
  if (opts.deleteBranchOnMerge !== undefined)
    patch.delete_branch_on_merge = opts.deleteBranchOnMerge;
  if (opts.isTemplate !== undefined) patch.is_template = opts.isTemplate;
  if (Object.keys(patch).length === 0) return;
  try {
    await updateRepositorySmart(o, r, token, patch);
  } catch {
    /* 增补失败不阻断创建跳转 */
  }
}

/**
 * 智能创建仓库：个人 GraphQL createRepository 首选 + REST 降级；
 * 组织（owner 非当前登录名）直接 REST POST /orgs/{org}/repos（GraphQL 需 ownerId 复杂）。
 * 返回 { name, full_name } 供跳转。
 */
export async function createRepositorySmart(
  token: string,
  opts: CreateRepoSmartInput,
  login?: string,
): Promise<{ name: string; full_name: string }> {
  const isOrg = Boolean(opts.owner && opts.owner !== login);
  // 组织仓库：REST 直接创建（全字段支持；GraphQL 需组织 node id，不引入复杂度）
  if (isOrg) {
    const r = await createRepository(token, toCreateRepoInput(opts), login);
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
          hasIssuesEnabled: opts.hasIssues,
          hasProjectsEnabled: opts.hasProjects,
          hasWikiEnabled: opts.hasWiki,
          hasDiscussionsEnabled: opts.hasDiscussions,
          autoInit: opts.autoInit ?? false,
          gitignoreTemplate: opts.gitignoreTemplate,
          licenseTemplate: opts.licenseTemplate,
        },
      },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.createRepository?.repository) {
      const r = resp.data.createRepository.repository;
      await patchGapFields(token, r.nameWithOwner, opts);
      return { name: r.name, full_name: r.nameWithOwner };
    }
    // GraphQL 失败 → 熔断降级 REST（复用 rest 层 createRepository；日志自动 ↪ 前缀）
    return withRestFallback(
      async () => {
        const r = await createRepository(token, toCreateRepoInput(opts), login);
        return { name: r.name, full_name: r.full_name };
      },
      "createRepositorySmart",
      resp,
    );
  } catch {
    // 网络层错误 → 熔断降级 REST
    return withRestFallback(
      async () => {
        const r = await createRepository(token, toCreateRepoInput(opts), login);
        return { name: r.name, full_name: r.full_name };
      },
      "createRepositorySmart",
      undefined,
    );
  }
}

/** 从模板仓库创建：GraphQL 无适配 → REST-only（红线例外），直接透传 REST createUsingTemplate。 */
export async function createRepositoryFromTemplateSmart(
  templateOwner: string,
  templateRepo: string,
  owner: string,
  name: string,
  token: string,
  opts?: { description?: string; private?: boolean },
): Promise<{ full_name: string }> {
  return createRepositoryFromTemplate(templateOwner, templateRepo, owner, name, token, opts);
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
  hasSponsorshipsEnabled?: boolean;
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
    has_sponsorships: g.hasSponsorshipsEnabled,
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
 * organization 可选：默认 fork 到本人；传组织名 → fork 到该组织；
 * name 可选：改名 fork；defaultBranchOnly 可选：仅复制默认分支。 */
export async function forkRepositorySmart(
  token: string,
  owner: string,
  repo: string,
  organization?: string,
  name?: string,
  defaultBranchOnly?: boolean,
): Promise<string> {
  const forked = await forkRepository(token, owner, repo, organization, name, defaultBranchOnly);
  return forked.full_name;
}

/**
 * 检测当前用户是否已 fork 指定仓库（精确支持改名 fork）。
 * - GraphQL 首选：viewer.repositories(isFork:true) 按 parent.nameWithOwner 精确匹配（改名后仍可识别）
 * - 失败降级 REST：同名检测 GET /repos/{login}/{repo}（改名 fork 会漏 → 页面实际 fork 时 422 由 sonner 报错）
 * 返回已 fork 的 full_name（null = 未 fork）。
 */
export async function detectExistingForkSmart(
  token: string,
  owner: string,
  repo: string,
  login: string,
): Promise<string | null> {
  const sourceFull = `${owner}/${repo}`.toLowerCase();
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => fetchRepository(login, repo, token).then((r) => r.full_name),
      "detectExistingForkSmart",
      gqlResp,
    ).catch(() => null);
  try {
    const resp: GraphQLResponse<{
      viewer: {
        repositories: {
          nodes: Array<{ nameWithOwner: string; parent: { nameWithOwner: string } | null }>;
          pageInfo: { hasNextPage: boolean };
        };
      };
    }> = await graphqlRequest(VIEWER_FORK_DETECT_QUERY, {}, token);
    if (!hasGraphQLErrors(resp) && resp.data?.viewer?.repositories) {
      const match = resp.data.viewer.repositories.nodes.find(
        (n) => n.parent?.nameWithOwner.toLowerCase() === sourceFull,
      );
      return match?.nameWithOwner ?? null;
    }
    return fromRest(resp);
  } catch {
    return fromRest(undefined);
  }
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

  // 字段分流：graph 可处理 vs rest-only 增补（GraphQL updateRepository mutation 无这些字段）
  const REST_ONLY_KEYS = [
    "private",
    "default_branch",
    "allow_squash_merge",
    "allow_merge_commit",
    "allow_rebase_merge",
    "allow_auto_merge",
    "delete_branch_on_merge",
    "is_template",
    "allow_update_branch",
    "allow_forking",
    "web_commit_signoff_required",
    "merge_commit_title",
    "merge_commit_message",
    "squash_merge_commit_title",
    "squash_merge_commit_message",
    "security_and_analysis",
  ] as const;
  const restOnly: UpdateRepositoryFields = {};
  let hasRestOnly = false;
  for (const key of REST_ONLY_KEYS) {
    if (fields[key] !== undefined) {
      (restOnly as Record<string, unknown>)[key] = fields[key];
      hasRestOnly = true;
    }
  }

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
  if (fields.has_sponsorships !== undefined)
    graphVars.hasSponsorshipsEnabled = fields.has_sponsorships;
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

/** 设置 web 提交签名：GraphQL updateRepositoryWebCommitSignoffSetting 首选（UpdateRepositoryInput 无此字段，
 * 走独立 mutation），失败降级 REST PATCH web_commit_signoff_required。 */
export async function setWebCommitSignoffSmart(
  owner: string,
  repo: string,
  enabled: boolean,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        await updateRepository(owner, repo, token, { web_commit_signoff_required: enabled });
      },
      "setWebCommitSignoffSmart",
      gqlResp,
    );
  if (!token) return fromRest(undefined);
  try {
    const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    const repositoryId = idResp.data?.repository?.id;
    if (!repositoryId || hasGraphQLErrors(idResp)) return fromRest(idResp);
    const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
      UPDATE_REPOSITORY_WEB_COMMIT_SIGNOFF_SETTING_MUTATION,
      { repositoryId, webCommitSignoffRequired: enabled },
      token,
    );
    if (hasGraphQLErrors(mutResp)) return fromRest(mutResp);
  } catch {
    return fromRest(undefined);
  }
}

// ===== GraphQL 无适配的仓库级写操作（REST-only 红线例外，smart 层透明转发）=====

/** 检查 immutable releases 是否启用（GraphQL 无对应字段 → REST-only） */
export async function checkImmutableReleasesSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<boolean> {
  return checkImmutableReleases(owner, repo, token);
}

/** 启用/禁用 immutable releases（GraphQL 无对应字段 → REST-only） */
export async function setImmutableReleasesSmart(
  owner: string,
  repo: string,
  enabled: boolean,
  token: string,
): Promise<void> {
  if (enabled) await enableImmutableReleases(owner, repo, token);
  else await disableImmutableReleases(owner, repo, token);
}

/** 重命名分支（GraphQL 无对应 mutation → REST-only） */
export async function renameBranchSmart(
  owner: string,
  repo: string,
  branch: string,
  newName: string,
  token: string,
): Promise<void> {
  return renameBranch(owner, repo, branch, newName, token);
}

/** 删除分支保护规则（GraphQL 无对应 mutation → REST-only） */
export async function deleteBranchProtectionSmart(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<void> {
  return deleteBranchProtection(owner, repo, branch, token);
}
