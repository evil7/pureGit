/**
 * GitHub REST API - 仓库 Tags（官方 /tags）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 tag 列表/创建/删除适配（Repository
 * 仅 `refs`/`defaultBranchRef`，无 tags 列表；无 createTag/deleteRef mutation）。
 *
 * 创建 tag 需两步（Git 数据模型）：先 `git.createTag` 建 tag 对象拿到 sha，
 * 再 `git.createRef` 建 `refs/tags/{tag}` 引用。删除即 `git.deleteRef`（ref=tags/{tag}）。
 * 写操作需仓库写权限。
 */

import { typedRequest } from "./rest-core";

/** 仓库 tag（GET /repos/{o}/{r}/tags 单项） */
export interface RepoTag {
  name: string;
  commit: { sha: string; url: string };
  zipball_url: string;
  tarball_url: string;
  node_id: string;
}

/** 列出仓库 tags（REST GET /repos/{o}/{r}/tags） */
export async function fetchTags(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoTag[]> {
  const data = await typedRequest<RepoTag[]>(token, (octokit) =>
    octokit.rest.repos.listTags({ owner, repo, per_page: 100 }),
  );
  return data ?? [];
}

/** 创建轻量 tag 对象（仅 `git.createTag`，返回 tag 对象 sha；不建引用） */
export async function createTagObject(
  owner: string,
  repo: string,
  tag: string,
  message: string,
  objectSha: string,
  token: string,
): Promise<{ sha: string }> {
  return typedRequest<{ sha: string }>(token, (octokit) =>
    octokit.rest.git.createTag({
      owner,
      repo,
      tag,
      message,
      object: objectSha,
      type: "commit",
    }),
  );
}

/** 创建 tag 引用（`git.createRef`，ref=refs/tags/{tag}） */
export async function createTagRef(
  owner: string,
  repo: string,
  tag: string,
  sha: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.git.createRef({ owner, repo, ref: `refs/tags/${tag}`, sha }),
  );
}

/**
 * 创建 tag（组合两步：tag 对象 + 引用）。
 * objectSha 为目标 commit 的 sha（由调用方经 fetchBranches 拿分支最新 commit 提供）。
 */
export async function createTag(
  owner: string,
  repo: string,
  tag: string,
  message: string,
  objectSha: string,
  token: string,
): Promise<void> {
  const { sha } = await createTagObject(owner, repo, tag, message, objectSha, token);
  await createTagRef(owner, repo, tag, sha, token);
}

/** 删除 tag（`git.deleteRef`，ref=tags/{tag}） */
export async function deleteTag(
  owner: string,
  repo: string,
  tag: string,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.git.deleteRef({ owner, repo, ref: `tags/${tag}` }),
  );
}
