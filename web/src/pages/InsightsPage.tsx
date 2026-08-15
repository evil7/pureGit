/**
 * 仓库 Insights Pulse 页（只做核心 Pulse，图表子页去杂项）
 *
 * 官方 /pulse：
 * - 左栏导航（Pulse/Contributors/Community standards/Commits/Code frequency/Dependency graph/Network/Forks/Actions usage）
 * - 顶部时间段 + Period 下拉
 * - Overview 统计卡：Active PRs / Active issues 大数字 + Merged/Open PRs + Closed/New issues 网格
 * - Summary 文字（Excluding merges, {n} authors have pushed...）
 * - Top committers（官方 Highcharts 柱状图 → 简版 CSS 条形图）
 *
 * 数据通道：Pulse 统计 GraphQL 一次请求 6 个 issueCount 首选 + REST /search 降级（smart）；
 * Top committers REST commits 聚合（GraphQL 无按作者聚合端点）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  GitPullRequest,
  CircleDot,
  GitMerge,
  CircleOff,
  PlusCircle,
  BarChart3,
  Users,
  GitFork,
  ShieldCheck,
  GitCommit,
  GitBranch,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  normalizeApiError,
  fetchPulseStatsSmart,
  fetchTopCommittersSmart,
  ApiError,
} from "@/lib/api";
import type { PulseStats, CommitterStat } from "@/lib/api";
import { cn } from "@/lib/utils";
import PageLayout from "@/components/PageLayout";

/** Period 选项（官方 1 week/1 month/3 months/1 year） */
const PERIODS = [
  { key: "week", days: 7, labelKey: "insights.period.week" },
  { key: "month", days: 30, labelKey: "insights.period.month" },
  { key: "3months", days: 90, labelKey: "insights.period.3months" },
  { key: "year", days: 365, labelKey: "insights.period.year" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

/** 左栏导航（官方 9 项；仅 Pulse 实现，其余置灰去杂项） */
const INSIGHTS_NAV: { key: string; labelKey: I18nKey; icon: LucideIcon; disabled?: boolean }[] = [
  { key: "pulse", labelKey: "insights.nav.pulse", icon: Activity },
  { key: "contributors", labelKey: "insights.nav.contributors", icon: Users, disabled: true },
  { key: "community", labelKey: "insights.nav.community", icon: ShieldCheck, disabled: true },
  { key: "commits", labelKey: "insights.nav.commits", icon: GitCommit, disabled: true },
  { key: "codeFrequency", labelKey: "insights.nav.codeFrequency", icon: BarChart3, disabled: true },
  {
    key: "dependencyGraph",
    labelKey: "insights.nav.dependencyGraph",
    icon: GitBranch,
    disabled: true,
  },
  { key: "network", labelKey: "insights.nav.network", icon: GitFork, disabled: true },
  { key: "forks", labelKey: "insights.nav.forks", icon: GitFork, disabled: true },
  { key: "actionsUsage", labelKey: "insights.nav.actionsUsage", icon: Zap, disabled: true },
];

export default function InsightsPage() {
  const { owner, repo } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [committers, setCommitters] = useState<CommitterStat[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const mountedRef = useRef(true);

  // since 日期（ISO，向后 N 天）
  const since = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period) ?? PERIODS[0];
    return new Date(Date.now() - p.days * 86_400_000).toISOString();
  }, [period]);

  useEffect(() => {
    mountedRef.current = true;
    setStats(null);
    setCommitters(null);
    setError(null);
    fetchPulseStatsSmart(owner!, repo!, since, token)
      .then((s) => mountedRef.current && setStats(s))
      .catch((e: unknown) => {
        if (mountedRef.current) setError(normalizeApiError(e));
      });
    fetchTopCommittersSmart(owner!, repo!, since, token)
      .then((c) => mountedRef.current && setCommitters(c))
      .catch(() => mountedRef.current && setCommitters([]));
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, since, token]);

  // 时间段显示：{since} – 今天（官方 July 31, 2026 – August 7, 2026）
  const rangeText = `${fmt(since)} – ${fmt(new Date().toISOString())}`;
  // Summary：Excluding merges, {authors} authors have pushed {commits} commits（committers 聚合）
  const totalAuthors = committers?.length ?? 0;
  const totalCommits = committers?.reduce((a, c) => a + c.count, 0) ?? 0;

  // 整页级致命错误（数据加载失败/限流）→ 路由 errorElement 全局错误页
  if (error) throw error;

  return (
    /* 修复双层 PAGE_SHELL 嵌套：仓库子页外层 RepoLayout 已给 PAGE_SHELL，
       此处仅两栏（D 型左导航 + 内容），不再套 PAGE_SHELL */
    <PageLayout
      gap="lg"
      left={{
        node: (
          <nav className="rounded-lg border bg-card p-2">
            <ul className="space-y-0.5">
              {INSIGHTS_NAV.map((x) => {
                const Icon = x.icon;
                return (
                  <li key={x.key}>
                    {x.disabled ? (
                      <span
                        className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50"
                        title={t("insights.soon")}
                      >
                        <Icon className="size-4 shrink-0" />
                        {t(x.labelKey)}
                      </span>
                    ) : (
                      <Link
                        to={`/${owner}/${repo}/pulse`}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                          "bg-accent font-medium text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        {t(x.labelKey)}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        ),
        width: 240,
        sticky: "nav",
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("insights.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rangeText}</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
          <SelectTrigger className="w-40">
            <span className="mr-1 text-muted-foreground">{t("insights.periodLabel")}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {t(p.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {stats === null ? (
        <PulseSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Overview 统计卡：2 大卡（Active）+ 4 网格 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("insights.overview")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                icon={GitPullRequest}
                label={t("insights.activePrs")}
                value={stats.activePrs}
                accent="text-primary"
              />
              <StatCard
                icon={CircleDot}
                label={t("insights.activeIssues")}
                value={stats.activeIssues}
                accent="text-chart-1"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={GitMerge} label={t("insights.mergedPrs")} value={stats.mergedPrs} />
              <StatCard icon={GitPullRequest} label={t("insights.openPrs")} value={stats.openPrs} />
              <StatCard
                icon={CircleOff}
                label={t("insights.closedIssues")}
                value={stats.closedIssues}
              />
              <StatCard icon={PlusCircle} label={t("insights.newIssues")} value={stats.newIssues} />
            </div>
          </section>

          {/* Summary 文字 */}
          {totalAuthors > 0 && (
            <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
              {t("insights.summary")
                .replace("{authors}", String(totalAuthors))
                .replace("{commits}", String(totalCommits))}
            </p>
          )}

          {/* Top committers（官方 Highcharts 柱状图 → 简版 CSS 条形图） */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("insights.topCommitters")}</h2>
            {committers === null ? (
              <div className="space-y-2 rounded-lg border p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : committers.length === 0 ? (
              <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                {t("insights.noCommitters")}
              </p>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                {committers.map((c, i) => {
                  const max = committers[0].count || 1;
                  return (
                    <div key={c.login} className="flex items-center gap-3">
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="w-8 shrink-0">
                        {c.avatarUrl ? (
                          <img src={c.avatarUrl} alt={c.login} className="size-6 rounded-full" />
                        ) : (
                          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {c.login.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <Link
                        to={`/${c.login}`}
                        className="w-32 shrink-0 truncate text-sm font-medium hover:underline"
                      >
                        {c.login}
                      </Link>
                      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted/60">
                        <div
                          className="h-full rounded-sm bg-chart-1/70"
                          style={{ width: `${Math.max((c.count / max) * 100, 3)}%` }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {c.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </PageLayout>
  );
}

/** 统计卡：图标 + 大数字 + 标签 */
function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <Icon className={cn("size-5 shrink-0 text-muted-foreground", accent)} />
      <div className="min-w-0">
        <p className={cn("text-2xl font-semibold tabular-nums", accent)}>
          {value.toLocaleString()}
        </p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** 加载骨架：统计卡 + 条形图占位 */
function PulseSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <Skeleton className="mb-3 h-6 w-28" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </section>
      {/* Summary 文字块 */}
      <Skeleton className="h-4 w-2/3" />
      <section>
        <Skeleton className="mb-3 h-6 w-40" />
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
