/**
 * ============================================================================
 * api-stargazers smart 决策 单元测试 —— stargazers/watchers 列表通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchStargazersSmart / fetchWatchersSmart：GraphQL 连接分页首选（cursor），
 *   失败/匿名 → 降级 REST（page 分页，endCursor 为页码字符串）。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchStargazers: vi.fn(),
    fetchWatchers: vi.fn(),
  };
});

import { fetchStargazersSmart, fetchWatchersSmart } from "@/lib/api/api-stargazers";
import { graphqlRequest } from "@/lib/api/api-core";
import { fetchStargazers, fetchWatchers } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockStargazers = vi.mocked(fetchStargazers);
const mockWatchers = vi.mocked(fetchWatchers);

const gqlStargazers = {
  data: {
    repository: {
      stargazers: {
        totalCount: 2,
        pageInfo: { endCursor: "CUR1", hasNextPage: false },
        edges: [{ node: { login: "alice", name: "Alice", avatarUrl: "a.png" } }],
      },
    },
  },
};

const gqlWatchers = {
  data: {
    repository: {
      watchers: {
        totalCount: 1,
        pageInfo: { endCursor: "CUR1", hasNextPage: false },
        edges: [{ node: { login: "bob", name: null, avatarUrl: null } }],
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchStargazersSmart", () => {
  it("GraphQL 成功 → 返回 users（login/name/avatar 映射），不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce(gqlStargazers as never);
    const page = await fetchStargazersSmart("o", "r", "gho_x");
    expect(page.users).toEqual([{ login: "alice", name: "Alice", avatar_url: "a.png" }]);
    expect(page.totalCount).toBe(2);
    expect(page.endCursor).toBe("CUR1");
    expect(page.hasNextPage).toBe(false);
    expect(mockStargazers).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST fetchStargazers", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockStargazers.mockResolvedValue([{ login: "alice" }] as never);
    const page = await fetchStargazersSmart("o", "r", "gho_x");
    expect(page.users).toEqual([{ login: "alice" }]);
    expect(mockStargazers).toHaveBeenCalledWith("o", "r", 30, 1, "gho_x");
  });

  it("匿名（token 空）→ 强制 REST fetchStargazers", async () => {
    mockStargazers.mockResolvedValue([{ login: "alice" }] as never);
    await fetchStargazersSmart("o", "r", null);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockStargazers).toHaveBeenCalledWith("o", "r", 30, 1, null);
  });
});

describe("fetchWatchersSmart", () => {
  it("GraphQL 成功 → 返回 users，不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce(gqlWatchers as never);
    const page = await fetchWatchersSmart("o", "r", "gho_x");
    expect(page.users).toEqual([{ login: "bob", name: undefined, avatar_url: undefined }]);
    expect(page.totalCount).toBe(1);
    expect(mockWatchers).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST fetchWatchers", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockWatchers.mockResolvedValue([{ login: "bob" }] as never);
    const page = await fetchWatchersSmart("o", "r", "gho_x");
    expect(page.users).toEqual([{ login: "bob" }]);
    expect(mockWatchers).toHaveBeenCalledWith("o", "r", 30, 1, "gho_x");
  });
});
