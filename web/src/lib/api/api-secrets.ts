/**
 * GitHub API smart layer - 仓库 Secrets & Variables（官方 /settings/secrets/actions）
 *
 * 整体 REST-only（红线例外，理由充分）：
 * - GraphQL 无 secrets/variables 类型（Repository 无相关字段）；
 * - secret 值需仓库 public key 加密（libsodium），REST 专有流程。
 * 故读取与写操作统一走 REST，smart 层透明转发。
 */

import {
  fetchRepoSecrets,
  fetchRepoVariables,
  upsertRepoSecret,
  deleteRepoSecret,
  createRepoVariable,
  updateRepoVariable,
  deleteRepoVariable,
} from "../restapi";
import type { RepoSecret, RepoVariable } from "../restapi";

/** 列出仓库 secrets（REST-only） */
export async function fetchRepoSecretsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoSecret[]> {
  return fetchRepoSecrets(owner, repo, token);
}

/** 列出仓库 variables（REST-only） */
export async function fetchRepoVariablesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoVariable[]> {
  return fetchRepoVariables(owner, repo, token);
}

/** 创建或更新 secret（REST-only；值加密由 REST 层承担） */
export async function upsertRepoSecretSmart(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  return upsertRepoSecret(owner, repo, name, value, token);
}

/** 删除 secret（REST-only） */
export async function deleteRepoSecretSmart(
  owner: string,
  repo: string,
  name: string,
  token: string,
): Promise<void> {
  return deleteRepoSecret(owner, repo, name, token);
}

/** 创建 variable（REST-only） */
export async function createRepoVariableSmart(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  return createRepoVariable(owner, repo, name, value, token);
}

/** 更新 variable（REST-only） */
export async function updateRepoVariableSmart(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  return updateRepoVariable(owner, repo, name, value, token);
}

/** 删除 variable（REST-only） */
export async function deleteRepoVariableSmart(
  owner: string,
  repo: string,
  name: string,
  token: string,
): Promise<void> {
  return deleteRepoVariable(owner, repo, name, token);
}
