/**
 * 最近推送分支提示条（复刻官方仓库 Overview 顶部 Recently touched branches）
 *
 * 官方（github.com 实测）：仓库主页 Overview 顶部（分支选择器行上方）显示黄色 Flash——
 * 「<分支名> had recent pushes on <日期>」+ 右侧 primary 按钮「Compare & pull request」
 * → 引导把刚推送的分支开成 PR（跳 compare/<branch>?expand=1）。
 *
 * 本项目（已确认决策）：
 *   - 仅登录用户显示（匿名返回 null）
 *   - 取最近 1 个非默认分支（committedDate 排序）
 *   - 14 天时间窗口内才显示
 *   - 「Compare & pull request」→ 站内 pulls/new?compare=<branch>（预填 compare 分支）
 *
 * 样式：amber 警告条（对齐 ArchivedBanner / ScopeWarningBanner 既有体系，design.md）。
 * 数据：fetchRecentBranchesSmart（GraphQL refs committedDate，失败静默隐藏）。
 * 用法：<RecentPushesBanner />；仅仓库 Code 首页顶部渲染。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useRepoData } from "@/lib/repo/repo-context";
import { fetchRecentBranchesSmart, type RecentBranch } from "@/lib/api";

/** 时间窗口：14 天内（官方分支页 recent 语义） */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function RecentPushesBanner() {
  const { owner = "", repo = "" } = useParams();
  const { token, user } = useAuth();
  const repoData = useRepoData();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [branch, setBranch] = useState<RecentBranch | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchRecentBranchesSmart(owner, repo, token).then((branches) => {
      if (cancelled) return;
      const cutoff = Date.now() - WINDOW_MS;
      // 已按 committedDate DESC 排序 → 取第一个在窗口内的非默认分支
      setBranch(branches.find((b) => new Date(b.committedDate).getTime() >= cutoff) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  if (!token || !branch) return null;
  // 仅本人管理的仓库显示快捷操作横幅（非本人仓库不应出现「Compare & pull request」快捷入口）
  if (!repoData || !user || repoData.owner.login !== user.login) return null;
  // fork 仓库：分支继承自上游（committedDate 是上游提交时间，非本人「最近推送」），
  // 官方不显示该横幅（仅显示「同步 Fork」信息条），故 fork 直接不渲染
  if (repoData.fork) return null;

  // fmt 的 absolute 格式（`2026年8月9日 22:53`）去掉 ` HH:mm` 时间尾 → 仅日期（对齐 ArchivedBanner）
  const fmtDate = (iso: string): string => fmt(iso).replace(/\s\d{2}:\d{2}$/, "");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-400/40 dark:bg-amber-950/40">
      <span className="flex min-w-0 items-center gap-2 text-amber-700 dark:text-amber-300">
        <GitBranch className="size-4 shrink-0" />
        <Link
          to={`/${owner}/${repo}/tree/${branch.name}`}
          className="font-semibold hover:underline"
        >
          {branch.name}
        </Link>
        <span className="truncate">
          {t("recentPushes.hadPushes").replace("{date}", fmtDate(branch.committedDate))}
        </span>
      </span>
      <Button asChild>
        <Link to={`/${owner}/${repo}/pulls/new?compare=${encodeURIComponent(branch.name)}`}>
          Compare &amp; pull request
        </Link>
      </Button>
    </div>
  );
}
