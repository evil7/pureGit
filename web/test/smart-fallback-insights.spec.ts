/**
 * ============================================================================
 * api-insights smart 降级决策 单元测试 —— Top committers GraphQL 主通道 + REST 熔断
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * fetchTopCommittersSmart：登录 GraphQL Commit.history 主通道（v0.0.1 登录强制 Graph 主通道，
 * 不限收益）+ REST 熔断降级（匿名强制 REST）。核心决策：
 * - token 空 → 直 REST（两页 200 条）
 * - GraphQL 成功 → history nodes 映射 RepoCommit（oid→sha / author.user→login），统计去 merge + 去无 login，top 10
 * - GraphQL errors / 异常 → 熔断降级 REST
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / fetchCommits），零真实网络请求。
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
    fetchCommits: vi.fn(),
  };
});

import { fetchTopCommittersSmart } from "@/lib/api-insights";
import { graphqlRequest } from "@/lib/api-core";
import { fetchCommits, type RepoCommit } from "@/lib/rest";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchCommits = vi.mocked(fetchCommits);

/** 最小 REST commit 夹具（REST 降级路径返回值） */
const restCommit = (login: string, message: string): RepoCommit => ({
  sha: "abc",
  commit: { message, author: { name: login, date: "2026-08-01T00:00:00Z" } },
  author: { login, avatar_url: "" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchCommits.mockResolvedValue([]);
});

describe("fetchTopCommittersSmart（登录 GraphQL history 主通道 + REST 熔断）", () => {
  it("token 空 → 直 REST（GraphQL 不调用，拉两页）", async () => {
    mockFetchCommits
      .mockResolvedValueOnce([restCommit("alice", "fix")])
      .mockResolvedValueOnce([restCommit("bob", "feat")]);
    const r = await fetchTopCommittersSmart("evil7", "puregit", "2026-07-01T00:00:00Z", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchCommits).toHaveBeenCalledTimes(2);
    expect(r.map((c) => c.login).sort()).toEqual(["alice", "bob"]);
  });

  it("GraphQL 成功 → history nodes 映射 + 去 merge + 去无 login + top 排序（REST 不调用）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          object: {
            history: {
              nodes: [
                {
                  oid: "a1",
                  message: "fix a",
                  author: {
                    name: "Alice",
                    date: "2026-08-01",
                    user: { login: "alice", avatarUrl: "av1" },
                  },
                },
                {
                  oid: "a2",
                  message: "feat a",
                  author: {
                    name: "Alice",
                    date: "2026-08-02",
                    user: { login: "alice", avatarUrl: "av1" },
                  },
                },
                {
                  oid: "m1",
                  message: "Merge branch 'x'",
                  author: {
                    name: "Alice",
                    date: "2026-08-03",
                    user: { login: "alice", avatarUrl: "av1" },
                  },
                },
                {
                  oid: "b1",
                  message: "feat b",
                  author: {
                    name: "Bob",
                    date: "2026-08-04",
                    user: { login: "bob", avatarUrl: "av2" },
                  },
                },
                {
                  oid: "n1",
                  message: "no user",
                  author: { name: "Ghost", date: "2026-08-05", user: null },
                },
              ],
            },
          },
        },
      },
    } as never);
    const r = await fetchTopCommittersSmart("evil7", "puregit", "2026-07-01T00:00:00Z", "gho_x");
    expect(mockFetchCommits).not.toHaveBeenCalled();
    // alice 2 条非 merge（merge 跳过）、bob 1 条、无 login 跳过 → 按 count 降序
    expect(r).toEqual([
      { login: "alice", count: 2, avatarUrl: "av1" },
      { login: "bob", count: 1, avatarUrl: "av2" },
    ]);
  });

  it("GraphQL errors → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    mockFetchCommits.mockResolvedValue([restCommit("alice", "fix")]);
    const r = await fetchTopCommittersSmart("evil7", "puregit", "2026-07-01T00:00:00Z", "gho_x");
    expect(mockFetchCommits).toHaveBeenCalled();
    expect(r[0].login).toBe("alice");
  });

  it("GraphQL 抛异常 → 熔断降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    mockFetchCommits.mockResolvedValue([restCommit("bob", "feat")]);
    const r = await fetchTopCommittersSmart("evil7", "puregit", "2026-07-01T00:00:00Z", "gho_x");
    expect(mockFetchCommits).toHaveBeenCalled();
    expect(r[0].login).toBe("bob");
  });
});
