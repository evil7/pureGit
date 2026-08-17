/**
 * GitHub API smart layer - 仓库 Webhooks（官方 /settings/hooks）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 repository webhook 端点。
 * smart 层透明转发 REST。
 */

import {
  fetchRepoWebhooks,
  createRepoWebhook,
  updateRepoWebhook,
  deleteRepoWebhook,
  pingRepoWebhook,
  fetchWebhookDeliveries,
  redeliverWebhookDelivery,
} from "../restapi";
import type { RepoWebhook, RepoWebhookDelivery, WebhookInput } from "../restapi";

/** 列出仓库 webhooks（REST-only） */
export async function fetchRepoWebhooksSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoWebhook[]> {
  return fetchRepoWebhooks(owner, repo, token);
}

/** 创建 webhook（REST-only） */
export async function createRepoWebhookSmart(
  owner: string,
  repo: string,
  input: WebhookInput,
  token: string,
): Promise<RepoWebhook> {
  return createRepoWebhook(owner, repo, input, token);
}

/** 更新 webhook（REST-only） */
export async function updateRepoWebhookSmart(
  owner: string,
  repo: string,
  hookId: number,
  input: WebhookInput,
  token: string,
): Promise<RepoWebhook> {
  return updateRepoWebhook(owner, repo, hookId, input, token);
}

/** 删除 webhook（REST-only） */
export async function deleteRepoWebhookSmart(
  owner: string,
  repo: string,
  hookId: number,
  token: string,
): Promise<void> {
  return deleteRepoWebhook(owner, repo, hookId, token);
}

/** Ping webhook（REST-only） */
export async function pingRepoWebhookSmart(
  owner: string,
  repo: string,
  hookId: number,
  token: string,
): Promise<void> {
  return pingRepoWebhook(owner, repo, hookId, token);
}

/** 列出 webhook 投递记录（REST-only） */
export async function fetchWebhookDeliveriesSmart(
  owner: string,
  repo: string,
  hookId: number,
  token?: string | null,
): Promise<RepoWebhookDelivery[]> {
  return fetchWebhookDeliveries(owner, repo, hookId, token);
}

/** 重投 webhook 投递（REST-only） */
export async function redeliverWebhookDeliverySmart(
  owner: string,
  repo: string,
  hookId: number,
  deliveryId: number,
  token: string,
): Promise<void> {
  return redeliverWebhookDelivery(owner, repo, hookId, deliveryId, token);
}
