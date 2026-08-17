/**
 * GitHub API smart layer - 分支保护（官方 /settings/branches）
 *
 * 整体 REST-only（红线例外，理由充分）：经典 branch protection 无 GraphQL 适配
 * （GraphQL 仅 BranchProtectionRule ruleset 新模型，字段嵌套极深，见 rest 层理由）。
 * smart 层透明转发 REST，并对「保存」做编排：主规则 PUT + 签名保护开关同步，
 * 全空规则时转为删除保护。
 */

import {
  fetchBranchesWithProtection,
  fetchBranchProtection,
  updateBranchProtection,
  deleteBranchProtection,
  setCommitSignatureProtection,
  isProtectionEmpty,
  ApiError,
} from "../restapi";
import type { BranchProtection, BranchProtectionInput, BranchListItem } from "../restapi";

/** 保存入参：主规则 + 签名保护开关（签名保护为独立子端点，需单独同步） */
export interface SaveBranchProtectionInput extends BranchProtectionInput {
  requireSignedCommits: boolean;
}

/** 列出分支及保护状态（REST-only） */
export async function fetchBranchesWithProtectionSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<BranchListItem[]> {
  return fetchBranchesWithProtection(owner, repo, token);
}

/** 获取分支保护规则（未启用返回 null；REST-only） */
export async function fetchBranchProtectionSmart(
  owner: string,
  repo: string,
  branch: string,
  token?: string | null,
): Promise<BranchProtection | null> {
  return fetchBranchProtection(owner, repo, branch, token);
}

/**
 * 保存分支保护规则（REST-only，含编排）：
 * - 规则全空 → 删除保护（幂等，404 忽略）+ 关闭签名保护。
 * - 否则 → PUT 全量更新主规则 + 按开关同步签名保护。
 */
export async function saveBranchProtectionSmart(
  owner: string,
  repo: string,
  branch: string,
  input: SaveBranchProtectionInput,
  token: string,
): Promise<void> {
  const { requireSignedCommits, ...rules } = input;
  if (isProtectionEmpty(rules)) {
    try {
      await deleteBranchProtection(owner, repo, branch, token);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    await setCommitSignatureProtection(owner, repo, branch, false, token);
    return;
  }
  await updateBranchProtection(owner, repo, branch, rules, token);
  await setCommitSignatureProtection(owner, repo, branch, requireSignedCommits, token);
}
