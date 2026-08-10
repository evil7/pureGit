/**
 * Markdown 标题索引（官方 blob 页 Outline 面板同款）
 *
 * GitHub 官方对 markdown 文件显示 **Outline 面板**（操作栏 list-unordered 图标 →
 * 右侧目录：Outline 标题 + Filter headings + 层级缩进列表，点击滚动到对应标题）。
 * 本模块提供：
 * - `extractOutline`：解析 markdown 文本的标题（# ~ ######，排除围栏代码块内），
 *   生成 `{level, text, id}` 列表（id 用 GitHub slugger 规则）
 * - `slugHeading` / `createSlugger`：GitHub 同款 slug（github-slugger v2）：
 *   `React + TypeScript + Vite` → `react--typescript--vite`（小写、`+` 等非
 *   `\p{L}\p{N}\-_ ` 字符移除、空格逐个转 `-`；中文等 unicode 字母保留）
 */

export interface OutlineItem {
  /** 标题级别 1~6 */
  level: number;
  /** 纯文本（去除行内标记） */
  text: string;
  /** 锚点 id（GitHub slug 规则；重复标题自动加 -1/-2） */
  id: string;
}

/** GitHub slugger 移除规则：保留 unicode 字母/数字/连字符/下划线/空格，其余全删 */
const SLUG_RE = /[^\p{L}\p{N}\-_ ]/gu;

/** 单次 slug（不带重复计数；与 GitHub slug() 一致） */
export function slugHeading(text: string): string {
  return text.toLowerCase().trim().replace(SLUG_RE, "").replace(/ /g, "-");
}

/** 带重复计数的 slugger（github-slugger slug() 实例行为：第二次出现加 -1，第三次 -2） */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugHeading(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/**
 * 提取 markdown 全部标题（按文档顺序；排除围栏代码块内的 #）。
 * 文本清理：去掉行内标记（`*` `_` `` ` `` `~`）再 slug——与渲染后文本一致。
 */
export function extractOutline(md: string): OutlineItem[] {
  const lines = md.split("\n");
  const items: OutlineItem[] = [];
  const slug = createSlugger();
  let inFence = false;
  for (const raw of lines) {
    // 围栏代码块（``` 或 ~~~）切换；```lang 开头不匹配标题
    const fence = raw.match(/^\s*(```|~~~)/);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // ATX 标题：0~3 空格 + 1~6 个 # + 至少一个空格 + 文本（尾随 # 闭合符可忽略）
    const m = raw.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if (!m) continue;
    const level = m[1].length;
    // 去行内标记后 trim（`# **特性**` → `特性`；尾随闭合 `## 标题 ##` → 去尾 #）
    const text = m[2]
      .replace(/[`*_~]/g, "")
      .replace(/\s+#+\s*$/, "")
      .trim();
    if (!text) continue;
    items.push({ level, text, id: slug(text) });
  }
  return items;
}
