/**
 * 仓库 GitHub Apps 设置页（官方 github.com/:owner/:repo/settings/installations）
 *
 * 无公开 API → 预留外链官方（红线「官方兜底」）：
 * 列出「已安装到该仓库的 GitHub Apps」需 GitHub App 的 user access token
 * （GET /user/installations 属 GitHub App 专属端点），PureGit 为 OAuth App，
 * 其 token 访问返回 403；GraphQL Repository/User 亦无 installations 字段。
 * 故仅提供标题说明 + 外链引导至官方管理页，不捏造列表。
 */
import { useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n";

export default function RepoGitHubAppsSettings() {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("repoApps.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("repoApps.desc")}</p>
      </div>

      <a
        href={`https://github.com/${owner}/${repo}/settings/installations`}
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
