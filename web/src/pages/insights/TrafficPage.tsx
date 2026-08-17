/**
 * Insights Traffic 页（官方 github.com/:owner/:repo/graphs/traffic）
 *
 * 官方结构：Clones / Views 两卡（14 天统计 + 折线图）+ Popular content（paths）
 * + Top referring sites（referrers）。
 * 图表简版：总数卡 + 每日条形图（对齐现有 Top committers 的 CSS 条形图做法）。
 * 数据通道：REST-only（GraphQL 无 traffic 端点），需 push 权限。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Eye, Link2, TrendingUp, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import {
  fetchClonesStats,
  fetchViewsStats,
  fetchTopPaths,
  fetchTopReferrers,
  apiErrorMessage,
} from "@/lib/restapi";
import type { ClonesStats, ViewsStats, TopPath, TopReferrer } from "@/lib/restapi";
import InsightsShell from "./InsightsShell";

export default function TrafficPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [clones, setClones] = useState<ClonesStats | null>(null);
  const [views, setViews] = useState<ViewsStats | null>(null);
  const [paths, setPaths] = useState<TopPath[] | null>(null);
  const [referrers, setReferrers] = useState<TopReferrer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setError(null);
    Promise.all([
      fetchClonesStats(owner, repo, token).then((d) => !cancelled && setClones(d)),
      fetchViewsStats(owner, repo, token).then((d) => !cancelled && setViews(d)),
      fetchTopPaths(owner, repo, token).then((d) => !cancelled && setPaths(d)),
      fetchTopReferrers(owner, repo, token).then((d) => !cancelled && setReferrers(d)),
    ]).catch((e) => !cancelled && setError(apiErrorMessage(e, t("insights.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  return (
    <InsightsShell title={t("insights.traffic.title")} desc={t("insights.traffic.desc")}>
      {!token ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("repoSettings.loginFirst")}
        </p>
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="grid gap-3 sm:grid-cols-2">
            <TrafficCard
              icon={Download}
              label={t("insights.traffic.clones")}
              stats={clones}
              points={clones?.clones ?? []}
            />
            <TrafficCard
              icon={Eye}
              label={t("insights.traffic.views")}
              stats={views}
              points={views?.views ?? []}
            />
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <ListCard
              icon={Link2}
              title={t("insights.traffic.topPaths")}
              empty={t("insights.traffic.noData")}
              loading={paths === null}
              items={(paths ?? []).map((p) => ({
                key: p.path,
                primary: p.title || p.path,
                secondary: p.path,
                count: p.count,
                uniques: p.uniques,
              }))}
              uniquesLabel={t("insights.traffic.uniques")}
            />
            <ListCard
              icon={TrendingUp}
              title={t("insights.traffic.topReferrers")}
              empty={t("insights.traffic.noData")}
              loading={referrers === null}
              items={(referrers ?? []).map((r) => ({
                key: r.referrer,
                primary: r.referrer,
                count: r.count,
                uniques: r.uniques,
              }))}
              uniquesLabel={t("insights.traffic.uniques")}
            />
          </section>
        </div>
      )}
    </InsightsShell>
  );
}

/** 流量统计卡（总数 + 每日条形图） */
function TrafficCard({
  icon: Icon,
  label,
  stats,
  points,
}: {
  icon: LucideIcon;
  label: string;
  stats: { count: number; uniques: number } | null;
  points: { timestamp: string; count: number; uniques: number }[];
}) {
  const { t } = useI18n();
  const max = Math.max(1, ...points.map((p) => p.count));

  if (stats === null) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-3 h-8 w-16" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums">{stats.count.toLocaleString()}</span>
        <span className="text-sm text-muted-foreground">
          {t("insights.traffic.uniquesCount").replace("{n}", String(stats.uniques))}
        </span>
      </div>
      <div className="mt-3 flex h-24 items-end gap-px">
        {points.map((p) => (
          <div
            key={p.timestamp}
            className="flex-1 rounded-t-sm bg-chart-1/70"
            style={{ height: `${Math.max((p.count / max) * 100, 2)}%` }}
            title={`${p.timestamp.slice(0, 10)}: ${p.count}`}
          />
        ))}
      </div>
    </div>
  );
}

/** 列表卡（热门路径 / 来源） */
function ListCard({
  icon: Icon,
  title,
  empty,
  loading,
  items,
  uniquesLabel,
}: {
  icon: LucideIcon;
  title: string;
  empty: string;
  loading: boolean;
  items: { key: string; primary: string; secondary?: string; count: number; uniques: number }[];
  uniquesLabel: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 py-4 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{it.primary}</p>
                {it.secondary && (
                  <p className="truncate text-xs text-muted-foreground">{it.secondary}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums">{it.count}</p>
                <p className="text-xs text-muted-foreground">
                  {uniquesLabel}: {it.uniques}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
