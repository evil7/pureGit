/**
 * ============================================================================
 * rest-issue-subtask 单元测试 —— issue 子任务/依赖通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - sub-issue / dependency 整体 REST-only（GraphQL 无适配）。
 * - fetchParentIssue：404/410（无父）→ null；其余错误原样抛出。
 * - fetchSubIssues / fetchBlockedByDependencies：空数组（null 返回）归一为 []。
 * 全部 mock typedRequest（rest-core 底层通道），零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi/rest-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi/rest-core")>();
  return {
    ...actual,
    typedRequest: vi.fn(),
  };
});

import { typedRequest, ApiError } from "@/lib/restapi/rest-core";
import {
  fetchSubIssues,
  fetchParentIssue,
  addSubIssue,
  removeSubIssue,
  fetchBlockedByDependencies,
  addBlockedByDependency,
  removeBlockedByDependency,
} from "@/lib/restapi/rest-issue-subtask";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSubIssues", () => {
  it("返回 null → 归一为 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    const result = await fetchSubIssues("o", "r", 1, "gho_x");
    expect(result).toEqual([]);
  });
});

describe("fetchParentIssue", () => {
  it("404 → null", async () => {
    mockTyped.mockRejectedValue(new ApiError(404, ""));
    await expect(fetchParentIssue("o", "r", 1, "gho_x")).resolves.toBeNull();
  });

  it("410 → null", async () => {
    mockTyped.mockRejectedValue(new ApiError(410, ""));
    await expect(fetchParentIssue("o", "r", 1, "gho_x")).resolves.toBeNull();
  });

  it("其它错误（500）→ 原样抛出", async () => {
    mockTyped.mockRejectedValue(new ApiError(500, ""));
    await expect(fetchParentIssue("o", "r", 1, "gho_x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("addSubIssue / removeSubIssue", () => {
  it("addSubIssue 转发不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await addSubIssue("o", "r", 1, 6, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });

  it("removeSubIssue 转发不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await removeSubIssue("o", "r", 1, 6, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});

describe("fetchBlockedByDependencies", () => {
  it("返回 null → 归一为 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    const result = await fetchBlockedByDependencies("o", "r", 1, "gho_x");
    expect(result).toEqual([]);
  });
});

describe("addBlockedByDependency / removeBlockedByDependency", () => {
  it("addBlockedByDependency 转发不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await addBlockedByDependency("o", "r", 1, 7, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });

  it("removeBlockedByDependency 转发不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await removeBlockedByDependency("o", "r", 1, 7, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});
