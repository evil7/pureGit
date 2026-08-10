/**
 * GitHub REST API - actions（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import { typedRequest, fetchWithTimeout, GITHUB_API } from "./rest-core";
import type { GitHubUser } from "./rest-core";

/** Workflow run 状态枚举（listWorkflowRunsForRepo status 参数） */
type WorkflowRunStatus =
  | "waiting"
  | "queued"
  | "in_progress"
  | "completed"
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "pending"
  | "action_required"
  | "neutral"
  | "skipped"
  | "stale"
  | "requested";

// ===== Actions（REST only——GraphQL 无 workflow/run 端点） =====

/** GitHub Actions Workflow（GET /repos/{o}/{r}/actions/workflows） */
export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string; // active / disabled_manually / ...
  badge_url?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
}

/** Actions Workflow Run（GET /repos/{o}/{r}/actions/runs） */
export interface WorkflowRun {
  id: number;
  name: string;
  display_title?: string;
  run_number: number;
  status: string; // queued / in_progress / completed / ...
  conclusion: string | null; // success / failure / cancelled / skipped / action_required / ...
  head_branch: string | null;
  event: string; // push / pull_request / workflow_dispatch / ...
  actor: GitHubUser | null;
  created_at: string;
  updated_at: string;
  /** 实际开始时间（排队后开始；与 updated_at 差值 = total duration） */
  run_started_at?: string;
  head_sha: string;
  html_url: string;
  workflow_id?: number;
}

/** Run Job（GET /repos/{o}/{r}/actions/runs/{id}/jobs） */
export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  /** 步骤开始/结束时间（耗时计算用） */
  started_at?: string | null;
  completed_at?: string | null;
}
export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: JobStep[];
}

/** Workflows 列表 */
export async function fetchWorkflows(
  owner: string,
  repo: string,
  token?: string | null,
  perPage = 100,
): Promise<Workflow[]> {
  const data = await typedRequest<{ workflows: Workflow[] }>(token, (octokit) =>
    octokit.rest.actions.listRepoWorkflows({ owner, repo, per_page: perPage }),
  );
  return data.workflows ?? [];
}

/** Workflow runs 列表（可按 workflow/branch/event/status 过滤） */
export async function fetchWorkflowRuns(
  owner: string,
  repo: string,
  token?: string | null,
  opts: {
    perPage?: number;
    page?: number;
    workflowId?: number;
    branch?: string;
    event?: string;
    status?: string;
  } = {},
): Promise<{ total_count: number; runs: WorkflowRun[] }> {
  const data = await typedRequest<{
    total_count: number;
    workflow_runs: WorkflowRun[];
  }>(token, (octokit) =>
    octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: opts.perPage ?? 20,
      ...(opts.page ? { page: opts.page } : {}),
      ...(opts.workflowId ? { workflow_id: opts.workflowId } : {}),
      ...(opts.branch ? { branch: opts.branch } : {}),
      ...(opts.event ? { event: opts.event } : {}),
      ...(opts.status ? { status: opts.status as WorkflowRunStatus } : {}),
    }),
  );
  return { total_count: data.total_count ?? 0, runs: data.workflow_runs ?? [] };
}

/** Run 详情（GET /repos/{o}/{r}/actions/runs/{id}） */
export async function fetchWorkflowRunDetail(
  owner: string,
  repo: string,
  runId: number,
  token?: string | null,
): Promise<WorkflowRun> {
  return typedRequest<WorkflowRun>(token, (octokit) =>
    octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
  );
}

/** Run jobs（含 steps；GET /repos/{o}/{r}/actions/runs/{id}/jobs） */
export async function fetchWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number,
  token?: string | null,
): Promise<WorkflowJob[]> {
  const data = await typedRequest<{ jobs: WorkflowJob[] }>(token, (octokit) =>
    octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    }),
  );
  return data.jobs ?? [];
}

/** 手动触发 workflow（POST /repos/{o}/{r}/actions/workflows/{id}/dispatches；需 write） */
export async function dispatchWorkflow(
  owner: string,
  repo: string,
  workflowId: number,
  ref: string,
  token: string,
  inputs: Record<string, string> = {},
): Promise<void> {
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref,
      inputs,
    }),
  );
}

/** Run Artifact（GET /repos/{o}/{r}/actions/runs/{id}/artifacts） */
export interface RunArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  archive_download_url: string;
  expired: boolean;
}

/** Run artifacts 列表 */
export async function fetchRunArtifacts(
  owner: string,
  repo: string,
  runId: number,
  token?: string | null,
): Promise<RunArtifact[]> {
  const data = await typedRequest<{ artifacts: RunArtifact[] }>(token, (octokit) =>
    octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: runId,
      per_page: 50,
    }),
  );
  return data.artifacts ?? [];
}

/** Job 日志（GET /repos/{o}/{r}/actions/jobs/{id}/logs——纯文本，前端直接渲染） */
export async function fetchJobLogs(
  owner: string,
  repo: string,
  jobId: number,
  token?: string | null,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${jobId}/logs`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}
