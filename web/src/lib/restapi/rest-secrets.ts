/**
 * GitHub REST API - 仓库 Secrets & Variables（官方 /settings/secrets/actions）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 secrets/variables 类型
 * （Repository 无相关字段），仅 REST `actions/ *secret* / *variable*` 端点可用。
 *
 * 安全约定（与官方一致）：
 * - secret 值**不可读回**（列表/详情仅返回 name + 时间），创建/更新前用仓库
 *   public key 做 libsodium `crypto_box_seal` 加密（encrypted_value + key_id）。
 * - variable 值为明文（可读回），创建/更新直接传 value。
 * - public key / secret 明文 value 仅存内存，不落 localStorage/日志。
 */

import { typedRequest } from "./rest-core";

// ===== Secrets =====

/** 仓库 Action secret（列表项；value 不可读回） */
export interface RepoSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

/** 仓库 public key（secrets 加密用；key 为 base64） */
export interface RepoPublicKey {
  key_id: string;
  key: string;
}

/** 列出仓库 Action secrets（REST GET /repos/{o}/{r}/actions/secrets） */
export async function fetchRepoSecrets(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoSecret[]> {
  const data = await typedRequest<{ secrets: RepoSecret[] }>(token, (octokit) =>
    octokit.rest.actions.listRepoSecrets({ owner, repo, per_page: 100 }),
  );
  return data.secrets ?? [];
}

/** 获取仓库 public key（REST GET /repos/{o}/{r}/actions/secrets/public-key） */
export async function fetchRepoPublicKey(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoPublicKey> {
  return typedRequest<RepoPublicKey>(token, (octokit) =>
    octokit.rest.actions.getRepoPublicKey({ owner, repo }),
  );
}

/** 用仓库 public key 加密 secret 值（libsodium crypto_box_seal，返回 base64） */
async function encryptSecretValue(value: string, publicKeyBase64: string): Promise<string> {
  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  const message = new TextEncoder().encode(value);
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(message, key);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

/** 创建或更新仓库 secret（REST PUT /repos/{o}/{r}/actions/secrets/{name}；同名覆盖） */
export async function upsertRepoSecret(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  const pub = await fetchRepoPublicKey(owner, repo, token);
  const encryptedValue = await encryptSecretValue(value, pub.key);
  await typedRequest(token, (octokit) =>
    octokit.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: name,
      encrypted_value: encryptedValue,
      key_id: pub.key_id,
    }),
  );
}

/** 删除仓库 secret（REST DELETE /repos/{o}/{r}/actions/secrets/{name}；204 无响应体） */
export async function deleteRepoSecret(
  owner: string,
  repo: string,
  name: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.actions.deleteRepoSecret({ owner, repo, secret_name: name }),
  );
}

// ===== Variables =====

/** 仓库 Action variable（value 明文可读） */
export interface RepoVariable {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

/** 列出仓库 Action variables（REST GET /repos/{o}/{r}/actions/variables） */
export async function fetchRepoVariables(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoVariable[]> {
  const data = await typedRequest<{ variables: RepoVariable[] }>(token, (octokit) =>
    octokit.rest.actions.listRepoVariables({ owner, repo, per_page: 100 }),
  );
  return data.variables ?? [];
}

/** 创建仓库 variable（REST POST /repos/{o}/{r}/actions/variables） */
export async function createRepoVariable(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.actions.createRepoVariable({ owner, repo, name, value }),
  );
}

/** 更新仓库 variable（REST PATCH /repos/{o}/{r}/actions/variables/{name}） */
export async function updateRepoVariable(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.actions.updateRepoVariable({ owner, repo, name, value }),
  );
}

/** 删除仓库 variable（REST DELETE /repos/{o}/{r}/actions/variables/{name}；204 无响应体） */
export async function deleteRepoVariable(
  owner: string,
  repo: string,
  name: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.actions.deleteRepoVariable({ owner, repo, name }),
  );
}
