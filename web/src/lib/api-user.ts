/**
 * GitHub API smart layer - user (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  VIEWER_QUERY,
  VIEWER_ORGS_QUERY,
  VIEWER_REPOS_QUERY,
  UPDATE_USER_MUTATION,
  VIEWER_SSH_KEYS_QUERY,
  CREATE_SSH_KEY_MUTATION,
  IS_FOLLOWING_QUERY,
  USER_ID_QUERY,
  FOLLOW_USER_MUTATION,
  UNFOLLOW_USER_MUTATION,
} from "./graphql";
import {
  fetchCurrentUser,
  fetchUserEmails,
  fetchUserOrgs,
  fetchMyRepos,
  updateUserProfile,
  isFollowing,
  setFollowing,
  fetchSSHKeys,
  addSSHKey,
  deleteSSHKey,
} from "./rest";
import type { GitHubUser, Repository, SSHKey } from "./rest";
import { toRepository } from "./api-repo";
import type { GraphQLRepository } from "./api-repo";

// ===== 智能封装：GraphQL 首选 + REST 降级 =====

/** 账户设置用当前用户画像（GraphQL/REST 统一结构） */
export interface ViewerProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  email?: string | null;
  plan?: string | null;
  pronouns?: string | null;
}

interface GraphQLViewer {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  email?: string | null;
  pronouns?: string | null;
}

/**
 * 智能获取当前用户画像：GraphQL viewer 首选，失败自动降级 REST /user。
 * 供账户设置（Profile/Account 页）使用。
 */
export async function fetchViewerSmart(token: string): Promise<ViewerProfile> {
  try {
    const resp: GraphQLResponse<{ viewer: GraphQLViewer }> = await graphqlRequest(
      VIEWER_QUERY,
      {},
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.viewer) {
      const v = resp.data.viewer;
      return {
        login: v.login,
        name: v.name,
        avatarUrl: v.avatarUrl,
        bio: v.bio,
        company: v.company,
        location: v.location,
        websiteUrl: v.websiteUrl,
        email: v.email ?? null,
        pronouns: v.pronouns ?? null,
      };
    }
  } catch {
    // 降级 REST
  }
  const u = await fetchCurrentUser(token);
  return {
    login: u.login,
    name: u.name ?? null,
    avatarUrl: u.avatar_url ?? null,
    bio: u.bio ?? null,
    company: u.company ?? null,
    location: u.location ?? null,
    websiteUrl: u.blog ?? null,
    email: u.email ?? null,
    plan: u.plan?.name ?? null,
    pronouns: u.pronouns ?? null,
  };
}

/** 智能获取当前用户（含 REST 字段），供头像/顶栏等简单场景使用 */
export async function fetchCurrentUserSmart(token: string): Promise<GitHubUser> {
  const profile = await fetchViewerSmart(token);
  return {
    login: profile.login,
    name: profile.name ?? undefined,
    avatar_url: profile.avatarUrl ?? undefined,
    bio: profile.bio ?? undefined,
    company: profile.company,
    location: profile.location,
    blog: profile.websiteUrl,
  };
}

// ===== 账户设置 smart 封装（GraphQL 首选 + REST 降级）=====

/** 邮箱统一结构 */
export interface UserEmailItem {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

/** 智能获取当前用户邮箱列表。
 * 注意：GitHub GraphQL 无 User.emails 字段（实测 400）→ 仅 REST /user/emails。 */
export async function fetchUserEmailsSmart(token: string): Promise<UserEmailItem[]> {
  const emails = await fetchUserEmails(token);
  return emails.map((e) => ({
    email: e.email,
    primary: e.primary,
    verified: e.verified,
    visibility: e.visibility,
  }));
}

/** 组织统一结构 */
export interface UserOrgItem {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  description: string | null;
}

/** 智能获取当前用户组织列表（GraphQL viewer.organizations 首选 + REST /user/orgs 降级） */
export async function fetchUserOrgsSmart(token: string): Promise<UserOrgItem[]> {
  try {
    const resp: GraphQLResponse<{
      viewer: { organizations: { nodes: UserOrgItem[] } };
    }> = await graphqlRequest(VIEWER_ORGS_QUERY, {}, token);
    if (!hasGraphQLErrors(resp) && resp.data?.viewer?.organizations?.nodes) {
      return resp.data.viewer.organizations.nodes;
    }
  } catch {
    // 降级 REST
  }
  const orgs = await fetchUserOrgs(token);
  return orgs.map((o) => ({
    login: o.login,
    name: o.name ?? null,
    avatarUrl: o.avatar_url ?? null,
    description: null,
  }));
}

/** 智能获取当前用户仓库（GraphQL viewer.repositories 首选 + REST /user/repos 降级） */
export async function fetchMyReposSmart(token: string): Promise<Repository[]> {
  try {
    const resp: GraphQLResponse<{
      viewer: { repositories: { nodes: GraphQLRepository[] } };
    }> = await graphqlRequest(VIEWER_REPOS_QUERY, {}, token);
    if (!hasGraphQLErrors(resp) && resp.data?.viewer?.repositories?.nodes) {
      return resp.data.viewer.repositories.nodes.map((g) => toRepository(g, g.owner?.login ?? ""));
    }
  } catch {
    // 降级 REST
  }
  return fetchMyRepos(token);
}

/** 更新当前用户公开资料（GraphQL updateUser 首选 + REST PATCH /user 降级） */
export async function updateUserProfileSmart(
  token: string,
  fields: {
    name?: string;
    bio?: string;
    company?: string;
    location?: string;
    websiteUrl?: string;
    pronouns?: string;
  },
): Promise<ViewerProfile> {
  try {
    const resp: GraphQLResponse<{
      updateUser: { user: GraphQLViewer };
    }> = await graphqlRequest(
      UPDATE_USER_MUTATION,
      {
        input: {
          name: fields.name ?? "",
          bio: fields.bio ?? "",
          company: fields.company ?? "",
          location: fields.location ?? "",
          websiteUrl: fields.websiteUrl ?? "",
          pronouns: fields.pronouns ?? "",
        },
      },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.updateUser?.user) {
      const u = resp.data.updateUser.user;
      return {
        login: u.login,
        name: u.name,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        company: u.company,
        location: u.location,
        websiteUrl: u.websiteUrl,
        pronouns: u.pronouns ?? null,
      };
    }
  } catch {
    // 降级 REST
  }
  const u = await updateUserProfile(token, {
    name: fields.name,
    bio: fields.bio,
    company: fields.company,
    location: fields.location,
    blog: fields.websiteUrl,
    pronouns: fields.pronouns,
  });
  return {
    login: u.login,
    name: u.name ?? null,
    avatarUrl: u.avatar_url ?? null,
    bio: u.bio ?? null,
    company: u.company ?? null,
    location: u.location ?? null,
    websiteUrl: u.blog ?? null,
    pronouns: u.pronouns ?? null,
  };
}

export async function fetchSshKeysSmart(token: string): Promise<SSHKey[]> {
  try {
    const resp: GraphQLResponse<{
      viewer: {
        sshKeys: {
          nodes: {
            id: string;
            key: string;
            title: string;
            createdAt: string;
            verified: boolean;
            readOnly: boolean;
          }[];
        };
      };
    }> = await graphqlRequest(VIEWER_SSH_KEYS_QUERY, {}, token);
    if (!hasGraphQLErrors(resp) && resp.data?.viewer) {
      return resp.data.viewer.sshKeys.nodes.map((k) => ({
        id: -1,
        key: k.key,
        url: "",
        title: k.title,
        created_at: k.createdAt,
        verified: k.verified,
        read_only: k.readOnly,
        last_used: null,
      }));
    }
  } catch {
    // 降级 REST
  }
  return fetchSSHKeys(token);
}

/** 智能新增 SSH key：GraphQL createSshKey 首选，失败降级 REST。 */
export async function addSshKeySmart(token: string, title: string, key: string): Promise<SSHKey> {
  try {
    const resp: GraphQLResponse<{
      createSshKey: {
        key: {
          id: string;
          key: string;
          title: string;
          createdAt: string;
          verified: boolean;
          readOnly: boolean;
        };
      } | null;
    }> = await graphqlRequest(CREATE_SSH_KEY_MUTATION, { title, key }, token);
    const k = resp.data?.createSshKey?.key;
    if (k && !hasGraphQLErrors(resp)) {
      return {
        id: -1,
        key: k.key,
        url: "",
        title: k.title,
        created_at: k.createdAt,
        verified: k.verified,
        read_only: k.readOnly,
        last_used: null,
      };
    }
  } catch {
    // 降级 REST
  }
  return addSSHKey(token, title, key);
}

/** 智能删除 SSH key：GraphQL deleteSshKey 首选（需 node id），失败降级 REST。 */
export async function deleteSshKeySmart(token: string, keyId: number): Promise<void> {
  try {
    // 列表拿 node id（REST id 与 GraphQL id 不同 → 查列表映射）
    const listResp: GraphQLResponse<{
      viewer: { sshKeys: { nodes: { id: string; title: string }[] } };
    }> = await graphqlRequest(VIEWER_SSH_KEYS_QUERY, {}, token);
    const list = listResp.data?.viewer?.sshKeys?.nodes;
    if (list && !hasGraphQLErrors(listResp) && list.length > 0) {
      // REST 列表顺序与 GraphQL 一致（按创建时间）；keyId 是 REST 数字 id，无法直接映射
      // → GraphQL 删除按 title 匹配不可靠；直接降级 REST（REST DELETE 是标准通道）
    }
  } catch {
    // 降级 REST
  }
  // REST DELETE 为标准通道（GraphQL 需 node id 且 keyId 无法可靠映射 → 直接 REST）
  await deleteSSHKey(token, keyId);
}

/** 智能查询是否已关注：GraphQL user.viewerIsFollowing 首选，失败降级 REST。 */
export async function isFollowingSmart(token: string, login: string): Promise<boolean> {
  try {
    const resp: GraphQLResponse<{
      user: { viewerIsFollowing: boolean } | null;
    }> = await graphqlRequest(IS_FOLLOWING_QUERY, { login }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.user) {
      return resp.data.user.viewerIsFollowing;
    }
  } catch {
    // 降级 REST
  }
  return isFollowing(token, login);
}

/** 智能关注/取关：GraphQL followUser/unfollowUser 首选（需 userId），失败降级 REST。 */
export async function setFollowingSmart(
  token: string,
  login: string,
  follow: boolean,
): Promise<void> {
  try {
    const idResp: GraphQLResponse<{ user: { id: string } | null }> = await graphqlRequest(
      USER_ID_QUERY,
      { login },
      token,
    );
    const userId = idResp.data?.user?.id;
    if (userId && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        follow ? FOLLOW_USER_MUTATION : UNFOLLOW_USER_MUTATION,
        { userId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
    }
  } catch {
    // 降级 REST
  }
  await setFollowing(token, login, follow);
}

/** 智能获取仓库主题：GraphQL repositoryTopics 首选，失败降级 REST。 */
