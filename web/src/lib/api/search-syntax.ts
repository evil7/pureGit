/**
 * GitHub 搜索语法系统（v2 重构：统一正反向解析引擎）
 *
 * 背景（用户决策）：GitHub 的入口端点本质是同一个 search（REST /search/* / GraphQL search），
 * 简单搜索（单一搜索框正向解析）与多功能搜索（高级表单反向构建）只是同一语法的两种呈现；
 * issue/PRs/Discussions 列表页基于同一套 qualifier 语法，仅隐含限定（repo:/is:issue/is:pr）不同。
 * 本模块实现「语法正反向解析」，供全站搜索页与各列表页统一复用。
 *
 * 三套 API：
 *   1. tokenizeSearch(raw)          → ParsedSearch（token 列表 + 自由文本）——正向解析核心
 *   2. serializeSearch(parsed, opts) → 查询串——反向构建核心（高级表单/筛选下拉用）
 *   3. matchSearch(raw, target)      → 前端过滤匹配（已加载数据场景）
 * 兼容投影：parseSearchSyntax(raw) → SearchFilters、buildSearchQuery(raw, opts) → 查询串
 * （页面状态/URL query 历史调用方复用）。
 *
 * 语法覆盖（官方 issue/PR/discussion search qualifier 全集）：
 *   状态：is:open/closed/merged/unmerged/archived/locked/unlocked/public/private/queued/pr/issue
 *         state:open/closed  reason:completed/"not planned"
 *   协作：author/assignee/mentions/commenter/involves/reviewed-by/review-requested/team
 *   标签/里程碑/项目：label/milestone/project
 *   PR：review/draft/head/base/status/linked
 *   缺失元数据：no:label/no:milestone/no:assignee/no:project
 *   时间/数值：created/updated/closed/merged/comments/reactions/interactions
 *   范围：repo/org/user/language/in
 *   否定：-qualifier（排除语义）
 * 不属于本系统：Actions 运行过滤（workflow/event/status/branch 为 REST 参数，非 search 语法）、
 * Notifications（官方无搜索框）。
 */

/** qualifier 值类型（决定 UI 控件与解析语义） */
export type QualifierKind = "text" | "user" | "date" | "number" | "boolean" | "enum";

/** qualifier 定义（语法字典条目） */
export interface QualifierDef {
  kind: QualifierKind;
  /** 是否支持 -qualifier 否定（no:xxx 缺失元数据不支持否定，官方规定） */
  negatable: boolean;
  /** enum 类型的合法值 */
  values?: readonly string[];
}

/** 完整 qualifier 字典（官方 issue/PR/discussion search 全集） */
export const QUALIFIER_DEFS: Record<string, QualifierDef> = {
  // 状态 / 类型
  is: {
    kind: "enum",
    negatable: false,
    values: [
      "open",
      "closed",
      "merged",
      "unmerged",
      "archived",
      "locked",
      "unlocked",
      "public",
      "private",
      "queued",
      "pr",
      "issue",
      "discussion",
      "gist",
      "answered",
      "unanswered",
    ],
  },
  type: {
    kind: "enum",
    negatable: false,
    values: ["issue", "pr", "discussion", "gist", "code", "repository", "user"],
  },
  state: { kind: "enum", negatable: false, values: ["open", "closed"] },
  reason: { kind: "enum", negatable: false, values: ["completed", "not planned", "reopened"] },
  // 协作（user 类型，me → @me 归一）
  author: { kind: "user", negatable: true },
  assignee: { kind: "user", negatable: true },
  mentions: { kind: "user", negatable: true },
  commenter: { kind: "user", negatable: true },
  involves: { kind: "user", negatable: true },
  "reviewed-by": { kind: "user", negatable: true },
  "review-requested": { kind: "user", negatable: true },
  "user-review-requested": { kind: "user", negatable: true },
  team: { kind: "text", negatable: true },
  "team-review-requested": { kind: "text", negatable: true },
  // 标签 / 里程碑 / 项目
  label: { kind: "text", negatable: true },
  milestone: { kind: "text", negatable: true },
  project: { kind: "text", negatable: true },
  // PR 特有
  review: {
    kind: "enum",
    negatable: true,
    values: ["none", "required", "approved", "changes_requested"],
  },
  draft: { kind: "boolean", negatable: true },
  head: { kind: "text", negatable: true },
  base: { kind: "text", negatable: true },
  status: { kind: "enum", negatable: true, values: ["pending", "success", "failure"] },
  linked: { kind: "enum", negatable: true, values: ["pr", "issue"] },
  // 缺失元数据（no:xxx；官方规定不支持 - 否定组合）
  no: { kind: "enum", negatable: false, values: ["label", "milestone", "assignee", "project"] },
  // 时间 / 数值（range 语义，支持比较符）
  created: { kind: "date", negatable: false },
  updated: { kind: "date", negatable: false },
  closed: { kind: "date", negatable: false },
  merged: { kind: "date", negatable: false },
  comments: { kind: "number", negatable: false },
  reactions: { kind: "number", negatable: false },
  interactions: { kind: "number", negatable: false },
  // 范围
  repo: { kind: "text", negatable: false },
  org: { kind: "text", negatable: false },
  user: { kind: "text", negatable: false },
  language: { kind: "text", negatable: false },
  in: { kind: "enum", negatable: false, values: ["title", "body", "comments"] },
  // 排序
  sort: { kind: "enum", negatable: false, values: ["created", "updated", "comments", "reactions"] },
};

/** 单个搜索 token（key:value，含否定与比较符） */
export interface SearchToken {
  key: string;
  negated: boolean;
  op: string;
  value: string;
  /** 原始 token 文本（含 - 前缀与引号，用于原样重建） */
  raw: string;
}

/** 解析结果：自由文本 + token 列表 */
export interface ParsedSearch {
  freeText: string;
  tokens: SearchToken[];
}

/** 提取值首部的比较符（> >= < <=） */
function extractOp(rawValue: string): string {
  const m = rawValue.match(/^([<>]=?)/);
  return m ? m[1] : "";
}

/**
 * 正向解析：查询串 → ParsedSearch（token 列表 + 自由文本）。
 * 支持：key:value、key:"带空格值"、-key:value（否定）、key:>n（比较符）。
 */
export function tokenizeSearch(raw: string): ParsedSearch {
  const tokens: SearchToken[] = [];
  const free: string[] = [];
  const re = /(^|\s)(-?)([A-Za-z][\w-]*):("[^"]*"|\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    free.push(raw.slice(last, m.index));
    last = re.lastIndex;
    const dash = m[2];
    const key = m[3].toLowerCase();
    const rawVal = m[4];
    const stripped = rawVal.replace(/^"|"$/g, "");
    tokens.push({
      key,
      negated: dash === "-",
      op: extractOp(stripped),
      value: stripped.replace(/^([<>]=?)/, ""),
      raw: `${dash}${key}:${rawVal}`,
    });
  }
  free.push(raw.slice(last));
  return { freeText: free.join(" ").replace(/\s+/g, " ").trim(), tokens };
}

/** 单个 token → 查询串（含否定/比较符/引号包裹） */
function tokenToString(t: SearchToken): string {
  const quote = /\s/.test(t.value) ? `"${t.value}"` : t.value;
  return `${t.negated ? "-" : ""}${t.key}:${t.op}${quote}`;
}

/**
 * 反向构建：ParsedSearch → 查询串（自由文本在前，token 随后，稳定保序）。
 * @param opts.inject 注入隐含限定（repo:/is:issue/is:open 等）到结果尾部。
 */
export function serializeSearch(parsed: ParsedSearch, opts?: { inject?: string[] }): string {
  const parts: string[] = [];
  if (parsed.freeText) parts.push(parsed.freeText);
  for (const t of parsed.tokens) parts.push(tokenToString(t));
  for (const i of opts?.inject ?? []) if (i) parts.push(i);
  return parts.join(" ");
}

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
  /** 时间/数值限定（created:/updated:/closed:/merged:/comments:/reactions:/interactions:）原样保留给 API */
  ranges: string[];
  /** 自由文本（非限定词 token 合并） */
  query: string;
  /** 否定 qualifier（-label:bug / -author:xxx）——排除语义 */
  negated?: { key: string; value: string }[];
  /** 缺失元数据（no:label / no:assignee / no:milestone / no:project） */
  missing?: string[];
}

/** 解析 GitHub 搜索查询串 → SearchFilters（未知限定词并入 query 原文；支持 - 否定与 no:） */
export function parseSearchSyntax(raw: string): SearchFilters {
  const f: SearchFilters = { is: [], labels: [], in: [], ranges: [], query: "" };
  const free: string[] = [];
  const negated: { key: string; value: string }[] = [];
  const missing: string[] = [];
  const re = /(^|\s)(-?)(\w+):("[^"]*"|\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const [, , dash, key, rawVal] = m;
    const val = rawVal.replace(/^"|"$/g, "");
    free.push(raw.slice(last, m.index));
    last = re.lastIndex;
    const k = key.toLowerCase();
    const isNegated = dash === "-";
    switch (k) {
      case "is":
        f.is.push(val);
        break;
      case "label":
        if (isNegated) negated.push({ key: k, value: val });
        else f.labels.push(val);
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
      case "no":
        missing.push(val);
        break;
      case "created":
      case "updated":
      case "closed":
      case "merged":
      case "comments":
      case "reactions":
      case "interactions":
        f.ranges.push(`${k}:${rawVal}`);
        break;
      default:
        free.push(`${dash}${key}:${rawVal}`);
    }
  }
  free.push(raw.slice(last));
  f.query = free.join(" ").replace(/\s+/g, " ").trim();
  if (negated.length) f.negated = negated;
  if (missing.length) f.missing = missing;
  return f;
}

/** 类型词（is:pr 等，与 type: 等价） */
const TYPE_WORDS = ["pr", "issue", "discussion", "gist"];

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
  // 类型限定（is:pr/is:issue 与 type: 等价，不重复加）：is 中的类型词直接原样输出，
  // 避免「已含类型词但被状态词过滤 + type 因等价不加」导致类型限定丢失
  const hasTypeInIs = f.is.some((v) => TYPE_WORDS.includes(v));
  if (opts.type && !hasTypeInIs) parts.push(`type:${opts.type}`);
  for (const v of f.is) if (TYPE_WORDS.includes(v)) parts.push(`is:${v}`);
  // is: 状态词
  const stateWords = f.is.filter((v) => !TYPE_WORDS.includes(v));
  if (stateWords.length === 0 && opts.defaultState) {
    parts.push(`is:${opts.defaultState}`);
  } else {
    for (const s of stateWords) parts.push(`is:${s}`);
  }
  // label / author / assignee / mentions / milestone / repo / org
  for (const l of f.labels) parts.push(`label:${l.includes(" ") ? `"${l}"` : l}`);
  for (const n of f.negated ?? [])
    parts.push(`-${n.key}:${n.value.includes(" ") ? `"${n.value}"` : n.value}`);
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
  // 缺失元数据（no:label 等）
  for (const m of f.missing ?? []) parts.push(`no:${m}`);
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
  // 否定 qualifier：-label:bug → 排除含该标签；-author:alice → 排除该作者
  for (const n of f.negated ?? []) {
    if (n.key === "label") {
      const has = (target.labels ?? []).map((l) => l.toLowerCase());
      if (has.includes(n.value.toLowerCase())) return false;
    } else if (n.key === "author") {
      if (target.author && target.author.toLowerCase() === n.value.toLowerCase()) return false;
    }
  }
  // 缺失元数据：no:label → 无标签
  for (const m of f.missing ?? []) {
    if (m === "label" && (target.labels?.length ?? 0) > 0) return false;
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

/** 已知 qualifier key（= 语法字典 + 全站搜索扩展 key；UI 层识别，不执行解析） */
export const QUALIFIER_KEYS = new Set<string>([
  ...Object.keys(QUALIFIER_DEFS),
  // 全站搜索扩展（仓库/用户）
  "order",
  "stars",
  "forks",
  "size",
  "pushed",
  "owner",
  "topic",
  "license",
  "archived",
  "fork",
  "mirror",
  "good-first-issues",
  "help-wanted-issues",
  "visibility",
  "close-reason",
  "followers",
  "repos",
  "location",
  "fullname",
  "sponsorable",
]);

export interface QualifierToken {
  key: string;
  negated: boolean;
  op: string;
  value: string;
}

/** 解析 q 中的全部 qualifier token（引号值整体取值；支持 - 否定前缀） */
export function parseQueryQualifiers(q: string): QualifierToken[] {
  const tokens: QualifierToken[] = [];
  const re = /(^|\s)(-?)(\w+):("[^"]*"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const key = m[3].toLowerCase();
    if (!QUALIFIER_KEYS.has(key)) continue;
    const rawVal = m[4];
    const stripped = rawVal.replace(/^"|"$/g, "");
    tokens.push({
      key,
      negated: m[2] === "-",
      op: extractOp(stripped),
      value: stripped.replace(/^([<>]=?)/, ""),
    });
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
