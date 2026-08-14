/**
 * GitHub API smart layer - insights（Insights Pulse）
 * Board file. See api.ts barrel.
 *
 * Pulse 统计：GraphQL PULSE_STATS_QUERY 一次请求 6 个 issueCount 首选，失败降级 REST /search/issues 并行 6 个。
 * Top committers：GraphQL Commit.history 主通道（history first:100 since 抽样）+ REST 熔断降级（匿名强制 REST 分页 2 页）。
 */
import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import { PULSE_STATS_QUERY } from "../graphql";
import { COMMIT_HISTORY_QUERY } from "@/lib/repo/repo-raw";
import { searchIssues, fetchCommits } from "../restapi";
import type { RepoCommit } from "../restapi";

/** Pulse 统计卡数据（官方 Overview：Active PRs/Issues 大卡 + Merged/Open/Closed/New 网格） */
export interface PulseStats {
  activePrs: number;
  activeIssues: number;
  mergedPrs: number;
  openPrs: number;
  closedIssues: number;
  newIssues: number;
}

/** Top committers 聚合条目（author.login + 提交数） */
export interface CommitterStat {
  login: string;
  count: number;
  avatarUrl?: string;
}

/** 日期 qualifier 格式化为 GraphQL/REST 通用（YYYY-MM-DD，>=since 语义） */
function sinceQualifier(since: string): string {
  return since.slice(0, 10);
}

/** Pulse 6 项统计的 search query 映射（GraphQL 变量与 REST 降级共用单一来源） */
function pulseQueries(repoQ: string, sinceQ: string): Record<string, string> {
  return {
    activePrsQ: `repo:${repoQ} is:pr is:open`,
    activeIssuesQ: `repo:${repoQ} is:issue is:open`,
    mergedPrsQ: `repo:${repoQ} is:pr is:merged merged:>=${sinceQ}`,
    openPrsQ: `repo:${repoQ} is:pr is:open`,
    closedIssuesQ: `repo:${repoQ} is:issue is:closed closed:>=${sinceQ}`,
    newIssuesQ: `repo:${repoQ} is:issue created:>=${sinceQ}`,
  };
}

/** 智能获取 Pulse 统计：GraphQL 一次请求首选，失败降级 REST 并行 6 个 search。 */
export async function fetchPulseStatsSmart(
  owner: string,
  repo: string,
  since: string,
  token?: string | null,
): Promise<PulseStats> {
  const repoQ = `${owner}/${repo}`;
  const sinceQ = sinceQualifier(since);
  const queries = pulseQueries(repoQ, sinceQ);
  // GraphQL 首选（一次请求，省额度）
  if (token) {
    try {
      const resp: GraphQLResponse<Record<string, { issueCount: number }>> = await graphqlRequest(
        PULSE_STATS_QUERY,
        queries,
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data) {
        return {
          activePrs: resp.data.activePrs?.issueCount ?? 0,
          activeIssues: resp.data.activeIssues?.issueCount ?? 0,
          mergedPrs: resp.data.mergedPrs?.issueCount ?? 0,
          openPrs: resp.data.openPrs?.issueCount ?? 0,
          closedIssues: resp.data.closedIssues?.issueCount ?? 0,
          newIssues: resp.data.newIssues?.issueCount ?? 0,
        };
      }
      // GraphQL 失败 → 熔断降级 REST（并行 6 个 search，各取 total_count；日志自动 ↪ 前缀）
      return withRestFallback(
        async () => restPulse(repoQ, sinceQ, token),
        "fetchPulseStatsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        async () => restPulse(repoQ, sinceQ, token),
        "fetchPulseStatsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST（并行 6 个 search）
  return restPulse(repoQ, sinceQ, token);
}

/** REST 降级：并行 6 个 search（各取 total_count） */
async function restPulse(
  repoQ: string,
  sinceQ: string,
  token?: string | null,
): Promise<PulseStats> {
  const queries = Object.entries(pulseQueries(repoQ, sinceQ)).map(
    ([key, q]) => [key.replace(/Q$/, ""), q] as const,
  );
  const results = await Promise.all(
    queries.map(async ([key, q]) => {
      try {
        const r = await searchIssues(q, 1, token);
        return [key, r.total_count] as const;
      } catch {
        return [key, 0] as const;
      }
    }),
  );
  return Object.fromEntries(results) as unknown as PulseStats;
}

/** COMMIT_HISTORY_QUERY 响应节点（GraphQL Commit.history 结构子集，映射为 RepoCommit） */
interface CommitHistoryNode {
  oid: string;
  message: string | null;
  author: {
    name: string | null;
    date: string | null;
    user: { login: string; avatarUrl: string | null } | null;
  } | null;
}

/**
 * 智能聚合 Top committers（登录 GraphQL Commit.history 主通道 + REST 熔断降级）。
 * 登录：GraphQL history(first:100, since) 单次抽样（connection first 上限 100，对 top 10 统计足够）；
 * 匿名 / GraphQL 失败：降级 REST commits 分页拉 2 页 200 条（匿名强制 REST）。
 * 去 merge 提交后按作者计数，取 top 10；大仓库仅抽样统计（官方 Highcharts 全量；简版 CSS 条形图够用）。
 */
export async function fetchTopCommittersSmart(
  owner: string,
  repo: string,
  since: string,
  token?: string | null,
): Promise<CommitterStat[]> {
  let commits: RepoCommit[];
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: { history: { nodes: CommitHistoryNode[] | null } | null } | null;
        } | null;
      }> = await graphqlRequest(
        COMMIT_HISTORY_QUERY,
        { owner, name: repo, expr: "HEAD", since },
        token,
      );
      const nodes = resp.data?.repository?.object?.history?.nodes;
      if (!hasGraphQLErrors(resp) && nodes) {
        commits = nodes.map((n) => ({
          sha: n.oid,
          commit: {
            message: n.message ?? "",
            author:
              n.author?.name || n.author?.date
                ? { name: n.author.name ?? "", date: n.author.date ?? "" }
                : null,
          },
          author: n.author?.user
            ? { login: n.author.user.login, avatar_url: n.author.user.avatarUrl ?? "" }
            : null,
        }));
      } else {
        // GraphQL 失败 → 熔断降级 REST（两页 200 条）
        commits = await withRestFallback(
          () => restCommits(owner, repo, since, token),
          "fetchTopCommittersSmart",
          resp,
        );
      }
    } catch {
      // 网络层错误 → 熔断降级 REST
      commits = await withRestFallback(
        () => restCommits(owner, repo, since, token),
        "fetchTopCommittersSmart",
        undefined,
      );
    }
  } else {
    // 匿名强制 REST（两页 200 条）
    commits = await restCommits(owner, repo, since, token);
  }

  const map = new Map<string, CommitterStat>();
  for (const c of commits) {
    const login = c.author?.login;
    if (!login) continue; // 无名提交跳过
    // 跳过 merge 提交（官方 Summary「Excluding merges」语义）
    if (/^Merge /.test(c.commit?.message ?? "")) continue;
    const cur = map.get(login);
    if (cur) cur.count += 1;
    else map.set(login, { login, count: 1, avatarUrl: c.author?.avatar_url });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

/** REST 降级：commits 分页拉 2 页 200 条（每页 100，去 merge 统计由上层完成） */
async function restCommits(
  owner: string,
  repo: string,
  since: string,
  token?: string | null,
): Promise<RepoCommit[]> {
  const pages = await Promise.all([
    fetchCommits(owner, repo, since, 100, 1, token).catch((e) => {
      logWarn("fetchTopCommittersSmart", `page1 commits 失败（静默空）: ${String(e)}`);
      return [] as RepoCommit[];
    }),
    fetchCommits(owner, repo, since, 100, 2, token).catch((e) => {
      logWarn("fetchTopCommittersSmart", `page2 commits 失败（静默空）: ${String(e)}`);
      return [] as RepoCommit[];
    }),
  ]);
  return pages.flat();
}
