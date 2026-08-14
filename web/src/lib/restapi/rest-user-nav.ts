/**
 * GitHub REST API - user-nav（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface.
 */

import { typedRequest, ApiError } from "./rest-core";
import type { GitHubUser } from "./rest-core";
import type { Repository, SearchResponse, Issue } from "./rest-issue-pr";

// ===== 用户级导航（Issues/Pulls/Notifications/Feed）=====

/**
 * 用户级 All issues：GET /issues（需登录，返回所有仓库中我创建/参与的 issue 与 PR）。
 * 注意：REST /issues 返回混合（含 PR），此处仅保留非 PR 项。
 * filter 对应官方 /issues/{tab}：assigned（分配给我）/ created（我创建）/ mentioned（提到我）/ recent（最近活动）。
 */
export async function fetchMyIssues(
  token: string,
  filter: "assigned" | "created" | "mentioned" | "recent" = "created",
  perPage = 20,
  page = 1,
): Promise<Issue[]> {
  const items = await typedRequest<Issue[]>(token, (octokit) =>
    octokit.rest.issues.listForAuthenticatedUser({
      // REST filter 无 recent（本地取最近活跃）；映射为 all 语义（全部含参与）
      filter: filter === "recent" ? "all" : filter,
      sort: "created",
      direction: "desc",
      per_page: perPage,
      page,
    }),
  );
  return items.filter((i) => !i.pull_request);
}

/**
 * 用户级 All PRs：search `is:pr ...`（需登录；REST 无用户级 /pulls 端点）。
 * filter 对应官方 /pulls/{nav}：inbox（默认全部）/ authored / assigned / involves / reviews（review-requested）。
 */
export async function fetchMyPulls(
  token: string,
  filter: "inbox" | "authored" | "assigned" | "involves" | "reviews" = "inbox",
  perPage = 20,
  page = 1,
): Promise<Issue[]> {
  const qualifier =
    filter === "authored"
      ? "author:@me"
      : filter === "assigned"
        ? "assignee:@me"
        : filter === "involves"
          ? "involves:@me"
          : filter === "reviews"
            ? "review-requested:@me"
            : "";
  const q = `is:pr${qualifier ? `+${qualifier}` : ""}`;
  const data = await typedRequest<SearchResponse<Issue>>(token, (octokit) =>
    octokit.rest.search.issuesAndPullRequests({
      q,
      sort: "created",
      order: "desc",
      per_page: perPage,
      page,
    }),
  );
  return data.items;
}

/** 用户级 Gist 列表：GET /gists（需登录，含私有 gist） */
export interface GistFile {
  filename: string;
  type: string;
  language: string | null;
  size: number;
  raw_url: string;
  /** 仅详情接口（GET /gists/{id}）提供 */
  content?: string;
}

export interface Gist {
  id: string;
  description: string | null;
  html_url: string;
  public: boolean;
  created_at: string;
  updated_at: string;
  /** 评论数（列表/详情接口均返回） */
  comments?: number;
  files: Record<string, GistFile>;
  owner?: { login: string; avatar_url: string };
}

export async function fetchMyGists(token: string, perPage = 20, page = 1): Promise<Gist[]> {
  return typedRequest<Gist[]>(token, (octokit) =>
    octokit.rest.gists.list({ per_page: perPage, page }),
  );
}

/** Gist 详情：GET /gists/{id}（需 token 访问私有 gist；files 含 content） */
export async function fetchGistDetail(id: string, token?: string | null): Promise<Gist> {
  return typedRequest<Gist>(token, (octokit) => octokit.rest.gists.get({ gist_id: id }));
}

/** 创建 Gist：POST /gists（需 gist scope） */
export async function createGist(
  token: string,
  opts: {
    description?: string;
    public?: boolean;
    files: Record<string, { content: string }>;
  },
): Promise<Gist> {
  return typedRequest<Gist>(token, (octokit) =>
    octokit.rest.gists.create({
      description: opts.description,
      public: opts.public ?? true,
      files: opts.files,
    }),
  );
}

/** 更新 Gist：PATCH /gists/{id}（需 gist scope） */
export async function updateGist(
  token: string,
  id: string,
  opts: {
    description?: string;
    files?: Record<string, { content: string } | null>;
  },
): Promise<Gist> {
  return typedRequest<Gist>(token, (octokit) =>
    octokit.rest.gists.update({
      gist_id: id,
      description: opts.description,
      files: opts.files as Record<string, { content?: string }> | undefined,
    }),
  );
}

/** 是否已 star 该 gist（GET /gists/{id}/star：204=已 star / 404=未；需 gist scope） */
export async function isGistStarred(id: string, token: string): Promise<boolean> {
  try {
    await typedRequest<void>(token, (octokit) =>
      octokit.rest.gists.checkIsStarred({ gist_id: id }),
    );
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

/** Gist fork 列表（计数用：GET /gists/{id}/forks；需 gist scope） */
export async function fetchGistForks(id: string, token: string): Promise<Gist[]> {
  return typedRequest<Gist[]>(token, (octokit) =>
    octokit.rest.gists.listForks({ gist_id: id, per_page: 100 }),
  );
}

/** star 该 gist（PUT /gists/{id}/star，204 成功；需 gist scope） */
export async function starGist(id: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.gists.star({ gist_id: id }));
}

/** 取消 star gist（DELETE /gists/{id}/star，204 成功；需 gist scope） */
export async function unstarGist(id: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.gists.unstar({ gist_id: id }));
}

/** 用户级通知列表：GET /notifications（需登录） */
export interface Notification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string; html_url: string };
}

export async function fetchNotifications(
  token: string,
  perPage = 20,
  page = 1,
): Promise<Notification[]> {
  return typedRequest<Notification[]>(token, (octokit) =>
    octokit.rest.activity.listNotificationsForAuthenticatedUser({
      per_page: perPage,
      page,
    }),
  );
}

// ===== 协作邀请（GET /user/repository_invitations）=====

/** 仓库协作邀请（别人邀请我成为协作者） */
export interface RepositoryInvitation {
  id: number;
  repository: {
    full_name: string;
    name: string;
    owner: { login: string; avatar_url: string };
    html_url: string;
    private: boolean;
  };
  inviter: { login: string; avatar_url: string; html_url: string } | null;
  permissions: "read" | "write" | "admin";
  created_at: string;
  expired?: boolean;
}

/** 列出协作邀请：GET /user/repository_invitations（repo scope 即可） */
export async function fetchRepoInvitations(
  token: string,
  perPage = 20,
): Promise<RepositoryInvitation[]> {
  return typedRequest<RepositoryInvitation[]>(token, (octokit) =>
    octokit.rest.repos.listInvitationsForAuthenticatedUser({ per_page: perPage }),
  );
}

/** 接受协作邀请：PATCH /user/repository_invitations/{id}（204） */
export async function acceptRepoInvitation(invitationId: number, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.repos.acceptInvitationForAuthenticatedUser({ invitation_id: invitationId }),
  );
}

/** 拒绝协作邀请：DELETE /user/repository_invitations/{id}（204） */
export async function declineRepoInvitation(invitationId: number, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.repos.declineInvitationForAuthenticatedUser({ invitation_id: invitationId }),
  );
}

// ===== 通知已读（需 notifications scope）=====

/** 全部标记已读：PUT /notifications（需 notifications scope） */
export async function markAllNotificationsRead(token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.activity.markNotificationsAsRead({}));
}

/** 单条线程标记已读：PATCH /notifications/threads/{id}（需 notifications scope） */
export async function markNotificationThreadRead(threadId: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.activity.markThreadAsRead({ thread_id: Number(threadId) }),
  );
}

// ===== 动态 Feed（Events API）=====

/** GitHub Events API 事件（received_events 精简结构） */
export interface ReceivedEvent {
  id: string;
  type: string;
  actor: { login: string; avatar_url: string };
  repo: { name: string; url: string };
  created_at: string;
  payload?: {
    action?: string;
    ref?: string;
    ref_type?: string;
    description?: string | null;
    master_branch?: string;
    pusher_type?: string;
    /** PushEvent：received_events API 实际只返回 ref/head/before（commits 列表被省略），摘要卡片用它们渲染 */
    head?: string;
    before?: string;
    commits?: { message: string; sha: string; url: string }[];
    size?: number;
    /** CommitCommentEvent：commit 行内评论定位（无 issue/PR，标题栏降级 commit short_sha） */
    commit_id?: string;
    /** 评论内容（IssueCommentEvent / PullRequestReviewCommentEvent）；path/line = 行内评论定位（File#L123） */
    comment?: { body?: string; html_url?: string; path?: string; line?: number };
    /** 评审内容（PullRequestReviewEvent）；state 供标题栏适配（APPROVED/CHANGES_REQUESTED/COMMENTED） */
    review?: { body?: string; html_url?: string; state?: string; commit_id?: string };
    /** 评论所属 issue（IssueCommentEvent / IssuesEvent）；body 为完整 issue 正文；comments 供右列计数 */
    issue?: {
      title?: string;
      html_url?: string;
      number?: number;
      state?: string;
      body?: string;
      comments?: number;
    };
    /** 评论所属 PR（PullRequestReviewEvent 仅 url/id/number/head/base 无 title；ReviewCommentEvent 完整）；comments 供右列计数 */
    pull_request?: {
      title?: string;
      html_url?: string;
      number?: number;
      state?: string;
      merged?: boolean;
      comments?: number;
    };
    /** Release 动态（ReleaseEvent）：版本信息 + 正文预览 */
    release?: { tag_name?: string; name?: string; html_url?: string; body?: string };
  };
}

/**
 * 好友动态：GET /users/{login}/received_events（该用户关注对象的动态）
 * 注：无 /user/received_events 端点（404），必须带 login；带 token 可见私有事件。
 * GraphQL 无 events 查询 → 仅 REST；失败由调用方降级处理。
 * @param page 分页（首页 1）；动态类型选择 = 分页式发起搜索（每页请求，翻页续拉不限制总量）
 */
export async function fetchReceivedEvents(
  login: string,
  token: string,
  perPage = 20,
  page = 1,
): Promise<ReceivedEvent[]> {
  return typedRequest<ReceivedEvent[]>(token, (octokit) =>
    octokit.rest.activity.listReceivedEventsForUser({
      username: login,
      per_page: perPage,
      page,
    }),
  );
}

/** 热门/趋势仓库（无官方 API，用搜索按 star 排序模拟，取近 days 天创建；分页式发起搜索） */
export async function fetchTrendingRepositories(
  days = 30,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const data = await typedRequest<SearchResponse<Repository>>(token, (octokit) =>
    octokit.rest.search.repos({
      q: `created:>${since}`,
      sort: "stars",
      order: "desc",
      per_page: perPage,
      page,
    }),
  );
  return data.items;
}

/** 搜索仓库 */
export async function searchRepositories(
  q: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<Repository>> {
  // q 内 sort: qualifier（GraphQL/网页语法）映射到 REST 独立 sort 参数：
  // REST /search 不解析 q 内 sort:，需显式提取（best 匹配时不传 sort）
  const sortMatch = q.match(/(?:^|\s)sort:(\w+)/);
  const sortParam: "stars" | "forks" | "updated" | undefined =
    sortMatch && ["stars", "forks", "updated"].includes(sortMatch[1])
      ? (sortMatch[1] as "stars" | "forks" | "updated")
      : undefined;
  return typedRequest<SearchResponse<Repository>>(token, (octokit) =>
    octokit.rest.search.repos({
      q,
      ...(sortParam ? { sort: sortParam, order: "desc" as const } : {}),
      per_page: perPage,
      page,
    }),
  );
}

/** 搜索用户 */
export async function searchUsers(
  q: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<GitHubUser>> {
  return typedRequest<SearchResponse<GitHubUser>>(token, (octokit) =>
    octokit.rest.search.users({ q, per_page: perPage, page }),
  );
}

/** 搜索 issue/PR */
export async function searchIssues(
  q: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<SearchResponse<Issue>> {
  // q 内 sort: qualifier（网页/GraphQL 语法）映射到 REST 独立 sort 参数：
  // REST /search 不解析 q 内 sort:，需显式提取（best/无 sort 时不传）
  const sortMatch = q.match(/(?:^|\s)sort:(\w+)(-asc)?/);
  const sortVal = sortMatch?.[1];
  const isAsc = !!sortMatch?.[2];
  const sortParam: "comments" | "created" | "updated" | undefined =
    sortVal && ["comments", "created", "updated"].includes(sortVal)
      ? (sortVal as "comments" | "created" | "updated")
      : undefined;
  const order: "asc" | "desc" = isAsc ? "asc" : "desc";
  return typedRequest<SearchResponse<Issue>>(token, (octokit) =>
    octokit.rest.search.issuesAndPullRequests({
      q,
      ...(sortParam ? { sort: sortParam, order } : {}),
      per_page: perPage,
      page,
    }),
  );
}

/** 仓库详情 */
