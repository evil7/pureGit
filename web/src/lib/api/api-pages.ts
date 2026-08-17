/**
 * GitHub API smart layer - 仓库 GitHub Pages（官方 /settings/pages）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 Pages 端点。smart 层透明转发 REST。
 */

import {
  fetchPages,
  createPagesSite,
  updatePagesSite,
  deletePagesSite,
  listPagesBuilds,
  requestPagesBuild,
} from "../restapi";
import type { RepoPages, RepoPagesBuild, PagesUpdateInput } from "../restapi";

/** 获取 Pages 站点（未启用返回 null；REST-only） */
export async function fetchPagesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoPages | null> {
  return fetchPages(owner, repo, token);
}

/** 创建 Pages 站点（REST-only） */
export async function createPagesSiteSmart(
  owner: string,
  repo: string,
  branch: string,
  path: "/" | "/docs",
  token: string,
): Promise<RepoPages> {
  return createPagesSite(owner, repo, branch, path, token);
}

/** 更新 Pages 站点（REST-only） */
export async function updatePagesSiteSmart(
  owner: string,
  repo: string,
  input: PagesUpdateInput,
  token: string,
): Promise<void> {
  return updatePagesSite(owner, repo, input, token);
}

/** 删除 Pages 站点（REST-only） */
export async function deletePagesSiteSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
  return deletePagesSite(owner, repo, token);
}

/** 列出 Pages 构建记录（REST-only） */
export async function listPagesBuildsSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoPagesBuild[]> {
  return listPagesBuilds(owner, repo, token);
}

/** 手动触发 Pages 构建（REST-only） */
export async function requestPagesBuildSmart(
  owner: string,
  repo: string,
  token: string,
): Promise<{ status: string }> {
  return requestPagesBuild(owner, repo, token);
}
