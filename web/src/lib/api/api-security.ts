/**
 * GitHub API smart layer - 仓库安全开关（官方 /settings/security_analysis Dependabot 区块）
 *
 * 整体 REST-only（红线例外，理由充分）：三个开关均为 legacy 三件套端点，GraphQL 无适配。
 * smart 层透明转发 REST（check 状态读取 + enable/disable 写入）。
 */

import { checkSecurityToggle, setSecurityToggle, fetchSecurityToggles } from "../restapi";
import type { SecurityToggleKind, SecurityToggles } from "../restapi";

/** 检查某开关是否启用（REST-only；204=启用，404=禁用） */
export async function checkSecurityToggleSmart(
  owner: string,
  repo: string,
  kind: SecurityToggleKind,
  token?: string | null,
): Promise<boolean> {
  return checkSecurityToggle(owner, repo, kind, token);
}

/** 设置某开关状态（REST-only） */
export async function setSecurityToggleSmart(
  owner: string,
  repo: string,
  kind: SecurityToggleKind,
  enabled: boolean,
  token: string,
): Promise<void> {
  return setSecurityToggle(owner, repo, kind, enabled, token);
}

/** 批量获取三个开关状态（REST-only） */
export async function fetchSecurityTogglesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<SecurityToggles> {
  return fetchSecurityToggles(owner, repo, token);
}
