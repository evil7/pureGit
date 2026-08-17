/**
 * Insights Contributors 页（官方 github.com/:owner/:repo/graphs/contributors）
 *
 * 官方结构：贡献者列表（头像 + login + 提交数）+ 每个贡献者的周活动热度条。
 * 图表简版：周活动 CSS 迷你条形图。数据通道：REST-only（GraphQL 无 stats 端点）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { fetchContributorsStats, apiErrorMessage } from "@/lib/restapi";
import type { ContributorStats } from "@/lib/restapi";
import InsightsShell from "./InsightsShell";

export default function ContributorsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [contributors, setContributors] = useState<ContributorStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContributors(null);
    setError(null);
    fetchContributorsStats(owner, repo, token)
      .then((d) => !cancelled && setContributors(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("insights.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  return (
    <InsightsShell title={t("insights.contributors.title")} desc={t("insights.contributors.desc")}>
      {error ? (
        <InlineError message={error} />
      ) : contributors === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : contributors.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t("insights.contributors.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {contributors.map((c) => {
            const login = c.author.login;
            const weekMax = Math.max(1, ...c.weeks.map((w) => w.c));
            return (
              <li key={login} className="flex items-center gap-3 px-4 py-3">
                <span className="size-8 shrink-0">
                  {c.author.avatar_url ? (
                    <img src={c.author.avatar_url} alt={login} className="size-8 rounded-full" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/${login}`} className="truncate text-sm font-medium hover:underline">
                      {login}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.total} {t("insights.contributors.commits")}
                    </span>
                  </div>
                  <div className="mt-1.5 flex h-4 items-end gap-px">
                    {c.weeks.slice(-52).map((w) => (
                      <div
                        key={w.w}
                        className="flex-1 rounded-t-sm bg-chart-1/70"
                        style={{ height: `${Math.max((w.c / weekMax) * 100, 2)}%` }}
                        title={`${new Date(w.w * 1000).toISOString().slice(0, 10)}: ${w.c}`}
                      />
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </InsightsShell>
  );
}
