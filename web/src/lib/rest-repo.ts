/**
 * GitHub REST API - repo（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import { ApiError, typedRequest, fetchWithTimeout, GITHUB_API } from "./rest-core";
import type { GitHubUser } from "./rest-core";
import type { Repository, PullFile } from "./rest-issue-pr";

// ===== 仓库创建/管理（需 token）=====

/**
 * 创建仓库（REST POST /user/repos 或 /orgs/{org}/repos）
 * @param owner 未传或等于当前登录名 → 个人仓库；否则为组织名（需该组织写权限）
 */
export async function createRepository(
  token: string,
  opts: {
    name: string;
    description?: string;
    private?: boolean;
    auto_init?: boolean;
    /** 目标 owner：不传/个人登录名 → /user/repos；组织名 → /orgs/{org}/repos */
    owner?: string;
  },
  login?: string,
): Promise<Repository> {
  const path = opts.owner && opts.owner !== login ? opts.owner : null;
  if (path) {
    return typedRequest<Repository>(token, (octokit) =>
      octokit.rest.repos.createInOrg({
        org: path,
        name: opts.name,
        description: opts.description,
        private: opts.private,
        auto_init: opts.auto_init,
      }),
    );
  }
  return typedRequest<Repository>(token, (octokit) =>
    octokit.rest.repos.createForAuthenticatedUser({
      name: opts.name,
      description: opts.description,
      private: opts.private,
      auto_init: opts.auto_init,
    }),
  );
}

/** 更新仓库基本信息（REST PATCH /repos/{owner}/{repo}） */
export async function updateRepository(
  owner: string,
  repo: string,
  token: string,
  fields: {
    /** 变更仓库名（官方支持 PATCH name，会生成重定向；改名后 URL 变更） */
    name?: string;
    description?: string;
    homepage?: string;
    default_branch?: string;
    private?: boolean;
    archived?: boolean;
    /** Features 开关（官方 has_issues/has_discussions/has_wiki/has_projects） */
    has_issues?: boolean;
    has_discussions?: boolean;
    has_wiki?: boolean;
    has_projects?: boolean;
  },
): Promise<Repository> {
  return typedRequest<Repository>(token, (octokit) =>
    octokit.rest.repos.update({ owner, repo, ...fields }),
  );
}

/** 仓库 topics（GET /repos/{owner}/{repo}/topics，需 repo/Administration 权限） */
export async function fetchRepoTopics(
  owner: string,
  repo: string,
  token: string,
): Promise<string[]> {
  const data = await typedRequest<{ names: string[] }>(token, (octokit) =>
    octokit.rest.repos.getAllTopics({ owner, repo }),
  );
  return data.names ?? [];
}

/** 替换仓库 topics（PUT /repos/{owner}/{repo}/topics，body {names}；需 repo/Administration 权限） */
export async function replaceRepoTopics(
  owner: string,
  repo: string,
  token: string,
  names: string[],
): Promise<string[]> {
  const data = await typedRequest<{ names: string[] }>(token, (octokit) =>
    octokit.rest.repos.replaceAllTopics({ owner, repo, names }),
  );
  return data.names ?? [];
}

export async function fetchBranches(
  owner: string,
  repo: string,
  perPage = 30,
  token?: string | null,
): Promise<{ name: string; commit: { sha: string } }[]> {
  return typedRequest<{ name: string; commit: { sha: string } }[]>(token, (octokit) =>
    octokit.rest.repos.listBranches({ owner, repo, per_page: perPage }),
  );
}

/** compare 对比结果（REST GET /repos/{o}/{r}/compare/{base}...{head}） */
export interface CompareResult {
  status: string; // ahead / behind / identical / diverged
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: {
    sha: string;
    commit: { message: string; author: { date?: string } | null };
  }[];
  files: PullFile[];
}

/**
 * 分支对比（compare 页 diff 预览数据源）。
 * 注：GraphQL 无 compare 端点 → 仅 REST（Octokit 类型化方法 compareCommitsWithBasehead，
 * basehead 整串传参，跨仓库冒号格式 `owner:repo:branch` 由 SDK 编码保证，勿再手拼 URL）。
 */
export async function fetchCompare(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token?: string | null,
): Promise<CompareResult> {
  const res = await typedRequest<{
    status: string;
    ahead_by: number;
    behind_by: number;
    total_commits: number;
    commits: CompareResult["commits"];
    files?: PullFile[];
  }>(token, (octokit) =>
    octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
    }),
  );
  return { ...res, files: res.files ?? [] };
}

/** merge-upstream 结果（REST POST /repos/{o}/{r}/merge-upstream；409 = 无上游更改） */
export interface MergeUpstreamResult {
  message?: string;
  merge_type?: "none" | "merge" | "rebase" | "fast-forward";
  base_branch?: string;
}

/**
 * 同步 fork（REST POST /repos/{owner}/{repo}/merge-upstream）。
 * 将上游默认分支的最新提交合并到本 fork 指定分支（官方 Sync fork → Update branch 的真实 API）。
 * 需 token + 仓库写权限；无上游更改时 409（合并结果 message）。
 * Octokit 类型化方法 repos.mergeUpstream（不再手拼 URL）。
 */
export async function mergeUpstream(
  owner: string,
  repo: string,
  token: string,
  branch: string,
): Promise<MergeUpstreamResult> {
  return typedRequest<MergeUpstreamResult>(token, (octokit) =>
    octokit.rest.repos.mergeUpstream({ owner, repo, branch }),
  );
}

/** 仓库最近提交（用于文件列表的提交信息行） */
export async function fetchLatestCommit(
  owner: string,
  repo: string,
  branch = "HEAD",
  token?: string | null,
): Promise<{
  sha: string;
  commit: { message: string; committer: { date: string } };
  author?: { login?: string; avatar_url?: string } | null;
} | null> {
  try {
    const arr = await typedRequest<
      {
        sha: string;
        commit: { message: string; committer: { date: string } };
        author?: { login?: string; avatar_url?: string } | null;
      }[]
    >(token, (octokit) =>
      octokit.rest.repos.listCommits({ owner, repo, sha: branch, per_page: 1 }),
    );
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

/** 指定文件的最近提交（用于 blob 文件头显示 commit 信息） */
export async function fetchFileCommit(
  owner: string,
  repo: string,
  path: string,
  branch = "HEAD",
  token?: string | null,
): Promise<{
  sha: string;
  commit: { message: string; committer: { date: string } };
  author?: { login?: string; avatar_url?: string } | null;
} | null> {
  try {
    const arr = await typedRequest<
      {
        sha: string;
        commit: { message: string; committer: { date: string } };
        author?: { login?: string; avatar_url?: string } | null;
      }[]
    >(token, (octokit) =>
      octokit.rest.repos.listCommits({ owner, repo, sha: branch, path, per_page: 1 }),
    );
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

export async function forkRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<Repository> {
  return typedRequest<Repository>(token, (octokit) =>
    octokit.rest.repos.createFork({ owner, repo }),
  );
}

/** 检测当前用户是否已 star 该仓库（204 已 star / 404 未 star） */
export async function checkStarred(token: string, owner: string, repo: string): Promise<boolean> {
  try {
    await typedRequest<void>(token, (octokit) =>
      octokit.rest.activity.checkRepoIsStarredByAuthenticatedUser({ owner, repo }),
    );
    return true;
  } catch {
    return false;
  }
}

/** star / unstar 仓库（starred=true 添加，false 移除） */
export async function setStarred(
  token: string,
  owner: string,
  repo: string,
  starred: boolean,
): Promise<void> {
  if (starred) {
    await typedRequest<void>(token, (octokit) =>
      octokit.rest.activity.starRepoForAuthenticatedUser({ owner, repo }),
    );
  } else {
    await typedRequest<void>(token, (octokit) =>
      octokit.rest.activity.unstarRepoForAuthenticatedUser({ owner, repo }),
    );
  }
}

// ===== Watch（订阅）=====

/** 仓库订阅状态（GET /repos/{o}/{r}/subscription；404 = 未订阅） */
export interface RepoSubscription {
  subscribed: boolean;
  ignored: boolean;
}

/** 查询当前用户对该仓库的订阅状态（未订阅时 404 → {subscribed:false, ignored:false}） */
export async function fetchRepoSubscription(
  owner: string,
  repo: string,
  token: string,
): Promise<RepoSubscription> {
  try {
    const data = await typedRequest<Partial<RepoSubscription>>(token, (octokit) =>
      octokit.rest.activity.getRepoSubscription({ owner, repo }),
    );
    return { subscribed: !!data.subscribed, ignored: !!data.ignored };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { subscribed: false, ignored: false };
    throw e;
  }
}

/**
 * 设置订阅状态（PUT /repos/{o}/{r}/subscription）。
 * watch：{subscribed:true}；unwatch：{subscribed:false}；ignore：{ignored:true}
 */
export async function setRepoSubscription(
  owner: string,
  repo: string,
  token: string,
  body: { subscribed?: boolean; ignored?: boolean },
): Promise<RepoSubscription> {
  const data = await typedRequest<Partial<RepoSubscription>>(token, (octokit) =>
    octokit.rest.activity.setRepoSubscription({ owner, repo, ...body }),
  );
  return { subscribed: !!data.subscribed, ignored: !!data.ignored };
}

export async function fetchRepository(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Repository> {
  return typedRequest<Repository>(token, (octokit) => octokit.rest.repos.get({ owner, repo }));
}

/** README 信息（含路径与 raw base，供相对图片/链接解析） */
export interface ReadmeInfo {
  content: string;
  /** README 在仓库中的路径（如 README.md / docs/README.md） */
  path: string;
  /** README 所在目录的 raw base：https://raw.githubusercontent.com/{o}/{r}/{branch}[/dir] */
  rawBase: string;
}

/**
 * 获取 README（JSON 响应：内容 + 路径 + download_url）。
 * 无 README 返回 null；其他错误抛 ApiError。
 */
export async function fetchReadme(
  owner: string,
  repo: string,
  token?: string | null,
  /** 子目录（官方 README API 支持 /readme/{dir}；默认根目录） */
  dir = "",
): Promise<ReadmeInfo | null> {
  const dirPath = dir ? `/${dir.split("/").map(encodeURIComponent).join("/")}` : "";
  const res = await fetchWithTimeout(`${GITHUB_API}/repos/${owner}/${repo}/readme${dirPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new ApiError(res.status);
  }
  const data = (await res.json()) as {
    path?: string;
    content?: string;
    encoding?: string;
    download_url?: string | null;
  };
  // atob 得到的是 Latin-1 字节串；GitHub base64 内容是 UTF-8 字节，
  // 直接返回会中文/emoji 等乱码 → 用 TextDecoder("utf-8") 正确解码
  const content =
    data.encoding === "base64" && data.content
      ? new TextDecoder("utf-8").decode(
          Uint8Array.from(atob(data.content.replace(/\s+/g, "")), (c) => c.charCodeAt(0)),
        )
      : "";
  // download_url 形如 https://raw.githubusercontent.com/{o}/{r}/{branch}/{path}
  // → 去掉末段文件名得到 README 所在目录的 raw base（根目录即分支本身）
  const rawBase = data.download_url
    ? data.download_url.replace(/\/[^/]+$/, "")
    : `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
  return { content, path: data.path ?? "README.md", rawBase };
}

/** 语言统计（字节数映射） */
export async function fetchLanguages(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Record<string, number>> {
  return typedRequest<Record<string, number>>(token, (octokit) =>
    octokit.rest.repos.listLanguages({ owner, repo }),
  );
}

/**
 * 获取 SECURITY.md（contents API，同 fetchReadme 模式：JSON + base64 解码）。
 * 无 SECURITY.md 返回 null；其他错误抛 ApiError。
 */
export async function fetchSecurityMd(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<ReadmeInfo | null> {
  const res = await fetchWithTimeout(`${GITHUB_API}/repos/${owner}/${repo}/contents/SECURITY.md`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new ApiError(res.status);
  }
  const data = (await res.json()) as {
    path?: string;
    content?: string;
    encoding?: string;
    download_url?: string | null;
  };
  const content =
    data.encoding === "base64" && data.content
      ? new TextDecoder("utf-8").decode(
          Uint8Array.from(atob(data.content.replace(/\s+/g, "")), (c) => c.charCodeAt(0)),
        )
      : "";
  const rawBase = data.download_url
    ? data.download_url.replace(/\/[^/]+$/, "")
    : `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
  return { content, path: data.path ?? "SECURITY.md", rawBase };
}

// ===== 文件树 / 代码内容 / Releases =====

export interface GitTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url?: string;
}

export interface GitTree {
  sha: string;
  tree: GitTreeItem[];
  truncated: boolean;
}

/** 递归文件树（可指定分支/commit，默认 HEAD） */
export async function fetchFileTree(
  owner: string,
  repo: string,
  branch = "HEAD",
  token?: string | null,
): Promise<GitTree> {
  return typedRequest<GitTree>(token, (octokit) =>
    octokit.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "1" }),
  );
}

/** 目录条目（contents API 无 raw Accept 时返回） */
export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

/** 获取指定目录下的条目列表（不递归） */
export async function fetchDirContents(
  owner: string,
  repo: string,
  path = "",
  branch = "HEAD",
  token?: string | null,
): Promise<DirEntry[]> {
  const entries = await typedRequest<{ name: string; path: string; type: string; size: number }[]>(
    token,
    (octokit) =>
      octokit.rest.repos.getContent({
        owner,
        repo,
        path: path || "",
        ...(branch && branch !== "HEAD" ? { ref: branch } : {}),
      }),
  );
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type === "dir" ? "dir" : "file",
    size: e.size ?? 0,
  }));
}

/**
 * 获取文件原始内容（REST contents API + raw Accept：上限 100MB——
 * 官方 2022-05 起 1MB~100MB 必须指定 raw/object 自定义媒体类型，本函数已满足；
 * >100MB 接口拒绝。branch 指定分支，默认 HEAD）。
 * 特殊语义端点（raw Accept）保留底层通道。
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  branch = "HEAD",
): Promise<string> {
  const res = await fetchWithTimeout(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!res.ok) {
    //：读响应体作 detail——403 限流响应体含 "rate limit"，
    // ApiError.isRateLimit 依赖它识别（否则匿名 60/h 耗尽时页面只报「文件加载失败」）
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return res.text();
}

// ===== Issue 模板（官方 /issues/new/choose 语义）=====

/** issue 模板（解析 front matter 后） */
export interface IssueTemplate {
  /** 模板名（front matter `name` 或文件名去扩展） */
  name: string;
  /** 模板描述（front matter `about`/`description`，可能为空） */
  description: string;
  /** 文件名（如 bug_report.md，URL query template= 用） */
  filename: string;
  /** 仓库内完整路径 */
  path: string;
  /** 模板正文（已剥离 front matter；.md 模板作为 issue body 预填，form 模板为空） */
  content: string;
  /** 预填标题（front matter `title`，如 "[bug]: "；form 模板常用） */
  prefillTitle?: string;
  /** 预填标签（front matter `labels` 数组） */
  prefillLabels?: string[];
  /** 是否为 form 模板（.yml/.yaml，正文是表单定义不直接预填） */
  isForm: boolean;
}

/** 官方模板目录候选（按序探测） */
const TEMPLATE_DIRS = [".github/ISSUE_TEMPLATE", "ISSUE_TEMPLATE", "docs/ISSUE_TEMPLATE"];

/** 官方单文件模板候选 */
const TEMPLATE_FILES = [".github/ISSUE_TEMPLATE.md", "ISSUE_TEMPLATE.md", "docs/ISSUE_TEMPLATE.md"];

/**
 * 解析模板 front matter：GitHub 模板支持两种形式——
 * 1. `---` 分隔的 YAML 块（.md 模板常用）
 * 2. 文件开头直接 YAML 键值（form 模板 .yml 常用，无 --- 分隔符）
 * 提取 name / about / description / title / labels。
 * 返回 { meta, body }；无 front matter 时 meta 空、body 全文。
 */
function parseTemplateFrontMatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, "");
  const lines = trimmed.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let bodyStart = 0;

  // YAML 标量值去引号（"Bug report" → Bug report；'[bug]: ' → [bug]: ）
  const unquote = (v: string): string => {
    const s = v.trim();
    if (s.length >= 2) {
      const first = s[0];
      const last = s[s.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return s.slice(1, -1);
      }
    }
    return s;
  };

  // 形式 1：--- 开头
  if (lines[0]?.trim() === "---") {
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "---") break;
      const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
      if (m) meta[m[1].toLowerCase()] = unquote(m[2]);
    }
    bodyStart = i + 1;
  } else {
    // 形式 2：开头连续 YAML 键值行（直到 body: 或非键值行）
    let i = 0;
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
      if (!m) break;
      meta[m[1].toLowerCase()] = unquote(m[2]);
      if (m[1].toLowerCase() === "body") {
        // body 是 form 模板字段定义起点，后续不再算 front matter
        i++;
        break;
      }
    }
    bodyStart = i;
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  return { meta, body };
}

/** 从文件名去扩展生成回退名（bug_report.md → Bug report） */
function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(md|yml|yaml)$/i, "");
  return base
    .split(/[-_]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * 获取仓库 issue 模板列表（官方 /issues/new/choose 语义）。
 * 探测标准位置（.github/ISSUE_TEMPLATE / ISSUE_TEMPLATE / docs/ISSUE_TEMPLATE 目录
 * + 单文件 .github/ISSUE_TEMPLATE.md / ISSUE_TEMPLATE.md / docs/ISSUE_TEMPLATE.md）。
 * 无模板返回 []（官方直接进空白表单）。
 */
export async function fetchIssueTemplates(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<IssueTemplate[]> {
  const templates: IssueTemplate[] = [];
  const seen = new Set<string>();

  const pushTemplate = (path: string, filename: string, raw: string) => {
    if (seen.has(filename) || !filename) return;
    seen.add(filename);
    const isForm = /\.(yml|yaml)$/i.test(filename);
    const { meta, body } = parseTemplateFrontMatter(raw);
    // form 模板（yml）正文是表单定义（body: 字段列表），不直接作为 issue body 预填；
    // 提取 front matter 的 title/labels 供表单预填
    let prefillTitle: string | undefined;
    let prefillLabels: string[] | undefined;
    if (meta.title) prefillTitle = meta.title;
    if (meta.labels) {
      // labels: ["bug", "feature"] 或 labels: bug
      const m = meta.labels.match(/\[([^\]]*)\]/);
      prefillLabels = m
        ? m[1]
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean)
        : meta.labels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    templates.push({
      name: meta.name || nameFromFilename(filename),
      description: meta.about || meta.description || "",
      filename,
      path,
      // form 模板不预填正文；.md 模板预填剥离 front matter 的正文
      content: isForm ? "" : body || raw.trim(),
      prefillTitle,
      prefillLabels,
      isForm,
    });
  };

  // 1) 目录探测（.md/.yml/.yaml，跳过 config.yml）
  for (const dir of TEMPLATE_DIRS) {
    try {
      const entries = await fetchDirContents(owner, repo, dir, "HEAD", token);
      const files = entries
        .filter(
          (e) =>
            e.type === "file" && /\.(md|yml|yaml)$/i.test(e.name) && !/^config\./i.test(e.name),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const f of files) {
        try {
          const raw = await fetchFileContent(owner, repo, f.path, token, "HEAD");
          pushTemplate(f.path, f.name, raw);
        } catch {
          /* 单个模板读取失败跳过 */
        }
      }
      if (templates.length > 0) return templates; // 首个命中目录即官方语义
    } catch {
      /* 目录不存在/无权限 → 探测下一位置 */
    }
  }

  // 2) 单文件模板
  for (const file of TEMPLATE_FILES) {
    try {
      const raw = await fetchFileContent(owner, repo, file, token, "HEAD");
      pushTemplate(file, file.split("/").pop()!, raw);
    } catch {
      /* 继续探测 */
    }
  }

  return templates;
}

// ===== 文件写操作（需 token；contents API，<1MB 文本文件）=====

/** 文件元信息（含 sha，编辑/删除必需） */
export interface FileMeta {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
}

/** 获取文件元信息（含 sha，供编辑/删除） */
export async function fetchFileMeta(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<FileMeta> {
  return typedRequest<FileMeta>(token, (octokit) =>
    octokit.rest.repos.getContent({ owner, repo, path }),
  );
}

/** 创建或更新文件（PUT contents；有 sha 更新，无 sha 新增） */
export async function updateFileContent(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  token: string,
  sha?: string,
): Promise<{ content: { sha: string } }> {
  return typedRequest<{ content: { sha: string } }>(token, (octokit) =>
    octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: btoa(unescape(encodeURIComponent(content))), // UTF-8 安全 base64
      branch,
      ...(sha ? { sha } : {}),
    }),
  );
}

/**
 * 创建新分支（官方「Create a new branch…」两段式第一步）。
 * GitHub contents API 无 new_branch 参数（静默忽略，提交仍落原分支），
 * 必须 POST /git/refs 先建分支，再 PUT contents 到新分支。
 */
export async function createBranch(
  owner: string,
  repo: string,
  newBranch: string,
  baseBranch: string,
  token: string,
): Promise<void> {
  // 1) 取 base 分支 head commit sha
  const ref = await typedRequest<{ object: { sha: string } }>(token, (octokit) =>
    octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` }),
  );
  // 2) 创建新分支（分支已存在会 422，由调用方按错误提示处理）
  await typedRequest<void>(token, (octokit) =>
    octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    }),
  );
}

/** 删除文件（DELETE contents） */
export async function deleteFileContent(
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
  sha: string,
  token: string,
): Promise<{ commit: { sha: string } }> {
  return typedRequest<{ commit: { sha: string } }>(token, (octokit) =>
    octokit.rest.repos.deleteFile({ owner, repo, path, message, branch, sha }),
  );
}

export interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  author: GitHubUser;
  assets: { name: string; size: number; browser_download_url: string }[];
}

/** Releases 列表 */
export async function fetchReleases(
  owner: string,
  repo: string,
  perPage = 20,
  token?: string | null,
  page = 1,
): Promise<Release[]> {
  return typedRequest<Release[]>(token, (octokit) =>
    octokit.rest.repos.listReleases({ owner, repo, per_page: perPage, page }),
  );
}

/** Release 详情 */
export async function fetchReleaseDetail(
  owner: string,
  repo: string,
  tag: string,
  token?: string | null,
): Promise<Release> {
  return typedRequest<Release>(token, (octokit) =>
    octokit.rest.repos.getReleaseByTag({ owner, repo, tag }),
  );
}

/** 从分页 Link header 解析最后一页页码（用于统计总数，避免全量拉取） */
function lastPageFromLink(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

/** 仓库 Releases 数量（per_page=1 读 Link header 末页；失败/限流返回 0） */
export async function fetchReleasesCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number> {
  try {
    const res = await fetchWithTimeout(`${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=1`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return 0;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/** 最新 Release + 总数（About 侧栏 Releases 分区入口；per_page=1 一次请求：body[0]=最新，Link header=总数） */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ count: number; latest: Release | null }> {
  try {
    const res = await fetchWithTimeout(`${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=1`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return { count: 0, latest: null };
    const last = lastPageFromLink(res.headers.get("Link"));
    const arr = (await res.json()) as Release[];
    return { count: last ?? arr.length, latest: arr[0] ?? null };
  } catch {
    return { count: 0, latest: null };
  }
}

/** 仓库根目录文件名数组（保留原始大小写；About Resources 探测 CoC/Contributing/Security/license
 * 是否存在——探测用小写比较、链接用原始名（blob 路由大小写敏感）；失败返回 null）。
 * 非递归顶层树（getTree 默认不递归，对应 recursive=0） */
export async function fetchRootFiles(
  owner: string,
  repo: string,
  branch: string,
  token?: string | null,
): Promise<string[] | null> {
  try {
    const tree = await typedRequest<{ tree?: { path?: string }[] }>(token, (octokit) =>
      octokit.rest.git.getTree({ owner, repo, tree_sha: branch }),
    );
    if (!tree?.tree) return null;
    return tree.tree.map((t) => t.path ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

/** 仓库 Contributors 数量（per_page=1 读 Link header 末页；失败/限流返回 0） */
export async function fetchContributorsCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return 0;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/**
 * open Pull requests 数量（REST pulls?state=open&per_page=1 读 Link header 末页）。
 * REST 仓库主字段 open_issues_count 含 PRs 不能拆分 → 独立精确计数；
 * 失败/限流返回 null（调用方据此隐藏计数，不显示错误）。
 */
export async function fetchOpenPullsCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return null;
  }
}

// ===== D1 Security 安全公告（REST only；GraphQL 无 security advisory 通道，见 api-compat.md §4.14）=====

/** 安全公告（GET /repos/{owner}/{repo}/security-advisories 结构子集） */
export interface SecurityAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  description: string | null;
  severity: "critical" | "high" | "medium" | "low" | null;
  state: "published" | "closed" | "withdrawn" | "draft" | "triage";
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  html_url: string;
  vulnerabilities: {
    package: { ecosystem: string; name: string | null } | null;
    vulnerable_version_range: string | null;
    patched_versions: string | null;
  }[];
  cwes: { cwe_id: string; name: string }[] | null;
  credits: { login: string; type: string }[] | null;
  author: { login: string; avatar_url: string } | null;
  publisher: { login: string; avatar_url: string } | null;
}

/** 列出仓库安全公告（仅 published；公开仓库匿名可读；需 token 时含私有仓库 published） */
export async function fetchSecurityAdvisories(
  owner: string,
  repo: string,
  token?: string | null,
  perPage = 30,
): Promise<SecurityAdvisory[]> {
  return typedRequest<SecurityAdvisory[]>(token, (octokit) =>
    octokit.rest.securityAdvisories.listRepositoryAdvisories({
      owner,
      repo,
      state: "published",
      per_page: perPage,
      sort: "published",
      direction: "desc",
    }),
  );
}

/**
 * 仓库安全公告总数（per_page=1 读 Link header 末页；官方 RepoHeader Security tab 计数 =
 * GHSA 总数，公开仓库匿名可读，2026-08-12 实测 github.com/microsoft/vscode 显示 43）。
 * 失败/限流返回 null（调用方据此隐藏计数）。
 */
export async function fetchSecurityAdvisoriesCount(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${GITHUB_API}/repos/${owner}/${repo}/security-advisories?state=published&per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const last = lastPageFromLink(res.headers.get("Link"));
    if (last != null) return last;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return null;
  }
}

/** 安全公告详情（GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}） */
export async function fetchSecurityAdvisory(
  owner: string,
  repo: string,
  ghsaId: string,
  token?: string | null,
): Promise<SecurityAdvisory> {
  return typedRequest<SecurityAdvisory>(token, (octokit) =>
    octokit.rest.securityAdvisories.getRepositoryAdvisory({ owner, repo, ghsa_id: ghsaId }),
  );
}

// ===== I1 Insights Pulse：提交聚合（Top committers）=====

/** 仓库提交精简结构（Pulse Top committers 聚合用；author 可能为 null——无名提交） */
export interface RepoCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
}

/** 列出仓库提交（GET /repos/{owner}/{repo}/commits；since 起过滤，分页拉取） */
export async function fetchCommits(
  owner: string,
  repo: string,
  since?: string,
  perPage = 100,
  page = 1,
  token?: string | null,
): Promise<RepoCommit[]> {
  return typedRequest<RepoCommit[]>(token, (octokit) =>
    octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: perPage,
      page,
      ...(since ? { since } : {}),
    }),
  );
}
