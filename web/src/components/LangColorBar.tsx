/**
 * 语言配色进度条 + 图例（业务私有组件，用户提出「单独解决 languages 配色」）
 *
 * 官方（github.com 仓库页 Languages 分区）：进度条各段 = 语言官方色 + 图例（色点 + 名 + %），
 * <1% 小语言合并为 Other 灰色段补足 100%。
 *
 * 配色方案（用户 3 点落地）：
 *   1. **单独解决**：语言段色一律**内联 style**（langColorOrFallback）——不新增/修改任何
 *      Tailwind chart 类 / shadcn CSS，与全局主题完全解耦；
 *   2. **官方配色**：`lang-colors.ts` 基于 linguist-languages 官方全量色表精确取色，
 *      官方返回多少个语言就有多少种官方色；未知语言回退中性灰；
 *   3. **私有组件**：Languages 分区唯一入口，RepoAbout 引用；色表逻辑集中在 lib/lang-colors.ts。
 *
 * 用法：<LangColorBar languages={repo.languages} />
 */
import { langColorOrFallback } from "@/lib/lang-colors";
import { Tip } from "@/components/Tip";

export function LangColorBar({
  languages,
}: {
  /** 仓库语言字节数映射（REST /repos/{o}/{r}/languages 或 GraphQL languages 映射） */
  languages: Record<string, number>;
}) {
  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  // 官方规则：>=1% 显示语言色段；<1% 合并 Other（进度条/图例补足 100%）
  const visibleLangs = Object.entries(languages)
    .filter(([, bytes]) => totalBytes > 0 && bytes / totalBytes >= 0.01)
    .sort((a, b) => b[1] - a[1]);
  const visibleBytes = visibleLangs.reduce((a, [, b]) => a + b, 0);
  const otherBytes = totalBytes - visibleBytes;

  if (visibleLangs.length === 0) return null;

  // Other 段色（中性灰；官方合并语义）
  const otherColor = langColorOrFallback(null);

  return (
    <>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full">
        {visibleLangs.map(([lang, bytes]) => (
          <Tip key={lang} label={`${lang} ${((bytes / totalBytes) * 100).toFixed(1)}%`}>
            <div
              style={{
                width: `${(bytes / totalBytes) * 100}%`,
                backgroundColor: langColorOrFallback(lang),
              }}
            />
          </Tip>
        ))}
        {otherBytes > 0 && (
          <Tip label={`Other ${((otherBytes / totalBytes) * 100).toFixed(1)}%`}>
            <div
              style={{ width: `${(otherBytes / totalBytes) * 100}%`, backgroundColor: otherColor }}
            />
          </Tip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {visibleLangs.map(([lang, bytes]) => (
          <span key={lang} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: langColorOrFallback(lang) }}
            />
            {lang}
            <span className="text-muted-foreground/70">
              {((bytes / totalBytes) * 100).toFixed(1)}%
            </span>
          </span>
        ))}
        {otherBytes > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: otherColor }} />
            Other
            <span className="text-muted-foreground/70">
              {((otherBytes / totalBytes) * 100).toFixed(1)}%
            </span>
          </span>
        )}
      </div>
    </>
  );
}
