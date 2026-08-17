/**
 * ============================================================================
 * api-release 写操作 smart 降级决策 单元测试 —— 发布/编辑/删除 release 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - createReleaseSmart：GraphQL 首选（先查 repositoryId 再 createRelease），任一步失败 → 降级 REST
 * - updateReleaseSmart / deleteReleaseSmart：有 nodeId → GraphQL 首选；无 nodeId → 直 REST（数字 id）
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
    createRelease: vi.fn(),
    updateRelease: vi.fn(),
    deleteRelease: vi.fn(),
  };
});

import { createReleaseSmart, updateReleaseSmart, deleteReleaseSmart } from "@/lib/api/api-release";
import { graphqlRequest } from "@/lib/api/api-core";
import { createRelease, updateRelease, deleteRelease } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockCreateRelease = vi.mocked(createRelease);
const mockUpdateRelease = vi.mocked(updateRelease);
const mockDeleteRelease = vi.mocked(deleteRelease);

const input = { tag_name: "v1.0.0", name: "v1.0.0" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createReleaseSmart", () => {
  it("GraphQL 成功 → 返回 tagName，不调 REST", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({
        data: { createRelease: { release: { tagName: "v1.0.0" } } },
      } as never);
    const tag = await createReleaseSmart("o", "r", input, "gho_x");
    expect(tag).toBe("v1.0.0");
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  it("GraphQL mutation 失败 → 降级 REST createRelease", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockCreateRelease.mockResolvedValue({ tag_name: "v1.0.0" } as never);
    const tag = await createReleaseSmart("o", "r", input, "gho_x");
    expect(tag).toBe("v1.0.0");
    expect(mockCreateRelease).toHaveBeenCalledWith("o", "r", input, "gho_x");
  });
});

describe("updateReleaseSmart", () => {
  it("有 nodeId 且 GraphQL 成功 → 不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ data: {} } as never);
    await updateReleaseSmart("o", "r", { nodeId: "RL_1", id: 5 }, input, "gho_x");
    expect(mockUpdateRelease).not.toHaveBeenCalled();
  });

  it("无 nodeId → 直接 REST updateRelease（数字 id）", async () => {
    mockUpdateRelease.mockResolvedValue({} as never);
    await updateReleaseSmart("o", "r", { id: 5 }, input, "gho_x");
    expect(mockUpdateRelease).toHaveBeenCalledWith("o", "r", 5, input, "gho_x");
  });
});

describe("deleteReleaseSmart", () => {
  it("有 nodeId 且 GraphQL 成功 → 不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ data: {} } as never);
    await deleteReleaseSmart("o", "r", { nodeId: "RL_1", id: 5 }, "gho_x");
    expect(mockDeleteRelease).not.toHaveBeenCalled();
  });

  it("无 nodeId → 直接 REST deleteRelease（数字 id）", async () => {
    mockDeleteRelease.mockResolvedValue(undefined);
    await deleteReleaseSmart("o", "r", { id: 5 }, "gho_x");
    expect(mockDeleteRelease).toHaveBeenCalledWith("o", "r", 5, "gho_x");
  });
});
