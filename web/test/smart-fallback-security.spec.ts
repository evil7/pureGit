/**
 * ============================================================================
 * api-security smart 决策 单元测试 —— Dependabot 安全开关通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - 三个开关整体 REST-only（GraphQL 无适配）→ smart 层透明转发 REST。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    checkSecurityToggle: vi.fn(),
    setSecurityToggle: vi.fn(),
    fetchSecurityToggles: vi.fn(),
  };
});

import {
  checkSecurityToggleSmart,
  setSecurityToggleSmart,
  fetchSecurityTogglesSmart,
} from "@/lib/api/api-security";
import { checkSecurityToggle, setSecurityToggle, fetchSecurityToggles } from "@/lib/restapi";

const mCheck = vi.mocked(checkSecurityToggle);
const mSet = vi.mocked(setSecurityToggle);
const mFetch = vi.mocked(fetchSecurityToggles);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkSecurityToggleSmart", () => {
  it("REST-only 透明转发 checkSecurityToggle", async () => {
    mCheck.mockResolvedValue(true);
    const result = await checkSecurityToggleSmart("o", "r", "vulnerabilityAlerts", "gho_x");
    expect(result).toBe(true);
    expect(mCheck).toHaveBeenCalledWith("o", "r", "vulnerabilityAlerts", "gho_x");
  });
});

describe("setSecurityToggleSmart", () => {
  it("REST-only 透明转发 setSecurityToggle", async () => {
    mSet.mockResolvedValue(undefined);
    await setSecurityToggleSmart("o", "r", "automatedSecurityFixes", true, "gho_x");
    expect(mSet).toHaveBeenCalledWith("o", "r", "automatedSecurityFixes", true, "gho_x");
  });
});

describe("fetchSecurityTogglesSmart", () => {
  it("REST-only 透明转发 fetchSecurityToggles", async () => {
    const toggles = {
      vulnerabilityAlerts: true,
      automatedSecurityFixes: false,
      privateVulnerabilityReporting: true,
    };
    mFetch.mockResolvedValue(toggles);
    const result = await fetchSecurityTogglesSmart("o", "r", "gho_x");
    expect(result).toEqual(toggles);
    expect(mFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});
