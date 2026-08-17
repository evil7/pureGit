/**
 * GitHub REST API - 仓库安全开关（官方 /settings/security_analysis 的 Dependabot 区块）
 *
 * 三个独立开关（区别于 security_and_analysis 对象字段，走各自的 enable/disable/check 三件套）：
 * - Dependabot alerts（vulnerability-alerts）
 * - Dependabot security updates（automated-security-fixes）
 * - Private vulnerability reporting（private-vulnerability-reporting）
 *
 * 整体 REST-only（红线例外，理由充分）：三者均为 legacy 三件套端点，GraphQL 无对应
 * mutation/字段适配；check 端点用 204=启用 / 404=禁用 表达状态，语义天然 REST。
 */

import { typedRequest, ApiError } from "./rest-core";
import type { Octokit } from "@octokit/rest";

/** 三态开关标识 */
export type SecurityToggleKind =
  | "vulnerabilityAlerts"
  | "automatedSecurityFixes"
  | "privateVulnerabilityReporting";

/** 三态开关状态汇总 */
export interface SecurityToggles {
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
}

/** 每个开关的 check/enable/disable 端点方法映射 */
const TOGGLE_ENDPOINTS: Record<
  SecurityToggleKind,
  {
    check: (o: Octokit, owner: string, repo: string) => Promise<{ data: unknown }>;
    enable: (o: Octokit, owner: string, repo: string) => Promise<{ data: unknown }>;
    disable: (o: Octokit, owner: string, repo: string) => Promise<{ data: unknown }>;
  }
> = {
  vulnerabilityAlerts: {
    check: (o, owner, repo) => o.rest.repos.checkVulnerabilityAlerts({ owner, repo }),
    enable: (o, owner, repo) => o.rest.repos.enableVulnerabilityAlerts({ owner, repo }),
    disable: (o, owner, repo) => o.rest.repos.disableVulnerabilityAlerts({ owner, repo }),
  },
  automatedSecurityFixes: {
    check: (o, owner, repo) => o.rest.repos.checkAutomatedSecurityFixes({ owner, repo }),
    enable: (o, owner, repo) => o.rest.repos.enableAutomatedSecurityFixes({ owner, repo }),
    disable: (o, owner, repo) => o.rest.repos.disableAutomatedSecurityFixes({ owner, repo }),
  },
  privateVulnerabilityReporting: {
    check: (o, owner, repo) => o.rest.repos.checkPrivateVulnerabilityReporting({ owner, repo }),
    enable: (o, owner, repo) => o.rest.repos.enablePrivateVulnerabilityReporting({ owner, repo }),
    disable: (o, owner, repo) => o.rest.repos.disablePrivateVulnerabilityReporting({ owner, repo }),
  },
};

/** 检查某开关是否启用（check 端点 204=启用，404=禁用） */
export async function checkSecurityToggle(
  owner: string,
  repo: string,
  kind: SecurityToggleKind,
  token?: string | null,
): Promise<boolean> {
  try {
    await typedRequest<unknown>(token, (o) => TOGGLE_ENDPOINTS[kind].check(o, owner, repo));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

/** 设置某开关状态（enabled → PUT 启用，否则 DELETE 禁用） */
export async function setSecurityToggle(
  owner: string,
  repo: string,
  kind: SecurityToggleKind,
  enabled: boolean,
  token: string,
): Promise<void> {
  await typedRequest<unknown>(token, (o) =>
    enabled
      ? TOGGLE_ENDPOINTS[kind].enable(o, owner, repo)
      : TOGGLE_ENDPOINTS[kind].disable(o, owner, repo),
  );
}

/** 批量获取三个开关状态（并发 check；单项失败会整体抛出，由调用方兜底空态） */
export async function fetchSecurityToggles(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<SecurityToggles> {
  const [vulnerabilityAlerts, automatedSecurityFixes, privateVulnerabilityReporting] =
    await Promise.all([
      checkSecurityToggle(owner, repo, "vulnerabilityAlerts", token),
      checkSecurityToggle(owner, repo, "automatedSecurityFixes", token),
      checkSecurityToggle(owner, repo, "privateVulnerabilityReporting", token),
    ]);
  return { vulnerabilityAlerts, automatedSecurityFixes, privateVulnerabilityReporting };
}
