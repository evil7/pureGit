/**
 * GitHub REST API - issue 子任务与依赖（官方 issue 详情侧栏）
 *
 * 整体 REST-only（红线例外，理由充分）：sub-issue / dependency 为 2024 新增 REST 端点，
 * GraphQL 无对应 mutation/查询适配。读取与写操作统一走 REST。
 *
 * 关键语义：add/remove 端点均用 **issue 数据库 id**（非 number）标识目标 issue——
 * sub-issue 用 `sub_issue_id`，依赖用 `issue_id`。调用方（页面）需先经 fetchIssueDetail
 * 将用户输入的 number 解析为 id。
 */

import { typedRequest, ApiError } from "./rest-core";
import type { Issue } from "./rest-issue-pr";

/** 列出子任务（GET /issues/{n}/sub_issues） */
export async function fetchSubIssues(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue[]> {
  const data = await typedRequest<Issue[]>(token, (octokit) =>
    octokit.rest.issues.listSubIssues({ owner, repo, issue_number: issueNumber, per_page: 100 }),
  );
  return data ?? [];
}

/** 获取父 issue（GET /issues/{n}/parent；无父 → 404/410 → null） */
export async function fetchParentIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue | null> {
  try {
    return await typedRequest<Issue>(token, (octokit) =>
      octokit.rest.issues.getParent({ owner, repo, issue_number: issueNumber }),
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

/** 添加子任务（POST /issues/{n}/sub_issues，body sub_issue_id） */
export async function addSubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.addSubIssue({
      owner,
      repo,
      issue_number: issueNumber,
      sub_issue_id: subIssueId,
    }),
  );
}

/** 移除子任务（DELETE /issues/{n}/sub_issue，body sub_issue_id） */
export async function removeSubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  subIssueId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.removeSubIssue({
      owner,
      repo,
      issue_number: issueNumber,
      sub_issue_id: subIssueId,
    }),
  );
}

/** 列出 blocked-by 依赖（GET /issues/{n}/dependencies/blocked_by） */
export async function fetchBlockedByDependencies(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string | null,
): Promise<Issue[]> {
  const data = await typedRequest<Issue[]>(token, (octokit) =>
    octokit.rest.issues.listDependenciesBlockedBy({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    }),
  );
  return data ?? [];
}

/** 添加 blocked-by 依赖（POST /issues/{n}/dependencies/blocked_by，body issue_id） */
export async function addBlockedByDependency(
  owner: string,
  repo: string,
  issueNumber: number,
  issueId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.addBlockedByDependency({
      owner,
      repo,
      issue_number: issueNumber,
      issue_id: issueId,
    }),
  );
}

/** 移除 blocked-by 依赖（DELETE /issues/{n}/dependencies/blocked_by/{issue_id}） */
export async function removeBlockedByDependency(
  owner: string,
  repo: string,
  issueNumber: number,
  issueId: number,
  token: string,
): Promise<void> {
  await typedRequest(token, (octokit) =>
    octokit.rest.issues.removeDependencyBlockedBy({
      owner,
      repo,
      issue_number: issueNumber,
      issue_id: issueId,
    }),
  );
}
