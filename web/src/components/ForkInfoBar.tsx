/**
 * Fork 仓库对照信息条（增补，官方 BranchInfoBar 复刻）
 *
 * 官方（github.com/evil7/vscode 实测）：fork 仓库首页操作栏上方显示对照条——
 * 「This branch is X commits ahead of and Y commits behind upstream:main」+ 两个按钮：
 *   - Contribute ▾（Open pull request / Create issue）
 *   - Sync fork ▾（Update branch —— 合并上游到本 fork 分支）
 *
 * 数据源：
 *   - compare：GET /repos/{o}/{r}/compare/{parent}:{parentBranch}...{branch}（REST 跨仓库）
 *   - 同步：POST /repos/{o}/{r}/merge-upstream（真实 API，官方 Update branch 等价）
 *
 * 仅 fork 仓库（repoData.fork && parent）渲染；非 fork 返回 null。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitPullRequest, GitMerge, RefreshCw, CircleDot, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useRepoData } from "@/lib/repo-context";
import { fetchCompare, mergeUpstream, apiErrorMessage, type CompareResult } from "@/lib/api";

export function ForkInfoBar() {
  const { owner = "", repo = "" } = useParams();
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const repoData = useRepoData();
  const parent = repoData?.parent;
  const branch = repoData?.default_branch ?? "main";
  const parentBranch = parent?.default_branch ?? "main";
  // 跨仓库 compare base（curl 实测：必须全冒号格式 `owner:repo:branch` 才 200；
  // `owner/repo:branch` 斜杠格式 404。full_name 含斜杠，需替换为冒号）
  const upstreamRef = parent ? `${parent.full_name.replace("/", ":")}:${parentBranch}` : null;
  const [status, setStatus] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  // 仅 fork 仓库渲染
  const isFork = Boolean(repoData?.fork && parent);
  useEffect(() => {
    if (!isFork || !parent || !upstreamRef) return;
    let cancelled = false;
    setStatus(null);
    setError(null);
    // 跨仓库 compare：base = 上游 owner:repo:branch，head = 本 fork 分支
    fetchCompare(owner, repo, upstreamRef, branch, token)
      .then((c) => !cancelled && setStatus(c))
      .catch(() => !cancelled && setStatus(null)); // 对照失败静默（条隐藏比对文案）
    return () => {
      cancelled = true;
    };
  }, [owner, repo, isFork, parent, upstreamRef, branch, token]);

  /** 对照文案（官方句式：ahead of / behind / up to date） */
  const summary = useMemo(() => {
    if (!status) return null;
    const upstream = `${parent?.full_name}:${parentBranch}`;
    const { ahead_by: ahead, behind_by: behind } = status;
    if (ahead === 0 && behind === 0) return t("forkInfo.upToDate").replace("{upstream}", upstream);
    if (ahead > 0 && behind > 0)
      return t("forkInfo.aheadBehind")
        .replace("{ahead}", String(ahead))
        .replace("{behind}", String(behind))
        .replace("{upstream}", upstream);
    if (behind > 0)
      return t("forkInfo.behind")
        .replace("{behind}", String(behind))
        .replace("{upstream}", upstream);
    return t("forkInfo.ahead").replace("{ahead}", String(ahead)).replace("{upstream}", upstream);
  }, [status, parent, parentBranch, t]);

  if (!isFork || !parent) return null;

  /** 同步 fork（Update branch：merge-upstream 合并上游到当前分支） */
  const syncBranch = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    setError(null);
    setSynced(false);
    try {
      await mergeUpstream(owner, repo, token, branch);
      setSynced(true);
      setTimeout(() => setSynced(false), 3000);
      // 同步后刷新对照（可能仍有差异或已一致）
      setStatus(null);
      fetchCompare(owner, repo, upstreamRef!, branch, token)
        .then(setStatus)
        .catch(() => undefined);
    } catch (e) {
      setError(apiErrorMessage(e, t("forkInfo.syncFailed")));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted px-4 py-2 text-sm">
      <span className="min-w-0 flex-1">
        {summary ? (
          summary
        ) : (
          /* 差异计算中（或对照失败静默）：骨架条匹配文本行高（h-4），防加载完成切换抖动 */
          <Skeleton className="h-4 w-64" />
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* Contribute ▾（官方：Open pull request / Create issue） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <GitPullRequest className="size-4" />
              {t("forkInfo.contribute")}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">
              {t("forkInfo.contributeLabel")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Open pull request → 官方跨仓库 compare 页（fork→上游建 PR 唯一官方通道） */}
            <DropdownMenuItem asChild>
              <a
                href={`https://github.com/${parent.full_name}/compare/${parentBranch}...${owner}:${branch}`}
                target="_blank"
                rel="noreferrer"
              >
                <GitPullRequest className="size-4" />
                {t("forkInfo.openPull")}
              </a>
            </DropdownMenuItem>
            {/* Create issue → 站内新建 issue */}
            <DropdownMenuItem asChild>
              <Link to={`/${owner}/${repo}/issues/new`}>
                <CircleDot className="size-4" />
                {t("forkInfo.createIssue")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sync fork ▾（官方：Update branch） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!canWrite}>
              <RefreshCw className="size-4" />
              {t("forkInfo.syncFork")}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs">{t("forkInfo.syncLabel")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!token || syncing}
              onSelect={(e) => {
                e.preventDefault();
                void syncBranch();
              }}
            >
              <GitMerge className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("forkInfo.updateBranch")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("forkInfo.updateBranchDesc").replace("{branch}", branch)}
                </span>
              </span>
            </DropdownMenuItem>
            {synced && <p className="px-2 py-1 text-xs text-chart-1">{t("forkInfo.synced")}</p>}
            {error && <InlineError message={error} size="sm" />}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
