/**
 * 归档仓库横幅（用户要求：archived 仓库主页面最上方黄色横幅）
 *
 * 官方（github.com archived 仓库首页顶部）：黄色横幅
 * 「This repository has been archived by the owner on Apr 30, 2023. It is now read-only.」
 * 本项目文案（用户指定中文）：「此仓库已于xxxx年xx月xx日归档，现阶段仅供查阅。」
 *
 * 样式：amber 黄横幅（对齐 ScopeWarningBanner / AccountSettings 既有 amber 警告条体系），
 * 图标 + 日期（跟随 useDateFormat 偏好，absolute 格式去时间尾）。
 *
 * 用法：<ArchivedBanner archivedAt={repoData.archived_at} />；仅已归档渲染，否则 null。
 */
import { Archive } from "lucide-react";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";

export function ArchivedBanner({ archivedAt }: { archivedAt?: string | null }) {
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  if (!archivedAt) return null;

  // fmt 的 absolute 格式（`2026年8月9日 22:53` / `August 9, 2026 22:53`）去掉 ` HH:mm` 时间尾 → 仅日期
  const fmtDate = (iso: string): string => fmt(iso).replace(/\s\d{2}:\d{2}$/, "");

  return (
    <div className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-400/40 dark:bg-amber-950/40">
      <span className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
        <Archive className="mt-0.5 size-4 shrink-0" />
        <span>{t("repoArchived.banner").replace("{date}", fmtDate(archivedAt))}</span>
      </span>
    </div>
  );
}
