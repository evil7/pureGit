/**
 * ============================================================================
 * api-search smart 精选测试 —— 搜索降级 + id 派生质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * api-search 的降级决策与 api-repo/issue/user **同构**（page>1 直 REST /
 * GraphQL 首选 / 降级 REST），不重复全量测。本文件聚焦 **独特逻辑**：
 * - searchIssueId：GraphQL search 节点无 databaseId → 由仓库 full_name + number
 *   派生稳定唯一 id（React key 需要；同输入必同输出）
 * - searchRepositoriesSmart / searchUsersSmart / searchIssuesSmart 的 GraphQL 成功路径
 *   转换（toSearchRepo：id 兜底 -1、owner 从 nameWithOwner.split("/")[0] 派生、
 *   topics 恒空、default_branch 恒 "main"；users：name/avatar_url/bio ?? undefined；
 *   issues：附带 repository.full_name）
 * - 分页 page>1 → 直 REST（不消耗 GraphQL 配额）
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / rest 层），
 * **零真实网络请求**——无风控风险。q 组装由 search-syntax（已测）负责，本层透传不重复。
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

vi.mock("@/lib/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rest")>();
  return {
    ...actual,
    searchRepositories: vi.fn(),
    searchUsers: vi.fn(),
    searchIssues: vi.fn(),
  };
});

import {
  searchRepositoriesSmart,
  searchUsersSmart,
  searchIssuesSmart,
  searchIssueId,
} from "@/lib/api-search";
import { graphqlRequest } from "@/lib/api-core";
import { searchRepositories, searchUsers, searchIssues } from "@/lib/rest";

const mockGraphql = vi.mocked(graphqlRequest);
const mockSearchRepos = vi.mocked(searchRepositories);
const mockSearchUsers = vi.mocked(searchUsers);
const mockSearchIssues = vi.mocked(searchIssues);

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockSearchRepos.mockResolvedValue({ total_count: 0, incomplete_results: false, items: [] });
  mockSearchUsers.mockResolvedValue({ total_count: 0, incomplete_results: false, items: [] });
  mockSearchIssues.mockResolvedValue({ total_count: 0, incomplete_results: false, items: [] });
});

describe("searchIssueId（稳定唯一 id 派生）", () => {
  it("确定性：同输入 → 同输出", () => {
    expect(searchIssueId("evil7/puregit", 42)).toBe(searchIssueId("evil7/puregit", 42));
  });

  it("不同仓库 → 不同 id", () => {
    expect(searchIssueId("evil7/puregit", 42)).not.toBe(searchIssueId("evil7/other", 42));
  });

  it("同仓库不同 number → 不同 id", () => {
    expect(searchIssueId("evil7/puregit", 41)).not.toBe(searchIssueId("evil7/puregit", 42));
  });

  it("输出为有限整数（React key 可用）", () => {
    const id = searchIssueId("evil7/puregit", 42);
    expect(Number.isFinite(id)).toBe(true);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe("searchRepositoriesSmart", () => {
  it("page>1 分页 → 直 REST（GraphQL 不调用）", async () => {
    await searchRepositoriesSmart("react", "gho_x", 2);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockSearchRepos).toHaveBeenCalled();
  });

  it("GraphQL 成功 → toSearchRepo 转换（id 兜底 -1 / owner 派生 / topics 空）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        search: {
          repositoryCount: 1,
          nodes: [
            {
              databaseId: 88,
              name: "puregit",
              nameWithOwner: "evil7/puregit",
              description: "mini github",
              url: "https://github.com/evil7/puregit",
              stargazerCount: 10,
              forkCount: 2,
              primaryLanguage: { name: "TypeScript" },
              updatedAt: "2026-07-01T00:00:00Z",
              isPrivate: false,
            },
          ],
        },
      },
    } as never);
    const r = await searchRepositoriesSmart("puregit", "gho_x");
    expect(mockSearchRepos).not.toHaveBeenCalled();
    expect(r.total_count).toBe(1);
    expect(r.items[0]).toMatchObject({
      id: 88,
      full_name: "evil7/puregit",
      owner: { login: "evil7" },
      stargazers_count: 10,
      forks_count: 2,
      language: "TypeScript",
      topics: [],
      license: null,
      default_branch: "main",
      private: false,
    });
  });

  it("databaseId null → id 兜底 -1", async () => {
    mockGraphql.mockResolvedValue({
      data: { search: { repositoryCount: 1, nodes: [{ ...gqlRepoNode, databaseId: null }] } },
    } as never);
    const r = await searchRepositoriesSmart("x", "gho_x");
    expect(r.items[0].id).toBe(-1);
  });

  it("GraphQL errors / 异常 → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    await searchRepositoriesSmart("x", "gho_x");
    expect(mockSearchRepos).toHaveBeenCalledTimes(1);
    mockGraphql.mockRejectedValue(new Error("net"));
    await searchRepositoriesSmart("x", "gho_x");
    expect(mockSearchRepos).toHaveBeenCalledTimes(2);
  });

  it("token 空 → 直 REST", async () => {
    await searchRepositoriesSmart("x", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockSearchRepos).toHaveBeenCalled();
  });
});

const gqlRepoNode = {
  databaseId: 88,
  name: "puregit",
  nameWithOwner: "evil7/puregit",
  description: null,
  url: "https://github.com/evil7/puregit",
  stargazerCount: 0,
  forkCount: 0,
  primaryLanguage: null,
  updatedAt: "2026-07-01T00:00:00Z",
  isPrivate: false,
};

describe("searchUsersSmart", () => {
  it("GraphQL 成功 → 用户映射（name/avatar_url/bio ?? undefined）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        search: {
          userCount: 2,
          nodes: [
            { login: "alice", name: "Alice", avatarUrl: "https://a.png", bio: "hi" },
            { login: "bob", name: null, avatarUrl: null, bio: null },
          ],
        },
      },
    } as never);
    const r = await searchUsersSmart("alice", "gho_x");
    expect(r.total_count).toBe(2);
    expect(r.items[0]).toEqual({
      login: "alice",
      name: "Alice",
      avatar_url: "https://a.png",
      bio: "hi",
    });
    expect(r.items[1]).toEqual({
      login: "bob",
      name: undefined,
      avatar_url: undefined,
      bio: undefined,
    });
  });

  it("GraphQL 成功 → Organization 节点映射（description 归一为 bio；避免空卡片）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        search: {
          userCount: 1,
          nodes: [
            {
              login: "github",
              name: "GitHub",
              avatarUrl: "https://gh.png",
              description: "org desc",
            },
          ],
        },
      },
    } as never);
    const r = await searchUsersSmart("github", "gho_x");
    expect(r.items[0]).toEqual({
      login: "github",
      name: "GitHub",
      avatar_url: "https://gh.png",
      bio: "org desc",
    });
  });

  it("降级 REST 同分页行为", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    await searchUsersSmart("alice", "gho_x");
    expect(mockSearchUsers).toHaveBeenCalledTimes(1);
  });
});

describe("searchIssuesSmart", () => {
  it("GraphQL 成功 → searchIssueId 派生 id + repository 附带", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        search: {
          issueCount: 1,
          nodes: [
            {
              number: 42,
              title: "Bug",
              url: "https://github.com/evil7/puregit/issues/42",
              state: "OPEN",
              createdAt: "2026-07-01T00:00:00Z",
              closedAt: null,
              comments: { totalCount: 2 },
              author: { login: "alice" },
              labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
              repository: { nameWithOwner: "evil7/puregit" },
            },
          ],
        },
      },
    } as never);
    const r = await searchIssuesSmart("repo:evil7/puregit bug", "gho_x");
    expect(r.total_count).toBe(1);
    const i = r.items[0];
    expect(i.id).toBe(searchIssueId("evil7/puregit", 42)); // 派生 id
    expect(i.number).toBe(42);
    expect(i.state).toBe("open");
    expect(i.repository).toEqual({ full_name: "evil7/puregit" });
    expect(i.labels).toEqual([{ name: "bug", color: "d73a4a" }]);
  });

  it("author 缺失 → user 兜底 ghost", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        search: {
          issueCount: 1,
          nodes: [
            {
              number: 1,
              title: "t",
              url: "u",
              state: "CLOSED",
              createdAt: "2026-07-01T00:00:00Z",
              closedAt: "2026-07-02T00:00:00Z",
              comments: { totalCount: 0 },
              author: null,
              labels: undefined,
              repository: { nameWithOwner: "o/r" },
            },
          ],
        },
      },
    } as never);
    const r = await searchIssuesSmart("x", "gho_x");
    expect(r.items[0].user).toEqual({ login: "ghost" });
    expect(r.items[0].closed_at).toBe("2026-07-02T00:00:00Z");
    expect(r.items[0].labels).toEqual([]);
  });

  it("降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("net"));
    await searchIssuesSmart("x", "gho_x");
    expect(mockSearchIssues).toHaveBeenCalledTimes(1);
  });
});
