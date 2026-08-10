/**
 * GitHub REST API - account（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import { typedRequest } from "./rest-core";
import type { GitHubUser } from "./rest-core";
import type { Repository } from "./rest-issue-pr";

// ===== 账户设置 API（需 token）=====

/** 当前用户邮箱（需 token，scope user:email） */
export interface UserEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

/** 当前用户邮箱列表（需 token） */
export async function fetchUserEmails(token: string): Promise<UserEmail[]> {
  return typedRequest<UserEmail[]>(token, (octokit) =>
    octokit.rest.users.listEmailsForAuthenticatedUser({ per_page: 50 }),
  );
}

/** 添加邮箱（REST POST /user/emails，需 token + user:email；body = 邮箱数组） */
export async function addUserEmails(token: string, emails: string[]): Promise<UserEmail[]> {
  return typedRequest<UserEmail[]>(token, (octokit) =>
    octokit.rest.users.addEmailForAuthenticatedUser({ emails }),
  );
}

/** 删除邮箱（REST DELETE /user/emails，需 token + user:email；body = 邮箱数组，204 无响应体） */
export async function removeUserEmails(token: string, emails: string[]): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.users.deleteEmailForAuthenticatedUser({ emails }),
  );
}

/**
 * 设置邮箱可见性（REST PATCH /user/email/visibility，需 token + user:email）
 * 「Keep my email addresses private」= private；「公开显示」= public。
 */
export async function setEmailVisibility(
  token: string,
  visibility: "private" | "public",
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.users.setPrimaryEmailVisibilityForAuthenticated({ visibility }),
  );
}

// ===== 账号模块：SSH keys（需 read:public_key / admin:public_key scope）=====

/** 已验证公钥（GET /user/keys 返回结构） */
export interface SSHKey {
  id: number;
  key: string;
  url: string;
  title: string;
  created_at: string;
  verified: boolean;
  read_only: boolean;
  last_used: string | null;
}

/** 列出当前用户 SSH keys（GET /user/keys，需 read:public_key） */
export async function fetchSSHKeys(token: string): Promise<SSHKey[]> {
  return typedRequest<SSHKey[]>(token, (octokit) =>
    octokit.rest.users.listPublicSshKeysForAuthenticatedUser({ per_page: 50 }),
  );
}

/** 添加 SSH key（POST /user/keys，需 write:public_key；body = {title, key}） */
export async function addSSHKey(token: string, title: string, key: string): Promise<SSHKey> {
  return typedRequest<SSHKey>(token, (octokit) =>
    octokit.rest.users.createPublicSshKeyForAuthenticatedUser({ title, key }),
  );
}

/** 删除 SSH key（DELETE /user/keys/{id}，需 admin:public_key；204 无响应体） */
export async function deleteSSHKey(token: string, keyId: number): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.users.deletePublicSshKeyForAuthenticatedUser({ key_id: keyId }),
  );
}

/** 当前用户所属组织列表（需 token） */
export async function fetchUserOrgs(token: string): Promise<GitHubUser[]> {
  return typedRequest<GitHubUser[]>(token, (octokit) =>
    octokit.rest.orgs.listForAuthenticatedUser({ per_page: 50 }),
  );
}

/** 组织成员关系（含角色：GET /user/memberships/orgs，需 token） */
export interface OrgMembership {
  organization: GitHubUser;
  role: "admin" | "member" | string;
  state: "active" | "pending";
}

/** 当前用户组织成员关系（含 role：admin → Owner，member → Member） */
export async function fetchOrgMemberships(token: string): Promise<OrgMembership[]> {
  return typedRequest<OrgMembership[]>(token, (octokit) =>
    octokit.rest.orgs.listMembershipsForAuthenticatedUser({ per_page: 50 }),
  );
}

/** 当前用户仓库（需 token，按最近更新排序；含私有仓库） */
export async function fetchMyRepos(token: string, perPage = 100, page = 1): Promise<Repository[]> {
  return typedRequest<Repository[]>(token, (octokit) =>
    octokit.rest.repos.listForAuthenticatedUser({ per_page: perPage, sort: "updated", page }),
  );
}

/** 更新当前用户公开资料（需 token） */
export async function updateUserProfile(
  token: string,
  fields: {
    name?: string;
    bio?: string;
    company?: string;
    location?: string;
    blog?: string;
    pronouns?: string;
  },
): Promise<GitHubUser> {
  return typedRequest<GitHubUser>(token, (octokit) =>
    octokit.rest.users.updateAuthenticated(fields),
  );
}

/**
 * 更新新个人仓库默认分支名（REST PATCH /user { master_branch }，需 token）
 * 复刻官方 /settings/repositories「Repository default branch」。
 */
export async function updateDefaultBranch(
  token: string,
  masterBranch: string,
): Promise<GitHubUser> {
  return typedRequest<GitHubUser>(token, (octokit) =>
    octokit.rest.users.updateAuthenticated({ master_branch: masterBranch }),
  );
}
// ===== GPG keys（需 read:gpg_key / admin:gpg_key scope）=====

/** GPG key（GET /user/gpg_keys 返回结构） */
export interface GpgKey {
  id: number;
  name: string | null;
  public_key: string;
  emails: { email: string; verified: boolean }[];
  subkeys: {
    id: number;
    primary_key_id: number;
    key_id: string;
    public_key: string;
    emails: { email: string; verified: boolean }[];
    can_sign: boolean;
    can_encrypt_comms: boolean;
    can_encrypt_storage: boolean;
    can_certify: boolean;
    created_at: string;
    expires_at: string | null;
    raw_key: string | null;
  }[];
  can_sign: boolean;
  can_encrypt_comms: boolean;
  can_encrypt_storage: boolean;
  can_certify: boolean;
  created_at: string;
  expires_at: string | null;
  raw_key: string | null;
  key_id: string;
}

/** 列出当前用户 GPG keys（GET /user/gpg_keys，需 read:gpg_key） */
export async function fetchGpgKeys(token: string): Promise<GpgKey[]> {
  return typedRequest<GpgKey[]>(token, (octokit) =>
    octokit.rest.users.listGpgKeysForAuthenticatedUser({ per_page: 50 }),
  );
}

/** 添加 GPG key（POST /user/gpg_keys，需 write:gpg_key；body = {armored_public_key}） */
export async function addGpgKey(token: string, armoredPublicKey: string): Promise<GpgKey> {
  return typedRequest<GpgKey>(token, (octokit) =>
    octokit.rest.users.createGpgKeyForAuthenticatedUser({
      armored_public_key: armoredPublicKey,
    }),
  );
}

/** 删除 GPG key（DELETE /user/gpg_keys/{id}，需 admin:gpg_key；204 无响应体） */
export async function deleteGpgKey(token: string, keyId: number): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.users.deleteGpgKeyForAuthenticatedUser({ gpg_key_id: keyId }),
  );
}

// ===== Blocked users（GET /user/blocks；GraphQL 无对应查询 → 仅 REST）=====

/** 已屏蔽用户（/user/blocks 返回的就是 GitHubUser 结构） */
export type BlockedUser = GitHubUser;

/** 列出已屏蔽用户（GET /user/blocks） */
export async function fetchBlockedUsers(token: string): Promise<BlockedUser[]> {
  return typedRequest<BlockedUser[]>(token, (octokit) =>
    octokit.rest.users.listBlockedByAuthenticatedUser({ per_page: 50 }),
  );
}

/** 屏蔽用户（PUT /user/blocks/{username}，无请求体，需完全控制） */
export async function blockUser(token: string, username: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.users.block({ username }));
}

/** 解除屏蔽（DELETE /user/blocks/{username}，204 无响应体） */
export async function unblockUser(token: string, username: string): Promise<void> {
  await typedRequest<void>(token, (octokit) => octokit.rest.users.unblock({ username }));
}
