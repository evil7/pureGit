/**
 * GitHub API smart layer - 文件内容（自 api-repo.ts 拆出）
 * blob 内容 / 目录列举 / README / 根文件 / 编辑页数据一次查。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { TREE_ENTRIES_QUERY, repoRawBase } from "@/lib/repo/repo-raw";
import { fetchRawContentSmart, fetchJsdelivrContent } from "@/lib/repo/raw-proxy";
import { getCachedSha, setCachedSha } from "@/lib/repo/sha-cache";
import { getProxyMode, anonymousProxyAllowed } from "@/lib/net/proxy-mode";
import { reportChannel } from "@/lib/net/channel-status";
import { fetchFileCommitSmart } from "./api-repo";
import {
  ApiError,
  fetchFileContent,
  fetchLatestCommit,
  fetchFileMeta,
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
 * GitHub API 文件内容通道上限（官方 2022-05 起 REST 提升至 100MB）：
 * - API_REST_MAX_BYTES = 100MB：REST contents + raw Accept 上限（1MB~100MB 必须 raw Accept，
 *   fetchFileContent 已满足）；>100MB 接口直接拒绝。
 * 文件内容读取已去 GraphQL（blob 1MB 截断徒增复杂度），统一走 REST contents 通道；
 * 文件树（git/trees 递归）自带 size 字段，knownSize 已知超限时跳过 REST 直连保底（免无谓尝试）。
 */
export const API_REST_MAX_BYTES = 100 * 1024 * 1024;

/**
 * 智能获取文件原始内容（blob 页主加载通道）——**REST contents 唯一通道 + 按登录态保底**。
 *
 * 分层（文件内容读取已去 GraphQL——blob 1MB 截断徒增复杂度，统一 REST contents）：
 * - **登录**：① REST contents（raw Accept，100MB 通道，私有仓库可读）
 *   → ② Worker /$raw 代理保底（跳过 raw 直连——受限网络直连超时浪费 5s；worker 带会话 token）。
 * - **匿名**（省流优先）：① 拿最新 commit sha（缓存 10min，1 额度）→ ② jsDelivr @sha（零额度精确绕墙）
 *   → ③ REST contents（②失败/拿不到 sha 时，实时）→ ④ raw 直连（零额度）→ ⑤ worker $raw（仅 mode=on）。
 *   额度耗尽（REST 限流）时跳过 ④ raw 直连，直接 ⑤ worker（on）/ 报错（off/login）。
 * - **knownSize 门控**：>100MB（REST 硬限制）→ 直接保底通道。
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
  // 登录保底：$raw 代理（directFirst=false 跳过直连，受限网络直连超时浪费 5s）
  const loginFallback = async (): Promise<string> => {
    const raw = await fetchRawContentSmart(owner, repo, branch, path, false);
    if (raw != null) {
      fileContentLog(detail, "fallback→$raw-proxy", raw.length);
      return raw;
    }
    fileContentLog(detail, "fallback→$raw-proxy→null", 0);
    throw new ApiError(413, "文件获取失败（超过通道上限或网络不可达）");
  };

  // 匿名省流链（token 为空）
  const anonymousFetch = async (): Promise<string> => {
    // ① 拿最新 commit sha（缓存 10min 优先；miss 时 REST 1 额度）
    let sha = getCachedSha(owner, repo, branch);
    if (!sha) {
      try {
        const latest = await fetchLatestCommit(owner, repo, branch, null);
        if (latest?.sha) {
          sha = latest.sha;
          setCachedSha(owner, repo, branch, sha);
        }
      } catch {
        /* 拿不到 sha（可能额度耗尽/网络） */
      }
    }
    // ② jsDelivr @sha（拿到 sha 才走；零额度内容寻址精确绕墙）
    if (sha) {
      const jd = await fetchJsdelivrContent(owner, repo, sha, path);
      if (jd != null) {
        fileContentLog(detail, "jsdelivr@sha", jd.length);
        return jd;
      }
      fileContentLog(detail, "jsdelivr@sha→null", 0);
    }
    // ③ REST contents（实时，1 额度）
    try {
      const rest = await fetchFileContent(owner, repo, path, null, branch);
      fileContentLog(detail, "rest-contents", rest.length);
      reportChannel("rest");
      return rest;
    } catch (e) {
      fileContentLog(detail, "rest-contents→err", 0);
      // 额度耗尽（限流）：跳过 raw 直连（撞墙浪费 5s），直接 worker $raw（on）/ 报错（off/login）
      if (e instanceof ApiError && e.isRateLimit) {
        const mode = await getProxyMode();
        if (anonymousProxyAllowed(mode)) {
          const raw = await fetchRawContentSmart(owner, repo, branch, path, false);
          if (raw != null) {
            fileContentLog(detail, "ratelimit→$raw-proxy", raw.length);
            return raw;
          }
        }
        fileContentLog(detail, "ratelimit→no-channel", 0);
        throw new ApiError(403, "匿名 API 额度已耗尽，请登录后继续");
      }
    }
    // ④ raw 直连（非限流失败；零额度，仅直连不转代理）
    const raw = await fetchRawContentSmart(owner, repo, branch, path, true, false);
    if (raw != null) {
      fileContentLog(detail, "fallback→raw-direct", raw.length);
      return raw;
    }
    fileContentLog(detail, "fallback→raw-direct→null", 0);
    throw new ApiError(404, "文件获取失败（公开文件不可达，请登录后重试）");
  };

  // size 门控：>100MB（REST 硬限制）→ 直接保底通道
  if (knownSize != null && knownSize > API_REST_MAX_BYTES) {
    fileContentLog(detail, "size-gated(>100MB)→fallback", 0);
    return token ? loginFallback() : anonymousFetch();
  }
  // 登录态：REST contents 唯一通道（去 GraphQL）
  if (token) {
    try {
      const rest = await fetchFileContent(owner, repo, path, token, branch);
      fileContentLog(detail, "rest-contents", rest.length);
      reportChannel("rest");
      return rest;
    } catch {
      fileContentLog(detail, "rest-contents→err", 0);
    }
    return loginFallback();
  }
  // 匿名态：省流链
  return anonymousFetch();
}

/** blob 文件头 commit 信息（与 fetchFileCommitSmart 返回结构一致） */
export type FileCommitInfo = Awaited<ReturnType<typeof fetchFileCommitSmart>>;

/**
 * blob 页复合查询——文件内容 + 该文件最近提交，两通道并行。
 * - content：fetchFileContentSmart（REST contents 唯一通道 + $raw/raw 保底，去 GraphQL）
 * - commit：fetchFileCommitSmart（GraphQL 主通道 + REST 降级；无 1MB 限制保留 GraphQL）
 * 匿名时 commit 为 null（BlobPage 匿名本就跳过 commit）。
 */
export async function fetchFileWithCommitSmart(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
  knownSize?: number,
): Promise<{ content: string; commit: FileCommitInfo }> {
  const [content, commit] = await Promise.all([
    fetchFileContentSmart(owner, repo, path, token, branch, knownSize),
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
