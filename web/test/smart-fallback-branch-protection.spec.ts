/**
 * ============================================================================
 * api-branch-protection smart 决策 单元测试 —— 分支保护通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - 经典 branch protection 整体 REST-only（GraphQL 无适配）→ smart 层透明转发 REST。
 * - saveBranchProtectionSmart 编排：规则非空 → PUT + 签名开关同步；全空 → 删除 + 关签名。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchBranchesWithProtection: vi.fn(),
    fetchBranchProtection: vi.fn(),
    updateBranchProtection: vi.fn(),
    deleteBranchProtection: vi.fn(),
    setCommitSignatureProtection: vi.fn(),
  };
});

import {
  fetchBranchesWithProtectionSmart,
  fetchBranchProtectionSmart,
  saveBranchProtectionSmart,
} from "@/lib/api/api-branch-protection";
import type { SaveBranchProtectionInput } from "@/lib/api/api-branch-protection";
import {
  fetchBranchesWithProtection,
  fetchBranchProtection,
  updateBranchProtection,
  deleteBranchProtection,
  setCommitSignatureProtection,
  ApiError,
} from "@/lib/restapi";

const mList = vi.mocked(fetchBranchesWithProtection);
const mFetch = vi.mocked(fetchBranchProtection);
const mUpdate = vi.mocked(updateBranchProtection);
const mDelete = vi.mocked(deleteBranchProtection);
const mSig = vi.mocked(setCommitSignatureProtection);

beforeEach(() => {
  vi.clearAllMocks();
});

/** 主规则（不含签名保护开关，签名保护为独立子端点） */
function emptyRules(): Omit<SaveBranchProtectionInput, "requireSignedCommits"> {
  return {
    required_status_checks: null,
    enforce_admins: null,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: null,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: false,
    lock_branch: false,
    allow_fork_syncing: false,
  };
}

/** 全空规则（无任何保护项启用） */
function emptyInput(): SaveBranchProtectionInput {
  return { ...emptyRules(), requireSignedCommits: false };
}

describe("fetchBranchesWithProtectionSmart", () => {
  it("REST-only 透明转发 fetchBranchesWithProtection", async () => {
    const list = [{ name: "main", protected: true }];
    mList.mockResolvedValue(list);
    const result = await fetchBranchesWithProtectionSmart("o", "r", "gho_x");
    expect(result).toEqual(list);
    expect(mList).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("fetchBranchProtectionSmart", () => {
  it("REST-only 透明转发 fetchBranchProtection（未启用返回 null）", async () => {
    mFetch.mockResolvedValue(null);
    const result = await fetchBranchProtectionSmart("o", "r", "main", "gho_x");
    expect(result).toBeNull();
    expect(mFetch).toHaveBeenCalledWith("o", "r", "main", "gho_x");
  });
});

describe("saveBranchProtectionSmart", () => {
  it("规则非空 → PUT 更新 + 开启签名保护", async () => {
    mUpdate.mockResolvedValue(undefined);
    mSig.mockResolvedValue(undefined);
    const input: SaveBranchProtectionInput = {
      ...emptyInput(),
      required_status_checks: { strict: true, contexts: ["ci"] },
      requireSignedCommits: true,
    };
    await saveBranchProtectionSmart("o", "r", "main", input, "gho_x");
    expect(mUpdate).toHaveBeenCalledTimes(1);
    const args = mUpdate.mock.calls[0];
    expect(args[0]).toBe("o");
    expect(args[1]).toBe("r");
    expect(args[2]).toBe("main");
    expect(args[3]).toEqual({
      ...emptyRules(),
      required_status_checks: { strict: true, contexts: ["ci"] },
    });
    expect(mSig).toHaveBeenCalledWith("o", "r", "main", true, "gho_x");
  });

  it("规则非空 + 不签名 → PUT 更新 + 关闭签名保护", async () => {
    mUpdate.mockResolvedValue(undefined);
    mSig.mockResolvedValue(undefined);
    const input: SaveBranchProtectionInput = {
      ...emptyInput(),
      enforce_admins: true,
      requireSignedCommits: false,
    };
    await saveBranchProtectionSmart("o", "r", "main", input, "gho_x");
    expect(mUpdate).toHaveBeenCalledTimes(1);
    expect(mDelete).not.toHaveBeenCalled();
    expect(mSig).toHaveBeenCalledWith("o", "r", "main", false, "gho_x");
  });

  it("规则全空 → 删除保护 + 关闭签名保护", async () => {
    mDelete.mockResolvedValue(undefined);
    mSig.mockResolvedValue(undefined);
    await saveBranchProtectionSmart("o", "r", "main", emptyInput(), "gho_x");
    expect(mUpdate).not.toHaveBeenCalled();
    expect(mDelete).toHaveBeenCalledWith("o", "r", "main", "gho_x");
    expect(mSig).toHaveBeenCalledWith("o", "r", "main", false, "gho_x");
  });

  it("规则全空 + 删除 404 → 静默忽略并继续关闭签名保护", async () => {
    mDelete.mockRejectedValue(new ApiError(404, "Not Found"));
    mSig.mockResolvedValue(undefined);
    await saveBranchProtectionSmart("o", "r", "main", emptyInput(), "gho_x");
    expect(mDelete).toHaveBeenCalledWith("o", "r", "main", "gho_x");
    expect(mSig).toHaveBeenCalledWith("o", "r", "main", false, "gho_x");
  });
});
