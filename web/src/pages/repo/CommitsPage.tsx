/**
 * 文件提交历史页（/:owner/:repo/commits/:branch/:path，官方 /commits/:branch/:path 复刻）
 *
 * 官方结构：头部面包屑（repo / 文件路径 + 分支徽标）→ 垂直提交列表（每行：标题 + 作者 + 时间 + sha）。
 * 数据源：fetchFileCommitsSmart（GraphQL object(branch).history(path) 首选 + REST listCommits(sha,path) 降级）。
 * 站内补全：blob 页 History 按钮 → 跳本页（替代原 github.com 外链）；path 为空时退化为分支全量历史。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { useAuth } from "@/hooks/useAuth";
import { useBranchPath } from "@/hooks/useBranchPath";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import { fetchFileCommitsSmart, type FileCommitItem } from "@/lib/api";
import { normalizeApiError, type ApiError } from "@/lib/restapi";

/** 单条提交行（官方结构：标题 + 作者/committed/时间 + sha badge + copy） */
function CommitRow({
  commit,
  owner,
  repo,
}: {
  commit: FileCommitItem;
  owner: string;
  repo: string;
}) {
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [copied, setCopied] = useState(false);
  const author = commit.authorLogin ?? commit.authorName ?? "unknown";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commit.sha);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
      <UserAvatar src={commit.authorAvatarUrl ?? undefined} alt={author} className="size-8" />
      <div className="min-w-0 flex-1">
        <Link
          to={`/${owner}/${repo}/commit/${commit.sha}`}
          className="block truncate font-medium text-foreground hover:text-primary hover:underline"
        >
          {commit.message.split("\n")[0]}
        </Link>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{author}</span>
          <span>{t("commit.committed")}</span>
          {commit.committedDate && <span>{fmt(commit.committedDate)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Badge variant="secondary" asChild className="font-mono hover:bg-secondary/80">
          <Link to={`/${owner}/${repo}/commit/${commit.sha}`} title={commit.sha}>
            {commit.sha.slice(0, 7)}
          </Link>
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => void copy()}
          title={t("commit.copySha")}
          aria-label={t("commit.copySha")}
        >
          {copied ? <Check className="size-3.5 text-chart-1" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export default function CommitsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { day } = useDateFormat();
  const { branch, path } = useBranchPath();

  const [commits, setCommits] = useState<FileCommitItem[] | null>(null);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [restPage, setRestPage] = useState(2);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setError(null);
    setEndCursor(null);
    setRestPage(2);
    setHasNextPage(false);
    fetchFileCommitsSmart(owner, repo, branch, path, null, 1, token)
      .then((r) => {
        if (cancelled) return;
        setCommits(r.commits);
        setEndCursor(r.endCursor);
        setHasNextPage(r.hasNextPage);
        setRestPage(r.restPage ?? 2);
      })
      .catch((e: unknown) => {
        if (cancelled) setError(normalizeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, path, token]);

  /** 加载更多：游标（GraphQL）/ 页码（REST 降级）续接追加下一页 */
  const loadMore = async () => {
    if (loadingMore || !hasNextPage) return;
    setLoadingMore(true);
    try {
      const r = await fetchFileCommitsSmart(owner, repo, branch, path, endCursor, restPage, token);
      setCommits((prev) => [...(prev ?? []), ...r.commits]);
      setEndCursor(r.endCursor);
      setHasNextPage(r.hasNextPage);
      setRestPage(r.restPage ?? restPage);
    } catch {
      /* 失败保持原列表（下回点击重试） */
    } finally {
      setLoadingMore(false);
    }
  };

  // 按日期分组（官方 Commits on X 结构；API 已按时间降序，Map 保持插入顺序）
  const groups = useMemo(() => {
    if (!commits) return [];
    const map = new Map<string, FileCommitItem[]>();
    for (const c of commits) {
      const key = c.committedDate ? c.committedDate.slice(0, 10) : "";
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [commits]);

  if (error) throw error;

  if (commits === null) {
    return (
      <div className="space-y-4">
        {/* 面包屑行 */}
        <Skeleton className="h-5 w-1/2" />
        {/* 日期分组标题 + 提交行 */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-0 overflow-hidden rounded-lg border">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-none" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 头部面包屑：repo 链接 / 文件路径 + 分支徽标 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link
          to={`/${owner}/${repo}/tree/${branch}`}
          className="font-medium text-primary hover:underline"
        >
          {repo}
        </Link>
        {path && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="break-all text-muted-foreground">{path}</span>
          </>
        )}
        <Badge variant="outline" className="ml-auto">
          {branch}
        </Badge>
      </div>

      {/* 提交历史列表（按日期分组，官方 Commits on X 结构） */}
      {commits.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("commits.empty")}</p>
      ) : (
        groups.map(([dateKey, items]) => (
          <div key={dateKey || "unknown"}>
            <h3 className="mt-4 mb-2 text-sm font-semibold">
              {t("commits.onDate", {
                date: items[0]?.committedDate ? day(items[0].committedDate) : "",
              })}
            </h3>
            <div className="rounded-lg border">
              {items.map((c) => (
                <CommitRow key={c.sha} commit={c} owner={owner} repo={repo} />
              ))}
            </div>
          </div>
        ))
      )}
      <LoadMoreButton
        loading={loadingMore}
        endReached={!hasNextPage}
        onClick={() => void loadMore()}
        className="mt-3"
      />
    </div>
  );
}
