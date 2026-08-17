/**
 * GitHub API smart layer - 仓库 deploy keys 管理（官方 /settings/keys）
 *
 * 整体 REST-only（红线例外，理由充分）：
 * - GraphQL 无 deploy key 写 mutation（add/delete 均无）；
 * - GraphQL DeployKey 仅暴露 node id（base64），无数字 id 字段，而 REST 删除
 *   仅接受数字 key_id——读取走 GraphQL 拿不到删除所需的数字 id，无法与写操作衔接。
 * 故读取与写操作统一走 REST（数字 id 贯穿增删查），smart 层透明转发。
 */

import { fetchDeployKeys, addDeployKey, deleteDeployKey } from "../restapi";
import type { RepoDeployKey } from "../restapi";

/** 获取 deploy keys（REST-only，见文件头理由） */
export async function fetchDeployKeysSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoDeployKey[]> {
  return fetchDeployKeys(owner, repo, token);
}

/** 添加 deploy key（REST-only；GraphQL 无 mutation）。 */
export async function addDeployKeySmart(
  owner: string,
  repo: string,
  title: string,
  key: string,
  readOnly: boolean,
  token: string,
): Promise<RepoDeployKey> {
  return addDeployKey(owner, repo, title, key, readOnly, token);
}

/** 删除 deploy key（REST-only；GraphQL 无 mutation）。 */
export async function deleteDeployKeySmart(
  owner: string,
  repo: string,
  keyId: number,
  token: string,
): Promise<void> {
  return deleteDeployKey(owner, repo, keyId, token);
}
