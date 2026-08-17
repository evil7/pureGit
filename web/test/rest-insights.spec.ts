/**
 * ============================================================================
 * rest-insights stats 端点 202 降级 单元测试 —— Insights 图表数据通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - `/stats/*` 端点首次请求返回 202（计算中）→ 降级为空数据（数组→[]，对象→空结构）。
 * - 其余错误（如 500）原样抛出；正常响应透明返回。
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
  fetchContributorsStats,
  fetchParticipationStats,
  fetchCodeFrequencyStats,
  fetchCommitActivityStats,
  fetchClonesStats,
} from "@/lib/restapi/rest-insights";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stats 端点 202 → 空数据降级", () => {
  it("fetchContributorsStats 202 → 返回空数组", async () => {
    mockTyped.mockRejectedValue(new ApiError(202, ""));
    const result = await fetchContributorsStats("o", "r", "gho_x");
    expect(result).toEqual([]);
  });

  it("fetchParticipationStats 202 → 返回空结构（对象非数组）", async () => {
    mockTyped.mockRejectedValue(new ApiError(202, ""));
    const result = await fetchParticipationStats("o", "r", "gho_x");
    expect(result).toEqual({ all: [], owner: [] });
  });

  it("fetchCodeFrequencyStats 202 → 返回空数组", async () => {
    mockTyped.mockRejectedValue(new ApiError(202, ""));
    const result = await fetchCodeFrequencyStats("o", "r", null);
    expect(result).toEqual([]);
  });
});

describe("stats 端点 202 返回空 JSON 对象 {} → 空数据降级（octokit 对 2xx 不抛错）", () => {
  it("fetchCommitActivityStats 返回 {} → 空数组", async () => {
    mockTyped.mockResolvedValue({} as never);
    const result = await fetchCommitActivityStats("o", "r", "gho_x");
    expect(result).toEqual([]);
  });

  it("fetchCodeFrequencyStats 返回 {} → 空数组", async () => {
    mockTyped.mockResolvedValue({} as never);
    const result = await fetchCodeFrequencyStats("o", "r", "gho_x");
    expect(result).toEqual([]);
  });

  it("fetchContributorsStats 返回 {} → 空数组", async () => {
    mockTyped.mockResolvedValue({} as never);
    const result = await fetchContributorsStats("o", "r", "gho_x");
    expect(result).toEqual([]);
  });

  it("fetchParticipationStats 返回 {} → 空结构（对象非数组）", async () => {
    mockTyped.mockResolvedValue({} as never);
    const result = await fetchParticipationStats("o", "r", "gho_x");
    expect(result).toEqual({ all: [], owner: [] });
  });
});

describe("stats 端点非 202 错误 → 原样抛出", () => {
  it("fetchCodeFrequencyStats 500 → 拒绝", async () => {
    mockTyped.mockRejectedValue(new ApiError(500, ""));
    await expect(fetchCodeFrequencyStats("o", "r", "gho_x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("traffic 端点正常响应 → 透明返回", () => {
  it("fetchClonesStats 透明返回数据", async () => {
    const stats = { count: 10, uniques: 5, clones: [] };
    mockTyped.mockResolvedValue(stats as never);
    const result = await fetchClonesStats("o", "r", "gho_x");
    expect(result).toEqual(stats);
  });
});
