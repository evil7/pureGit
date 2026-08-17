/**
 * GitHub API smart layer - 仓库安全告警（官方 Security 页 Dependabot / Code scanning / Secret scanning）
 *
 * 整体 REST-only（红线例外，理由充分）：三类 alerts 均为 REST 专属端点，GraphQL 无适配。
 * smart 层透明转发 REST（列表/详情/状态更新）。
 */

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
} from "../restapi";
import type { DependabotAlert, CodeScanningAlert, SecretScanningAlert } from "../restapi";

// ===== Dependabot =====

export async function fetchDependabotAlertsSmart(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<DependabotAlert[]> {
  return fetchDependabotAlerts(owner, repo, token, state, perPage);
}

export async function getDependabotAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<DependabotAlert> {
  return getDependabotAlert(owner, repo, alertNumber, token);
}

export async function updateDependabotAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "dismissed" | "open"; dismissed_reason?: string; dismissed_comment?: string },
  token: string,
): Promise<void> {
  return updateDependabotAlert(owner, repo, alertNumber, body, token);
}

// ===== Code scanning =====

export async function fetchCodeScanningAlertsSmart(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<CodeScanningAlert[]> {
  return fetchCodeScanningAlerts(owner, repo, token, state, perPage);
}

export async function getCodeScanningAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<CodeScanningAlert> {
  return getCodeScanningAlert(owner, repo, alertNumber, token);
}

export async function updateCodeScanningAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "dismissed" | "open"; dismissed_reason?: string; dismissed_comment?: string },
  token: string,
): Promise<void> {
  return updateCodeScanningAlert(owner, repo, alertNumber, body, token);
}

// ===== Secret scanning =====

export async function fetchSecretScanningAlertsSmart(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<SecretScanningAlert[]> {
  return fetchSecretScanningAlerts(owner, repo, token, state, perPage);
}

export async function getSecretScanningAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<SecretScanningAlert> {
  return getSecretScanningAlert(owner, repo, alertNumber, token);
}

export async function updateSecretScanningAlertSmart(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "open" | "resolved"; resolution?: string; resolution_comment?: string },
  token: string,
): Promise<void> {
  return updateSecretScanningAlert(owner, repo, alertNumber, body, token);
}
