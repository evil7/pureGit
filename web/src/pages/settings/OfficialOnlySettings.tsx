/**
 * 仓库设置「预留外链」通用页（无公开 API 项统一兜底，红线「官方兜底」）
 *
 * 官方 settings 侧导航中无公开 API 的子项（Copilot / Planning / Codespaces 等）
 * 统一复用本组件：标题说明 + 外链引导至官方管理页，不捏造数据。
 */
import { useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useI18n, type I18nKey } from "@/i18n";

export function OfficialOnlySettings({
  titleKey,
  descKey,
  path,
}: {
  titleKey: I18nKey;
  descKey: I18nKey;
  path: string;
}) {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t(titleKey)}</h2>
        <p className="text-sm text-muted-foreground">{t(descKey)}</p>
      </div>

      <a
        href={`https://github.com/${owner}/${repo}/settings/${path}`}
        target="_blank"
        rel="noreferrer"
        title={t("actions.mgmt.officialOnlyTitle")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-3.5 shrink-0" />
        {t("repoApps.manage")}
        <span className="text-[10px] text-muted-foreground/70">
          {t("actions.mgmt.officialOnly")}
        </span>
      </a>
    </div>
  );
}
