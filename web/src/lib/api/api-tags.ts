/**
 * GitHub API smart layer - 仓库 Tags（官方 /tags）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 tag 列表/创建/删除适配。
 * smart 层透明转发 REST。
 */

import { fetchTags, createTag, deleteTag } from "../restapi";
import type { RepoTag } from "../restapi";

/** 列出仓库 tags（REST-only） */
export async function fetchTagsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoTag[]> {
  return fetchTags(owner, repo, token);
}

/** 创建 tag（REST-only，两步：tag 对象 + 引用） */
export async function createTagSmart(
  owner: string,
  repo: string,
  tag: string,
  message: string,
  objectSha: string,
  token: string,
): Promise<void> {
  return createTag(owner, repo, tag, message, objectSha, token);
}

/** 删除 tag（REST-only） */
export async function deleteTagSmart(
  owner: string,
  repo: string,
  tag: string,
  token: string,
): Promise<void> {
  return deleteTag(owner, repo, tag, token);
}
