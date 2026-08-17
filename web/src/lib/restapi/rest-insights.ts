/**
 * GitHub REST API - Insights 图表子页（Traffic / Stats / Community）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 traffic/commit-stats/community
 * 端点（这些是仓库统计聚合，GitHub 仅 REST 提供）。页面直接经本层调用，无 smart 层。
 *
 * 202 语义：`/stats/*` 端点首次请求时 GitHub 后台计算中返回 202（Accepted），
 * 客户端应稍后重试。本层对 202 统一降级为空数据（页面显示空态，不报错）。
 */

import { typedRequest, ApiError } from "./rest-core";
import type { GitHubUser } from "./rest-core";

// ===== Traffic（需 push 权限；登录 token）=====

/** 单个时间点流量计数（clones/views 通用） */
export interface TrafficPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

/** 克隆统计（GET /traffic/clones） */
export interface ClonesStats {
  count: number;
  uniques: number;
  clones: TrafficPoint[];
}

/** 访问统计（GET /traffic/views） */
export interface ViewsStats {
  count: number;
  uniques: number;
  views: TrafficPoint[];
}

/** 热门路径（GET /traffic/popular/paths） */
export interface TopPath {
  path: string;
  title: string;
  count: number;
  uniques: number;
}

/** 热门来源（GET /traffic/popular/referrers） */
export interface TopReferrer {
  referrer: string;
  count: number;
  uniques: number;
}

/** 获取克隆统计（REST GET /repos/{o}/{r}/traffic/clones） */
export async function fetchClonesStats(
  owner: string,
  repo: string,
  token: string,
): Promise<ClonesStats> {
  return typedRequest<ClonesStats>(token, (octokit) =>
    octokit.rest.repos.getClones({ owner, repo, per: "day" }),
  );
}

/** 获取访问统计（REST GET /repos/{o}/{r}/traffic/views） */
export async function fetchViewsStats(
  owner: string,
  repo: string,
  token: string,
): Promise<ViewsStats> {
  return typedRequest<ViewsStats>(token, (octokit) =>
    octokit.rest.repos.getViews({ owner, repo, per: "day" }),
  );
}

/** 获取热门路径（REST GET /repos/{o}/{r}/traffic/popular/paths） */
export async function fetchTopPaths(
  owner: string,
  repo: string,
  token: string,
): Promise<TopPath[]> {
  return typedRequest<TopPath[]>(token, (octokit) =>
    octokit.rest.repos.getTopPaths({ owner, repo }),
  );
}

/** 获取热门来源（REST GET /repos/{o}/{r}/traffic/popular/referrers） */
export async function fetchTopReferrers(
  owner: string,
  repo: string,
  token: string,
): Promise<TopReferrer[]> {
  return typedRequest<TopReferrer[]>(token, (octokit) =>
    octokit.rest.repos.getTopReferrers({ owner, repo }),
  );
}

// ===== Stats（公开；首次可能 202 → 空数据）=====

/** 贡献者周提交（GET /stats/contributors 单项） */
export interface ContributorStats {
  author: GitHubUser;
  total: number;
  weeks: { w: number; a: number; d: number; c: number }[];
}

/** 代码频率（GET /stats/code_frequency；三元组 [week_ts, additions, deletions]） */
export type CodeFrequencyPoint = [number, number, number];

/** 提交活动（GET /stats/commit_activity；一年 52 周） */
export interface CommitActivityWeek {
  days: number[];
  total: number;
  week: number;
}

/** 参与度（GET /stats/participation） */
export interface ParticipationStats {
  all: number[];
  owner: number[];
}

/** 打卡图（GET /stats/punch_card；三元组 [day, hour, commits]） */
export type PunchCardPoint = [number, number, number];

/** 获取贡献者提交统计（REST GET /stats/contributors） */
export async function fetchContributorsStats(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<ContributorStats[]> {
  return statsOrEmpty<ContributorStats[]>(token, [], (octokit) =>
    octokit.rest.repos.getContributorsStats({ owner, repo }),
  );
}

/** 获取代码频率（REST GET /stats/code_frequency） */
export async function fetchCodeFrequencyStats(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<CodeFrequencyPoint[]> {
  return statsOrEmpty<CodeFrequencyPoint[]>(token, [], (octokit) =>
    octokit.rest.repos.getCodeFrequencyStats({ owner, repo }),
  );
}

/** 获取提交活动（REST GET /stats/commit_activity） */
export async function fetchCommitActivityStats(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<CommitActivityWeek[]> {
  return statsOrEmpty<CommitActivityWeek[]>(token, [], (octokit) =>
    octokit.rest.repos.getCommitActivityStats({ owner, repo }),
  );
}

/** 获取参与度（REST GET /stats/participation） */
export async function fetchParticipationStats(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<ParticipationStats> {
  return statsOrEmpty<ParticipationStats>(token, { all: [], owner: [] }, (octokit) =>
    octokit.rest.repos.getParticipationStats({ owner, repo }),
  );
}

/** 获取打卡图（REST GET /stats/punch_card） */
export async function fetchPunchCardStats(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<PunchCardPoint[]> {
  return statsOrEmpty<PunchCardPoint[]>(token, [], (octokit) =>
    octokit.rest.repos.getPunchCardStats({ owner, repo }),
  );
}

/** stats 端点「空响应」判定：null / 空串 / 空 JSON 对象 {} 均视为无数据 */
function isEmptyStatsData(data: unknown): boolean {
  if (data == null) return true;
  if (data === "") return true;
  // 202 时 GitHub 可能返回空 JSON 对象 {}（body 为 "{\n\n}"），octokit 解析为 {}。
  if (
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data as object).length === 0
  ) {
    return true;
  }
  return false;
}

/** stats 端点 202（计算中）→ 返回空数据；其余错误原样抛出 */
async function statsOrEmpty<T>(
  token: string | null | undefined,
  empty: T,
  run: (octokit: import("@octokit/rest").Octokit) => Promise<{ data: any }>,
): Promise<T> {
  try {
    const data = await typedRequest<T>(token, run);
    // GitHub /stats/* 首次请求返回 202（后台计算中）时，octokit 对 2xx 不抛错，
    // data 可能为 undefined / 空串 / 空 JSON 对象 {}——按空数据兜底（否则页面 .map 对非数组报错）。
    if (isEmptyStatsData(data)) return empty;
    return data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 202) {
      return empty;
    }
    throw e;
  }
}

// ===== Community（社区画像 + CODEOWNERS 错误）=====

/** 社区画像文件状态（GET /community/profile files 子项） */
export interface CommunityFile {
  url: string | null;
  html_url: string | null;
}

/** 社区画像（GET /community/profile） */
export interface CommunityProfile {
  health_percentage: number;
  description: string | null;
  documentation: string | null;
  files: {
    code_of_conduct: CommunityFile | null;
    contributing: CommunityFile | null;
    license: CommunityFile | null;
    readme: CommunityFile | null;
    issue_template: CommunityFile | null;
    pull_request_template: CommunityFile | null;
  };
  updated_at: string | null;
}

/** CODEOWNERS 错误项（GET /codeowners/errors） */
export interface CodeownersError {
  line: number;
  column: number;
  source: string;
  kind: string;
  suggestion: string | null;
  message: string;
  path: string;
}

/** 获取社区画像（REST GET /community/profile） */
export async function fetchCommunityProfileMetrics(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<CommunityProfile> {
  return typedRequest<CommunityProfile>(token, (octokit) =>
    octokit.rest.repos.getCommunityProfileMetrics({ owner, repo }),
  );
}

/** 获取 CODEOWNERS 错误（REST GET /codeowners/errors） */
export async function fetchCodeownersErrors(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<CodeownersError[]> {
  const data = await typedRequest<{ errors: CodeownersError[] }>(token, (octokit) =>
    octokit.rest.repos.codeownersErrors({ owner, repo }),
  );
  return data.errors ?? [];
}
