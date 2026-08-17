/**
 * Feed 卡片详情批量补拉 GraphQL 模板（aliases 动态生成：一次请求多 PR/commit）
 *
 * 背景：feed 每页最多 10 张卡，PR/push 卡详情若逐卡独立查询会单页发出 N 次请求
 * （最坏 N+1 次/页），且 PR 全量详情查询点数高（~20 点/次，含 body/labels/commits 等未用字段）。
 * 本模块用 GraphQL 字段别名（aliases）把同一帧的多个 PR/commit 合并为 **1 次请求**：
 * - PR 只取 feed 所需最小字段集：number/title/state/mergedAt/url/comments.totalCount +
 *   headRefName/baseRefName/headRepositoryOwner（统一 PR 卡「来源分支」badge：base ← head，fork 显 owner）
 * - commit 用 object(oid) + messageHeadline（提交首行，正是 feed push 卡标题行所需）
 * GraphQL 的 aliases 数量必须在查询文本中静态写死 → 按注册项数量动态生成查询串 + 变量。
 */
export interface FeedPrBatchItem {
  /** alias 名（生成器内部使用，r0/r1/...） */
  alias: string;
  owner: string;
  repo: string;
  number: number;
}

export interface FeedCommitBatchItem {
  alias: string;
  owner: string;
  repo: string;
  sha: string;
}

/** PR 批量查询：aliases → repository.pullRequest 最小字段集 */
export function buildFeedPrBatchQuery(items: FeedPrBatchItem[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const defs: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const it of items) {
    const vO = `${it.alias}_o`;
    const vN = `${it.alias}_n`;
    const vNum = `${it.alias}_num`;
    defs.push(`$${vO}: String!, $${vN}: String!, $${vNum}: Int!`);
    fields.push(
      `${it.alias}: repository(owner: $${vO}, name: $${vN}) {
        pullRequest(number: $${vNum}) {
          number
          title
          state
          mergedAt
          url
          headRefName
          baseRefName
          headRepositoryOwner {
            login
          }
          comments { totalCount }
        }
      }`,
    );
    variables[vO] = it.owner;
    variables[vN] = it.repo;
    variables[vNum] = it.number;
  }
  return {
    query: `query FeedPrBatch(${defs.join(", ")}) {\n  ${fields.join("\n  ")}\n}`,
    variables,
  };
}

/** commit 批量查询：aliases → repository.object(oid).messageHeadline（提交首行） */
export function buildFeedCommitBatchQuery(items: FeedCommitBatchItem[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const defs: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const it of items) {
    const vO = `${it.alias}_o`;
    const vN = `${it.alias}_n`;
    const vSha = `${it.alias}_sha`;
    defs.push(`$${vO}: String!, $${vN}: String!, $${vSha}: GitObjectID!`);
    fields.push(
      `${it.alias}: repository(owner: $${vO}, name: $${vN}) {
        object(oid: $${vSha}) {
          ... on Commit {
            messageHeadline
          }
        }
      }`,
    );
    variables[vO] = it.owner;
    variables[vN] = it.repo;
    variables[vSha] = it.sha;
  }
  return {
    query: `query FeedCommitBatch(${defs.join(", ")}) {\n  ${fields.join("\n  ")}\n}`,
    variables,
  };
}
