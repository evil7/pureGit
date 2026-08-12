/**
 * GitHub API smart layer - insights（Insights Pulse）
 * Board file. See api.ts barrel & docs/api-compat.md.
 *
 * Pulse 统计：GraphQL PULSE_STATS_QUERY 一次请求 6 个 issueCount 首选，失败降级 REST /search/issues 并行 6 个。
 * Top committers：REST commits 聚合（GraphQL 无等价「按作者聚合」端点，REST only）。
 */
import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { PULSE_STATS_QUERY } from "./graphql";
import { searchIssues, fetchCommits } from "./rest";
import type { RepoCommit } from "./rest";

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

/** 智能获取 Pulse 统计：GraphQL 一次请求首选，失败降级 REST 并行 6 个 search。 */
export async function fetchPulseStatsSmart(
  owner: string,
  repo: string,
  since: string,
  token?: string | null,
): Promise<PulseStats> {
  const repoQ = `${owner}/${repo}`;
  const sinceQ = sinceQualifier(since);
  // GraphQL 首选（一次请求，省额度）
  if (token) {
    try {
      const resp: GraphQLResponse<Record<string, { issueCount: number }>> = await graphqlRequest(
        PULSE_STATS_QUERY,
        { repo: repoQ, since: sinceQ },
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
  const queries = [
    ["activePrs", `repo:${repoQ} is:pr is:open`],
    ["activeIssues", `repo:${repoQ} is:issue is:open`],
    ["mergedPrs", `repo:${repoQ} is:pr is:merged merged:>=${sinceQ}`],
    ["openPrs", `repo:${repoQ} is:pr is:open`],
    ["closedIssues", `repo:${repoQ} is:issue is:closed closed:>=${sinceQ}`],
    ["newIssues", `repo:${repoQ} is:issue created:>=${sinceQ}`],
  ] as const;
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

/**
 * 智能聚合 Top committers（REST commits 分页拉 2 页 200 条，去 merge 提交后按作者计数，取 top 10）。
 * 大仓库仅抽样统计（官方 Highcharts 全量；简版 CSS 条形图够用）。
 */
export async function fetchTopCommittersSmart(
  owner: string,
  repo: string,
  since: string,
  token?: string | null,
): Promise<CommitterStat[]> {
  try {
    const pages = await Promise.all([
      fetchCommits(owner, repo, since, 100, 1, token).catch(() => [] as RepoCommit[]),
      fetchCommits(owner, repo, since, 100, 2, token).catch(() => [] as RepoCommit[]),
    ]);
    const map = new Map<string, CommitterStat>();
    for (const c of pages.flat()) {
      const login = c.author?.login;
      if (!login) continue; // 无名提交跳过
      // 跳过 merge 提交（官方 Summary「Excluding merges」语义）
      if (/^Merge /.test(c.commit?.message ?? "")) continue;
      const cur = map.get(login);
      if (cur) cur.count += 1;
      else map.set(login, { login, count: 1, avatarUrl: c.author?.avatar_url });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  } catch {
    return [];
  }
}
