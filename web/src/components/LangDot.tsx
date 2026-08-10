/**
 * 语言色点（业务公共组件 统一 4 处色值不一致的语言点；
 * 改用 linguist 官方全量色表）
 *
 * GitHub 官方语言色（linguist 色表，lib/lang-colors.ts 全量取色）；未知语言回退中性灰。
 * 用法：<LangDot lang={repo.language} />
 */
import { cn } from "@/lib/utils";
import { langColorOrFallback } from "@/lib/lang-colors";

export function LangDot({ lang, className }: { lang?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        !lang && "bg-muted-foreground/50",
        className,
      )}
      style={lang ? { backgroundColor: langColorOrFallback(lang) } : undefined}
      aria-label={lang ?? undefined}
      role="img"
    />
  );
}
