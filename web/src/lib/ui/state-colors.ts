/**
 * 状态徽标自定义配色（GitHub Primer 官方状态色，独立于 shadcn chart 色板）
 *
 * 官方状态徽标色（primer 色板实测）：light 用沉稳深色（绿 #1a7f37 / 紫 #8250df / 红 #cf222e），
 * dark 用明亮色（绿 #3fb950 / 紫 #a371f7 / 红 #f85149）——避免 tailwind 600 级在浅色主题下过艳。
 * Issue closed 与 PR merged 同为紫（官方语义）。仅静态字符串，JIT 正常扫描；
 * 不修改 index.css 的 shadcn CSS 变量（--chart-* 等保留给图表组件使用）。
 */

/** 实心状态徽标（头部状态徽标）：彩底 + 白字（light/dark 双态） */
export const STATE_BADGE_SOLID: Record<string, string> = {
  open: "bg-[#1a7f37] text-white dark:bg-[#3fb950]",
  merged: "bg-[#8250df] text-white dark:bg-[#a371f7]",
  closed: "bg-[#cf222e] text-white dark:bg-[#f85149]",
  "issue-closed": "bg-[#8250df] text-white dark:bg-[#a371f7]",
};

/** 浅底状态徽标（审计者栏 / 时间线评审态）：透明底 + 彩字 */
export const REVIEW_STATE_BADGE_TINTED: Record<string, string> = {
  APPROVED: "bg-emerald-500/15 text-emerald-600",
  CHANGES_REQUESTED: "bg-red-500/15 text-red-600",
  COMMENTED: "bg-blue-500/15 text-blue-600",
  DISMISSED: "bg-muted text-muted-foreground",
  PENDING: "bg-muted text-muted-foreground",
};
