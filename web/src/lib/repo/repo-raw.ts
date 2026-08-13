/**
 * 仓库 raw base 工具（从 MarkdownView.tsx 拆出）
 *
 * 原因：MarkdownView.tsx 同时导出组件与函数 → React Fast Refresh 失效
 * （组件文件只允许导出组件）。所有相对资源解析基准统一从这里取。
 */
import { graphqlRequest } from "@/lib/graphql";
import { fetchRawContentSmart } from "./raw-proxy";

/** 仓库相对资源 raw base（相对图片解析基准）：https://raw.githubusercontent.com/{owner}/{repo}/{ref} */
export function repoRawBase(owner: string, repo: string, ref = "HEAD"): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}`;
}

/** GraphQL 拉取指定 sha 下文件内容（Expand 上下文对比用；blob text >1MB 截断 isTruncated=true → 返回 null） */
export const FILE_RAW_QUERY = /* GraphQL */ `
  query FileRaw($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Blob {
          text
          isTruncated
        }
      }
    }
  }
`;

/** 编辑页数据一次查——blob 内容(text) + metadata(oid)。
 * oid 与 REST contents.sha 同为 blob SHA（官方文档），可直接用于 createOrUpdateFileContents。
 * >1MB 时 isTruncated=true（text 只含部分 官方确认——text 非 null 但截断），
 * oid 仍有值（sha 不受影响）——截断必须检查 isTruncated，防静默返回残缺内容。 */
export const FILE_EDIT_QUERY = /* GraphQL */ `
  query FileEdit($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Blob {
          oid
          text
          isTruncated
        }
      }
    }
  }
`;

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
 * 走 GraphQL（前端主数据通道，CORS 与网络受限环境已验证可用；
 * api.github.com contents 端点无 CORS 头、raw.githubusercontent 不可达 → 弃用）。
 * 文件 >1MB（isTruncated=true）/ 404 / 网络错误返回 null。
 *
 * 补全降级通道——登录 GraphQL → REST contents → $raw 代理；
 * 匿名（GraphQL 恒 403 守卫短路）→ raw 直连 → $raw 代理。
 * 修订：GraphQL 截断判定改为 isTruncated（官方：>1MB 时 text 非 null 但含部分内容，
 * 必须显式检查 isTruncated 防静默返回残缺内容）。
 */
export async function fetchRepoFileRaw(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  token?: string | null,
): Promise<string | null> {
  // ① 登录：GraphQL blob 首选（5000 点配额，稳定）
  if (token) {
    try {
      const resp = await graphqlRequest<{
        repository: { object: { text: string | null; isTruncated: boolean } | null } | null;
      }>(FILE_RAW_QUERY, { owner, name: repo, expr: `${ref}:${path}` }, token);
      const obj = resp.data?.repository?.object;
      // text 完整（非截断）才返回；>1MB 截断 / text=null → 降级
      if (obj?.text != null && !obj.isTruncated) return obj.text;
      // isTruncated=true（>1MB）或 text === null → 降级
    } catch {
      /* 降级 */
    }
  }
  // ② 匿名 / GraphQL 失败：raw 直连 → $raw 代理
  return fetchRawContentSmart(owner, repo, ref, path, true);
}
