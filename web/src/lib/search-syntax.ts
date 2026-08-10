/**
 * GitHub 搜索语法系统（精进）
 *
 * 官方 issues/PRs/discussions/gists 列表搜索框支持 GitHub search 语法：
 *   is:open / is:closed / is:answered / is:unanswered / is:pr / is:issue / is:merged
 *   label:bug / label:"in progress"（引号包裹的值）
 *   author:me / assignee:me / mentions:me / milestone:v1.0
 *   repo:owner/name / org:name / in:title / in:body
 *   created:2026-01-01 / updated:>2026-06-01 / comments:>5 / reactions:>3
 *   sort:created / sort:comments / sort:updated / sort:reactions（后缀 -asc 升序）
 *   type:issue / type:pr / type:discussion / type:gist
 *
 * 三套 API：
 *   1. parseSearchSyntax(raw)      → 结构化 SearchFilters（页面状态/URL query 用）
 *   2. buildSearchQuery(raw, opts) → GitHub 搜索端点（GraphQL search / REST search）query 串
 *   3. matchSearch(raw, target)    → 前端过滤匹配（用户级列表等已加载数据场景）
 *
 * 适配页面：仓库 Issues / Pulls / Discussions、用户级 All issues / All PRs / Gists。
 * 不属于本系统：Actions 的 Filter workflow runs（workflow/event/status/branch 过滤）、
 * Notifications（官方无搜索框）、全局 SearchPage（全站搜索独立体系）。
 */

export interface SearchFilters {
  /** 状态词（is:open/is:closed/is:answered/is:unanswered/is:merged） */
  is: string[];
  /** label:xxx（可多个） */
  labels: string[];
  author?: string;
  assignee?: string;
  mentions?: string;
  milestone?: string;
  repo?: string;
  org?: string;
  /** in:title / in:body / in:comments */
  in: string[];
  /** 排序（sort:xxx） */
  sort?: string;
  /** 时间/数值限定（created:/updated:/comments:/reactions:）原样保留给 API */
  ranges: string[];
  /** 自由文本（非限定词 token 合并） */
  query: string;
}

/** 解析 GitHub 搜索查询串 → SearchFilters（未知限定词并入 query 原文） */
export function parseSearchSyntax(raw: string): SearchFilters {
  const f: SearchFilters = { is: [], labels: [], in: [], ranges: [], query: "" };
  const free: string[] = [];
  const re = /(\w+):("[^"]*"|\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const [, key, rawVal] = m;
    const val = rawVal.replace(/^"|"$/g, "");
    free.push(raw.slice(last, m.index));
    last = re.lastIndex;
    switch (key.toLowerCase()) {
      case "is":
        f.is.push(val);
        break;
      case "label":
        f.labels.push(val);
        break;
      case "author":
        f.author = val === "me" ? "@me" : val;
        break;
      case "assignee":
        f.assignee = val === "me" ? "@me" : val;
        break;
      case "mentions":
        f.mentions = val === "me" ? "@me" : val;
        break;
      case "milestone":
        f.milestone = val;
        break;
      case "repo":
        f.repo = val;
        break;
      case "org":
        f.org = val;
        break;
      case "in":
        f.in.push(val);
        break;
      case "sort":
        f.sort = val;
        break;
      case "created":
      case "updated":
      case "comments":
      case "reactions":
        f.ranges.push(`${key}:${rawVal}`);
        break;
      default:
        free.push(`${key}:${rawVal}`);
    }
  }
  free.push(raw.slice(last));
  f.query = free.join(" ").replace(/\s+/g, " ").trim();
  return f;
}

/**
 * 构建 GitHub 搜索端点 query 串（GraphQL search / REST /search）。
 * @param raw 用户输入（可为空）
 * @param opts 页面限定：type（issue/pr/discussion/gist）、repo（自动加 repo:owner/name）、defaultState（无 is: 时默认）
 */
export function buildSearchQuery(
  raw: string,
  opts: {
    type?: "issue" | "pr" | "discussion" | "gist";
    repo?: string;
    defaultState?: string | null;
  },
): string {
  const parts: string[] = [];
  const f = parseSearchSyntax(raw);
  if (f.query) parts.push(f.query);
  // 类型限定（is:pr/is:issue 与 type: 等价，不重复加）
  const hasTypeInIs = f.is.some((v) => ["pr", "issue", "discussion", "gist"].includes(v));
  if (opts.type && !hasTypeInIs) parts.push(`type:${opts.type}`);
  // is: 状态词
  const stateWords = f.is.filter((v) => !["pr", "issue", "discussion", "gist"].includes(v));
  if (stateWords.length === 0 && opts.defaultState) {
    parts.push(`is:${opts.defaultState}`);
  } else {
    for (const s of stateWords) parts.push(`is:${s}`);
  }
  // label / author / assignee / mentions / milestone / repo / org
  for (const l of f.labels) parts.push(`label:${l.includes(" ") ? `"${l}"` : l}`);
  if (f.author) parts.push(`author:${f.author}`);
  if (f.assignee) parts.push(`assignee:${f.assignee}`);
  if (f.mentions) parts.push(`mentions:${f.mentions}`);
  if (f.milestone) parts.push(`milestone:${f.milestone}`);
  if (f.org) parts.push(`org:${f.org}`);
  // repo 限定（页面 repo 参数优先，显式 repo: 覆盖）
  parts.push(`repo:${f.repo ?? opts.repo}`);
  // in: 限定
  for (const i of f.in) parts.push(`in:${i}`);
  // 范围限定 + 排序
  for (const r of f.ranges) parts.push(r);
  if (f.sort) parts.push(`sort:${f.sort}`);
  return parts.join(" ");
}

/** 前端过滤匹配（已加载数据场景）：raw 解析后的每个条件与 target 字段逐一匹配 */
export function matchSearch(
  raw: string,
  target: {
    title: string;
    body?: string;
    repo?: string;
    author?: string;
    labels?: string[];
    state?: string;
    isAnswered?: boolean;
  },
): boolean {
  if (!raw.trim()) return true;
  const f = parseSearchSyntax(raw);
  const text = [target.title, target.body ?? "", target.repo ?? ""].join(" ").toLowerCase();
  if (f.query && !text.includes(f.query.toLowerCase())) return false;
  for (const s of f.is) {
    if (s === "open" && target.state !== "open" && target.state !== "OPEN") return false;
    if (s === "closed" && target.state !== "closed" && target.state !== "CLOSED") return false;
    if (s === "answered" && !target.isAnswered) return false;
    if (s === "unanswered" && target.isAnswered) return false;
  }
  if (f.labels.length > 0) {
    const has = (target.labels ?? []).map((l) => l.toLowerCase());
    for (const l of f.labels) if (!has.includes(l.toLowerCase())) return false;
  }
  if (f.author && target.author && target.author.toLowerCase() !== f.author.toLowerCase())
    return false;
  if (f.repo && target.repo && !target.repo.toLowerCase().includes(f.repo.toLowerCase()))
    return false;
  return true;
}

/** 预置搜索词（官方搜索框 placeholder/快捷入口） */
export const SEARCH_PRESETS = {
  open: "is:open",
  closed: "is:closed",
  answered: "is:answered",
  unanswered: "is:unanswered",
} as const;

// ===== 全站搜索（SearchPage）：qualifier 快捷增删 =====
// 搜索框下方 chips（语言/高级过滤）点击 = 追加/移除 qualifier 到 q。
// API 原生支持全部 qualifier，此处仅做 UI 识别（不参与解析执行）。

/** 已知 qualifier key（全站搜索 repos/users/issues，GitHub 官方文档集合） */
export const QUALIFIER_KEYS = new Set([
  // 通用
  "is",
  "in",
  "type",
  "sort",
  "order",
  // 仓库
  "language",
  "stars",
  "forks",
  "size",
  "created",
  "pushed",
  "user",
  "org",
  "owner",
  "repo",
  "topic",
  "license",
  "archived",
  "fork",
  "mirror",
  "good-first-issues",
  "help-wanted-issues",
  "visibility",
  // issue/PR
  "author",
  "assignee",
  "mentions",
  "reviewed-by",
  "commenter",
  "involved",
  "label",
  "milestone",
  "project",
  "comments",
  "interactions",
  "updated",
  "merged",
  "closed",
  "draft",
  "review",
  "status",
  "head",
  "base",
  "team",
  "close-reason",
  // 用户
  "followers",
  "repos",
  "location",
  "fullname",
  "sponsorable",
]);

export interface QualifierToken {
  key: string;
  op: string;
  value: string;
}

/** 提取值首部的比较符 */
function extractOp(rawValue: string): string {
  const m = rawValue.match(/^([<>]=?)/);
  return m ? m[1] : "";
}

/** 解析 q 中的全部 qualifier token（引号值整体取值） */
export function parseQueryQualifiers(q: string): QualifierToken[] {
  const tokens: QualifierToken[] = [];
  const re = /(\w+):("[^"]*"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const key = m[1].toLowerCase();
    if (!QUALIFIER_KEYS.has(key)) continue;
    const rawVal = m[2];
    const stripped = rawVal.replace(/^"|"$/g, "");
    tokens.push({ key, op: extractOp(stripped), value: stripped.replace(/^([<>]=?)/, "") });
  }
  return tokens;
}

/** 取指定 key 的完整值（含比较符），无则 null */
export function getQualifier(q: string, key: string): string | null {
  const t = parseQueryQualifiers(q).find((x) => x.key === key);
  return t ? t.op + t.value : null;
}

/** 判断是否含指定 key（可指定完整值）的 qualifier */
export function hasQualifier(q: string, key: string, value?: string): boolean {
  return parseQueryQualifiers(q).some(
    (t) => t.key === key && (value === undefined || t.op + t.value === value),
  );
}

/** 追加或替换指定 key 的 qualifier（同 key 已存在则原位替换；引号值整体匹配） */
export function addQualifier(q: string, key: string, value: string): string {
  const full = `${key}:${value}`;
  const re = new RegExp(`(^|\\s)${key}:("[^"]*"|\\S*)`);
  if (re.test(q)) {
    return q.replace(re, `$1${full}`);
  }
  return q.trim() ? `${q.trim()} ${full}` : full;
}

/** 删除指定 key 的所有 qualifier */
export function removeQualifier(q: string, key: string): string {
  const re = new RegExp(`(^|\\s)${key}:("[^"]*"|\\S*)`, "g");
  return q.replace(re, " ").replace(/\s+/g, " ").trim();
}

/** toggle：有（指定值）则移除，无则追加（追加前先移除同 key 其他值） */
export function toggleQualifier(q: string, key: string, value: string): string {
  if (hasQualifier(q, key, value)) return removeQualifier(q, key);
  return addQualifier(removeQualifier(q, key), key, value);
}
