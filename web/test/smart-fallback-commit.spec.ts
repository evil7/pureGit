/**
 * ============================================================================
 * api-commit smart 降级决策 单元测试 —— commit 关联 PR / 状态 / 评论通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchCommitAssociatedPRsSmart / fetchCommitStatusSmart：GraphQL 首选 + REST 降级
 * - addCommitCommentSmart：GraphQL addComment 首选（需 commit node id）+ REST 降级
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
    listCommitAssociatedPRs: vi.fn(),
    getCommitStatus: vi.fn(),
    listCommitComments: vi.fn(),
    createCommitComment: vi.fn(),
  };
});

import {
  fetchCommitAssociatedPRsSmart,
  fetchCommitStatusSmart,
  addCommitCommentSmart,
} from "@/lib/api/api-commit";
import { graphqlRequest } from "@/lib/api/api-core";
import { listCommitAssociatedPRs, getCommitStatus, createCommitComment } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockListPRs = vi.mocked(listCommitAssociatedPRs);
const mockGetStatus = vi.mocked(getCommitStatus);
const mockCreateComment = vi.mocked(createCommitComment);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCommitAssociatedPRsSmart", () => {
  it("GraphQL 成功 → 返回 PR，不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        repository: {
          object: { associatedPullRequests: { nodes: [{ number: 1, title: "t", url: "u" }] } },
        },
      },
    } as never);
    const prs = await fetchCommitAssociatedPRsSmart("o", "r", "abc", "gho_x");
    expect(prs).toEqual([{ number: 1, title: "t", url: "u" }]);
    expect(mockListPRs).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockListPRs.mockResolvedValue([{ number: 1, title: "t", url: "u" }]);
    const prs = await fetchCommitAssociatedPRsSmart("o", "r", "abc", "gho_x");
    expect(prs).toEqual([{ number: 1, title: "t", url: "u" }]);
    expect(mockListPRs).toHaveBeenCalled();
  });
});

describe("fetchCommitStatusSmart", () => {
  it("GraphQL 成功 → 返回 checks，不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        repository: {
          object: {
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: { nodes: [{ name: "ci", conclusion: "SUCCESS" }] },
            },
          },
        },
      },
    } as never);
    const s = await fetchCommitStatusSmart("o", "r", "abc", "gho_x");
    expect(s?.state).toBe("SUCCESS");
    expect(s?.checks).toHaveLength(1);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockGetStatus.mockResolvedValue({ state: "success", checks: [] });
    const s = await fetchCommitStatusSmart("o", "r", "abc", "gho_x");
    expect(s?.state).toBe("success");
    expect(mockGetStatus).toHaveBeenCalled();
  });
});

describe("addCommitCommentSmart", () => {
  it("GraphQL 成功 → 返回评论，不调 REST", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { object: { id: "C_1" } } } } as never)
      .mockResolvedValueOnce({
        data: {
          addComment: {
            commentEdge: {
              node: {
                id: "IC_1",
                body: "hi",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                author: { login: "a", avatarUrl: "x" },
                url: "u",
              },
            },
          },
        },
      } as never);
    const c = await addCommitCommentSmart("o", "r", "abc", "hi", "gho_x");
    expect(c.body).toBe("hi");
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST createCommitComment", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockCreateComment.mockResolvedValue({
      id: 1,
      body: "hi",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      user: { login: "a", avatar_url: "x" },
      html_url: "u",
    } as never);
    const c = await addCommitCommentSmart("o", "r", "abc", "hi", "gho_x");
    expect(c.body).toBe("hi");
    expect(mockCreateComment).toHaveBeenCalledWith("o", "r", "abc", "hi", "gho_x");
  });
});
