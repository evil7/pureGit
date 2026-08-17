/**
 * GitHub API smart layer - 文件内容（自 api-repo.ts 拆出）
 * blob 内容 / 目录列举 / README / 根文件 / 编辑页数据一次查。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { TREE_ENTRIES_QUERY, repoRawBase } from "@/lib/repo/repo-raw";
import { buildRawProxyUrl } from "@/lib/repo/raw-proxy";
import { reportChannel } from "@/lib/net/channel-status";
import { getRawProxyMode } from "@/lib/net/proxy-mode";
import { fetchFileCommitSmart } from "./api-repo";
import {
  ApiError,
  fetchFileMeta,
  fetchFileContent,
  fetchDirContents,
  fetchReadme,
  fetchRootFiles,
} from "../restapi";
import type { ReadmeInfo, DirEntry } from "../restapi";

// ===== blob 文件内容（$raw 内部路由优先 + 状态分流 + 路径审计日志）=====

/**
 * 文件内容通道审计日志（dev 模式输出，格式对齐 [PureGit API]）。
 * 记录文件内容实际命中的读取路径（direct-raw / worker-$raw-proxy / graphql-blob / rest-contents），
 * 便于核实内部功能路径的真实触发方式（用户要求：对读取方式做审计）。
 */
function fileContentLog(detail: string, channel: string, size: number): void {
  if (!import.meta.env.DEV) return;
  console.log(`[PureGit API] [FileContent] ${detail} → ${channel} ${size}B`);
}

/**
 * blob 页内联渲染上限（对齐 GitHub GraphQL Blob.text 1MB 截断）。
 * 超过阈值的内容不内联渲染（前端 banner 引导 Raw/Download），避免大文件进 JS 内存卡死浏览器。
 * >100MB 硬限制由 contents API 拒绝（422/413），前端 413 提示无法预览。
 */
export const BLOB_INLINE_MAX_BYTES = 1024 * 1024;

/**
 * 智能获取文件原始内容——按 proxy 模式分流。
 *
 * 中心思想（架构纠正）：`$raw` 仅代表 worker 纯反代（受 RAW_PROXY_ENABLE 门控）；
 * 获取文件内容由前端直发 API（登录带 token / 匿名不带）。
 * - proxy 可用（on / login+登录）→ 走 /$raw 透传（私有仓库可读，流式）
 * - 否则 → 前端直发 fetchFileContent（api contents raw Accept，登录带 token / 匿名不带）
 * - maxBytes 内联渲染上限（默认不限）：读 body 前按 Content-Length 拦截，
 *   超限直接抛 413「文件过大」（仅 BlobPage 内联传入；README/编辑/DiffView 等不传）。
 */
export async function fetchFileContentSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  maxBytes?: number,
): Promise<string> {
  const detail = `${owner}/${repo} ${branch}:${path}`;
  // proxy 可用 → /$raw 透传；否则 → 前端直发 api contents
  const mode = await getRawProxyMode();
  const canProxy = token ? mode === "on" || mode === "login" : mode === "on";
  if (canProxy) {
    try {
      const res = await fetch(buildRawProxyUrl(owner, repo, branch, path), {
        credentials: "include",
      });
      if (res.status === 413) {
        fileContentLog(detail, "$raw→413(too-large)", 0);
        throw new ApiError(413, "文件过大，无法在线预览");
      }
      if (res.status === 404) {
        fileContentLog(detail, "$raw→404", 0);
        throw new ApiError(404, "文件不存在");
      }
      if (!res.ok) {
        // 鉴权失败（401/403，worker 会话失效）或 5xx → 降级前端直发 api contents
        // （登录带 token；公开仓库匿名即可读，登录态 api contents 更无虞）
        fileContentLog(detail, `$raw→${res.status}（降级 api-contents）`, 0);
      } else {
        // 内联渲染上限门控：读 body 前按 Content-Length 拦截（超限不进内存，避免浏览器卡死）
        if (maxBytes != null) {
          const contentLength = Number(res.headers.get("Content-Length") ?? "0");
          if (contentLength > maxBytes) {
            fileContentLog(detail, `$raw→too-large(>${maxBytes}B)`, contentLength);
            throw new ApiError(413, "文件过大，无法在线预览");
          }
        }
        const text = await res.text();
        fileContentLog(detail, "$raw", text.length);
        reportChannel("worker");
        return text;
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      fileContentLog(detail, "$raw→err（降级 api-contents）", 0);
    }
  }
  // 前端直发 api contents（登录带 token / 匿名不带；maxBytes 门控在底层 fetchFileContent）
  try {
    const text = await fetchFileContent(owner, repo, path, token, branch, maxBytes);
    fileContentLog(detail, "api-contents", text.length);
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    fileContentLog(detail, "api-contents→err", 0);
    throw new ApiError(500, "文件获取失败（网络不可达）");
  }
}

/** blob 文件头 commit 信息（与 fetchFileCommitSmart 返回结构一致） */
export type FileCommitInfo = Awaited<ReturnType<typeof fetchFileCommitSmart>>;

/**
 * blob 页复合查询——文件内容 + 该文件最近提交，两通道并行。
 * - content：fetchFileContentSmart（proxy 分流；maxBytes 内联渲染上限透传）
 * - commit：fetchFileCommitSmart（GraphQL 主通道 + REST 降级；无 1MB 限制保留 GraphQL）
 * 匿名时 commit 为 null（BlobPage 匿名本就跳过 commit）。
 */
export async function fetchFileWithCommitSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  maxBytes?: number,
): Promise<{ content: string; commit: FileCommitInfo }> {
  const [content, commit] = await Promise.all([
    fetchFileContentSmart(owner, repo, path, token, branch, maxBytes),
    token ? fetchFileCommitSmart(owner, repo, path, branch, token) : Promise.resolve(null),
  ]);
  return { content, commit };
}

// ===== 目录列举 / README（登录 GraphQL 主通道 + REST 熔断）=====

/** GraphQL TreeEntry 结构子集（Tree.entries 查询返回节点） */
interface TreeEntryNode {
  name: string;
  path: string | null;
  type: string;
  size: number | null;
}

/** GraphQL Tree.entries 节点 → DirEntry（type "tree"→dir，其余 blob/commit→file） */
function toDirEntry(e: TreeEntryNode): DirEntry {
  return {
    name: e.name,
    path: e.path ?? e.name,
    type: e.type === "tree" ? "dir" : "file",
    size: e.size ?? 0,
  };
}

/**
 * 智能获取目录条目列表（TreePage / CodeIndex 目录列表主通道）。
 * 登录：GraphQL repository.object(expression:"HEAD:path") → Tree.entries 首选（v0.0.1 登录强制 Graph 主通道）；
 * 匿名 / GraphQL 失败 → 熔断降级 REST fetchDirContents（匿名强制 REST）。
 */
export async function fetchDirContentsSmart(
  owner: string,
  repo: string,
  path = "",
  branch = "HEAD",
  token?: string | null,
): Promise<DirEntry[]> {
  if (token) {
    try {
      const expr = path ? `${branch}:${path}` : `${branch}:`;
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(TREE_ENTRIES_QUERY, { owner, name: repo, expr }, token);
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        return entries.map(toDirEntry);
      }
      // GraphQL 失败（如 path 是文件而非目录）→ 熔断降级 REST
      return withRestFallback(
        () => fetchDirContents(owner, repo, path, branch, token),
        "fetchDirContentsSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchDirContents(owner, repo, path, branch, token),
        "fetchDirContentsSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchDirContents(owner, repo, path, branch, token);
}

/**
 * 目录页复合查询——一次 Tree.entries 同时返回目录条目 + 定位 README（CodeIndex / TreePage 主通道）。
 * 替代 fetchDirContentsSmart + fetchReadmeSmart 两次请求（后者内部又查一次 Tree.entries 定位 README）。
 * 消除同一目录 Tree.entries 的重复拉取，并统一 branch 语义（原 fetchReadmeSmart 写死 HEAD，非默认分支不一致）。
 *
 * 分层：
 * - 登录：一次 TREE_ENTRIES_QUERY 拿 entries → 目录列表 + README 定位（blob 且 name 以 readme 开头）；
 *   README 命中后 fetchFileContentSmart 拿内容（GraphQL blob + REST/$raw 保底）。
 * - 匿名 / GraphQL 失败 → withRestFallback 降级 REST 分步（fetchDirContents + fetchReadme 并行）。
 */
export async function fetchDirWithReadmeSmart(
  owner: string,
  repo: string,
  path = "",
  branch = "HEAD",
  token?: string | null,
): Promise<{ entries: DirEntry[]; readme: ReadmeInfo | null }> {
  // REST 降级分步（README 失败静默 null，不影响目录列表）
  const fromRest = async (): Promise<{ entries: DirEntry[]; readme: ReadmeInfo | null }> => {
    const [entries, readme] = await Promise.all([
      fetchDirContents(owner, repo, path, branch, token),
      fetchReadme(owner, repo, token, path).catch(() => null),
    ]);
    return { entries, readme };
  };
  if (token) {
    try {
      const expr = path ? `${branch}:${path}` : `${branch}:`;
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(TREE_ENTRIES_QUERY, { owner, name: repo, expr }, token);
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        const dirEntries = entries.map(toDirEntry);
        // README 定位：blob 且 name 严格匹配 readme.md（大小写不敏感）——
        // 勿用 /^readme\./ 前缀匹配（会误命中 README.i18n.yaml 等非 md 文件）
        const readme = entries.find((e) => e.type === "blob" && /^readme\.md$/i.test(e.name));
        let readmeInfo: ReadmeInfo | null = null;
        if (readme) {
          const readmePath = readme.path ?? (path ? `${path}/${readme.name}` : readme.name);
          try {
            const content = await fetchFileContentSmart(owner, repo, readmePath, token, branch);
            readmeInfo = {
              content,
              path: readmePath,
              rawBase: repoRawBase(owner, repo, branch) + (path ? `/${path}` : ""),
            };
          } catch {
            readmeInfo = null; // README 内容失败静默（不影响目录列表）
          }
        }
        return { entries: dirEntries, readme: readmeInfo };
      }
      // GraphQL 失败 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchDirWithReadmeSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST 分步
      return withRestFallback(fromRest, "fetchDirWithReadmeSmart", undefined);
    }
  }
  // 匿名强制 REST 分步
  return fromRest();
}

/**
 * 智能获取仓库根目录文件名数组（About Resources 探测 CoC/Contributing/Security/license）。
 * 登录：GraphQL repository.object(expression:"HEAD:") → Tree.entries 顶层名（单层，无需 recursive）；
 * 匿名 / GraphQL 失败 → 熔断降级 REST fetchRootFiles（get-tree 非递归）。
 */
export async function fetchRootFilesSmart(
  owner: string,
  repo: string,
  branch: string,
  token?: string | null,
): Promise<string[] | null> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(
        TREE_ENTRIES_QUERY,
        { owner, name: repo, expr: `${branch}:` },
        token,
      );
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        return entries.map((e) => e.name).filter(Boolean);
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchRootFiles(owner, repo, branch, token),
        "fetchRootFilesSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchRootFiles(owner, repo, branch, token),
        "fetchRootFilesSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchRootFiles(owner, repo, branch, token);
}

// ===== 编辑页数据一次查（blob 内容 + metadata）=====

/** 编辑页数据（内容 + blob sha） */
export interface FileEditData {
  /** 文件内容（skipContent=true 或 >1MB/非文本时为 null） */
  content: string | null;
  /** blob sha（PUT createOrUpdateFileContents 的 sha 参数；与 REST contents.sha 语义一致） */
  sha: string;
}

/**
 * 编辑页数据：REST 通道一次拿 sha(meta) + 内容（去 GraphQL——blob 1MB 截断徒增复杂度）。
 * - sha：fetchFileMeta（REST contents 元数据，与 createOrUpdateFileContents 的 sha 语义一致）；
 * - 内容：fetchFileContentSmart（REST contents 唯一通道 + $raw/raw 保底）；
 * - skipContent=true（blob→编辑注入路径）：仅取 sha；
 * - 编辑场景 token 必在（WriteGate 门控）。
 */
export async function fetchFileEditSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  skipContent = false,
): Promise<FileEditData> {
  const meta = await fetchFileMeta(owner, repo, path, token!);
  if (skipContent) return { content: null, sha: meta.sha };
  const c = await fetchFileContentSmart(owner, repo, path, token, branch);
  return { content: c, sha: meta.sha };
}
