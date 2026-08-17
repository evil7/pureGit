/**
 * GitHub REST API - user-org（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface.
 */

import { typedRequest, ApiError, fetchWithTimeout, GITHUB_API } from "./rest-core";
import type { GitHubUser } from "./rest-core";
import type { Repository } from "./rest-issue-pr";

// ===== 关注/取关（user:follow，write 模式 user scope 隐含） =====

/** 是否已关注用户（GET /user/following/{login}，204=已关注 / 404=未关注） */
export async function isFollowing(token: string, login: string): Promise<boolean> {
  try {
    await typedRequest<void>(token, (octokit) =>
      octokit.rest.users.checkPersonIsFollowedByAuthenticated({ username: login }),
    );
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

/** 关注/取关用户（PUT/DELETE /user/following/{login}，204 成功；需 user:follow） */
export async function setFollowing(token: string, login: string, follow: boolean): Promise<void> {
  if (follow) {
    await typedRequest<void>(token, (octokit) => octokit.rest.users.follow({ username: login }));
  } else {
    await typedRequest<void>(token, (octokit) => octokit.rest.users.unfollow({ username: login }));
  }
}

/** 删除仓库（REST DELETE /repos/{owner}/{repo}，危险操作） */
export async function deleteRepository(owner: string, repo: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.repos.delete({ owner, repo }));
}

/**
 * 迁移仓库所有权（REST POST /repos/{owner}/{repo}/transfer，危险操作）
 * body: { new_owner, team_ids?: number[], lock_repositories?: boolean }
 * 需 repo + admin:org（目标为组织时）；仅仓库所有者可操作。
 */
export async function transferRepository(
  owner: string,
  repo: string,
  token: string,
  body: { new_owner: string; lock_repositories?: boolean },
): Promise<Repository> {
  return typedRequest<Repository>(token, (octokit) =>
    octokit.rest.repos.transfer({ owner, repo, ...body }),
  );
}

/** 用户公开资料（REST） */
export async function fetchUser(
  login: string,
  token?: string | null,
): Promise<GitHubUser & { followers: number; following: number; public_repos: number }> {
  return typedRequest<GitHubUser & { followers: number; following: number; public_repos: number }>(
    token,
    (octokit) => octokit.rest.users.getByUsername({ username: login }),
  );
}

/** 用户完整信息（含 id，供组织邀请等需 id 的场景；GET /users/{login} 公开） */
export async function fetchUserWithId(
  login: string,
  token?: string | null,
): Promise<{ id: number; login: string }> {
  return typedRequest<{ id: number; login: string }>(token, (octokit) =>
    octokit.rest.users.getByUsername({ username: login }),
  );
}

/** 用户公开仓库（REST，按最近推送排序） */
export async function fetchUserRepos(
  login: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  return typedRequest<Repository[]>(token, (octokit) =>
    octokit.rest.repos.listForUser({ username: login, sort: "pushed", per_page: perPage, page }),
  );
}

/** 用户 Star 的仓库（REST，按最近 star 排序；公开数据） */
export async function fetchUserStars(
  login: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  return typedRequest<Repository[]>(token, (octokit) =>
    octokit.rest.activity.listReposStarredByUser({
      username: login,
      per_page: perPage,
      page,
    }),
  );
}

/** 用户 Watching 的仓库（REST，按最近 watch 排序；仅认证用户本人可见完整列表） */
export async function fetchUserWatched(
  login: string,
  perPage = 100,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  return typedRequest<Repository[]>(token, (octokit) =>
    octokit.rest.activity.listReposWatchedByUser({
      username: login,
      per_page: perPage,
      page,
    }),
  );
}

/** 用户 Star 仓库总数（per_page=1 读 Link header 末页；失败/限流返回 null —— 特殊语义端点保留底层通道） */
export async function fetchUserStarsCount(
  login: string,
  token?: string | null,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/users/${encodeURIComponent(login)}/starred?per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const link = res.headers.get("Link");
    const m = link?.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (m) return Number(m[1]);
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : null;
  } catch {
    return null;
  }
}

/** 组织公开资料（REST） */
export async function fetchOrg(
  org: string,
  token?: string | null,
): Promise<{
  login: string;
  name?: string;
  avatar_url?: string;
  description?: string;
  blog?: string | null;
  location?: string | null;
  public_repos: number;
}> {
  return typedRequest<{
    login: string;
    name?: string;
    avatar_url?: string;
    description?: string;
    blog?: string | null;
    location?: string | null;
    public_repos: number;
  }>(token, (octokit) => octokit.rest.orgs.get({ org }));
}

// ===== 组织管理 API（需 token + admin:org，组织设置与修改）=====

/** 组织详情（含邮箱/站点/节点 ID，用于资料编辑） */
export interface OrgDetail {
  login: string;
  name?: string | null;
  avatar_url?: string;
  description?: string | null;
  blog?: string | null;
  location?: string | null;
  email?: string | null;
  public_repos: number;
  node_id: string;
  /** 成员默认仓库权限（REST GET /orgs/{org} 返回；GraphQL defaultRepositoryPermission 映射） */
  default_repository_permission?: "read" | "write" | "admin" | "none" | null;
  /** 成员可创建仓库类型（仅 REST 返回；实测含 "public" 新值，官方文档过时仅列 all/private/none） */
  members_allowed_repository_creation_type?: "all" | "public" | "private" | "none" | null;
}

/** 组织详情（REST GET /orgs/{org}，需 token） */
export async function fetchOrgDetail(org: string, token: string): Promise<OrgDetail> {
  return typedRequest<OrgDetail>(token, (octokit) => octokit.rest.orgs.get({ org }));
}

/** 更新组织资料（REST PATCH /orgs/{org}，需 admin:org） */
export async function updateOrganization(
  org: string,
  token: string,
  fields: {
    name?: string;
    description?: string;
    blog?: string;
    location?: string;
    email?: string;
    /** 成员对组织仓库的默认权限（read/write/admin/none，官方 Member privileges） */
    default_repository_permission?: "read" | "write" | "admin" | "none";
    /** 成员可创建的仓库类型（all/public/private/none，官方 Member privileges；Octokit 类型未含 public 但 API 实际接受） */
    members_allowed_repository_creation_type?: "all" | "private" | "none";
  },
): Promise<OrgDetail> {
  return typedRequest<OrgDetail>(token, (octokit) =>
    octokit.rest.orgs.update({
      org,
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.blog !== undefined ? { blog: fields.blog } : {}),
      ...(fields.location !== undefined ? { location: fields.location } : {}),
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.default_repository_permission !== undefined
        ? { default_repository_permission: fields.default_repository_permission }
        : {}),
      ...(fields.members_allowed_repository_creation_type !== undefined
        ? {
            members_allowed_repository_creation_type:
              fields.members_allowed_repository_creation_type as "all" | "private" | "none",
          }
        : {}),
    }),
  );
}

/** 组织成员（REST GET /orgs/{org}/members，公开可见） */
export interface OrgMember {
  login: string;
  avatar_url: string;
  html_url: string;
  /** 2FA 已启用（REST 认证请求返回；GraphQL 无此字段） */
  two_factor_authentication?: boolean;
}

export async function fetchOrgMembers(
  org: string,
  token?: string | null,
  perPage = 30,
  role?: "admin" | "member",
): Promise<OrgMember[]> {
  return typedRequest<OrgMember[]>(token, (octokit) =>
    octokit.rest.orgs.listMembers({
      org,
      per_page: perPage,
      ...(role ? { role } : {}),
    }),
  );
}

/** 成员 + 角色（合并 admin 子集判定；角色/2FA 均为 REST 专属字段 → 固定 REST） */
export interface OrgMemberWithRole extends OrgMember {
  role: "admin" | "member";
}

/**
 * 成员列表含角色（Owner/Member）与 2FA 徽章字段。
 * 两个请求合并：全量 members + role=admin 子集，交集判 admin；需 admin:org 获取 2FA。
 */
export async function fetchOrgMembersWithRoles(
  org: string,
  token: string,
): Promise<OrgMemberWithRole[]> {
  const [all, admins] = await Promise.all([
    fetchOrgMembers(org, token, 100),
    fetchOrgMembers(org, token, 100, "admin"),
  ]);
  const adminSet = new Set(admins.map((m) => m.login));
  return all.map((m) => ({
    ...m,
    role: adminSet.has(m.login) ? "admin" : "member",
  }));
}

/** 退出组织（REST DELETE /orgs/{org}/memberships/{login}，需成员身份；204 无响应体） */
export async function leaveOrganization(org: string, login: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.orgs.removeMembershipForUser({ org, username: login }),
  );
}

// ===== 组织成员管理（需 admin:org；官方 Members 页） =====

/** 组织邀请（GET /orgs/{org}/invitations 返回项） */
export interface OrgInvitation {
  id: number;
  login: string | null;
  email: string | null;
  role: string;
  created_at: string;
  inviter: { login: string; avatar_url: string };
}

/** 组织邀请列表（GET /orgs/{org}/invitations，需 admin:org） */
export async function fetchOrgInvitations(org: string, token: string): Promise<OrgInvitation[]> {
  return typedRequest<OrgInvitation[]>(token, (octokit) =>
    octokit.rest.orgs.listPendingInvitations({ org, per_page: 50 }),
  );
}

/** 邀请成员（POST /orgs/{org}/invitations；invitee_id 或 email 二选一，需 admin:org） */
export async function createOrgInvitation(
  org: string,
  token: string,
  body: {
    invitee_id?: number;
    email?: string;
    role?: "admin" | "direct_member" | "billing_manager" | "reinstate" | string;
  },
): Promise<OrgInvitation> {
  return typedRequest<OrgInvitation>(token, (octokit) =>
    octokit.rest.orgs.createInvitation({
      org,
      invitee_id: body.invitee_id,
      email: body.email,
      ...(body.role
        ? { role: body.role as "admin" | "direct_member" | "billing_manager" | "reinstate" }
        : {}),
    }),
  );
}

/** 取消邀请（DELETE /orgs/{org}/invitations/{id}，204 无响应体；需 admin:org） */
export async function cancelOrgInvitation(
  org: string,
  invitationId: number,
  token: string,
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.orgs.cancelInvitation({ org, invitation_id: invitationId }),
  );
}

/** 组织成员角色信息（GET /orgs/{org}/memberships/{username}） */
export interface OrgMembershipDetail {
  url: string;
  state: "active" | "pending";
  role: "admin" | "member" | "billing_manager";
  user: { login: string; avatar_url: string };
}

/** 调整成员角色（PUT /orgs/{org}/memberships/{username}，role: admin/member，需 admin:org） */
export async function setOrgMemberRole(
  org: string,
  username: string,
  token: string,
  role: "admin" | "member",
): Promise<OrgMembershipDetail> {
  return typedRequest<OrgMembershipDetail>(token, (octokit) =>
    octokit.rest.orgs.setMembershipForUser({ org, username, role }),
  );
}

/** 移除成员（DELETE /orgs/{org}/members/{username}，204 无响应体；需 admin:org） */
export async function removeOrgMember(org: string, username: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.orgs.removeMember({ org, username }));
}

// ===== 团队管理（需 read:org 读取 / admin:org 写；官方 Teams 页） =====

/** 团队（GET /orgs/{org}/teams 返回项） */
export interface OrgTeam {
  id: number;
  node_id: string;
  name: string;
  slug: string;
  description: string | null;
  privacy: "closed" | "secret";
  permission: string;
  members_count?: number;
  repos_count?: number;
  html_url: string;
}

/** 团队列表（GET /orgs/{org}/teams，需 read:org） */
export async function fetchOrgTeams(org: string, token: string): Promise<OrgTeam[]> {
  return typedRequest<OrgTeam[]>(token, (octokit) =>
    octokit.rest.teams.list({ org, per_page: 50 }),
  );
}

/** 创建团队（POST /orgs/{org}/teams，需 admin:org 或 member 可建） */
export async function createOrgTeam(
  org: string,
  token: string,
  body: { name: string; description?: string; privacy?: "closed" | "secret" },
): Promise<OrgTeam> {
  return typedRequest<OrgTeam>(token, (octokit) => octokit.rest.teams.create({ org, ...body }));
}

/** 更新团队（PATCH /orgs/{org}/teams/{slug}，需 owner 或 team maintainer） */
export async function updateOrgTeam(
  org: string,
  slug: string,
  token: string,
  body: { name?: string; description?: string; privacy?: "closed" | "secret" },
): Promise<OrgTeam> {
  return typedRequest<OrgTeam>(token, (octokit) =>
    octokit.rest.teams.updateInOrg({ org, team_slug: slug, ...body }),
  );
}

/** 删除团队（DELETE /orgs/{org}/teams/{slug}，204 无响应体；需 owner 或 team maintainer） */
export async function deleteOrgTeam(org: string, slug: string, token: string): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.teams.deleteInOrg({ org, team_slug: slug }),
  );
}

/** 团队成员列表（GET /orgs/{org}/teams/{slug}/members，需 read:org） */
export async function fetchTeamMembers(
  org: string,
  slug: string,
  token: string,
): Promise<OrgMember[]> {
  return typedRequest<OrgMember[]>(token, (octokit) =>
    octokit.rest.teams.listMembersInOrg({ org, team_slug: slug, per_page: 50 }),
  );
}

/** 添加团队成员（PUT /orgs/{org}/teams/{slug}/memberships/{username}，204 无响应体；需 maintainer） */
export async function addTeamMember(
  org: string,
  slug: string,
  username: string,
  token: string,
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
      org,
      team_slug: slug,
      username,
    }),
  );
}

/** 移除团队成员（DELETE /orgs/{org}/teams/{slug}/memberships/{username}，204 无响应体；需 maintainer） */
export async function removeTeamMember(
  org: string,
  slug: string,
  username: string,
  token: string,
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.teams.removeMembershipForUserInOrg({
      org,
      team_slug: slug,
      username,
    }),
  );
}

/** 组织公开仓库（REST，按最近推送排序） */
export async function fetchOrgRepos(
  org: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Repository[]> {
  return typedRequest<Repository[]>(token, (octokit) =>
    octokit.rest.repos.listForOrg({ org, sort: "pushed", per_page: perPage, page }),
  );
}

/** 仓库分支列表（REST） */
