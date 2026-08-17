/**
 * GitHub REST API - 仓库 GitHub Pages（官方 /settings/pages）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 Pages 端点（Repository 仅
 * `homepageUrl`，无 source/build_type/cname/构建记录）。读取与写操作统一走 REST。
 *
 * 写操作需仓库管理员权限（页面由 RepoSettingsLayout 的 ADMIN 检查保护）。
 * getPages 未启用时返回 404 → 归一为 null（页面显示「未启用」态）。
 */

import { typedRequest, ApiError } from "./rest-core";

/** GitHub Pages 站点（GET /repos/{o}/{r}/pages 返回结构） */
export interface RepoPages {
  /** 站点 URL（如 https://evil7.github.io/puregit-test/） */
  url: string;
  status: "built" | "building" | "errored" | null;
  /** 自定义域名（可空） */
  cname: string | null;
  custom_404: boolean;
  html_url?: string;
  /** 构建方式：legacy（分支构建）/ workflow（Actions 构建） */
  build_type: "legacy" | "workflow" | null;
  /** 分支构建来源（branch + path）；workflow 构建为 null */
  source: { branch: string; path: "/" | "/docs" } | null;
  public: boolean;
  https_enforced?: boolean;
  https_certificate?: {
    state: string;
    domain: string;
    expires_at?: string;
  } | null;
}

/** GitHub Pages 构建记录（GET /pages/builds 单项） */
export interface RepoPagesBuild {
  url: string;
  status: string;
  error: { message: string | null };
  commit: string;
  duration: number;
  created_at: string;
  updated_at: string;
}

/** 更新 Pages 站点入参 */
export interface PagesUpdateInput {
  cname?: string | null;
  https_enforced?: boolean;
  build_type?: "legacy" | "workflow";
  source?: { branch: string; path: "/" | "/docs" };
}

/** 获取 Pages 站点（REST GET /repos/{o}/{r}/pages；未启用 404 → null） */
export async function fetchPages(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoPages | null> {
  try {
    return await typedRequest<RepoPages>(token, (octokit) =>
      octokit.rest.repos.getPages({ owner, repo }),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** 创建 Pages 站点（REST POST /repos/{o}/{r}/pages；legacy 分支构建） */
export async function createPagesSite(
  owner: string,
  repo: string,
  branch: string,
  path: "/" | "/docs",
  token: string,
): Promise<RepoPages> {
  return typedRequest<RepoPages>(token, (octokit) =>
    octokit.rest.repos.createPagesSite({
      owner,
      repo,
      build_type: "legacy",
      source: { branch, path },
    }),
  );
}

/** 更新 Pages 站点（REST PUT /repos/{o}/{r}/pages；204 无响应体） */
export async function updatePagesSite(
  owner: string,
  repo: string,
  input: PagesUpdateInput,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.repos.updateInformationAboutPagesSite({
      owner,
      repo,
      ...(input.cname !== undefined ? { cname: input.cname } : {}),
      ...(input.https_enforced !== undefined ? { https_enforced: input.https_enforced } : {}),
      ...(input.build_type !== undefined ? { build_type: input.build_type } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
    }),
  );
}

/** 删除 Pages 站点（REST DELETE /repos/{o}/{r}/pages；204 无响应体） */
export async function deletePagesSite(owner: string, repo: string, token: string): Promise<void> {
  await typedRequest(token, (octokit) => octokit.rest.repos.deletePagesSite({ owner, repo }));
}

/** 列出 Pages 构建记录（REST GET /repos/{o}/{r}/pages/builds） */
export async function listPagesBuilds(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoPagesBuild[]> {
  return typedRequest<RepoPagesBuild[]>(token, (octokit) =>
    octokit.rest.repos.listPagesBuilds({ owner, repo, per_page: 30 }),
  );
}

/** 手动触发 Pages 构建（REST POST /repos/{o}/{r}/pages/builds） */
export async function requestPagesBuild(
  owner: string,
  repo: string,
  token: string,
): Promise<{ status: string }> {
  return typedRequest<{ status: string }>(token, (octokit) =>
    octokit.rest.repos.requestPagesBuild({ owner, repo }),
  );
}
