/**
 * ============================================================================
 * api-user smart 降级决策 单元测试 —— viewer/组织/仓库/SSH/资料 通路质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * api-user 是当前用户（viewer）相关 smart 层，统一「GraphQL 首选 + REST 降级」：
 * - fetchViewerSmart：GraphQL viewer 首选 → ViewerProfile 映射（email ?? null）；降级 REST /user →
 *   映射（blog → websiteUrl、plan?.name ?? null、pronouns ?? null）
 * - fetchUserOrgsSmart：GraphQL viewer.organizations 首选；降级 REST → 映射（description 固定 null）
 * - fetchMyReposSmart：GraphQL viewer.repositories 首选 → toRepository 转换；降级 REST
 * - fetchSshKeysSmart：GraphQL viewer.sshKeys 首选 → SSHKey 映射（id 兜底 -1、created_at/read_only）；
 *   降级 REST
 * - fetchUserEmailsSmart：**无 GraphQL 通道**（GitHub GraphQL 无 User.emails 字段，实测 400）
 *   → 仅 REST /user/emails（纯透传 + 字段裁剪，不经 graphqlRequest）
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / rest 层），api-repo.toRepository
 * 为纯函数真实执行（无网络）。**零真实网络请求**——无风控风险。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

vi.mock("@/lib/raw-proxy", () => ({
  fetchRawContentSmart: vi.fn(),
}));

vi.mock("@/lib/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rest")>();
  return {
    ...actual,
    fetchCurrentUser: vi.fn(),
    fetchUserEmails: vi.fn(),
    fetchUserOrgs: vi.fn(),
    fetchMyRepos: vi.fn(),
    updateUserProfile: vi.fn(),
    fetchSSHKeys: vi.fn(),
    isFollowing: vi.fn(),
    setFollowing: vi.fn(),
    addSSHKey: vi.fn(),
    deleteSSHKey: vi.fn(),
  };
});

import {
  fetchViewerSmart,
  fetchUserEmailsSmart,
  fetchUserOrgsSmart,
  fetchMyReposSmart,
  fetchSshKeysSmart,
} from "@/lib/api-user";
import { graphqlRequest } from "@/lib/api-core";
import {
  fetchCurrentUser,
  fetchUserEmails,
  fetchUserOrgs,
  fetchMyRepos,
  fetchSSHKeys,
  type GitHubUser,
  type Repository,
} from "@/lib/rest";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchCurrentUser = vi.mocked(fetchCurrentUser);
const mockFetchUserEmails = vi.mocked(fetchUserEmails);
const mockFetchUserOrgs = vi.mocked(fetchUserOrgs);
const mockFetchMyRepos = vi.mocked(fetchMyRepos);
const mockFetchSSHKeys = vi.mocked(fetchSSHKeys);

/** GraphQL viewer 节点夹具（ViewerProfile 映射源） */
const gqlViewer = {
  login: "alice",
  name: "Alice",
  avatarUrl: "https://avatars/a.png",
  bio: "hello",
  company: "ACME",
  location: "SH",
  websiteUrl: "https://alice.dev",
  email: "a@x.com",
  pronouns: "she/her",
};

/** REST /user 响应夹具（降级映射源） */
const restUser: GitHubUser = {
  login: "alice",
  name: "Alice",
  avatar_url: "https://avatars/a.png",
  bio: "hello",
  company: "ACME",
  location: "SH",
  blog: "https://alice.dev",
  email: "a@x.com",
  plan: { name: "free" },
  pronouns: "she/her",
};

/** GraphQL 仓库节点夹具（toRepository 映射源，最小字段） */
const gqlRepo = {
  databaseId: 99,
  name: "puregit",
  nameWithOwner: "alice/puregit",
  description: null,
  homepageUrl: null,
  url: "https://github.com/alice/puregit",
  owner: { login: "alice", avatarUrl: null },
  stargazerCount: 0,
  forkCount: 0,
  watchers: undefined,
  viewerSubscription: null,
  viewerHasStarred: false,
  primaryLanguage: { name: "TypeScript" },
  languages: undefined,
  repositoryTopics: undefined,
  licenseInfo: null,
  updatedAt: "2026-07-01T00:00:00Z",
  defaultBranchRef: { name: "main" },
  isPrivate: false,
  isArchived: false,
  isFork: false,
  parent: null,
  diskUsage: null,
};

const restRepo: Repository = {
  id: 1,
  name: "puregit",
  full_name: "alice/puregit",
  owner: { login: "alice" },
  description: null,
  homepage: null,
  private: false,
  html_url: "https://github.com/alice/puregit",
  default_branch: "main",
  fork: false,
  updated_at: "2026-07-01T00:00:00Z",
  pushed_at: "2026-07-01T00:00:00Z",
  stargazers_count: 0,
  forks_count: 0,
  language: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchCurrentUser.mockResolvedValue(restUser);
  mockFetchUserEmails.mockResolvedValue([
    { email: "a@x.com", primary: true, verified: true, visibility: "private" },
  ]);
  mockFetchUserOrgs.mockResolvedValue([{ login: "acme", name: "ACME", avatar_url: undefined }]);
  mockFetchMyRepos.mockResolvedValue([restRepo]);
  mockFetchSSHKeys.mockResolvedValue([
    {
      id: 1,
      key: "ssh-rsa AAA",
      url: "",
      title: "laptop",
      created_at: "2026-01-01",
      verified: true,
      read_only: false,
      last_used: null,
    },
  ]);
});

describe("fetchViewerSmart（GraphQL 首选 + REST 降级）", () => {
  it("GraphQL 成功 → ViewerProfile 全字段映射（email ?? null）", async () => {
    mockGraphql.mockResolvedValue({ data: { viewer: gqlViewer } } as never);
    const v = await fetchViewerSmart("gho_x");
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
    expect(v).toEqual({
      login: "alice",
      name: "Alice",
      avatarUrl: "https://avatars/a.png",
      bio: "hello",
      company: "ACME",
      location: "SH",
      websiteUrl: "https://alice.dev",
      email: "a@x.com",
      pronouns: "she/her",
    });
    expect(v.plan).toBeUndefined(); // GraphQL 路径无 plan 字段
  });

  it("GraphQL viewer 缺 email → email 兜底 null", async () => {
    mockGraphql.mockResolvedValue({
      data: { viewer: { ...gqlViewer, email: undefined } },
    } as never);
    const v = await fetchViewerSmart("gho_x");
    expect(v.email).toBeNull();
  });

  it("GraphQL errors → 降级 REST /user 映射（blog→websiteUrl、plan?.name ?? null）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    const v = await fetchViewerSmart("gho_x");
    expect(mockFetchCurrentUser).toHaveBeenCalled();
    expect(v).toEqual({
      login: "alice",
      name: "Alice",
      avatarUrl: "https://avatars/a.png",
      bio: "hello",
      company: "ACME",
      location: "SH",
      websiteUrl: "https://alice.dev",
      email: "a@x.com",
      plan: "free",
      pronouns: "she/her",
    });
  });

  it("GraphQL 抛异常 → 降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("net"));
    const v = await fetchViewerSmart("gho_x");
    expect(mockFetchCurrentUser).toHaveBeenCalled();
    expect(v.login).toBe("alice");
  });
});

describe("fetchUserEmailsSmart（仅 REST：GraphQL 无 User.emails 字段，实测 400）", () => {
  it("不经 graphqlRequest，直接 REST /user/emails 并裁剪字段", async () => {
    const emails = await fetchUserEmailsSmart("gho_x");
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchUserEmails).toHaveBeenCalledWith("gho_x");
    expect(emails).toEqual([
      { email: "a@x.com", primary: true, verified: true, visibility: "private" },
    ]);
  });
});

describe("fetchUserOrgsSmart（GraphQL 首选 + REST 降级）", () => {
  it("GraphQL 成功 → 原样返回组织节点", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        viewer: {
          organizations: {
            nodes: [{ login: "acme", name: "ACME", avatarUrl: null, description: null }],
          },
        },
      },
    } as never);
    const orgs = await fetchUserOrgsSmart("gho_x");
    expect(mockFetchUserOrgs).not.toHaveBeenCalled();
    expect(orgs).toEqual([{ login: "acme", name: "ACME", avatarUrl: null, description: null }]);
  });

  it("GraphQL errors → 降级 REST 映射（description 固定 null）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    const orgs = await fetchUserOrgsSmart("gho_x");
    expect(mockFetchUserOrgs).toHaveBeenCalled();
    expect(orgs).toEqual([{ login: "acme", name: "ACME", avatarUrl: null, description: null }]);
  });
});

describe("fetchMyReposSmart（GraphQL 首选游标分页 + REST 降级）", () => {
  it("GraphQL 成功 → toRepository 转换 + pageInfo 游标（full_name / language）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        viewer: {
          repositories: {
            nodes: [gqlRepo],
            pageInfo: { endCursor: "cur_1", hasNextPage: true },
          },
        },
      },
    } as never);
    const { repos, endCursor, hasNextPage } = await fetchMyReposSmart("gho_x");
    expect(mockFetchMyRepos).not.toHaveBeenCalled();
    expect(repos[0]).toMatchObject({
      id: 99,
      full_name: "alice/puregit",
      language: "TypeScript",
      default_branch: "main",
    });
    expect(endCursor).toBe("cur_1");
    expect(hasNextPage).toBe(true);
  });

  it("GraphQL 成功无 pageInfo → endCursor null / hasNextPage false", async () => {
    mockGraphql.mockResolvedValue({
      data: { viewer: { repositories: { nodes: [gqlRepo] } } },
    } as never);
    const { repos, endCursor, hasNextPage } = await fetchMyReposSmart("gho_x");
    expect(repos[0].id).toBe(99);
    expect(endCursor).toBeNull();
    expect(hasNextPage).toBe(false);
  });

  it("GraphQL errors / 异常 → 降级 REST（返回 repos + 无游标）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchMyReposSmart("gho_x")).repos[0].id).toBe(1);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchMyReposSmart("gho_x")).repos[0].id).toBe(1);
    expect(mockFetchMyRepos).toHaveBeenCalledTimes(2);
  });

  it("游标续接（cursor 传入）→ GraphQL 用 after 变量", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        viewer: {
          repositories: {
            nodes: [gqlRepo],
            pageInfo: { endCursor: "cur_2", hasNextPage: false },
          },
        },
      },
    } as never);
    const { endCursor, hasNextPage } = await fetchMyReposSmart("gho_x", "cur_1");
    expect(mockGraphql).toHaveBeenCalledWith(expect.any(String), { after: "cur_1" }, "gho_x");
    expect(endCursor).toBe("cur_2");
    expect(hasNextPage).toBe(false);
  });
});

describe("fetchSshKeysSmart（GraphQL 首选 + REST 降级）", () => {
  it("GraphQL 成功 → SSHKey 映射（id 兜底 -1、created_at/read_only）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        viewer: {
          sshKeys: {
            nodes: [
              {
                id: "abc",
                key: "ssh-rsa AAA",
                title: "laptop",
                createdAt: "2026-01-01T00:00:00Z",
                verified: true,
                readOnly: false,
              },
            ],
          },
        },
      },
    } as never);
    const keys = await fetchSshKeysSmart("gho_x");
    expect(mockFetchSSHKeys).not.toHaveBeenCalled();
    expect(keys).toEqual([
      {
        id: -1,
        key: "ssh-rsa AAA",
        url: "",
        title: "laptop",
        created_at: "2026-01-01T00:00:00Z",
        verified: true,
        read_only: false,
        last_used: null,
      },
    ]);
  });

  it("GraphQL errors / 异常 → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchSshKeysSmart("gho_x"))[0].id).toBe(1);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchSshKeysSmart("gho_x"))[0].id).toBe(1);
    expect(mockFetchSSHKeys).toHaveBeenCalledTimes(2);
  });
});
