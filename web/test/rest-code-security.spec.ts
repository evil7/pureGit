/**
 * ============================================================================
 * rest-code-security 告警三件套 单元测试 —— Dependabot / Code scanning / Secret scanning
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - 三类 list 端点：正确透传 owner/repo/state/per_page，返回 data ?? []（空返回兜底 []）。
 * - 三类 get 端点：正确透传 alert_number。
 * - 三类 update 端点：正确透传 state 与 dismissed_reason / resolution。
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

import { typedRequest } from "@/lib/restapi/rest-core";
import {
  fetchDependabotAlerts,
  getDependabotAlert,
  updateDependabotAlert,
  fetchCodeScanningAlerts,
  getCodeScanningAlert,
  updateCodeScanningAlert,
  fetchSecretScanningAlerts,
  getSecretScanningAlert,
  updateSecretScanningAlert,
  type DependabotAlert,
  type CodeScanningAlert,
  type SecretScanningAlert,
} from "@/lib/restapi/rest-code-security";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Dependabot alerts", () => {
  it("fetch 透传 owner/repo/state/per_page 并兜底 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    await expect(fetchDependabotAlerts("o", "r", "gho_x", "open", 50)).resolves.toEqual([]);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { dependabot: { listAlertsForRepo: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.dependabot.listAlertsForRepo).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      state: "open",
      per_page: 50,
    });
  });

  it("get 透传 alert_number", async () => {
    const alert = { number: 1 } as DependabotAlert;
    mockTyped.mockResolvedValue(alert);
    await expect(getDependabotAlert("o", "r", 7)).resolves.toBe(alert);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { dependabot: { getAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.dependabot.getAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 7,
    });
  });

  it("update 透传 state 与 dismissed_reason", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await updateDependabotAlert(
      "o",
      "r",
      3,
      { state: "dismissed", dismissed_reason: "inaccurate" },
      "gho_x",
    );
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { dependabot: { updateAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.dependabot.updateAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 3,
      state: "dismissed",
      dismissed_reason: "inaccurate",
      dismissed_comment: undefined,
    });
  });
});

describe("Code scanning alerts", () => {
  it("fetch 透传 state 并兜底 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    await expect(fetchCodeScanningAlerts("o", "r", null, "open")).resolves.toEqual([]);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = {
      rest: { codeScanning: { listAlertsForRepo: vi.fn().mockResolvedValue({}) } },
    };
    await run(octokit as never);
    expect(octokit.rest.codeScanning.listAlertsForRepo).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      state: "open",
      per_page: 30,
    });
  });

  it("get 透传 alert_number", async () => {
    const alert = { number: 2 } as CodeScanningAlert;
    mockTyped.mockResolvedValue(alert);
    await expect(getCodeScanningAlert("o", "r", 9)).resolves.toBe(alert);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { codeScanning: { getAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.codeScanning.getAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 9,
    });
  });

  it("update 透传 state 与 dismissed_reason", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await updateCodeScanningAlert(
      "o",
      "r",
      4,
      { state: "dismissed", dismissed_reason: "won't fix" },
      "gho_x",
    );
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { codeScanning: { updateAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.codeScanning.updateAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 4,
      state: "dismissed",
      dismissed_reason: "won't fix",
      dismissed_comment: undefined,
    });
  });
});

describe("Secret scanning alerts", () => {
  it("fetch 透传 state 并兜底 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    await expect(fetchSecretScanningAlerts("o", "r", "gho_x", "resolved")).resolves.toEqual([]);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = {
      rest: { secretScanning: { listAlertsForRepo: vi.fn().mockResolvedValue({}) } },
    };
    await run(octokit as never);
    expect(octokit.rest.secretScanning.listAlertsForRepo).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      state: "resolved",
      per_page: 30,
    });
  });

  it("get 透传 alert_number", async () => {
    const alert = { number: 5 } as SecretScanningAlert;
    mockTyped.mockResolvedValue(alert);
    await expect(getSecretScanningAlert("o", "r", 11)).resolves.toBe(alert);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { secretScanning: { getAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.secretScanning.getAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 11,
    });
  });

  it("update 透传 state 与 resolution", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await updateSecretScanningAlert(
      "o",
      "r",
      6,
      { state: "resolved", resolution: "revoked" },
      "gho_x",
    );
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { secretScanning: { updateAlert: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.secretScanning.updateAlert).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      alert_number: 6,
      state: "resolved",
      resolution: "revoked",
      resolution_comment: undefined,
    });
  });
});
