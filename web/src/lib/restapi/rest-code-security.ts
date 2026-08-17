/**
 * GitHub REST API - 仓库安全告警（官方 Security 页 Dependabot / Code scanning / Secret scanning）
 *
 * 整体 REST-only（红线例外，理由充分）：三类 alerts 均为 REST 专属端点，GraphQL 无
 * 对应查询/mutation 适配（Security 页 GraphQL 仅有 securityAdvisories 公告，无 alerts）。
 * 读取与写操作统一走 REST。
 *
 * 列表/详情/状态更新三件套；列表按 state 过滤（默认 open），写操作需 security_events scope。
 */

import { typedRequest } from "./rest-core";

// ===== Dependabot alerts =====

/** Dependabot 告警（收窄到列表/详情展示所需字段） */
export interface DependabotAlert {
  number: number;
  state: "auto_dismissed" | "dismissed" | "fixed" | "open";
  /** security_advisory.severity */
  severity: "critical" | "high" | "medium" | "low";
  /** security_advisory.summary */
  summary: string;
  /** security_advisory.ghsa_id / cve_id */
  ghsa_id: string;
  cve_id: string | null;
  /** dependency.package */
  package_name: string;
  ecosystem: string;
  manifest_path: string | null;
  /** security_vulnerability.vulnerable_version_range / first_patched_version */
  vulnerable_version_range: string | null;
  first_patched_version: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  dismissed_at: string | null;
  fixed_at: string | null;
  dismissed_reason: string | null;
}

// ===== Code scanning alerts =====

/** Code scanning 告警（收窄） */
export interface CodeScanningAlert {
  number: number;
  state: "open" | "dismissed" | "fixed";
  /** rule.severity */
  severity: "error" | "warning" | "note" | string;
  /** rule.description */
  description: string;
  /** rule.security_severity_level */
  security_severity_level: "critical" | "high" | "medium" | "low" | string;
  /** tool.name */
  tool: string;
  /** most_recent_instance.message.text */
  message: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  dismissed_at: string | null;
  fixed_at: string | null;
  dismissed_reason: string | null;
}

// ===== Secret scanning alerts =====

/** Secret scanning 告警（收窄） */
export interface SecretScanningAlert {
  number: number;
  state: "open" | "resolved";
  secret_type: string;
  secret_type_display_name: string;
  resolution: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// ===== Dependabot =====

/** 列出 Dependabot 告警（GET /repos/{o}/{r}/dependabot/alerts） */
export async function fetchDependabotAlerts(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<DependabotAlert[]> {
  const data = await typedRequest<DependabotAlert[]>(token, (octokit) =>
    octokit.rest.dependabot.listAlertsForRepo({
      owner,
      repo,
      ...(state ? { state: state as never } : {}),
      per_page: perPage,
    }),
  );
  return data ?? [];
}

/** 获取单个 Dependabot 告警（GET /repos/{o}/{r}/dependabot/alerts/{n}） */
export async function getDependabotAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<DependabotAlert> {
  return typedRequest<DependabotAlert>(token, (octokit) =>
    octokit.rest.dependabot.getAlert({ owner, repo, alert_number: alertNumber }),
  );
}

/** 更新 Dependabot 告警（PATCH；state=dismissed 需 dismissed_reason） */
export async function updateDependabotAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "dismissed" | "open"; dismissed_reason?: string; dismissed_comment?: string },
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.dependabot.updateAlert({
      owner,
      repo,
      alert_number: alertNumber,
      state: body.state,
      dismissed_reason: body.dismissed_reason as never,
      dismissed_comment: body.dismissed_comment,
    }),
  );
}

// ===== Code scanning =====

/** 列出 Code scanning 告警（GET /repos/{o}/{r}/code-scanning/alerts） */
export async function fetchCodeScanningAlerts(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<CodeScanningAlert[]> {
  const data = await typedRequest<CodeScanningAlert[]>(token, (octokit) =>
    octokit.rest.codeScanning.listAlertsForRepo({
      owner,
      repo,
      ...(state ? { state: state as never } : {}),
      per_page: perPage,
    }),
  );
  return data ?? [];
}

/** 获取单个 Code scanning 告警（GET /repos/{o}/{r}/code-scanning/alerts/{n}） */
export async function getCodeScanningAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<CodeScanningAlert> {
  return typedRequest<CodeScanningAlert>(token, (octokit) =>
    octokit.rest.codeScanning.getAlert({ owner, repo, alert_number: alertNumber }),
  );
}

/** 更新 Code scanning 告警（PATCH；state=dismissed 需 dismissed_reason） */
export async function updateCodeScanningAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "dismissed" | "open"; dismissed_reason?: string; dismissed_comment?: string },
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.codeScanning.updateAlert({
      owner,
      repo,
      alert_number: alertNumber,
      state: body.state,
      dismissed_reason: body.dismissed_reason as never,
      dismissed_comment: body.dismissed_comment,
    }),
  );
}

// ===== Secret scanning =====

/** 列出 Secret scanning 告警（GET /repos/{o}/{r}/secret-scanning/alerts） */
export async function fetchSecretScanningAlerts(
  owner: string,
  repo: string,
  token?: string | null,
  state?: string,
  perPage = 30,
): Promise<SecretScanningAlert[]> {
  const data = await typedRequest<SecretScanningAlert[]>(token, (octokit) =>
    octokit.rest.secretScanning.listAlertsForRepo({
      owner,
      repo,
      ...(state ? { state: state as never } : {}),
      per_page: perPage,
    }),
  );
  return data ?? [];
}

/** 获取单个 Secret scanning 告警（GET /repos/{o}/{r}/secret-scanning/alerts/{n}） */
export async function getSecretScanningAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  token?: string | null,
): Promise<SecretScanningAlert> {
  return typedRequest<SecretScanningAlert>(token, (octokit) =>
    octokit.rest.secretScanning.getAlert({ owner, repo, alert_number: alertNumber }),
  );
}

/** 更新 Secret scanning 告警（PATCH；state=resolved 需 resolution） */
export async function updateSecretScanningAlert(
  owner: string,
  repo: string,
  alertNumber: number,
  body: { state: "open" | "resolved"; resolution?: string; resolution_comment?: string },
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.secretScanning.updateAlert({
      owner,
      repo,
      alert_number: alertNumber,
      state: body.state,
      resolution: body.resolution as never,
      resolution_comment: body.resolution_comment,
    }),
  );
}
