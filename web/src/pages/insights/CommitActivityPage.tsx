/**
 * Insights Commits 页（官方 github.com/:owner/:repo/graphs/commit-activity）
 *
 * 官方结构：过去一年每周提交活动柱状图。
 * 图表简版：52 周 CSS 柱状图。数据通道：REST-only（GraphQL 无 stats 端点）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { fetchCommitActivityStats, apiErrorMessage } from "@/lib/restapi";
import type { CommitActivityWeek } from "@/lib/restapi";
import InsightsShell from "./InsightsShell";

export default function CommitActivityPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [weeks, setWeeks] = useState<CommitActivityWeek[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWeeks(null);
    setError(null);
    fetchCommitActivityStats(owner, repo, token)
      .then((d) => !cancelled && setWeeks(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("insights.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const max = Math.max(1, ...(weeks ?? []).map((w) => w.total));

  return (
    <InsightsShell title={t("insights.commits.title")} desc={t("insights.commits.desc")}>
      {error ? (
        <InlineError message={error} />
      ) : weeks === null ? (
        <Skeleton className="h-64 w-full" />
      ) : weeks.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t("insights.commits.empty")}
        </p>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex h-64 items-end gap-px overflow-x-auto">
            {weeks.map((w) => (
              <div
                key={w.week}
                className="min-w-3 flex-1 rounded-t-sm bg-chart-1/70"
                style={{ height: `${Math.max((w.total / max) * 100, w.total > 0 ? 1 : 0)}%` }}
                title={`${new Date(w.week * 1000).toISOString().slice(0, 10)}: ${w.total} commits`}
              />
            ))}
          </div>
        </div>
      )}
    </InsightsShell>
  );
}
