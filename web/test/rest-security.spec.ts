/**
 * ============================================================================
 * rest-security 三态开关 单元测试 —— Dependabot 安全开关通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - check 端点语义：204（不抛错）= 启用 → true；404 = 禁用 → false；其余错误原样抛出。
 * - setSecurityToggle：enabled 走 enable 端点，disabled 走 disable 端点（均 204 不抛错）。
 * - fetchSecurityToggles：并发 check 三个开关并汇总。
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
  checkSecurityToggle,
  setSecurityToggle,
  fetchSecurityToggles,
} from "@/lib/restapi/rest-security";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkSecurityToggle（204=启用 / 404=禁用）", () => {
  it("404 → false", async () => {
    mockTyped.mockRejectedValue(new ApiError(404, "Not Found"));
    await expect(checkSecurityToggle("o", "r", "vulnerabilityAlerts", "gho_x")).resolves.toBe(
      false,
    );
  });

  it("正常（204）→ true", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await expect(checkSecurityToggle("o", "r", "automatedSecurityFixes", "gho_x")).resolves.toBe(
      true,
    );
  });

  it("其它错误（500）→ 原样抛出", async () => {
    mockTyped.mockRejectedValue(new ApiError(500, ""));
    await expect(
      checkSecurityToggle("o", "r", "privateVulnerabilityReporting", "gho_x"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("setSecurityToggle（enabled → enable，否则 disable）", () => {
  it("enabled=true 不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await setSecurityToggle("o", "r", "vulnerabilityAlerts", true, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 不抛错", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await setSecurityToggle("o", "r", "vulnerabilityAlerts", false, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSecurityToggles（并发 check 三个开关并汇总）", () => {
  it("404/启用混合 → 正确汇总", async () => {
    // 顺序：vulnerabilityAlerts(404=false)、automatedSecurityFixes(true)、privateVulnerabilityReporting(true)
    mockTyped.mockRejectedValueOnce(new ApiError(404, "")).mockResolvedValue(undefined as never);
    const result = await fetchSecurityToggles("o", "r", "gho_x");
    expect(result).toEqual({
      vulnerabilityAlerts: false,
      automatedSecurityFixes: true,
      privateVulnerabilityReporting: true,
    });
  });
});
