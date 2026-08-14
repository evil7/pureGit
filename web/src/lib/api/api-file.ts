/**
 * GitHub API smart layer - 文件内容（自 api-repo.ts 拆出）
 * blob 内容 / 目录列举 / README / 根文件 / 编辑页数据一次查。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  FILE_RAW_QUERY,
  FILE_EDIT_QUERY,
  FILE_WITH_COMMIT_QUERY,
  TREE_ENTRIES_QUERY,
  repoRawBase,
} from "@/lib/repo/repo-raw";
import { fetchRawContentSmart } from "@/lib/repo/raw-proxy";
import {
  ApiError,
  fetchFileContent,
  fetchFileMeta,
  fetchFileCommit,
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
 * GitHub API 文件内容通道上限（修订，官方 2022-05 起 REST 提升至 100MB）：
 * - API_REST_MAX_BYTES = 100MB：REST contents + raw Accept 上限（1MB~100MB 必须 raw Accept，
 *   fetchFileContent 已满足）；>100MB 接口直接拒绝。
 * - API_GQL_MAX_BYTES = 1MB：GraphQL Blob.text 硬限制——>1MB 时 isTruncated=true、text 只含部分
 *   （官方 确认：text 非 null 但截断），必须检查 isTruncated 防静默返回残缺内容。
 * 文件树（git/trees 递归）自带 size 字段，knownSize 已知超限时跳过对应通道（免无谓 API 尝试）。
 */
export const API_REST_MAX_BYTES = 100 * 1024 * 1024;
export const API_GQL_MAX_BYTES = 1024 * 1024;

/**
 * 智能获取文件原始内容（blob 页主加载通道）——**API 优先 + 按登录态保底**。
 *
 * 分层（用户定稿：登录 = API smart hack 优先、$raw 保底；匿名 = REST hack 优先、raw 直连保底）：
 * - **登录**：① GraphQL blob（`Blob.text` + isTruncated 检查，5000 点配额，≤1MB）
 *   → ② REST contents（raw Accept，100MB 通道，私有仓库可读）
 *   → ③ Worker /$raw 代理保底（跳过直连——受限网络直连超时浪费 5s；worker 带会话 token，绕墙 + Cache API）。
 * - **匿名**（GraphQL 恒 403 守卫短路）：① REST contents（raw Accept，公开仓库，60/h 配额——
 *   api.github.com 实测可达，用户定稿主通道）→ ② raw 直连保底（零配额零成本；**仅直连不转代理**）。
 * - **knownSize 门控**：>100MB（REST 硬限制）→ 直接保底通道；>1MB（GraphQL 必截断）→ 跳过 GraphQL 直接 REST。
 * 每次命中通道打 fileContentLog（dev 审计）。
 */
export async function fetchFileContentSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  knownSize?: number,
): Promise<string> {
  const detail = `${owner}/${repo} ${branch}:${path}`;
  // 保底通道（登录 $raw 代理 / 匿名 raw 直连）——用户定稿
  const fallback = async (): Promise<string> => {
    if (token) {
      // 登录保底：$raw 代理（directFirst=false 跳过直连，受限网络直连超时浪费 5s）
      const raw = await fetchRawContentSmart(owner, repo, branch, path, false);
      if (raw != null) {
        fileContentLog(detail, "fallback→$raw-proxy", raw.length);
        return raw;
      }
      fileContentLog(detail, "fallback→$raw-proxy→null", 0);
      throw new ApiError(413, "文件获取失败（超过通道上限或网络不可达）");
    }
    // 匿名保底：raw 直连（零配额；仅直连不转代理，用户定稿）
    const raw = await fetchRawContentSmart(owner, repo, branch, path, true, false);
    if (raw != null) {
      fileContentLog(detail, "fallback→raw-direct", raw.length);
      return raw;
    }
    fileContentLog(detail, "fallback→raw-direct→null", 0);
    throw new ApiError(404, "文件获取失败（公开文件不可达，请登录后重试）");
  };
  // ①-0 size 门控：>100MB（REST 硬限制）→ 直接保底通道
  if (knownSize != null && knownSize > API_REST_MAX_BYTES) {
    fileContentLog(detail, "size-gated(>100MB)→fallback", 0);
    return fallback();
  }
  // ① GraphQL：仅登录且 ≤1MB（>1MB 必截断，跳过省一次无效查询）
  if (token && !(knownSize != null && knownSize > API_GQL_MAX_BYTES)) {
    try {
      const resp: GraphQLResponse<{
        repository: { object: { text: string | null; isTruncated: boolean } | null } | null;
      }> = await graphqlRequest(
        FILE_RAW_QUERY,
        { owner, name: repo, expr: `${branch}:${path}` },
        token,
      );
      const obj = resp.data?.repository?.object;
      // text 完整（非截断）才返回；截断（>1MB）/ errors → 降级 REST
      if (!hasGraphQLErrors(resp) && obj?.text != null && !obj.isTruncated) {
        fileContentLog(detail, "graphql-blob", obj.text.length);
        return obj.text;
      }
      fileContentLog(detail, "graphql-blob→skip(truncated/err)", 0);
    } catch {
      fileContentLog(detail, "graphql-blob→err", 0);
    }
  } else {
    fileContentLog(
      detail,
      token ? "graphql-blob→skip(size>1MB)" : "graphql-blob→skip(anonymous)",
      0,
    );
  }
  // ② REST contents（raw Accept，100MB 通道；登录匿名都走——api.github.com 实测可达）
  try {
    const rest = await fetchFileContent(owner, repo, path, token, branch);
    fileContentLog(detail, "rest-contents", rest.length);
    return rest;
  } catch {
    fileContentLog(detail, "rest-contents→err", 0);
  }
  // ③ 保底通道（登录 $raw 代理 / 匿名 raw 直连）
  return fallback();
}

/** blob 文件头 commit 信息（与 REST fetchFileCommit 返回结构一致） */
export type FileCommitInfo = Awaited<ReturnType<typeof fetchFileCommit>>;

/**
 * blob 页复合查询——一次 GraphQL 同时拿文件内容(text) + 该文件最近提交(commit)。
 * 替代 BlobPage 原先 fetchFileContentSmart + fetchFileCommitSmart 两次请求（登录态 2→1）。
 *
 * 分层：
 * - 登录且 ≤1MB：一次 FILE_WITH_COMMIT_QUERY（file alias 拿 Blob.text + commit alias 拿 Commit.history）。
 *   text 完整（非截断）→ content + commit 一次到位；
 *   text 截断（>1MB）→ content 降级 REST（commit 保留 GraphQL 结果）；
 *   commit 为 null（文件无提交历史）→ commit 降级 REST。
 * - 其余（匿名 / >1MB 门控 / GraphQL 失败）→ 分别降级：
 *   content 走 fetchFileContentSmart 完整降级链（GraphQL blob → REST → $raw）；
 *   commit 走 REST fetchFileCommit（静默 null，BlobPage 匿名本就跳过 commit）。
 */
export async function fetchFileWithCommitSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  knownSize?: number,
): Promise<{ content: string; commit: FileCommitInfo }> {
  const detail = `${owner}/${repo} ${branch}:${path}`;
  // GraphQL commit 节点 → FileCommitInfo
  const mapCommit = (n: {
    oid: string;
    message: string;
    committedDate: string;
    author: { avatarUrl: string; user: { login: string } | null } | null;
  }): FileCommitInfo => ({
    sha: n.oid,
    commit: { message: n.message, committer: { date: n.committedDate } },
    author: n.author?.user ? { login: n.author.user.login, avatar_url: n.author.avatarUrl } : null,
  });

  // 合并查询主通道（仅登录且 ≤1MB——>1MB text 必截断，跳过省一次无效查询）
  if (token && !(knownSize != null && knownSize > API_GQL_MAX_BYTES)) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          file: { text: string | null; isTruncated: boolean } | null;
          commit: {
            history: { nodes: Parameters<typeof mapCommit>[0][] } | null;
          } | null;
        } | null;
      }> = await graphqlRequest(
        FILE_WITH_COMMIT_QUERY,
        { owner, name: repo, fileExpr: `${branch}:${path}`, commitExpr: branch, path },
        token,
      );
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const file = resp.data.repository.file;
        const commitNode = resp.data.repository.commit?.history?.nodes?.[0];
        // text 完整（非截断）→ content + commit 一次到位
        if (file?.text != null && !file.isTruncated) {
          fileContentLog(detail, "graphql-blob+commit", file.text.length);
          return {
            content: file.text,
            commit: commitNode
              ? mapCommit(commitNode)
              : await fetchFileCommit(owner, repo, path, branch, token),
          };
        }
        // text 截断（>1MB）→ content 走 REST contents 降级（commit 保留）
        fileContentLog(detail, "graphql-blob→truncated", 0);
        try {
          const rest = await fetchFileContent(owner, repo, path, token, branch);
          return {
            content: rest,
            commit: commitNode
              ? mapCommit(commitNode)
              : await fetchFileCommit(owner, repo, path, branch, token),
          };
        } catch {
          /* content REST 失败 → 落入下方完整降级链 */
        }
      }
    } catch {
      /* GraphQL 失败 → 落入下方完整降级链 */
    }
  }
  // 完整降级链（匿名 / 截断 REST 失败 / GraphQL 失败）
  const [content, commit] = await Promise.all([
    fetchFileContentSmart(owner, repo, path, token, branch, knownSize),
    token ? fetchFileCommit(owner, repo, path, branch, token) : Promise.resolve(null),
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
 * 智能获取 README（CodeIndex / TreePage 子目录 README 主通道）。
 * 登录：GraphQL 两步——① Tree.entries 定位 README 文件（REST /readme 自动定位 → GraphQL 需手动枚举，
 *   按 name 前缀 readme 匹配 blob）② fetchFileContentSmart 拿内容（GraphQL blob + REST/$raw 保底）。
 * 匿名 / GraphQL 失败 → 熔断降级 REST fetchReadme（自动定位，无需手动枚举）。
 */
export async function fetchReadmeSmart(
  owner: string,
  repo: string,
  token?: string | null,
  dir = "",
): Promise<ReadmeInfo | null> {
  if (token) {
    try {
      const expr = dir ? `HEAD:${dir}` : "HEAD:";
      const resp: GraphQLResponse<{
        repository: { object: { entries: TreeEntryNode[] | null } | null } | null;
      }> = await graphqlRequest(TREE_ENTRIES_QUERY, { owner, name: repo, expr }, token);
      const entries = resp.data?.repository?.object?.entries;
      if (!hasGraphQLErrors(resp) && entries) {
        // README 定位：blob 且 name 严格匹配 readme.md（大小写不敏感）——
        // 勿用 /^readme\./ 前缀匹配（会误命中 README.i18n.yaml 等非 md 文件）
        const readme = entries.find((e) => e.type === "blob" && /^readme\.md$/i.test(e.name));
        if (readme) {
          const readmePath = readme.path ?? (dir ? `${dir}/${readme.name}` : readme.name);
          const content = await fetchFileContentSmart(owner, repo, readmePath, token);
          return {
            content,
            path: readmePath,
            rawBase: repoRawBase(owner, repo, "HEAD") + (dir ? `/${dir}` : ""),
          };
        }
        // 目录存在但无 README → null（与 REST /readme 404 语义一致）
        return null;
      }
      // GraphQL 失败 → 熔断降级 REST（自动定位 README）
      return withRestFallback(() => fetchReadme(owner, repo, token, dir), "fetchReadmeSmart", resp);
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchReadme(owner, repo, token, dir),
        "fetchReadmeSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchReadme(owner, repo, token, dir);
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
 * 编辑页数据：一次 GraphQL 同时拿 blob 内容(text) + sha(oid)，降级链完备。
 * - oid 与 REST contents.sha 同为 blob SHA（GitHub 官方文档），可直接用于 PUT 提交；
 * - >1MB：isTruncated=true（text 只含部分，官方 确认）→ 不返回残缺内容，
 *   内容经 fetchFileContentSmart（REST/$raw）补齐，sha 用 oid；
 * - 误填目录路径（object 为 Tree，fragment 不匹配）→ 无 oid → 降级 REST 报错（同 REST 行为）；
 * - 匿名 / GraphQL 失败：降级 REST fetchFileMeta 拿 sha + fetchFileContentSmart 内容通道；
 * - skipContent=true（blob→编辑注入路径）：仅取 sha（GraphQL 仍返回 text 字段，解析时忽略）。
 */
export async function fetchFileEditSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  skipContent = false,
): Promise<FileEditData> {
  // ① 登录 GraphQL 首选：object { ... on Blob { oid text isTruncated } }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          object: { oid: string; text: string | null; isTruncated: boolean } | null;
        } | null;
      }> = await graphqlRequest(
        FILE_EDIT_QUERY,
        { owner, name: repo, expr: `${branch}:${path}` },
        token,
      );
      const obj = resp.data?.repository?.object;
      if (obj?.oid) {
        // sha 到手；text 完整（非截断）则一并返回（skipContent 时调用方不要内容）
        if (skipContent) return { content: null, sha: obj.oid };
        if (obj.text != null && !obj.isTruncated) {
          return { content: obj.text, sha: obj.oid };
        }
        // isTruncated（>1MB）→ 不返回残缺内容，经 smart 通道补齐，sha 用 oid
        const c = await fetchFileContentSmart(owner, repo, path, token, branch);
        return { content: c, sha: obj.oid };
      }
      // object 为 null（路径不存在）或非 Blob（目录）→ 降级 REST（行为与 REST contents 一致）
    } catch {
      /* 降级 */
    }
  }
  // ② 降级：REST contents 拿 sha + smart 通道内容（编辑场景 token 必在：WriteGate 门控）
  const meta = await fetchFileMeta(owner, repo, path, token!);
  if (skipContent) return { content: null, sha: meta.sha };
  const c = await fetchFileContentSmart(owner, repo, path, token, branch);
  return { content: c, sha: meta.sha };
}
