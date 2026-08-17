/**
 * Insights 左栏导航（官方 github.com/:owner/:repo 下 Insights 系列子页共用）
 *
 * 官方 URL 结构（平级路由，非 /pulse 子路由）：
 * - /pulse                    → Pulse
 * - /graphs/contributors      → Contributors
 * - /graphs/traffic           → Traffic（流量统计）
 * - /graphs/commit-activity   → Commits（提交活动）
 * - /graphs/code-frequency    → Code frequency
 * - /community                → Community standards
 * 未实现项（Dependency graph / Network / Actions performance metrics）外链官方并标注「仅官方」；
 * Forks 站内指向 /forks（已实现 ForksPage）；Actions usage 站内指向 /actions/metrics/usage；
 * Traffic 需仓库 push（WRITE）权限，无权限（含匿名）隐藏（官方行为）。
 */
import { NavLink, useParams } from "react-router-dom";
import {
  Activity,
  Users,
  LineChart,
  GitCommit,
  BarChart3,
  ShieldCheck,
  GitBranch,
  GitFork,
  Zap,
  Gauge,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { useI18n, type I18nKey } from "@/i18n";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { cn } from "@/lib/utils";

/** 导航项（to=站内路由；href=官方外链；disabled 项置灰去杂项） */
interface InsightsNavItem {
  key: string;
  to: string;
  /** 官方外链（无公开 API 的项）；存在时渲染 <a target=_blank> */
  href?: string;
  labelKey: I18nKey;
  icon: LucideIcon;
  /** 无公开 API，外链官方并标注「仅官方」 */
  officialOnly?: boolean;
  disabled?: boolean;
  /** 需仓库 push（WRITE）权限才显示（无权限/匿名隐藏） */
  requireWrite?: boolean;
}

export default function InsightsNav() {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();
  const { canWrite } = useRepoPermission();

  const items: InsightsNavItem[] = [
    { key: "pulse", to: `/${owner}/${repo}/pulse`, labelKey: "insights.nav.pulse", icon: Activity },
    {
      key: "contributors",
      to: `/${owner}/${repo}/graphs/contributors`,
      labelKey: "insights.nav.contributors",
      icon: Users,
    },
    {
      key: "traffic",
      to: `/${owner}/${repo}/graphs/traffic`,
      labelKey: "insights.nav.traffic",
      icon: LineChart,
      requireWrite: true,
    },
    {
      key: "commits",
      to: `/${owner}/${repo}/graphs/commit-activity`,
      labelKey: "insights.nav.commits",
      icon: GitCommit,
    },
    {
      key: "codeFrequency",
      to: `/${owner}/${repo}/graphs/code-frequency`,
      labelKey: "insights.nav.codeFrequency",
      icon: BarChart3,
    },
    {
      key: "community",
      to: `/${owner}/${repo}/community`,
      labelKey: "insights.nav.community",
      icon: ShieldCheck,
    },
    {
      key: "forks",
      to: `/${owner}/${repo}/forks`,
      labelKey: "insights.nav.forks",
      icon: GitFork,
    },
    {
      key: "dependencyGraph",
      to: "",
      href: `https://github.com/${owner}/${repo}/network/dependencies`,
      labelKey: "insights.nav.dependencyGraph",
      icon: GitBranch,
      officialOnly: true,
    },
    {
      key: "network",
      to: "",
      href: `https://github.com/${owner}/${repo}/network`,
      labelKey: "insights.nav.network",
      icon: GitFork,
      officialOnly: true,
    },
    {
      key: "actionsUsage",
      to: `/${owner}/${repo}/actions/metrics/usage`,
      labelKey: "insights.nav.actionsUsage",
      icon: Zap,
    },
    {
      key: "actionsPerformance",
      to: "",
      href: `https://github.com/${owner}/${repo}/actions/metrics/performance`,
      labelKey: "insights.nav.actionsPerformance",
      icon: Gauge,
      officialOnly: true,
    },
  ];

  // 需 push 权限的项（Traffic）：无 WRITE 权限（含匿名）时隐藏（官方行为）
  const visibleItems = items.filter((it) => !it.requireWrite || canWrite);

  return (
    <nav className="rounded-lg border bg-card p-2">
      <ul className="space-y-0.5">
        {visibleItems.map(({ key, to, href, labelKey, icon: Icon, disabled, officialOnly }) => (
          <li key={key}>
            {disabled ? (
              <span
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50"
                title={t("insights.soon")}
              >
                <Icon className="size-4 shrink-0" />
                {t(labelKey)}
              </span>
            ) : href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                title={officialOnly ? t("insights.officialOnlyTitle") : undefined}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                {officialOnly && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {t("insights.officialOnly")}
                  </span>
                )}
                <ExternalLink className="size-3 shrink-0 text-muted-foreground/50" />
              </a>
            ) : (
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {t(labelKey)}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
