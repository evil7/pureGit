/**
 * GitHub 官方语言配色（用户提出「按官方给不同语言配色 + 单独解决不污染 shadcn」）
 *
 * 数据源：`linguist-languages`（GitHub Linguist 官方数据包，`languages.ts` 已用于语言检测）
 * ——每个语言条目自带 `color` 字段（官方 linguist 色表，全量 600+ 语言，随包版本维护更新）。
 * GitHub 官网仓库语言进度条/色点即按此表取色：语言名 → 固定官方色（非轮换 chart 色）。
 *
 * 用法：
 *   const color = getLangColor("TypeScript"); // "#3178c6"
 *   style={{ backgroundColor: color ?? FALLBACK_LANG_COLOR }}
 *
 * 设计约束（用户 3 点）：
 *   1. 单独解决：返回**十六进制色值**，调用方**内联 style** 上色——不新增/修改任何
 *      Tailwind chart 类或 shadcn 组件 CSS，与全局主题完全解耦；
 *   2. 官方数量/配色：官方 API 返回多少个语言就有多少种官方色（精确匹配 linguist 全表），
 *      未知语言回退统一中性灰（FALLBACK_LANG_COLOR）；
 *   3. 本项目私有模块：色表逻辑集中此处，LangDot / LangColorBar 统一取色，杜绝分散手写色表。
 */

import * as linguist from "linguist-languages";

/** 未知语言回退色（GitHub 官方中性灰，深浅模式均可读） */
export const FALLBACK_LANG_COLOR = "#8b949e";

interface LinguistLang {
  name?: string;
  color?: string;
}

/**
 * 小写语言名 → 官方色值索引（模块加载时构建一次；linguist ~600 项，避免每次查找全遍历）。
 * 仅收录带 color 的语言（部分语言无官方色，如纯文本/标记格式）。
 */
const COLOR_INDEX: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const lang of Object.values(linguist) as LinguistLang[]) {
    if (lang?.name && lang.color) idx[lang.name.toLowerCase()] = lang.color;
  }
  return idx;
})();

/**
 * 获取 GitHub 官方语言色（linguist 色表，大小写不敏感）。
 * 未知语言 / 空值返回 null（调用方回退 FALLBACK_LANG_COLOR）。
 */
export function getLangColor(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return COLOR_INDEX[lang.toLowerCase()] ?? null;
}

/** 便捷取色：未知语言自动回退中性灰（进度条段 / 图例色点直接内联用） */
export function langColorOrFallback(lang: string | null | undefined): string {
  return getLangColor(lang) ?? FALLBACK_LANG_COLOR;
}
