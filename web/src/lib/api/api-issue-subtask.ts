/**
 * GitHub API smart layer - issue 子任务与依赖（官方 issue 详情侧栏）
 *
 * 整体 REST-only（红线例外，理由充分）：GraphQL 无 sub-issue / dependency 适配。
 * smart 层透明转发 REST。
 */

import {
  fetchSubIssues,
  fetchParentIssue,
  addSubIssue,
  removeSubIssue,
  fetchBlockedByDependencies,
  addBlockedByDependency,
  removeBlockedByDependency,
} from "../restapi";
import type { Issue } from "../restapi";

/** 列出子任务（REST-only） */
export async function fetchSubIssuesSmart(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue[]> {
  return fetchSubIssues(owner, repo, issueNumber, token);
}

/** 获取父 issue（REST-only；无父返回 null） */
export async function fetchParentIssueSmart(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue | null> {
  return fetchParentIssue(owner, repo, issueNumber, token);
}

/** 添加子任务（REST-only） */
export async function addSubIssueSmart(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueId: number,
  token: string,
): Promise<void> {
  return addSubIssue(owner, repo, issueNumber, subIssueId, token);
}

/** 移除子任务（REST-only） */
export async function removeSubIssueSmart(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueId: number,
  token: string,
): Promise<void> {
  return removeSubIssue(owner, repo, issueNumber, subIssueId, token);
}

/** 列出 blocked-by 依赖（REST-only） */
export async function fetchBlockedByDependenciesSmart(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue[]> {
  return fetchBlockedByDependencies(owner, repo, issueNumber, token);
}

/** 添加 blocked-by 依赖（REST-only） */
export async function addBlockedByDependencySmart(
  owner: string,
  repo: string,
  issueNumber: number,
  issueId: number,
  token: string,
): Promise<void> {
  return addBlockedByDependency(owner, repo, issueNumber, issueId, token);
}

/** 移除 blocked-by 依赖（REST-only） */
export async function removeBlockedByDependencySmart(
  owner: string,
  repo: string,
  issueNumber: number,
  issueId: number,
  token: string,
): Promise<void> {
  return removeBlockedByDependency(owner, repo, issueNumber, issueId, token);
}
