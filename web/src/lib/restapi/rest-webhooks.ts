/**
 * GitHub REST API - 仓库 Webhooks（官方 /settings/hooks）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 repository webhook 端点
 * （webhook 为 REST 专属能力）。读取与写操作统一走 REST。
 *
 * 字段契约（对齐官方 Webhook 结构）：
 * - config.url（必填）/ content_type（json|form）/ secret（HMAC 签名，可空）/ insecure_ssl（"0"|"1"）
 * - events（事件名数组，默认 ["push"]）
 * - active（是否投递）
 * - last_response（最近一次投递状态：code/status/message）
 */

import { typedRequest } from "./rest-core";

/** 仓库 webhook config（URL / 内容类型 / 密钥 / SSL 校验） */
export interface RepoWebhookConfig {
  url: string;
  content_type: "json" | "form";
  secret?: string;
  insecure_ssl?: string;
}

/** 仓库 webhook（列表项 + 详情） */
export interface RepoWebhook {
  id: number;
  name: string;
  active: boolean;
  events: string[];
  config: RepoWebhookConfig;
  last_response: {
    code: number | null;
    status: string | null;
    message: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

/** webhook 投递记录（列表项） */
export interface RepoWebhookDelivery {
  id: number;
  guid: string;
  delivered_at: string;
  redelivery: boolean;
  duration: number;
  status: string;
  status_code: number;
  event: string;
  action: string | null;
}

/** webhook 事件清单（value = GitHub 事件名；labelKey = i18n 键） */
export const WEBHOOK_EVENTS: { value: string; labelKey: string }[] = [
  { value: "push", labelKey: "repoWebhooks.evt.push" },
  { value: "pull_request", labelKey: "repoWebhooks.evt.pullRequest" },
  { value: "pull_request_review", labelKey: "repoWebhooks.evt.pullRequestReview" },
  { value: "pull_request_review_comment", labelKey: "repoWebhooks.evt.pullRequestReviewComment" },
  { value: "issues", labelKey: "repoWebhooks.evt.issues" },
  { value: "issue_comment", labelKey: "repoWebhooks.evt.issueComment" },
  { value: "commit_comment", labelKey: "repoWebhooks.evt.commitComment" },
  { value: "create", labelKey: "repoWebhooks.evt.create" },
  { value: "delete", labelKey: "repoWebhooks.evt.delete" },
  { value: "fork", labelKey: "repoWebhooks.evt.fork" },
  { value: "star", labelKey: "repoWebhooks.evt.star" },
  { value: "watch", labelKey: "repoWebhooks.evt.watch" },
  { value: "release", labelKey: "repoWebhooks.evt.release" },
  { value: "deployment", labelKey: "repoWebhooks.evt.deployment" },
  { value: "deployment_status", labelKey: "repoWebhooks.evt.deploymentStatus" },
  { value: "status", labelKey: "repoWebhooks.evt.status" },
  { value: "check_run", labelKey: "repoWebhooks.evt.checkRun" },
  { value: "check_suite", labelKey: "repoWebhooks.evt.checkSuite" },
  { value: "discussion", labelKey: "repoWebhooks.evt.discussion" },
  { value: "discussion_comment", labelKey: "repoWebhooks.evt.discussionComment" },
  { value: "member", labelKey: "repoWebhooks.evt.member" },
  { value: "public", labelKey: "repoWebhooks.evt.public" },
  { value: "repository", labelKey: "repoWebhooks.evt.repository" },
  { value: "workflow_run", labelKey: "repoWebhooks.evt.workflowRun" },
  { value: "workflow_job", labelKey: "repoWebhooks.evt.workflowJob" },
  { value: "label", labelKey: "repoWebhooks.evt.label" },
  { value: "milestone", labelKey: "repoWebhooks.evt.milestone" },
  { value: "page_build", labelKey: "repoWebhooks.evt.pageBuild" },
  { value: "code_scanning_alert", labelKey: "repoWebhooks.evt.codeScanningAlert" },
  { value: "dependabot_alert", labelKey: "repoWebhooks.evt.dependabotAlert" },
  { value: "secret_scanning_alert", labelKey: "repoWebhooks.evt.secretScanningAlert" },
];

/** 创建/更新 webhook 的入参 */
export interface WebhookInput {
  url: string;
  contentType: "json" | "form";
  secret?: string;
  insecureSsl?: boolean;
  events: string[];
  active: boolean;
}

/** 列出仓库 webhooks（REST GET /repos/{o}/{r}/hooks） */
export async function fetchRepoWebhooks(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoWebhook[]> {
  return typedRequest<RepoWebhook[]>(token, (octokit) =>
    octokit.rest.repos.listWebhooks({ owner, repo, per_page: 100 }),
  );
}

/** 创建 webhook（REST POST /repos/{o}/{r}/hooks） */
export async function createRepoWebhook(
  owner: string,
  repo: string,
  input: WebhookInput,
  token: string,
): Promise<RepoWebhook> {
  return typedRequest<RepoWebhook>(token, (octokit) =>
    octokit.rest.repos.createWebhook({
      owner,
      repo,
      name: "web",
      active: input.active,
      events: input.events,
      config: webhookConfigToRest(input),
    }),
  );
}

/** 更新 webhook（REST PATCH /repos/{o}/{r}/hooks/{hook_id}；events 整体替换） */
export async function updateRepoWebhook(
  owner: string,
  repo: string,
  hookId: number,
  input: WebhookInput,
  token: string,
): Promise<RepoWebhook> {
  return typedRequest<RepoWebhook>(token, (octokit) =>
    octokit.rest.repos.updateWebhook({
      owner,
      repo,
      hook_id: hookId,
      active: input.active,
      events: input.events,
      config: webhookConfigToRest(input),
    }),
  );
}

/** 删除 webhook（REST DELETE /repos/{o}/{r}/hooks/{hook_id}；204 无响应体） */
export async function deleteRepoWebhook(
  owner: string,
  repo: string,
  hookId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.deleteWebhook({ owner, repo, hook_id: hookId }),
  );
}

/** Ping webhook（REST POST /repos/{o}/{r}/hooks/{hook_id}/pings；204） */
export async function pingRepoWebhook(
  owner: string,
  repo: string,
  hookId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.pingWebhook({ owner, repo, hook_id: hookId }),
  );
}

/** 列出 webhook 投递记录（REST GET /repos/{o}/{r}/hooks/{hook_id}/deliveries） */
export async function fetchWebhookDeliveries(
  owner: string,
  repo: string,
  hookId: number,
  token?: string | null,
): Promise<RepoWebhookDelivery[]> {
  return typedRequest<RepoWebhookDelivery[]>(token, (octokit) =>
    octokit.rest.repos.listWebhookDeliveries({
      owner,
      repo,
      hook_id: hookId,
      per_page: 30,
    }),
  );
}

/** 重投 webhook 投递（REST POST .../deliveries/{id}/attempts；202） */
export async function redeliverWebhookDelivery(
  owner: string,
  repo: string,
  hookId: number,
  deliveryId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.redeliverWebhookDelivery({
      owner,
      repo,
      hook_id: hookId,
      delivery_id: deliveryId,
    }),
  );
}

/** 内部：WebhookInput → REST config 结构（secret/insecure_ssl 空值不传） */
function webhookConfigToRest(input: WebhookInput): {
  url: string;
  content_type: "json" | "form";
  secret?: string;
  insecure_ssl?: string;
} {
  return {
    url: input.url,
    content_type: input.contentType,
    ...(input.secret ? { secret: input.secret } : {}),
    insecure_ssl: input.insecureSsl ? "1" : "0",
  };
}
