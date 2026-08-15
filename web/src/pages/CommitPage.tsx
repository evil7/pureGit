/**
 * 单个 commit 详情页（/:owner/:repo/commit/:sha，官方 /commit/:sha 复刻）
 *
 * 官方结构：commit 标题（message 首行）→ 作者头像 + login + committed + 时间 + 父提交 →
 * 文件变更统计 → 文件 diff 列表（复用 DiffView，评论/Expand 因无 PR 上下文自然隐藏）。
 * 数据源：REST GET /repos/{owner}/{repo}/commits/{ref}（fetchCommitDetail，含 files/stats/parents）。
 * 站内补全：feed push 卡片 / commit 评论卡片 → 跳转本页（替代原 github.com 外链）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, ArrowUp, ChevronDown, ChevronUp, Copy, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffView } from "@/components/DiffView";
import { FileTree } from "@/components/FileTree";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { buildTree } from "@/lib/repo/file-tree";
import { ApiError, fetchCommitDetail, normalizeApiError } from "@/lib/restapi";
import { GRID_2COL_280, SIDEBAR_STICKY_SCROLL_HEAD } from "@/lib/ui/layout";

/** 每批渲染的 diff 文件数（大 commit 分批渲染，防文件爆炸卡死） */
const DIFF_PAGE_SIZE = 20;

export default function CommitPage() {
  const { owner = "", repo = "", sha = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchCommitDetail>>>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [visibleCount, setVisibleCount] = useState(DIFF_PAGE_SIZE);
  const [copied, setCopied] = useState(false);
  // commit summary（message 首行后的正文）折叠态：默认收起（仅显示 5 行）
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // sticky 头粘住态（参照 BlobPage：粘住后切实色背景，消除半透明影印）
  const [headerStickied, setHeaderStickied] = useState(false);
  // 滚动后显示返回顶部按钮（参照 BlobPage showTop）
  const [showTop, setShowTop] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setVisibleCount(DIFF_PAGE_SIZE);
    fetchCommitDetail(owner, repo, sha, token)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        if (d == null) setError(new ApiError(404, "commit 不存在"));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, sha, token]);

  // 滚动监听（参照 BlobPage sticky 头）：showTop 阈值 + 头粘住态（top <= 57 = topbar 底）
  useEffect(() => {
    const onScroll = () => {
      setShowTop(window.scrollY > 120);
      const el = headerRef.current;
      if (el) setHeaderStickied(el.getBoundingClientRect().top <= 57);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 文件树（从 files 构建；点击滚动到对应 diff 文件）；detail 为 null 时占位空树
  const filesTree = useMemo(
    () =>
      detail
        ? buildTree(
            detail.files.map((f) => ({
              path: f.filename,
              mode: "100644",
              type: "blob" as const,
              sha: "",
            })),
          )
        : null,
    [detail],
  );

  if (error) throw error;
  if (detail === null || filesTree === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // body = message 首行之后的其余行（多行提交信息）；标题已由 commit.title 展示
  const body = detail.commit.message.split("\n").slice(1).join("\n").trim();
  const date = detail.commit.author?.date ?? detail.commit.committer?.date ?? "";
  const authorName = detail.author?.login ?? detail.commit.author?.name ?? "unknown";
  // 正文超过 5 行时可折叠（默认收起）
  const bodyLineCount = body ? body.split("\n").length : 0;
  const canCollapseBody = bodyLineCount > 5;

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const scrollToFile = (path: string) => {
    document.getElementById(`diff-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(detail.sha);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const visibleFiles = detail.files.slice(0, visibleCount);

  return (
    <div>
      {/* Sticky 单行头（参照 BlobPage #StickyHeader）：始终渲染 sticky top-14 滚动吸附；
          粘住后切实色背景（消除半透明影印）；Top 按钮随滚动显示 */}
      <div
        ref={headerRef}
        className={cn(
          "sticky top-14 z-10 mb-3 border-b",
          headerStickied ? "bg-background" : "bg-background/95 backdrop-blur",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <h1 className="shrink-0 text-base font-semibold">
            {t("commit.title", { sha: detail.sha.slice(0, 7) })}
          </h1>
          <UserAvatar
            src={detail.author?.avatar_url}
            alt={authorName}
            className="size-5 shrink-0"
          />
          <span className="truncate font-medium text-foreground">{authorName}</span>
          <span className="shrink-0 text-muted-foreground">{t("commit.committed")}</span>
          {date && <span className="truncate text-muted-foreground">{fmt(date)}</span>}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/${owner}/${repo}/tree/${detail.sha}`}>{t("commit.browseFiles")}</Link>
            </Button>
            {showTop && (
              <Button variant="ghost" size="sm" className="gap-1" onClick={scrollToTop}>
                <ArrowUp className="size-3.5" />
                {t("commit.backToTop")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 详情：commit summary（可折叠）+ 父提交 + sha + 统计 */}
      <div className="mb-4">
        {body && (
          <div>
            <pre
              className={cn(
                "mt-2 wrap-break-word font-mono text-sm whitespace-pre-wrap text-muted-foreground",
                canCollapseBody && !summaryExpanded && "line-clamp-5",
              )}
            >
              {body}
            </pre>
            {canCollapseBody && (
              <button
                type="button"
                onClick={() => setSummaryExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {summaryExpanded ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    {t("common.collapse")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    {t("common.expand")}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* 父提交 + 当前 sha（badge + copy）；下边框分割线分隔统计行 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-b pb-3 text-xs text-muted-foreground">
          {detail.parents.length > 0 && (
            <>
              <span>{detail.parents.length > 1 ? t("commit.parents") : t("commit.parent")}</span>
              {detail.parents.map((p) => (
                <Link
                  key={p.sha}
                  to={`/${owner}/${repo}/commit/${p.sha}`}
                  className="font-mono text-primary hover:underline"
                >
                  {p.sha.slice(0, 7)}
                </Link>
              ))}
            </>
          )}
          <Badge variant="secondary" className="gap-1 font-mono">
            <GitCommitHorizontal className="size-3" />
            {detail.sha.slice(0, 7)}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => void copySha()}
            title={t("commit.copySha")}
            aria-label={t("commit.copySha")}
          >
            {copied ? <Check className="size-3.5 text-chart-1" /> : <Copy className="size-3.5" />}
          </Button>
        </div>

        {/* 统计行 */}
        <div className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("commit.filesChanged", { count: detail.files.length })}
          </span>
          <span className="ml-3 text-(--diff-add-fg)">+{detail.stats.additions}</span>
          <span className="ml-2 text-(--diff-del-fg)">-{detail.stats.deletions}</span>
        </div>
      </div>

      {/* 两栏：左文件树 + 右 diff（分批渲染，大 commit 防卡死）；
          文件树 sticky 锚点 top-25 对齐上方 sticky 头底（101px），卡片容器复用 FileTreeSidebar 风格 */}
      <div className={GRID_2COL_280}>
        <aside
          className={cn(
            "flex flex-col overflow-hidden rounded-lg border bg-card",
            SIDEBAR_STICKY_SCROLL_HEAD,
          )}
        >
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("commit.files")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <FileTree
              root={filesTree}
              currentPath=""
              branch={detail.sha}
              onSelectFile={scrollToFile}
              initiallyExpandAll
            />
          </div>
        </aside>
        <div className="min-w-0">
          <DiffView files={visibleFiles} owner={owner} repo={repo} fileLinkSha={detail.sha} />
          {detail.files.length > visibleCount && (
            <LoadMoreButton
              loading={false}
              endReached={false}
              onClick={() => setVisibleCount((c) => c + DIFF_PAGE_SIZE)}
              className="mt-3"
            />
          )}
        </div>
      </div>
    </div>
  );
}
