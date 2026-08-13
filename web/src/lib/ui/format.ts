/** 项目自定义格式化工具（shadcn 生成的 utils.ts 只保留 cn，自定义函数集中于此） */

/** 官方 GitHub 简写数字：1234 → "1.2k"、123456 → "123k"、1234567 → "1.2M"；<1000 原样 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return String(n);
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
  // Intl 输出大写字面（1.2K/123K）→ GitHub 官方用小写 k
  return formatted.replace("K", "k");
}
