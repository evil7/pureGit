/**
 * GitHub API smart layer - org (split from api.ts,)
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  USER_PROFILE_QUERY,
  ORG_PROFILE_QUERY,
  UPDATE_ORG_MUTATION,
  ORG_MEMBERS_QUERY,
  STARRED_REPOS_QUERY,
} from "./graphql";
import {
  fetchUser,
  fetchUserRepos,
  fetchUserStars,
  fetchUserStarsCount,
  fetchOrg,
  fetchOrgDetail,
  updateOrganization,
  fetchOrgMembers,
  fetchOrgRepos,
} from "./rest";
import type { Repository, OrgMember, OrgDetail } from "./rest";

// ===== 用户/组织主页：GraphQL 首选 + REST 降级 =====

/** 用户/组织主页统一数据结构 */
export interface ProfileData {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  /** 公司（仅用户页） */
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  /** 公开仓库数（GraphQL visibility:PUBLIC totalCount / REST public_repos——任何权限下都是公开数） */
  publicRepos: number;
  /** 权限内仓库总数（自己/组织成员含私有；匿名=公开数。API 自动处置权限差异） */
  totalRepos: number;
  /** 关注数/关注中数（仅用户页；组织为 0） */
  followers: number;
  following: number;
  /** 用户状态（仅用户页 GraphQL status；REST 降级为 null） */
  status: { emoji: string | null; message: string | null } | null;
  /** 代词（仅用户页；REST 降级为 null） */
  pronouns: string | null;
  /** 加入的组织（仅用户页；REST 降级为空数组） */
  organizations: { avatarUrl: string | null; login: string }[];
  /** 组织成员数（仅组织页 membersWithRole.totalCount；匿名/降级为 0） */
  members: number;
  /** 用户页：viewer 是否已关注该用户（GraphQL viewerIsFollowing；REST 降级 null） */
  viewerIsFollowing: boolean | null;
  /** 组织页：viewer 是否可管理（GraphQL viewerCanAdminister；REST 降级 false） */
  viewerCanAdminister: boolean;
  /** 用户页：Star 仓库总数（GraphQL starredRepositories.totalCount 随主页查询一次拿到；REST 降级 null） */
  starCount: number | null;
  repos: Repository[];
  /** 置顶仓库（GraphQL pinnedItems；REST 降级时为空数组） */
  pinned: Repository[];
}

interface GraphQLProfileRepo {
  databaseId: number | null;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  isPrivate: boolean;
  isFork?: boolean;
  parent?: {
    nameWithOwner: string;
    defaultBranchRef?: { name: string } | null;
    owner?: { login: string };
  } | null;
  updatedAt: string;
}

interface GraphQLProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  bio?: string | null;
  description?: string | null;
  company?: string | null;
  location: string | null;
  websiteUrl: string | null;
  pronouns?: string | null;
  status?: { emoji: string | null; message: string | null } | null;
  followers?: { totalCount: number } | null;
  following?: { totalCount: number } | null;
  /** viewer 是否已关注该用户（仅 User 查询返回） */
  viewerIsFollowing?: boolean | null;
  /** viewer 是否可管理（仅 Organization 查询返回） */
  viewerCanAdminister?: boolean;
  organizations?: { nodes: { avatarUrl: string | null; login: string }[] } | null;
  /** 用户 Star 仓库总数 */
  starredRepositories?: { totalCount: number } | null;
  /** alias：visibility:PUBLIC 的公开仓库数 */
  publicRepos?: { totalCount: number } | null;
  /** 组织成员数（仅 Organization 查询返回） */
  membersWithRole?: { totalCount: number } | null;
  repositories: { totalCount?: number; nodes: GraphQLProfileRepo[] };
  pinnedItems?: { nodes: GraphQLProfileRepo[] };
}

/** GraphQL 仓库节点 → REST 兼容结构 */
function toProfileRepo(g: GraphQLProfileRepo, owner: string): Repository {
  return {
    id: g.databaseId ?? -1, // GraphQL databaseId；缺失时兜底 -1
    name: g.name,
    full_name: g.nameWithOwner,
    owner: { login: owner },
    description: g.description,
    html_url: g.url,
    homepage: null,
    stargazers_count: g.stargazerCount,
    forks_count: g.forkCount,
    language: g.primaryLanguage?.name ?? null,
    topics: [],
    updated_at: g.updatedAt,
    pushed_at: g.updatedAt,
    license: null,
    default_branch: "main",
    private: g.isPrivate,
    // fork 图标 + forked from 文本
    fork: g.isFork,
    parent: g.parent
      ? {
          full_name: g.parent.nameWithOwner,
          default_branch: g.parent.defaultBranchRef?.name,
          owner: g.parent.owner,
        }
      : null,
  };
}

function toProfileData(g: GraphQLProfile, publicRepos: number): ProfileData {
  return {
    login: g.login,
    name: g.name,
    avatarUrl: g.avatarUrl,
    bio: g.bio ?? g.description ?? null,
    company: g.company ?? null,
    location: g.location,
    websiteUrl: g.websiteUrl,
    publicRepos,
    // 权限内总数（自己/成员含私有）；totalCount 缺失时兜底公开数
    totalRepos: g.repositories.totalCount ?? publicRepos,
    followers: g.followers?.totalCount ?? 0,
    following: g.following?.totalCount ?? 0,
    // 状态仅在 emoji/message 任一存在时保留
    status: g.status && (g.status.emoji || g.status.message) ? g.status : null,
    pronouns: g.pronouns ?? null,
    organizations: (g.organizations?.nodes ?? []).map((o) => ({
      avatarUrl: o.avatarUrl,
      login: o.login,
    })),
    members: g.membersWithRole?.totalCount ?? 0,
    viewerIsFollowing: g.viewerIsFollowing ?? null,
    viewerCanAdminister: g.viewerCanAdminister ?? false,
    starCount: g.starredRepositories?.totalCount ?? null,
    repos: g.repositories.nodes.map((n) => toProfileRepo(n, g.login)),
    pinned: (g.pinnedItems?.nodes ?? []).map((n) => toProfileRepo(n, g.login)),
  };
}

/** 用户/组织主页智能获取（自动检测 user/org 修复组织走用户路由降级问题）
 *
 * 背景：官方统一路径 github.com/{login}（/orgs/{org} 302 → /{org}）。GraphQL user(login:)
 * 对组织 login 报错「Could not resolve to a User」→ 旧实现直接降级 REST 丢 pinned/私有数。
 * 本函数：GraphQL 先试 user → 失败试 organization；REST /users/{login} 对组织也返回 200
 * （type: "Organization" 区分），据此走 org 分支。
 */
export interface ProfileResult {
  kind: "user" | "org";
  data: ProfileData;
}

export async function fetchProfileSmart(
  login: string,
  token?: string | null,
): Promise<ProfileResult> {
  // REST 熔断降级（复用 rest 层 fetchUser/fetchOrg…；日志自动 ↪ 前缀）
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async (): Promise<ProfileResult> => {
        // REST /users/{login} 对组织也返回 200（type: "Organization"）
        const user = await fetchUser(login, token);
        if (user.type === "Organization") {
          const [org, repos] = await Promise.all([
            fetchOrg(login, token),
            fetchOrgRepos(login, 20, token),
          ]);
          return {
            kind: "org",
            data: {
              login: org.login,
              name: org.name ?? null,
              avatarUrl: org.avatar_url ?? null,
              bio: org.description ?? null,
              company: null,
              location: org.location ?? null,
              websiteUrl: org.blog ?? null,
              publicRepos: org.public_repos,
              totalRepos: org.public_repos,
              followers: 0,
              following: 0,
              status: null,
              pronouns: null,
              organizations: [],
              members: 0,
              viewerIsFollowing: null,
              viewerCanAdminister: false,
              starCount: null,
              repos,
              pinned: [],
            },
          };
        }
        const [repos, starCount] = await Promise.all([
          fetchUserRepos(login, 20, token),
          fetchUserStarsCount(login, token),
        ]);
        return {
          kind: "user",
          data: {
            login: user.login,
            name: user.name ?? null,
            avatarUrl: user.avatar_url ?? null,
            bio: user.bio ?? null,
            company: user.company ?? null,
            location: user.location ?? null,
            websiteUrl: user.blog ?? null,
            publicRepos: user.public_repos,
            totalRepos: user.public_repos,
            followers: user.followers,
            following: user.following,
            status: null,
            pronouns: null,
            organizations: [],
            members: 0,
            viewerIsFollowing: null,
            viewerCanAdminister: false,
            starCount,
            repos,
            pinned: [],
          },
        };
      },
      "fetchProfileSmart",
      gqlResp,
    );
  // GraphQL 首选（需 token；匿名直接 REST）
  if (token) {
    try {
      const resp: GraphQLResponse<{ user: GraphQLProfile | null }> = await graphqlRequest(
        USER_PROFILE_QUERY,
        { login },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.user) {
        const u = resp.data.user;
        return {
          kind: "user",
          data: toProfileData(u, u.publicRepos?.totalCount ?? u.repositories.nodes.length),
        };
      }
    } catch {
      // 网络层错误 → 熔断降级 REST
      return fromRest(undefined);
    }
    try {
      const resp: GraphQLResponse<{ organization: GraphQLProfile | null }> = await graphqlRequest(
        ORG_PROFILE_QUERY,
        { login },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.organization) {
        const o = resp.data.organization;
        return {
          kind: "org",
          data: toProfileData(o, o.publicRepos?.totalCount ?? o.repositories.nodes.length),
        };
      }
      // 双查询均失败（非 user 非 org）→ 熔断降级 REST
      return fromRest(resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return fromRest(undefined);
    }
  }
  // 匿名强制 REST（GraphQL 恒 403，硬约束非降级）
  return fromRest(undefined);
}

/**
 * 用户 Star 的仓库（用户主页 Stars tab）：GraphQL starredRepositories 首选 + REST 降级。
 * GraphQL 需认证（匿名降级 REST）；star 数 totalCount 仅供标题展示。
 * page>1 分页请求走 REST（GraphQL 分页需游标）。
 */
export async function fetchUserStarsSmart(
  login: string,
  token?: string | null,
  page = 1,
): Promise<{ totalCount: number; repos: Repository[] }> {
  if (page > 1) {
    const repos = await fetchUserStars(login, 20, token, page);
    return { totalCount: repos.length, repos };
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        user: { starredRepositories: { totalCount: number; nodes: GraphQLProfileRepo[] } } | null;
      }> = await graphqlRequest(STARRED_REPOS_QUERY, { login }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.user) {
        return {
          totalCount: resp.data.user.starredRepositories.totalCount,
          repos: resp.data.user.starredRepositories.nodes.map((n) => toProfileRepo(n, login)),
        };
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        async () => {
          const repos = await fetchUserStars(login, 20, token);
          return { totalCount: repos.length, repos };
        },
        "fetchUserStarsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => {
          const repos = await fetchUserStars(login, 20, token);
          return { totalCount: repos.length, repos };
        },
        "fetchUserStarsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  const repos = await fetchUserStars(login, 20, token);
  return { totalCount: repos.length, repos };
}

// ===== 组织管理（需 token + admin:org，组织设置与修改）=====

/**
 * 获取组织详情（含邮箱/站点/成员权限字段，供资料编辑）。
 * GraphQL 首选（修正：Organization 类型无 defaultRepositoryPermission 字段，
 * 用 membersAllowedRepositoryCreationType 等价映射；default_repository_permission 为 REST-only）
 * → REST /orgs/{org} 降级。
 */
export async function fetchOrgDetailSmart(org: string, token: string): Promise<OrgDetail> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(() => fetchOrgDetail(org, token), "fetchOrgDetailSmart", gqlResp);
  try {
    const resp: GraphQLResponse<{
      organization: {
        login: string;
        name: string | null;
        avatarUrl: string | null;
        description: string | null;
        location: string | null;
        websiteUrl: string | null;
        email: string | null;
      } | null;
    }> = await graphqlRequest(
      `query OrgDetail($login: String!) {
        organization(login: $login) {
          login
          name
          avatarUrl
          description
          location
          websiteUrl
          email
        }
      }`,
      { login: org },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.organization) {
      const o = resp.data.organization;
      // 权限字段（default_repository_permission / members_allowed_repository_creation_type）
      // 为 REST-only：GitHub GraphQL Organization 无等价字段（octokit/graphql-schema 实测
      // 4 候选名 defaultRepositoryPermission/membersAllowedRepositoryCreationType/
      // membersCanCreatePublicRepositories/membersCanCreatePrivateRepositories 均 undefinedField，
      // ）→ GraphQL 成功后轻量 REST 补丁（字段级补充，非降级）
      let permPatch: Pick<
        OrgDetail,
        "default_repository_permission" | "members_allowed_repository_creation_type"
      > = {};
      try {
        const rest = await fetchOrgDetail(org, token);
        permPatch = {
          default_repository_permission: rest.default_repository_permission,
          members_allowed_repository_creation_type: rest.members_allowed_repository_creation_type,
        };
      } catch {
        // 补丁失败静默（权限下拉回退默认值）
      }
      return {
        login: o.login,
        name: o.name,
        avatar_url: o.avatarUrl ?? undefined,
        description: o.description,
        blog: o.websiteUrl,
        location: o.location,
        email: o.email,
        public_repos: 0,
        node_id: "",
        ...permPatch,
      };
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

/**
 * 智能更新组织资料：GraphQL updateOrganization 首选 + REST PATCH /orgs/{org} 降级。
 * 注意：GraphQL 需组织 node id，先经 fetchOrgDetailSmart 获取。
 */
export async function updateOrganizationSmart(
  org: string,
  token: string,
  fields: {
    name?: string;
    description?: string;
    websiteUrl?: string;
    location?: string;
    email?: string;
    /** 成员默认仓库权限（仅 REST 支持，GraphQL mutation 无 → 传此字段时走 REST） */
    default_repository_permission?: "read" | "write" | "admin" | "none";
    /** 成员可创建仓库类型（仅 REST 支持；含 "public" 新值） */
    members_allowed_repository_creation_type?: "all" | "public" | "private" | "none";
  },
): Promise<OrgDetail> {
  // 成员权限字段 GraphQL mutation 不支持 → 直接走 REST（避免 GraphQL 成功后静默丢失字段）
  if (fields.default_repository_permission || fields.members_allowed_repository_creation_type) {
    return updateOrganization(org, token, {
      name: fields.name,
      description: fields.description,
      blog: fields.websiteUrl,
      location: fields.location,
      email: fields.email,
      default_repository_permission: fields.default_repository_permission,
      // Octokit 类型未含 "public" 新值（API 实际接受）→ 收窄断言
      members_allowed_repository_creation_type: fields.members_allowed_repository_creation_type as
        | "all"
        | "private"
        | "none",
    });
  }
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () =>
        updateOrganization(org, token, {
          name: fields.name,
          description: fields.description,
          blog: fields.websiteUrl,
          location: fields.location,
          email: fields.email,
        }),
      "updateOrganizationSmart",
      gqlResp,
    );
  try {
    const detail = await fetchOrgDetailSmart(org, token);
    if (!detail.node_id) throw new Error("no node_id");
    const resp: GraphQLResponse<{
      updateOrganization: {
        organization: {
          id: string;
          login: string;
          name: string | null;
          description: string | null;
          websiteUrl: string | null;
          location: string | null;
          email: string | null;
          avatarUrl: string | null;
        };
      };
    }> = await graphqlRequest(
      UPDATE_ORG_MUTATION,
      {
        input: {
          organizationId: detail.node_id,
          name: fields.name ?? "",
          description: fields.description ?? "",
          websiteUrl: fields.websiteUrl ?? "",
          location: fields.location ?? "",
          email: fields.email ?? "",
        },
      },
      token,
    );
    if (!hasGraphQLErrors(resp) && resp.data?.updateOrganization?.organization) {
      const o = resp.data.updateOrganization.organization;
      return {
        login: o.login,
        name: o.name,
        avatar_url: o.avatarUrl ?? undefined,
        description: o.description,
        blog: o.websiteUrl,
        location: o.location,
        email: o.email,
        public_repos: 0,
        node_id: o.id,
      };
    }
    // GraphQL 失败 → 熔断降级 REST
    return fromRest(resp);
  } catch {
    // 网络层错误 → 熔断降级 REST
    return fromRest(undefined);
  }
}

// ===== A 类整改 smart 包装（双端点 API 全部接入 smart 层） =====
// 原则（见 docs/api-compat.md）：页面一律从本模块调用；GraphQL 首选 + REST 自动降级。
// 不可抗力保持 REST-only 的 API（compare/updateRepository/GPG/block/notifications 等）见文档清单。

/** 智能获取组织成员：GraphQL organization.membersWithRole 首选，失败降级 REST。 */
export async function fetchOrgMembersSmart(
  org: string,
  token?: string | null,
): Promise<OrgMember[]> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        organization: {
          membersWithRole: { nodes: { login: string; avatarUrl: string; url: string }[] };
        } | null;
      }> = await graphqlRequest(ORG_MEMBERS_QUERY, { login: org }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.organization) {
        return resp.data.organization.membersWithRole.nodes.map((m) => ({
          login: m.login,
          avatar_url: m.avatarUrl,
          html_url: m.url,
        }));
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(() => fetchOrgMembers(org, token), "fetchOrgMembersSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(() => fetchOrgMembers(org, token), "fetchOrgMembersSmart", undefined);
    }
  }
  // 匿名强制 REST
  return fetchOrgMembers(org, token);
}

// ===== 组织成员角色 / 邀请 / 团队（增补） =====
// GraphQL 无对应（members 角色、invitations、teams 均无查询/mutation 等价）→ 固定 REST。
// 页面经此模块统一 import；调用方直接使用 rest 层函数（本文件 re-export 便于页面单点引用）。

export { fetchOrgInvitations, createOrgInvitation, cancelOrgInvitation } from "./rest";
export { setOrgMemberRole, removeOrgMember } from "./rest";
export { fetchOrgTeams, createOrgTeam, updateOrgTeam, deleteOrgTeam } from "./rest";
export { fetchTeamMembers, addTeamMember, removeTeamMember } from "./rest";
/** 成员含角色/2FA（固定 REST，官方 People 页数据源） */
export { fetchOrgMembersWithRoles } from "./rest";
