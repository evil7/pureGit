/**
 * Wiki 数据层（扩展）
 *
 * 数据源：Worker /$wiki 代理（raw.githubusercontent.com/wiki——无官方 API，
 * 前端直连 raw 被墙，走服务端代理）。页面内容 = {page}.md 文本；
 * 页面列表 = _Sidebar.md（markdown 链接列表）解析。
 */
import { WORKER_BASE } from "../auth/worker-base";

export interface WikiPage {
  name: string;
  title: string;
}

/** 获取 wiki 页内容（md 文本）；404 → null；其他错误抛 */
export async function fetchWikiPage(
  owner: string,
  repo: string,
  page: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch(
    `${WORKER_BASE}/$wiki/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${page
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`,
    // 显式携带会话 cookie（worker /$wiki 鉴权依赖 httpOnly cookie；与 /$raw 一致）
    { signal, credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`wiki 加载失败（${res.status}）`);
  return res.text();
}

/**
 * 解析 _Sidebar.md 为页面列表。
 * GitHub wiki sidebar 混用两种链接语法（guava 等仓库实测）：
 *   ① wiki 双括号 `[[标题|页面名]]` / `[[页面名]]`（MediaWiki/GitHub 专用）
 *   ② 标准 markdown `[标题](页面名)`
 * 规则：
 *   - 外链（http(s)://、//、/ 开头绝对路径）跳过
 *   - **锚点子链接跳过**（`页面名#锚点` 不是独立页面——`[Size Caps](CachesExplained#Size-based-Eviction.md)`
 *     若解析成独立条目会与 `[[Caches|CachesExplained]]` 生成重复 name，触发 React 重复 key（实测修复）
 *   - name 去重（同名只保留首个，标题优先取显式标题）
 */
export function parseWikiSidebar(md: string): WikiPage[] {
  const pages: WikiPage[] = [];
  const seen = new Set<string>();
  const add = (name: string, title: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    pages.push({ name, title: title || name });
  };

  // ① wiki 双括号：[[页面名]] 或 [[标题|页面名]]（组1=标题，组2=页面名）
  const wikiRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  for (const m of md.matchAll(wikiRe)) {
    const title = (m[1] || "").trim();
    const target = (m[2] ?? m[1]).trim(); // 无 | 时页面名 = 组1
    if (/^(https?:)?\/\//.test(target) || target.startsWith("/")) continue;
    if (target.includes("#")) continue; // 锚点子链接（页面名#锚点）→ 非独立页面
    const name = target.replace(/\.md$/, "").trim();
    if (!name) continue;
    add(name, title);
  }

  // ② 标准 markdown：[标题](页面名)
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const m of md.matchAll(linkRe)) {
    const title = m[1].trim();
    const target = m[2].trim();
    if (/^(https?:)?\/\//.test(target) || target.startsWith("/")) continue;
    if (target.includes("#")) continue; // 锚点子链接 → 非独立页面
    const name = target.replace(/\.md$/, "").trim();
    if (!name) continue;
    add(name, title);
  }
  return pages;
}
