/**
 * 仓库可见性/状态徽章（增补）
 *
 * 统一仓库列表的状态标记（对齐官方 + 精简）：
 * - 私有仓库 → Private（私有）徽章
 * - 归档仓库 → Archived（归档）徽章（灰底）
 * - 公开且未归档 → 不渲染（默认即公开，减少噪音；对齐官方搜索页/组织主页列表）
 *
 * 用法：<RepoVisibilityBadge repo={repo} />（输入含 private/archived 的 Repository 对象）
 */
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n";

export function RepoVisibilityBadge({
  repo,
  className,
}: {
  repo: { private?: boolean; archived?: boolean };
  className?: string;
}) {
  const { t } = useI18n();
  if (!repo.private && !repo.archived) return null;
  return (
    <>
      {repo.archived && (
        <Badge variant="outline" className={`ml-2 text-xs ${className ?? ""}`}>
          {t("common.repoArchived")}
        </Badge>
      )}
      {repo.private && (
        <Badge variant="outline" className={`ml-2 text-xs ${className ?? ""}`}>
          {t("common.repoPrivate")}
        </Badge>
      )}
    </>
  );
}
