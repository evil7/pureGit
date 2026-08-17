/**
 * 归档仓库横幅（repo 查看页面 tabs 下方全宽黄色告警条）
 *
 * 官方（github.com archived 仓库首页顶部）：黄色横幅
 * 「This repository has been archived by the owner on Apr 30, 2023. It is now read-only.」
 * 本项目文案（用户指定中文）：「仓库已于xxxx年xx月xx日归档，仅供查看」。
 *
 * 样式：amber 黄横幅（对齐 ScopeWarningBanner / AccountSettings 既有 amber 警告条体系），
 * 单行全宽（border-b 分隔），内部 mx-auto max-w-7xl 对齐内容宽度；左图标 + 日期文案，
 * 最右端（ADMIN 权限）提供「取消归档」快捷按钮。
 *
 * 用法：<ArchivedBanner archivedAt={data.archived_at} canAdmin onUnarchive unarchiving />；
 * 仅已归档渲染，否则 null。
 */
import { Archive, ArchiveRestore } from "lucide-react";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Button } from "@/components/ui/button";

export function ArchivedBanner({
  archivedAt,
  canAdmin = false,
  unarchiving = false,
  onUnarchive,
}: {
  archivedAt?: string | null;
  /** 是否 ADMIN 权限（决定是否显示「取消归档」按钮） */
  canAdmin?: boolean;
  unarchiving?: boolean;
  onUnarchive?: () => void;
}) {
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  if (!archivedAt) return null;

  // fmt 的 absolute 格式（`2026年8月9日 22:53` / `August 9, 2026 22:53`）去掉 ` HH:mm` 时间尾 → 仅日期
  const fmtDate = (iso: string): string => fmt(iso).replace(/\s\d{2}:\d{2}$/, "");

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-sm">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-amber-700 dark:text-amber-300">
          <Archive className="size-4 shrink-0" />
          <span className="truncate">
            {t("repoArchived.banner").replace("{date}", fmtDate(archivedAt))}
          </span>
        </span>
        {canAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onUnarchive}
            disabled={unarchiving}
          >
            <ArchiveRestore className="size-3.5" />
            {unarchiving ? t("common.loading") : t("repoArchived.unarchive")}
          </Button>
        )}
      </div>
    </div>
  );
}
