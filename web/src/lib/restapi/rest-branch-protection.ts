/**
 * GitHub REST API - 分支保护（官方 /settings/branches）
 *
 * 整体 REST-only（红线例外，理由充分）：经典 branch protection（PUT
 * /branches/{branch}/protection 一套规则按分支名设置）在 GraphQL 中无对应——
 * GraphQL 仅提供 BranchProtectionRule（ruleset 新模型，需 pattern 匹配分支，字段
 * 嵌套极深），与经典保护是两套 API 面。故读取与写操作统一走 REST。
 *
 * 写操作需仓库管理员权限（页面由 RepoSettingsLayout 的 ADMIN 检查保护）。
 * 签名保护（required_signatures）为独立子端点，需 branch protection 已启用才可设置。
 */

import { typedRequest, ApiError } from "./rest-core";

/** 分支保护规则（GET /repos/{o}/{r}/branches/{branch}/protection 返回结构，已收窄） */
export interface BranchProtection {
  required_status_checks: {
    strict: boolean;
    contexts: string[];
  } | null;
  enforce_admins: { enabled: boolean };
  required_pull_request_reviews: {
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
    require_last_push_approval: boolean;
  } | null;
  restrictions: {
    users: { login: string }[];
    teams: { slug: string }[];
    apps: { slug: string }[];
  } | null;
  required_linear_history: { enabled: boolean };
  allow_force_pushes: { enabled: boolean };
  allow_deletions: { enabled: boolean };
  block_creations: { enabled: boolean };
  required_conversation_resolution: { enabled: boolean };
  required_signatures: { enabled: boolean };
  lock_branch: { enabled: boolean };
  allow_fork_syncing: { enabled: boolean };
}

/** 分支保护写操作入参（映射到 PUT /branches/{branch}/protection 请求体） */
export interface BranchProtectionInput {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: boolean | null;
  required_pull_request_reviews: {
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
    require_last_push_approval: boolean;
  } | null;
  restrictions: { users: string[]; teams: string[]; apps: string[] } | null;
  required_linear_history: boolean;
  allow_force_pushes: boolean | null;
  allow_deletions: boolean;
  block_creations: boolean;
  required_conversation_resolution: boolean;
  lock_branch: boolean;
  allow_fork_syncing: boolean;
}

/** 分支列表项（含保护状态，供设置页列表展示） */
export interface BranchListItem {
  name: string;
  protected: boolean;
}

/** 列出分支及保护状态（REST GET /repos/{o}/{r}/branches） */
export async function fetchBranchesWithProtection(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<BranchListItem[]> {
  const data = await typedRequest<BranchListItem[]>(token, (octokit) =>
    octokit.rest.repos.listBranches({ owner, repo, per_page: 100 }),
  );
  return data ?? [];
}

/** 获取分支保护规则（REST GET；未启用 404 → null） */
export async function fetchBranchProtection(
  owner: string,
  repo: string,
  branch: string,
  token?: string | null,
): Promise<BranchProtection | null> {
  try {
    return await typedRequest<BranchProtection>(token, (octokit) =>
      octokit.rest.repos.getBranchProtection({ owner, repo, branch }),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** 创建/更新分支保护规则（REST PUT；首次启用与后续更新共用） */
export async function updateBranchProtection(
  owner: string,
  repo: string,
  branch: string,
  input: BranchProtectionInput,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.updateBranchProtection({ owner, repo, branch, ...input }),
  );
}

/** 启用签名保护（REST POST required_signatures；需 branch protection 已启用） */
export async function createCommitSignatureProtection(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.createCommitSignatureProtection({ owner, repo, branch }),
  );
}

/** 关闭签名保护（REST DELETE required_signatures；未启用时 404 由调用方忽略） */
export async function deleteCommitSignatureProtection(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.deleteCommitSignatureProtection({ owner, repo, branch }),
  );
}

/**
 * 同步签名保护开关（幂等）。
 * 启用 → POST；关闭 → DELETE（未启用时 404 静默忽略，避免重复关闭报错）。
 */
export async function setCommitSignatureProtection(
  owner: string,
  repo: string,
  branch: string,
  enabled: boolean,
  token: string,
): Promise<void> {
  if (enabled) {
    await createCommitSignatureProtection(owner, repo, branch, token);
    return;
  }
  try {
    await deleteCommitSignatureProtection(owner, repo, branch, token);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
}

/**
 * 判断保护规则是否「全空」（无任何实质保护项启用）。
 * 仅统计构成保护的核心开关；allow_force_pushes/allow_deletions/lock_branch 等
 * 属「放宽」项（默认即保护态），不单独构成保护。
 */
export function isProtectionEmpty(input: BranchProtectionInput): boolean {
  return !(
    input.required_status_checks !== null ||
    input.enforce_admins === true ||
    input.required_pull_request_reviews !== null ||
    input.restrictions !== null ||
    input.required_linear_history === true ||
    input.block_creations === true ||
    input.required_conversation_resolution === true
  );
}
