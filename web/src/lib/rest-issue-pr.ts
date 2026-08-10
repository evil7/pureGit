/**
 * GitHub REST API - issue-pr（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import { typedRequest } from "./rest-core";
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
  /** 里程碑（仅详情/部分列表提供） */
  milestone?: { title: string } | null;
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
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  draft?: boolean;
  head?: { ref: string; label: string; sha?: string };
  base?: { ref: string; label: string; sha?: string };
  /** 指派人（GraphQL 映射或 REST 原生；仅详情/部分列表提供） */
  assignees?: { login: string; avatar_url?: string }[];
  /** 里程碑（仅详情/部分列表提供） */
  milestone?: { title: string } | null;
  /** 标签（GraphQL 映射；仅列表提供） */
  labels?: { name: string; color: string }[];
  /** 当前用户订阅状态（GraphQL viewerSubscription） */
  subscription?: string | null;
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
    if (runs.length === 0) return null;
    const summary: CheckRunsSummary = { total: runs.length, success: 0, failure: 0, pending: 0 };
    for (const r of runs) {
      if (r.status !== "completed") summary.pending++;
      else if (r.conclusion === "success") summary.success++;
      else if (
        r.conclusion === "failure" ||
        r.conclusion === "cancelled" ||
        r.conclusion === "timed_out"
      )
        summary.failure++;
      else summary.pending++; // neutral/skipped/stale 视为非失败
    }
    return summary;
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
  body: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  path: string;
  /** 评论所在行号（当前版本行） */
  line: number;
  /** LEFT=旧文件 / RIGHT=新文件 */
  side: "LEFT" | "RIGHT";
  html_url?: string;
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
): Promise<PullRequest[]> {
  return typedRequest<PullRequest[]>(token, (octokit) =>
    octokit.rest.pulls.list({ owner, repo, state, per_page: perPage, page }),
  );
}

/** PR 详情 */
export async function fetchPullDetail(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullRequest> {
  return typedRequest<PullRequest>(token, (octokit) =>
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
  );
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
 * 获取 PR 变更文件列表。
 * 注：GraphQL pullRequest.files 不返回 unified diff patch → 仅 REST（双端降级不适用）。
 */
export async function fetchPullFiles(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<PullFile[]> {
  return typedRequest<PullFile[]>(token, (octokit) =>
    octokit.rest.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 }),
  );
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
