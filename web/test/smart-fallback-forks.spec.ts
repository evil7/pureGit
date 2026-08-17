/**
 * ============================================================================
 * api-forks smart 决策 单元测试 —— forks 列表通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchForksSmart：GraphQL forks 连接分页首选（cursor），
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
    fetchForks: vi.fn(),
  };
});

import { fetchForksSmart } from "@/lib/api/api-forks";
import { graphqlRequest } from "@/lib/api/api-core";
import { fetchForks } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockForks = vi.mocked(fetchForks);

const gqlForks = {
  data: {
    repository: {
      forks: {
        totalCount: 1,
        pageInfo: { endCursor: "CUR1", hasNextPage: false },
        edges: [
          {
            node: {
              name: "repo-fork",
              nameWithOwner: "alice/repo-fork",
              description: "desc",
              primaryLanguage: { name: "TypeScript" },
              stargazerCount: 3,
              url: "https://github.com/alice/repo-fork",
              owner: { login: "alice", avatarUrl: "a.png" },
            },
          },
        ],
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchForksSmart", () => {
  it("GraphQL 成功 → 返回 forks（收窄映射），不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce(gqlForks as never);
    const page = await fetchForksSmart("o", "r", "gho_x");
    expect(page.forks).toEqual([
      {
        name: "repo-fork",
        full_name: "alice/repo-fork",
        owner: { login: "alice", avatar_url: "a.png" },
        description: "desc",
        language: "TypeScript",
        stargazers_count: 3,
        html_url: "https://github.com/alice/repo-fork",
      },
    ]);
    expect(page.totalCount).toBe(1);
    expect(page.endCursor).toBe("CUR1");
    expect(page.hasNextPage).toBe(false);
    expect(mockForks).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST fetchForks", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockForks.mockResolvedValue([
      {
        full_name: "b/repo",
        name: "repo",
        owner: { login: "b", avatar_url: "" },
        description: null,
        language: null,
        stargazers_count: 0,
        html_url: "",
      },
    ]);
    const page = await fetchForksSmart("o", "r", "gho_x");
    expect(page.forks.length).toBe(1);
    expect(mockForks).toHaveBeenCalledWith("o", "r", 30, 1, "gho_x");
  });

  it("匿名（token 空）→ 强制 REST fetchForks", async () => {
    mockForks.mockResolvedValue([]);
    await fetchForksSmart("o", "r", null);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockForks).toHaveBeenCalledWith("o", "r", 30, 1, null);
  });
});
