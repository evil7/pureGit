/**
 * GitHub API smart layer - user (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  VIEWER_QUERY,
  VIEWER_ORGS_QUERY,
  VIEWER_REPOS_QUERY,
  MY_GISTS_QUERY,
  UPDATE_USER_MUTATION,
  CREATE_SSH_KEY_MUTATION,
  IS_FOLLOWING_QUERY,
  USER_ID_QUERY,
  FOLLOW_USER_MUTATION,
  UNFOLLOW_USER_MUTATION,
} from "../graphql";
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
  fetchMyGists,
} from "../restapi";
import type { GitHubUser, Repository, SSHKey, Gist } from "../restapi";
import { toRepository } from "./api-repo";
import type { GraphQLRepository } from "./api-repo";

// ===== 智能封装：GraphQL 首选 + REST 降级 =====

/** 游标分页仓库结果（GraphQL pageInfo 映射；REST 无游标 → endCursor=null/hasNextPage=false） */
export interface PagedRepos {
  repos: Repository[];
  endCursor: string | null;
  hasNextPage: boolean;
}

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
  // REST 熔断降级（复用 rest 层 fetchCurrentUser；日志自动 ↪ 前缀）
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
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
      },
      "fetchViewerSmart",
      gqlResp,
    );
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
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误（graphqlRequest 已触发 cooldown）→ 熔断降级 REST
    return fromRest(undefined);
  }
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
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        const orgs = await fetchUserOrgs(token);
        return orgs.map((o) => ({
          login: o.login,
          name: o.name ?? null,
          avatarUrl: o.avatar_url ?? null,
          description: null,
        }));
      },
      "fetchUserOrgsSmart",
      gqlResp,
    );
  try {
    const resp: GraphQLResponse<{
      viewer: { organizations: { nodes: UserOrgItem[] } };
    }> = await graphqlRequest(VIEWER_ORGS_QUERY, {}, token);
    if (!hasGraphQLErrors(resp) && resp.data?.viewer?.organizations?.nodes) {
      return resp.data.viewer.organizations.nodes;
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 智能获取当前用户仓库（GraphQL viewer.repositories 游标分页首选 + REST /user/repos 降级）。
 * cursor 传续接游标（after）；首屏不传。返回 { repos, endCursor, hasNextPage } 供「显示更多」续接。 */
export async function fetchMyReposSmart(
  token: string,
  cursor?: string | null,
): Promise<PagedRepos> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>): Promise<PagedRepos> =>
    withRestFallback(
      async () => {
        // REST page 分页无游标；cursor 存在时按 page=2 近似续接（REST 降级低频）
        const repos = await fetchMyRepos(token, 100, cursor ? 2 : 1);
        return { repos, endCursor: null, hasNextPage: false };
      },
      "fetchMyReposSmart",
      gqlResp,
    );
  try {
    const resp: GraphQLResponse<{
      viewer: {
        repositories: {
          nodes: GraphQLRepository[];
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
        };
      };
    }> = await graphqlRequest(VIEWER_REPOS_QUERY, { after: cursor ?? null }, token);
    const repos = resp.data?.viewer?.repositories;
    if (!hasGraphQLErrors(resp) && repos) {
      return {
        repos: repos.nodes.map((g) => toRepository(g, g.owner?.login ?? "")),
        endCursor: repos.pageInfo?.endCursor ?? null,
        hasNextPage: repos.pageInfo?.hasNextPage ?? false,
      };
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 游标分页 Gist 结果（GraphQL pageInfo 映射；REST 无游标 → endCursor=null/hasNextPage=false） */
export interface PagedGists {
  gists: Gist[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/** 智能获取当前用户 Gist 列表（GraphQL viewer.gists 游标分页首选 + REST /gists 降级）。
 * resourcePath 提取 REST gist id（列表跳转详情需 REST id；GraphQL node id 与 REST id 不同）。 */
export async function fetchMyGistsSmart(
  token: string,
  cursor?: string | null,
): Promise<PagedGists> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>): Promise<PagedGists> =>
    withRestFallback(
      async () => {
        const gists = await fetchMyGists(token, 50, cursor ? 2 : 1);
        return { gists, endCursor: null, hasNextPage: false };
      },
      "fetchMyGistsSmart",
      gqlResp,
    );
  try {
    const resp: GraphQLResponse<{
      viewer: {
        gists: {
          nodes: {
            resourcePath: string;
            description: string | null;
            isPublic: boolean;
            createdAt: string;
            updatedAt: string;
            owner: { login: string; avatarUrl: string } | null;
            comments: { totalCount: number };
            files: { name: string; language: { name: string } | null; size: number | null }[];
          }[];
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
        };
      };
    }> = await graphqlRequest(MY_GISTS_QUERY, { after: cursor ?? null }, token);
    const gists = resp.data?.viewer?.gists;
    if (!hasGraphQLErrors(resp) && gists) {
      return {
        gists: gists.nodes.map((g) => ({
          // REST gist id = resourcePath 末段（列表跳转详情页需 REST id）
          id: g.resourcePath.split("/").pop() ?? g.resourcePath,
          description: g.description,
          html_url: `https://gist.github.com${g.resourcePath}`,
          public: g.isPublic,
          created_at: g.createdAt,
          updated_at: g.updatedAt,
          comments: g.comments?.totalCount ?? 0,
          files: Object.fromEntries(
            g.files.map((f) => [
              f.name,
              {
                filename: f.name,
                type: "text/plain",
                language: f.language?.name ?? null,
                size: f.size ?? 0,
                raw_url: "",
              },
            ]),
          ),
          owner: g.owner
            ? { login: g.owner.login, avatar_url: g.owner.avatarUrl ?? undefined }
            : undefined,
        })),
        endCursor: gists.pageInfo?.endCursor ?? null,
        hasNextPage: gists.pageInfo?.hasNextPage ?? false,
      };
    }
    return fromRest(resp);
  } catch {
    return fromRest(undefined);
  }
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
  // REST 熔断降级（PATCH /user；日志自动 ↪ 前缀）
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
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
      },
      "updateUserProfileSmart",
      gqlResp,
    );
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
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

export async function fetchSshKeysSmart(token: string): Promise<SSHKey[]> {
  // SSH key 删除依赖 REST 数字 id（DELETE /user/keys/{id}）；GraphQL key 类型（PublicKey）无
  // databaseId 字段、node id 不可靠解码为数字 id → 列表强制 REST（「GraphQL 无适配」特例，见 api-compat.md）。
  return fetchSSHKeys(token);
}

/** 智能新增 SSH key：GraphQL createSshKey 首选，失败降级 REST。 */
export async function addSshKeySmart(token: string, title: string, key: string): Promise<SSHKey> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => addSSHKey(token, title, key), "addSshKeySmart", gqlResp);
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
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 删除 SSH key：REST DELETE /user/keys/{id}（GraphQL deleteSshKey 需 node id，列表 REST 无 node id → REST 标准通道）。 */
export async function deleteSshKeySmart(token: string, keyId: number): Promise<void> {
  await deleteSSHKey(token, keyId);
}

/** 智能查询是否已关注：GraphQL user.viewerIsFollowing 首选，失败降级 REST。 */
export async function isFollowingSmart(token: string, login: string): Promise<boolean> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => isFollowing(token, login), "isFollowingSmart", gqlResp);
  try {
    const resp: GraphQLResponse<{
      user: { viewerIsFollowing: boolean } | null;
    }> = await graphqlRequest(IS_FOLLOWING_QUERY, { login }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.user) {
      return resp.data.user.viewerIsFollowing;
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 智能关注/取关：GraphQL followUser/unfollowUser 首选（需 userId），失败降级 REST。 */
export async function setFollowingSmart(
  token: string,
  login: string,
  follow: boolean,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => setFollowing(token, login, follow), "setFollowingSmart", gqlResp);
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
      // mutation 失败 → 熔断降级 REST
      return fromRest(mutResp);
    }
    // userId 缺失（GraphQL 查询失败/用户不存在）→ 熔断降级 REST
    return fromRest(idResp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/** 智能获取仓库主题：GraphQL repositoryTopics 首选，失败降级 REST。 */
