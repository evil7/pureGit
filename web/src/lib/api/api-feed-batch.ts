/**
 * Feed 卡片详情批量补拉调度（微任务合并：同一帧注册的 PR/commit 合并为 1 次 GraphQL 请求）
 *
 * 背景与设计（对应 api-compat.md §2 智能层架构）：
 * feed 每页最多 10 张卡，PR/push 卡详情若逐卡独立查询会单页发出 N 次请求（最坏 N+1 次/页），
 * 且 PR 全量详情查询点数高（~20 点/次）。本模块把「单页 N 次详情请求」收敛为「1~2 次/页」：
 * - **微任务合并**：同一帧（setTimeout 0）内注册的 PR/commit 合并为 1 次 GraphQL aliases 请求；
 *   不同帧自动分批 → 天然防「翻页瞬间连发 N 请求」与 HMR 热重载重复拉取
 * - **瘦身字段**：PR 只取 title/state/mergedAt/url/comments（见 graphql/feed.ts，~5 点/alias）
 * - **模块级缓存**：按 `owner/repo#number` / `owner/repo#sha` 缓存，跨页回访零请求
 * - **null 降级**：单节点缺失（仓库已删/私有）或整体失败（网络/熔断）→ resolve(null)，
 *   卡片回退 payload 基础信息（不阻塞渲染、不重试防风暴）
 * 登录态（feed 仅登录展示）经 api-core graphqlRequest：匿名短路 / 额度跟踪 / 熔断同主通道。
 */
import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import { buildFeedPrBatchQuery, buildFeedCommitBatchQuery } from "../graphql";

/** PR 摘要（feed 卡片所需最小字段集；mergedAt 非 null = 已合并；headOwner = head 仓库 owner，非本仓库 = fork PR） */
export interface FeedPrSummary {
  number: number;
  title: string;
  state: string;
  mergedAt: string | null;
  url: string;
  comments: number;
  headRefName: string;
  baseRefName: string;
  headOwner: string | null;
}

interface PendingPr {
  owner: string;
  repo: string;
  number: number;
  token: string;
  resolve: (v: FeedPrSummary | null) => void;
}

interface PendingCommit {
  owner: string;
  repo: string;
  sha: string;
  token: string;
  resolve: (v: string | null) => void;
}

interface PrAliasNode {
  pullRequest: {
    number: number;
    title: string;
    state: string;
    mergedAt: string | null;
    url: string;
    headRefName: string | null;
    baseRefName: string | null;
    headRepositoryOwner: { login: string } | null;
    comments: { totalCount: number } | null;
  } | null;
}

interface CommitAliasNode {
  object: { messageHeadline?: string | null } | null;
}

/** 模块级缓存：同一 key 跨页/跨渲染零请求（失败缓存 null 防风暴，不重试） */
const prCache = new Map<string, Promise<FeedPrSummary | null>>();
const commitCache = new Map<string, Promise<string | null>>();
let prBatch: Map<string, PendingPr> | null = null;
let commitBatch: Map<string, PendingCommit> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** 注册一帧内的合并刷新（仅首次注册触发；flush 后清空复用） */
function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPrs();
    void flushCommits();
  }, 0);
}

/**
 * 注册 PR 摘要补拉（PullRequestEvent / PullRequestReviewEvent 的 payload 缺 title/state）。
 * 同一帧多个注册 → 合并 1 次 GraphQL aliases 请求；缓存命中零请求；失败 resolve(null)。
 */
export function scheduleFeedPr(
  owner: string,
  repo: string,
  number: number,
  token: string | null,
): Promise<FeedPrSummary | null> {
  if (!token) return Promise.resolve(null);
  const key = `${owner}/${repo}#${number}`;
  let p = prCache.get(key);
  if (!p) {
    p = new Promise<FeedPrSummary | null>((resolve) => {
      (prBatch ??= new Map()).set(key, { owner, repo, number, token, resolve });
      scheduleFlush();
    });
    prCache.set(key, p);
  }
  return p;
}

/**
 * 注册 commit message 补拉（PushEvent 的 payload 无 commits 列表，只有 head sha）。
 * 同一帧多个注册 → 合并 1 次 GraphQL aliases 请求；缓存命中零请求；失败 resolve(null)。
 */
export function scheduleFeedCommit(
  owner: string,
  repo: string,
  sha: string,
  token: string | null,
): Promise<string | null> {
  if (!token) return Promise.resolve(null);
  const key = `${owner}/${repo}#${sha}`;
  let p = commitCache.get(key);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      (commitBatch ??= new Map()).set(key, { owner, repo, sha, token, resolve });
      scheduleFlush();
    });
    commitCache.set(key, p);
  }
  return p;
}

/** 冲刷 PR 批量（1 次 GraphQL aliases 请求；整体失败 → 全部 null 降级） */
async function flushPrs() {
  if (!prBatch) return;
  const batch = prBatch;
  prBatch = null;
  const entries = [...batch.values()];
  const token = entries[0]?.token;
  if (!token) {
    entries.forEach((e) => e.resolve(null));
    return;
  }
  const { query, variables } = buildFeedPrBatchQuery(
    entries.map((e, i) => ({ alias: `r${i}`, owner: e.owner, repo: e.repo, number: e.number })),
  );
  try {
    const resp = await graphqlRequest<Record<string, PrAliasNode | null>>(query, variables, token);
    if (hasGraphQLErrors(resp) || !resp.data) {
      entries.forEach((e) => e.resolve(null));
      return;
    }
    entries.forEach((e, i) => {
      const node = resp.data?.[`r${i}`]?.pullRequest ?? null;
      e.resolve(
        node
          ? {
              number: node.number,
              title: node.title,
              state: node.state,
              mergedAt: node.mergedAt,
              url: node.url,
              comments: node.comments?.totalCount ?? 0,
              headRefName: node.headRefName ?? "",
              baseRefName: node.baseRefName ?? "",
              headOwner: node.headRepositoryOwner?.login ?? null,
            }
          : null,
      );
    });
  } catch {
    entries.forEach((e) => e.resolve(null));
  }
}

/** 冲刷 commit 批量（1 次 GraphQL aliases 请求；整体失败 → 全部 null 降级） */
async function flushCommits() {
  if (!commitBatch) return;
  const batch = commitBatch;
  commitBatch = null;
  const entries = [...batch.values()];
  const token = entries[0]?.token;
  if (!token) {
    entries.forEach((e) => e.resolve(null));
    return;
  }
  const { query, variables } = buildFeedCommitBatchQuery(
    entries.map((e, i) => ({ alias: `c${i}`, owner: e.owner, repo: e.repo, sha: e.sha })),
  );
  try {
    const resp = await graphqlRequest<Record<string, CommitAliasNode | null>>(
      query,
      variables,
      token,
    );
    if (hasGraphQLErrors(resp) || !resp.data) {
      entries.forEach((e) => e.resolve(null));
      return;
    }
    entries.forEach((e, i) => {
      const msg = resp.data?.[`c${i}`]?.object?.messageHeadline;
      // 归一单行（messageHeadline 已是首行，保险处理换行/空白）
      e.resolve(msg ? msg.replace(/\s+/g, " ").trim() : null);
    });
  } catch {
    entries.forEach((e) => e.resolve(null));
  }
}
