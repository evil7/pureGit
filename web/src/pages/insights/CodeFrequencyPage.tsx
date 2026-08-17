/**
 * Insights Code frequency 页（官方 github.com/:owner/:repo/graphs/code-frequency）
 *
 * 官方结构：每周 additions（绿）/ deletions（红）柱状图。
 * 图表简版：CSS 双色条形图（正负叠加）。数据通道：REST-only（GraphQL 无 stats 端点）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { fetchCodeFrequencyStats, apiErrorMessage } from "@/lib/restapi";
import type { CodeFrequencyPoint } from "@/lib/restapi";
import InsightsShell from "./InsightsShell";

export default function CodeFrequencyPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [points, setPoints] = useState<CodeFrequencyPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setError(null);
    fetchCodeFrequencyStats(owner, repo, token)
      .then((d) => !cancelled && setPoints(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("insights.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const max = Math.max(1, ...(points ?? []).map((p) => Math.max(p[1], p[2])));

  return (
    <InsightsShell
      title={t("insights.codeFrequency.title")}
      desc={t("insights.codeFrequency.desc")}
    >
      {error ? (
        <InlineError message={error} />
      ) : points === null ? (
        <Skeleton className="h-64 w-full" />
      ) : points.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t("insights.codeFrequency.empty")}
        </p>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-chart-2" />
              {t("insights.codeFrequency.additions")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-chart-3" />
              {t("insights.codeFrequency.deletions")}
            </span>
          </div>
          <div className="flex h-64 items-end gap-px overflow-x-auto">
            {points.map(([week, add, del]) => (
              <div key={week} className="flex min-w-3 flex-1 flex-col justify-end gap-px">
                <div
                  className="w-full rounded-t-sm bg-chart-2"
                  style={{ height: `${Math.max((add / max) * 100, add > 0 ? 1 : 0)}%` }}
                  title={`${new Date(week * 1000).toISOString().slice(0, 10)} +${add}`}
                />
                <div
                  className="w-full rounded-b-sm bg-chart-3"
                  style={{ height: `${Math.max((del / max) * 100, del > 0 ? 1 : 0)}%` }}
                  title={`${new Date(week * 1000).toISOString().slice(0, 10)} -${del}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </InsightsShell>
  );
}
