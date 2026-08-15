/**
 * 仓库 raw base 工具（从 MarkdownView.tsx 拆出）
 *
 * 原因：MarkdownView.tsx 同时导出组件与函数 → React Fast Refresh 失效
 * （组件文件只允许导出组件）。所有相对资源解析基准统一从这里取。
 */
import { fetchRawContentSmart } from "./raw-proxy";

/** 仓库相对资源 raw base（相对图片解析基准）：https://raw.githubusercontent.com/{owner}/{repo}/{ref} */
export function repoRawBase(owner: string, repo: string, ref = "HEAD"): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}`;
}

/** 目录树条目（Tree.entries）——目录列举 / README 定位共用。
 * object(expression: "HEAD:path") 返回 GitObject，... on Tree 命中目录时取 entries。
 * 相比 REST get-content，Tree.entries 无 raw/文件内容，仅结构（name/path/type/size），
 * 恰好覆盖目录列表与 README 文件定位两个场景（登录 GraphQL 主通道，匿名/失败降级 REST）。 */
export const TREE_ENTRIES_QUERY = /* GraphQL */ `
  query TreeEntries($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Tree {
          entries {
            name
            path
            type
            size
          }
        }
      }
    }
  }
`;

/** 提交历史（Commit.history）——commit 列表（since 过滤 + first 分页；匿名/失败降级 REST list-commits）。
 * object(expression: "HEAD") 命中 Commit 时取 history；nodes 含 oid/message/author 供 Top committers 聚合。 */
export const COMMIT_HISTORY_QUERY = /* GraphQL */ `
  query CommitHistory($owner: String!, $name: String!, $expr: String!, $since: GitTimestamp) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Commit {
          history(first: 100, since: $since) {
            nodes {
              oid
              message
              author {
                name
                date
                user {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * 拉取指定 ref（分支/sha）下的文件原文（DiffView Expand 上下文对比用）。
 * 走 raw 通道（去 GraphQL——blob 1MB 截断徒增复杂度）：
 * 登录跳过 raw 直连（私有仓库直连 404）直接 $raw 代理带 token；匿名 raw 直连 → $raw 代理。
 * 文件 404 / 网络错误返回 null。
 */
export async function fetchRepoFileRaw(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  token?: string | null,
): Promise<string | null> {
  return fetchRawContentSmart(owner, repo, ref, path, !token);
}
