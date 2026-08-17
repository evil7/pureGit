/**
 * 组织设置 —— 仓库（用户要求组织设置侧栏加「仓库」项）
 *
 * 显示该组织全部仓库（listForOrg 全量），行：名称 + 状态徽章 + 描述 + 大小 + 设置入口。
 * 设置入口跳 /organizations/:org/.../settings（实际为 /:owner/:repo/settings 仓库设置）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Settings } from "lucide-react";
import { RepoVisibilityBadge } from "@/components/RepoVisibilityBadge";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { fetchOrgReposSmart, type Repository } from "@/lib/api";

/** KB → 人类可读大小（与 RepositoriesSettings 同规则） */
function formatSize(kb?: number): string | null {
  if (kb === undefined || kb === null) return null;
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

export default function OrgReposSettings() {
  const { org = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !org) return;
    let cancelled = false;
    setRepos(null);
    setError(null);
    fetchOrgReposSmart(org, token)
      .then((list) => !cancelled && setRepos(list))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [org, token]);

  return (
    <div className="flex flex-col gap-3">
      {error && <InlineError message={t("common.loadFailed").replace("{error}", error)} />}
      <div>
        <h2 className="text-lg font-semibold">{t("orgRepos.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {repos !== null
            ? t("reposSettings.repoCount").replace("{count}", String(repos.length))
            : ""}
        </p>
      </div>

      {repos === null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : repos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("orgRepos.empty")}</p>
      ) : (
        <div className="flex flex-col divide-y rounded-lg border">
          {repos.map((r) => (
            <div key={r.full_name} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                <Link to={`/${r.full_name}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <RepoVisibilityBadge repo={r} />
                {r.description && (
                  <p className="truncate text-sm text-muted-foreground">{r.description}</p>
                )}
                {formatSize(r.size) && (
                  <p className="text-xs text-muted-foreground">{formatSize(r.size)}</p>
                )}
              </div>
              <Button variant="ghost" className="gap-1" asChild>
                <Link to={`/${r.full_name}/settings`}>
                  <Settings className="size-3.5" />
                  {t("common.settings")}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
