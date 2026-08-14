/**
 * GitHub REST API - issue-pr（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import { typedRequest, fetchWithTimeout, GITHUB_API, ApiError } from "./rest-core";
import type { GitHubUser } from "./rest-core";

// ===== M3 写操作 API（需 token）=====

/** 创建 issue */
export async function createIssue(
  token: string,
  owner: string,
  repo: string,
  body: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  },
): Promise<Issue> {
  return typedRequest<Issue>(token, (octokit) =>
    octokit.rest.issues.create({ owner, repo, ...body }),
  );
}

/** 创建 PR */
export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  body: { title: string; body?: string; head: string; base: string },
): Promise<PullRequest> {
  return typedRequest<PullRequest>(token, (octokit) =>
    octokit.rest.pulls.create({ owner, repo, ...body }),
  );
}

/** fork 仓库（返回 fork 后的仓库） */
// ===== M2 浏览功能 API =====

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  /** 关注者/订阅者数（watch 计数） */
  subscribers_count?: number;
  /** open issues 数（REST open_issues_count 官方含 PRs 合计；GraphQL openIssues.totalCount 精确） */
  open_issues_count?: number;
  /** open PRs 数（GraphQL openPullRequests.totalCount；REST 需 pulls?state=open 独立精确） */
  open_pulls_count?: number;
  language: string | null;
  topics?: string[];
  updated_at: string;
  pushed_at: string;
  license?: { spdx_id: string } | null;
  default_branch: string;
  private: boolean;
  /** 是否 fork 仓库（REST fork / GraphQL isFork） */
  fork?: boolean;
  /** fork 上游（REST parent / GraphQL parent；非 fork 时 null） */
  parent?: {
    full_name: string;
    default_branch?: string;
    owner?: { login: string };
  } | null;
  /** 是否已归档（只读仓库；官方 archive 语义） */
  archived?: boolean;
  /** 归档日期（REST archived_at / GraphQL archivedAt；未归档 null） */
  archived_at?: string | null;
  /** 仓库大小（KB；GraphQL diskUsage 或 REST size，可能缺失） */
  size?: number;
  /** 当前登录用户是否已 star（GraphQL viewerHasStarred；REST 无此字段时 undefined） */
  viewer_has_starred?: boolean;
  /** 当前登录用户订阅状态（GraphQL viewerSubscription：SUBSCRIBED/IGNORED/UNSUBSCRIBED；REST 无此字段时 undefined） */
  viewer_subscription?: string | null;
  /** Features（设置页开关；REST 有 has_* 字段，GraphQL has*Enabled） */
  has_issues?: boolean;
  has_discussions?: boolean;
  has_wiki?: boolean;
  has_projects?: boolean;
}

export interface SearchResponse<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  body: string | null;
  labels?: { name: string; color: string }[];
  pull_request?: unknown; // 有该字段则为 PR
  /** 所属仓库（仅跨仓库搜索结果提供） */
  repository?: { full_name: string };
  /** 指派人（GraphQL 映射或 REST 原生；仅详情/部分列表提供） */
  assignees?: { login: string; avatar_url?: string }[];
  /** 里程碑（仅详情/部分列表提供；number 供侧栏编辑清除/保持） */
  milestone?: { title: string; number?: number } | null;
  /** 当前用户订阅状态（GraphQL viewerSubscription；SUBSCRIBED/UNSUBSCRIBED/IGNORED） */
  subscription?: string | null;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  body: string | null;
  merged_at: string | null;
  comments: number;
  /** 行内评审评论数（REST 详情原生 review_comments；GraphQL 详情不映射，Conversation 计数降级用） */
  review_comments?: number;
  /** 总评论数（GraphQL totalCommentsCount 官方字段；REST 降级 = comments + review_comments） */
  total_comments?: number;
  /** CI check-runs 汇总（GraphQL 列表批量内联 statusCheckRollup 携带；REST/search 列表无此字段 = undefined，行组件回退单查） */
  checks?: CheckRunsSummary | null;
  commits: number;
  /** 关联 issue 数（GraphQL closingIssuesReferences；REST 原生无此字段，undefined 时列表不渲染） */
  linked_issues?: number;
  additions: number;
  deletions: number;
  changed_files: number;
  draft?: boolean;
  head?: { ref: string; label: string; sha?: string };
  base?: { ref: string; label: string; sha?: string };
  /** 指派人（GraphQL 映射或 REST 原生；仅详情/部分列表提供） */
  assignees?: { login: string; avatar_url?: string }[];
  /** 里程碑（仅详情/部分列表提供；number 供侧栏编辑清除/保持） */
  milestone?: { title: string; number?: number } | null;
  /** 标签（GraphQL 映射；仅列表提供） */
  labels?: { name: string; color: string }[];
  /** 当前用户订阅状态（GraphQL viewerSubscription） */
  subscription?: string | null;
  /** 对话是否锁定（issues/lock；REST 详情原生字段） */
  locked?: boolean;
}

/** check-run 状态（GET /repos/{o}/{r}/commits/{sha}/check-runs） */
export interface CheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
}

/** check-runs 汇总（供 PR 行 CI 进度显示） */
export interface CheckRunsSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
}

/** check-run 归一化输入（GraphQL statusCheckRollup CheckRun / REST check_runs 共用；状态枚举大小写统一转大写比较） */
export interface CheckRunLike {
  status: string | null;
  conclusion: string | null;
}

/**
 * check-run 列表 → 汇总（空列表 → null）。
 * GraphQL（statusCheckRollup.contexts）与 REST（check_runs）两通道共用：
 * 状态枚举大小写不同（COMPLETED vs completed）→ 统一 toUpperCase 比较。
 */
export function toCheckRunsSummary(
  nodes: CheckRunLike[] | undefined | null,
): CheckRunsSummary | null {
  if (!nodes || nodes.length === 0) return null;
  const summary: CheckRunsSummary = { total: nodes.length, success: 0, failure: 0, pending: 0 };
  for (const r of nodes) {
    const status = (r.status ?? "").toUpperCase();
    const conclusion = (r.conclusion ?? "").toUpperCase();
    if (status !== "COMPLETED") summary.pending++;
    else if (conclusion === "SUCCESS") summary.success++;
    else if (conclusion === "FAILURE" || conclusion === "CANCELLED" || conclusion === "TIMED_OUT")
      summary.failure++;
    else summary.pending++; // neutral/skipped/stale/action_required 视为非失败
  }
  return summary;
}

/**
 * 获取 PR head commit 的 check-runs（CI 状态；GET /repos/{o}/{r}/commits/{sha}/check-runs）。
 * 无 checks / 404 返回 null（官方显示无 checks）。
 */
export async function fetchPullCheckRuns(
  owner: string,
  repo: string,
  sha: string,
  token?: string | null,
): Promise<CheckRunsSummary | null> {
  try {
    const resp = await typedRequest<{
      total_count: number;
      check_runs: CheckRun[];
    }>(token, (octokit) =>
      octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: sha,
        per_page: 100,
      }),
    );
    const runs = resp.check_runs ?? [];
    return toCheckRunsSummary(runs);
  } catch {
    return null; // 404（无 checks）/ 网络错误 → 不显示
  }
}

/** issue/PR 评论（GET /repos/{o}/{r}/issues/{n}/comments） */
export interface IssueComment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: GitHubUser;
  html_url: string;
}

/** 仓库 label（GET /repos/{o}/{r}/labels） */
export interface RepoLabel {
  id: number;
  name: string;
  color: string;
  description?: string | null;
}

/** 获取仓库 labels（新建 issue 预选用；需 read 权限） */
export async function fetchRepoLabels(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoLabel[]> {
  return typedRequest<RepoLabel[]>(token, (octokit) =>
    octokit.rest.issues.listLabelsForRepo({ owner, repo, per_page: 100 }),
  );
}

/** 可指派给本仓库的用户（GET /repos/{o}/{r}/assignees；需 write 权限） */
export async function fetchRepoAssignees(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<GitHubUser[]> {
  return typedRequest<GitHubUser[]>(token, (octokit) =>
    octokit.rest.issues.listAssignees({ owner, repo, per_page: 100 }),
  );
}

/** 仓库里程碑（GET /repos/{o}/{r}/milestones；侧栏 Set milestone 编辑弹窗数据源） */
export interface RepoMilestone {
  number: number;
  title: string;
  state: string;
  description?: string | null;
}
export async function fetchRepoMilestones(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoMilestone[]> {
  return typedRequest<RepoMilestone[]>(token, (octokit) =>
    octokit.rest.issues.listMilestones({ owner, repo, state: "open", per_page: 100 }),
  );
}

/** 从分页 Link header 解析最后一页页码（统计总数用，避免全量拉取） */
function lastPageFromLink(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

/** 仓库 Labels 总数（per_page=1 读 Link header 末页；失败/限流返回 null） */
export async function fetchRepoLabelCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`${GITHUB_API}/repos/${owner}/${repo}/labels?per_page=1`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return null;
  }
}

/** 仓库 Milestones 总数（per_page=1 读 Link header 末页；失败/限流返回 null） */
export async function fetchRepoMilestoneCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/repos/${owner}/${repo}/milestones?per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return null;
  }
}

/** 更新 PR 指派（add-assignees + remove-assignees 组合；assignees 登录名数组） */
export async function updatePullAssignees(
  owner: string,
  repo: string,
  number: number,
  add: string[],
  remove: string[],
  token: string,
): Promise<void> {
  if (add.length) {
    await typedRequest(token, (octokit) =>
      octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: number,
        assignees: add,
      }),
    );
  }
  if (remove.length) {
    await typedRequest(token, (octokit) =>
      octokit.rest.issues.removeAssignees({
        owner,
        repo,
        issue_number: number,
        assignees: remove,
      }),
    );
  }
}

/** 更新 PR 标签（set-labels 全量替换；labels 名称数组） */
export async function updatePullLabels(
  owner: string,
  repo: string,
  number: number,
  labels: string[],
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.setLabels({ owner, repo, issue_number: number, labels }),
  );
}

/** 更新 PR 里程碑（update milestone 字段；milestone 传里程碑 number，null 清除） */
export async function updatePullMilestone(
  owner: string,
  repo: string,
  number: number,
  milestone: number | null,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.update({ owner, repo, issue_number: number, milestone }),
  );
}

/** 锁定/解锁对话（issues/lock|unlock 对 PR 同样适用；官方侧栏 Lock conversation） */
export async function lockPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.lock({ owner, repo, issue_number: number }),
  );
}
export async function unlockPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.unlock({ owner, repo, issue_number: number }),
  );
}

/** 获取 issue/PR 的评论列表（PR 的 issue 评论与 issue 同一端点；无需额外 scope） */
export async function fetchIssueComments(
  owner: string,
  repo: string,
  number: number,
  token: string | null,
): Promise<IssueComment[]> {
  return typedRequest<IssueComment[]>(token, (octokit) =>
    octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100 }),
  );
}

/** 发表 issue/PR 评论（需 write 权限；POST /repos/{o}/{r}/issues/{n}/comments） */
export async function addIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
  token: string,
): Promise<IssueComment> {
  return typedRequest<IssueComment>(token, (octokit) =>
    octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body,
    }),
  );
}

/** PR 行内评审评论（GET /repos/{o}/{r}/pulls/{n}/comments） */
export interface ReviewComment {
  id: number;
  /** GraphQL node id（REST 通道无此字段；GraphQL 评论无 REST database id、id 固定 -1 → 唯一 key 用 nodeId） */
  nodeId?: string;
  body: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  path: string;
  /** 评论所在行号（当前版本行） */
  line: number;
  /** LEFT=旧文件 / RIGHT=新文件 */
  side: "LEFT" | "RIGHT";
  html_url?: string;
  /** 所属线程 id（GraphQL reviewThread；REST 无此字段时 undefined——仅线程解决 UI 用） */
  threadId?: string;
  /** 线程是否已解决（GraphQL reviewThread.isResolved） */
  threadResolved?: boolean;
}

export async function fetchPullReviewComments(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<ReviewComment[]> {
  return typedRequest<ReviewComment[]>(token, (octokit) =>
    octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    }),
  );
}

/** 发表 PR 行内评审评论（需 write 权限；POST /repos/{o}/{r}/pulls/{n}/comments） */
export async function addPullReviewComment(
  owner: string,
  repo: string,
  number: number,
  params: {
    body: string;
    commit_id: string;
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
  },
  token: string,
): Promise<ReviewComment> {
  return typedRequest<ReviewComment>(token, (octokit) =>
    octokit.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: number,
      ...params,
    }),
  );
}

/**
 * 关闭 / 重新打开 issue（需 write 权限；PATCH /repos/{o}/{r}/issues/{n}）。
 * state: "closed" | "open"。
 */
export async function updateIssueState(
  owner: string,
  repo: string,
  number: number,
  state: "closed" | "open",
  token: string,
): Promise<Issue> {
  return typedRequest<Issue>(token, (octokit) =>
    octokit.rest.issues.update({ owner, repo, issue_number: number, state }),
  );
}

/**
 * 获取当前用户对 issue 的订阅状态（GET /repos/{o}/{r}/issues/{n}/subscription）。
 * 未订阅返回 404 → null（官方「Subscribe」未激活态）。
 * 注：Octokit 无此端点类型化方法（仅 enterprise/plan subscription）→ 用 SDK 原生 request 模板。
 */
export async function fetchIssueSubscription(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{ subscribed: boolean; ignored: boolean } | null> {
  try {
    return await typedRequest<{ subscribed: boolean; ignored: boolean }>(token, (octokit) =>
      octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/subscription", {
        owner,
        repo,
        issue_number: number,
      }),
    );
  } catch {
    return null; // 404 = 未订阅
  }
}

/** 订阅 issue（PUT /repos/{o}/{r}/issues/{n}/subscription，需 write 权限） */
export async function subscribeIssue(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{ subscribed: boolean; ignored: boolean }> {
  return typedRequest<{ subscribed: boolean; ignored: boolean }>(token, (octokit) =>
    octokit.request("PUT /repos/{owner}/{repo}/issues/{issue_number}/subscription", {
      owner,
      repo,
      issue_number: number,
      subscribed: true,
    }),
  );
}

/** 取消订阅 issue（DELETE /repos/{o}/{r}/issues/{n}/subscription，需 write 权限） */
export async function unsubscribeIssue(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/subscription", {
      owner,
      repo,
      issue_number: number,
    }),
  );
}

/** 仓库内 issues 列表（排除 PR） */
export async function fetchIssues(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  perPage = 30,
  token?: string | null,
  filters?: {
    author?: string;
    assignee?: string;
    labels?: string;
    sort?: string;
    q?: string;
  },
  page = 1,
): Promise<Issue[]> {
  const params = { state, per_page: perPage, page } as Record<string, string | number>;
  if (filters?.author) params.creator = filters.author;
  if (filters?.assignee) params.assignee = filters.assignee;
  if (filters?.labels) params.labels = filters.labels;
  if (filters?.sort) params.sort = filters.sort;
  if (filters?.q) params.q = filters.q;
  const items = await typedRequest<Issue[]>(token, (octokit) =>
    octokit.rest.issues.listForRepo({ owner, repo, ...params }),
  );
  return items.filter((i) => !i.pull_request);
}

/** 仓库协作者（@ 补全数据源；GET /repos/{o}/{r}/collaborators，仅登录可见） */
export interface Collaborator {
  login: string;
  avatar_url: string;
}

export async function fetchCollaborators(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Collaborator[]> {
  return typedRequest<Collaborator[]>(token, (octokit) =>
    octokit.rest.repos.listCollaborators({ owner, repo, per_page: 100 }),
  );
}

/** 仓库贡献者（@ 补全数据源·公开；GET /repos/{o}/{r}/contributors，无需权限） */
export interface Contributor {
  login: string;
  avatar_url: string;
}

export async function fetchContributors(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Contributor[]> {
  return typedRequest<Contributor[]>(token, (octokit) =>
    octokit.rest.repos.listContributors({ owner, repo, per_page: 100 }),
  );
}

/** issue 详情 */
export async function fetchIssueDetail(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<Issue> {
  return typedRequest<Issue>(token, (octokit) =>
    octokit.rest.issues.get({ owner, repo, issue_number: number }),
  );
}

/** 仓库内 PR 列表 */
export async function fetchPulls(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  perPage = 30,
  token?: string | null,
  page = 1,
  sort?: "created" | "updated" | "popularity" | "long-running",
  direction?: "asc" | "desc",
): Promise<PullRequest[]> {
  return typedRequest<PullRequest[]>(token, (octokit) =>
    octokit.rest.pulls.list({
      owner,
      repo,
      state,
      per_page: perPage,
      page,
      ...(sort ? { sort, ...(direction ? { direction } : {}) } : {}),
    }),
  );
}

/** PR 详情 */
export async function fetchPullDetail(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullRequest> {
  // REST 原生 comments 仅计 issue 评论、review_comments 计行内评审评论 → 合计为总评论数
  // （对齐 GraphQL totalCommentsCount；Conversation tab 计数统一用 total_comments）
  const pr = await typedRequest<PullRequest>(token, (octokit) =>
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
  );
  return {
    ...pr,
    total_comments: (pr.comments ?? 0) + (pr.review_comments ?? 0),
  };
}

// ===== 用户级导航（Issues/Pulls/Notifications/Feed）=====
// ===== PR 变更文件（Files changed，GET /pulls/{n}/files）=====

/** PR 变更文件（REST GET /pulls/{number}/files 返回结构，精简） */
export interface PullFile {
  filename: string;
  status: string; // added / removed / modified / renamed / copied / changed
  additions: number;
  deletions: number;
  changes: number;
  /** unified diff 文本（超大文件可能省略，需 `application/vnd.github.diff` 的为 null） */
  patch?: string;
  raw_url?: string;
  /** 重命名/复制时提供旧路径 */
  previous_filename?: string;
}

/**
 * 分页获取 PR 变更文件列表（每页默认 5 个，Files changed tab 用「加载更多」逐步加载，
 * 避免大 PR 一次全量拉取卡死——unified diff patch 是大体积数据）。
 * 注：GraphQL pullRequest.files 不返回 unified diff patch → 仅 REST（双端降级不适用）。
 * hasMore 用 Link 头 `rel="next"` 精确判断（页满判断在恰好整页时误报多一次空请求）——
 * Link 头解析属特殊语义端点，走 fetchWithTimeout 底层通道（开发规范 8 豁免项）。
 */
export async function fetchPullFiles(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
  page = 1,
  perPage = 5,
): Promise<{ items: PullFile[]; hasMore: boolean }> {
  const res = await fetchWithTimeout(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=${perPage}&page=${page}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  const items = (await res.json()) as PullFile[];
  const link = res.headers.get("link");
  return { items, hasMore: link?.includes('rel="next"') ?? false };
}

// ===== PR commits（GET /pulls/{n}/commits）=====

/** PR commit（REST GET /pulls/{number}/commits 返回结构，精简） */
export interface PullCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: { login: string; avatar_url: string } | null;
  committer: { login: string } | null;
}

/**
 * 获取 PR commit 列表（GET /pulls/{number}/commits）。
 * 供 PR 详情 Commits tab 使用。
 */
export async function fetchPullCommits(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullCommit[]> {
  return typedRequest<PullCommit[]>(token, (octokit) =>
    octokit.rest.pulls.listCommits({ owner, repo, pull_number: number, per_page: 100 }),
  );
}

// ===== PR 评审工作流（Review / Merge / Request reviewers）=====

/** 评审提交（REST GET /pulls/{n}/reviews 返回结构，精简） */
export interface PullReview {
  id: number;
  user: { login: string; avatar_url: string } | null;
  body: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at?: string;
  commit_id?: string;
}

/**
 * 获取 PR 评审列表（GET /pulls/{number}/reviews）。
 * 供 PR 详情 Reviewers 栏 / 评审摘要展示。
 */
export async function fetchPullReviews(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullReview[]> {
  return typedRequest<PullReview[]>(token, (octokit) =>
    octokit.rest.pulls.listReviews({ owner, repo, pull_number: number, per_page: 100 }),
  );
}

/**
 * 获取请求的评审者（GET /pulls/{n}/requested_reviewers）。
 * 返回 SimpleUser[] | Team[] union——仅保留有 login 的 User（Team 无 login，用 name 标识，降级路径忽略）。
 * 供 PR 详情 Reviewers 栏 reviewRequests 的 REST 熔断降级。
 */
export async function fetchPullRequestedReviewers(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<{ login: string; avatarUrl: string }[]> {
  const list = await typedRequest<
    Array<{ login?: string; avatar_url?: string | null; name?: string }>
  >(token, (octokit) =>
    octokit.rest.pulls.listRequestedReviewers({ owner, repo, pull_number: number }),
  );
  return list
    .filter((x): x is { login: string; avatar_url?: string | null } => Boolean(x.login))
    .map((x) => ({ login: x.login, avatarUrl: x.avatar_url ?? "" }));
}

/** 评审事件（三态提交：COMMENT 普通留言 / APPROVE 批准 / REQUEST_CHANGES 请求修改） */
export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** 提交评审（POST /pulls/{n}/reviews；event + body，可附带行内评论 comments） */
export interface CreatePullReviewParams {
  event: ReviewEvent;
  body?: string;
  /** 附带的行内评论（与本次评审一起提交） */
  comments?: {
    body: string;
    path: string;
    line?: number;
    side?: "LEFT" | "RIGHT";
  }[];
}

export async function createPullReview(
  owner: string,
  repo: string,
  number: number,
  params: CreatePullReviewParams,
  token: string,
): Promise<PullReview> {
  return typedRequest<PullReview>(token, (octokit) =>
    octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      event: params.event,
      ...(params.body ? { body: params.body } : {}),
      ...(params.comments?.length ? { comments: params.comments } : {}),
    }),
  );
}

/** 合并 PR（PUT /pulls/{n}/merge；仅 REST——GraphQL mergePullRequest 语义需 node id 且无可靠降级映射） */
export type PullMergeMethod = "merge" | "squash" | "rebase";

/** 合并 PR：commit_title/commit_message 可选；409 不可合并/405 分支保护抛出 ApiError */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  method: PullMergeMethod,
  token: string,
  opts?: { commit_title?: string; commit_message?: string },
): Promise<{ merged: boolean; message: string }> {
  return typedRequest<{ merged: boolean; message: string }>(token, (octokit) =>
    octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: number,
      merge_method: method,
      ...(opts?.commit_title ? { commit_title: opts.commit_title } : {}),
      ...(opts?.commit_message ? { commit_message: opts.commit_message } : {}),
    }),
  );
}

/** 请求评审者（POST /pulls/{n}/requested_reviewers；reviewers 登录名数组） */
export async function requestReviewers(
  owner: string,
  repo: string,
  number: number,
  reviewers: string[],
  token: string,
): Promise<unknown> {
  return typedRequest(token, (octokit) =>
    octokit.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: number,
      reviewers,
    }),
  );
}

/** 移除请求的评审者（DELETE /pulls/{n}/requested_reviewers） */
export async function removeRequestedReviewer(
  owner: string,
  repo: string,
  number: number,
  reviewer: string,
  token: string,
): Promise<unknown> {
  return typedRequest(token, (octokit) =>
    octokit.rest.pulls.removeRequestedReviewers({
      owner,
      repo,
      pull_number: number,
      reviewers: [reviewer],
    }),
  );
}

/** 更新 PR 状态（PATCH /pulls/{n}；关闭/重新打开，保留 title/body 不变） */
export async function updatePullRequestState(
  owner: string,
  repo: string,
  number: number,
  state: "open" | "closed",
  token: string,
): Promise<PullRequest> {
  return typedRequest<PullRequest>(token, (octokit) =>
    octokit.rest.pulls.update({ owner, repo, pull_number: number, state }),
  );
}
