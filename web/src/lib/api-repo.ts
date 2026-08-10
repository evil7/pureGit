/**
 * GitHub API smart layer - repo (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  REPOSITORY_QUERY,
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
  fetchLanguages,
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
} from "./rest";
import { FILE_RAW_QUERY, FILE_EDIT_QUERY } from "./repo-raw";
import { fetchRawContentSmart } from "./raw-proxy";
import type { Repository, RepoSubscription, SecurityAdvisory, ReadmeInfo } from "./rest";

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
  } catch {
    // 降级 REST
  }
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
      // GraphQL 返回 errors → 落入 REST
    } catch {
      // GraphQL 不可达/超时 → 落入 REST
    }
  }

  // ---- 降级 REST ----
  const [data, langs] = await Promise.all([
    fetchRepository(owner, name, token),
    fetchLanguages(owner, name, token).catch(() => ({})),
  ]);
  return { data, langs };
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
  } catch {
    // 降级 REST（返回 null，由调用方走 REST）
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
    } catch {
      // 降级 REST
    }
  }
  // ---- 降级 REST ----
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
    } catch {
      // 降级 REST
    }
  }
  // ---- 降级 REST ----
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
    } catch {
      // 降级 REST
    }
  }
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
    } catch {
      // 降级 REST
    }
  }
  // REST 降级需 token（fetchRepoTopics 签名要求 string）
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
    }
  } catch {
    // 降级 REST
  }
  return replaceRepoTopics(owner, repo, token, names);
}

/** 智能查询仓库订阅状态：GraphQL viewerSubscription（REPOSITORY_QUERY）首选，失败降级 REST。 */
export async function fetchRepoSubscriptionSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<RepoSubscription> {
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
  } catch {
    // 降级 REST
  }
  return fetchRepoSubscription(owner, repo, token);
}

/** 智能设置仓库订阅：GraphQL updateSubscription 首选（需 repositoryId），失败降级 REST。 */
export async function setRepoSubscriptionSmart(
  owner: string,
  repo: string,
  token: string,
  body: { subscribed?: boolean; ignored?: boolean },
): Promise<RepoSubscription> {
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
    }
  } catch {
    // 降级 REST
  }
  return setRepoSubscription(owner, repo, token, body);
}

/** 智能删除仓库：GraphQL deleteRepository 首选（需 repositoryId），失败降级 REST。 */
export async function deleteRepositorySmart(
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
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
    }
  } catch {
    // 降级 REST
  }
  await deleteRepository(owner, repo, token);
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
