/**
 * PR 详情页（/:owner/:repo/pull/:number）
 *
 * 自 PullsPages.tsx 拆出（列表页与详情页职责分离）。
 * 官方 F 型布局：完整头部（滚出视口触发 fixed 精简头）→ 左主列（Conversation/Commits/Checks/Files）
 * + 右 metadata 侧栏（Reviewers/Assignees/Labels/Milestone/Development/participants）。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  CircleX,
  FileDiff,
  GitBranch,
  GitCommit,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  User,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommentsSection } from "@/components/CommentsSection";
import { PullTimeline } from "@/components/PullTimeline";
import { MarkdownView } from "@/components/MarkdownView";
import { UserAvatar } from "@/components/UserAvatar";
import { DiffView } from "@/components/DiffView";
import { ReviewChangesDialog, MergePanel, ReviewStateBadge } from "@/components/PullReviewPanel";
import { COPILOT_AVATAR, copilotDisplayName, isCopilotLogin } from "@/lib/repo/copilot";
import { PullMetadataSidebar } from "@/components/PullMetadataSidebar";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import PageLayout from "@/components/PageLayout";
import { toastError, toastSuccess } from "@/lib/ui/toast";
import {
  fetchPullDetailFullSmart,
  fetchPullTimelineSmart,
  requestReviewersSmart,
  updatePullRequestStateSmart,
  fetchPullCommitsSmart,
  fetchPullCheckRunsSmart,
  fetchPullCheckRunListSmart,
  setIssueSubscriptionSmart,
  dismissPullReviewSmart,
  updatePullReviewSmart,
  deletePendingReviewSmart,
  updatePullBranchSmart,
  normalizeApiError,
  ApiError,
  type PullReviewSummary,
  type PullReview,
  type PullTimelineEvent,
} from "@/lib/api";
import {
  fetchPullFiles,
  fetchWorkflowRuns,
  apiErrorMessage,
  type CheckRunsSummary,
  type CheckRunItem,
  type PullCommit,
  type WorkflowRun,
} from "@/lib/restapi";
import type { PullRequest, IssueComment, PullFile } from "@/lib/restapi";
import { ChecksBadge, CheckRunRow, WorkflowRunRow, PullStateBadge } from "./PullStatus";

export default function PullDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token, user, canWrite } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  /** Files changed 分页状态：items 已加载文件 / page 当前页 / hasMore 是否还有（每次 5 个，大 PR 防卡死） */
  const [files, setFiles] = useState<{ items: PullFile[]; page: number; hasMore: boolean } | null>(
    null,
  );
  const [filesLoadingMore, setFilesLoadingMore] = useState(false);
  const [commits, setCommits] = useState<PullCommit[] | null>(null);
  const [checks, setChecks] = useState<CheckRunsSummary | null | undefined>(undefined); // undefined=加载中 null=无checks
  // check-run 列表（Checks tab 逐条列出；与汇总同步懒加载）
  const [checkRunList, setCheckRunList] = useState<CheckRunItem[] | null>(null);
  // 关联 head commit 的 workflow run（REST actions/runs head_sha；dynamic/push 触发无 check run 也在此列出）
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[] | null>(null);
  const [reviewSummary, setReviewSummary] = useState<PullReviewSummary | null | undefined>(
    undefined,
  );
  // 时间线（GraphQL timelineItems；null=查询失败降级回退三段式渲染）
  const [timeline, setTimeline] = useState<PullTimelineEvent[] | null | undefined>(undefined);
  // 时间线分页（timelineItems cursor 分页；endCursor 为空 = 无更多）
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [tab, setTab] = useState<"conversation" | "commits" | "checks" | "files">("conversation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  // 驳回评审 + 更新分支
  const [dismissTarget, setDismissTarget] = useState<PullReview | null>(null);
  const [dismissMessage, setDismissMessage] = useState("");
  const [dismissSubmitting, setDismissSubmitting] = useState(false);
  const [updatingBranch, setUpdatingBranch] = useState(false);
  // 编辑/删除 pending 草稿（仅评审作者）
  const [editReviewTarget, setEditReviewTarget] = useState<PullReview | null>(null);
  const [editReviewBody, setEditReviewBody] = useState("");
  const [editReviewBusy, setEditReviewBusy] = useState(false);
  const [deleteReviewTarget, setDeleteReviewTarget] = useState<PullReview | null>(null);
  const [deleteReviewBusy, setDeleteReviewBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPullDetailFullSmart(owner!, repo!, Number(number), token),
      token ? fetchPullTimelineSmart(owner!, repo!, Number(number), token) : Promise.resolve(null),
    ])
      .then(([{ pr: data, comments: cs, reviewSummary: summary }, tl]) => {
        if (!cancelled) {
          setPr(data);
          setComments(cs);
          setReviewSummary(summary);
          setTimeline(tl ? tl.events : null);
          setTimelineCursor(tl?.endCursor ?? null);
          setTimelineHasMore(tl?.hasNextPage ?? false);
          // 订阅状态（GraphQL viewerSubscription）
          if (data.subscription) {
            setSubscribed(data.subscription !== "UNSUBSCRIBED");
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number, token]);

  // Commits：切到该 tab 时懒加载
  useEffect(() => {
    if (tab !== "commits" || commits !== null) return;
    let cancelled = false;
    fetchPullCommitsSmart(owner!, repo!, Number(number), token)
      .then((list) => !cancelled && setCommits(list))
      .catch(() => !cancelled && setCommits([]));
    return () => {
      cancelled = true;
    };
  }, [tab, commits, owner, repo, number, token]);

  // Checks：切到该 tab 时懒加载（open PR 且 head.sha 存在）；汇总 + 列表 + workflow run 并行
  useEffect(() => {
    if (tab !== "checks" || checks !== undefined || !pr?.head?.sha) return;
    let cancelled = false;
    Promise.all([
      fetchPullCheckRunsSmart(owner!, repo!, pr.head.sha, token),
      fetchPullCheckRunListSmart(owner!, repo!, pr.head.sha, token),
      fetchWorkflowRuns(owner!, repo!, token, { headSha: pr.head.sha, perPage: 100 })
        .then((r) => r.runs)
        .catch(() => []),
    ]).then(([summary, list, runs]) => {
      if (cancelled) return;
      setChecks(summary ?? null);
      setCheckRunList(list ?? []);
      setWorkflowRuns(runs);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, checks, pr?.head?.sha, owner, repo, token]);

  // Files changed：切到该 tab 时懒加载第一页（每页 5 个；大 PR 避免一次全量拉取卡死）
  useEffect(() => {
    if (tab !== "files" || files !== null) return;
    let cancelled = false;
    fetchPullFiles(owner!, repo!, Number(number), token, 1, 5)
      .then(({ items, hasMore }) => !cancelled && setFiles({ items, page: 1, hasMore }))
      .catch(() => !cancelled && setFiles({ items: [], page: 1, hasMore: false }));
    return () => {
      cancelled = true;
    };
  }, [tab, files, owner, repo, number, token]);

  // Files changed：加载更多（追加下一页文件到列表）
  const loadMoreFiles = async () => {
    if (!files || !files.hasMore || filesLoadingMore) return;
    setFilesLoadingMore(true);
    try {
      const { items, hasMore } = await fetchPullFiles(
        owner!,
        repo!,
        Number(number),
        token,
        files.page + 1,
        5,
      );
      setFiles((prev) =>
        prev ? { items: [...prev.items, ...items], page: prev.page + 1, hasMore } : prev,
      );
    } catch (e) {
      toastError(apiErrorMessage(e, "加载更多文件失败"));
    } finally {
      setFilesLoadingMore(false);
    }
  };

  // Files changed 行内评论后：重新拉取时间线（review thread 事件进入 Conversation 时间线）
  const refreshTimeline = async () => {
    if (!token) return;
    const tl = await fetchPullTimelineSmart(owner!, repo!, Number(number), token);
    if (tl) {
      setTimeline(tl.events);
      setTimelineCursor(tl.endCursor);
      setTimelineHasMore(tl.hasNextPage);
    }
  };

  // 时间线加载更多（timelineItems 分页：追加下一页事件，官方「Load more」）
  const loadMoreTimeline = async () => {
    if (!token || !timelineCursor || timelineLoadingMore) return;
    setTimelineLoadingMore(true);
    try {
      const page = await fetchPullTimelineSmart(
        owner!,
        repo!,
        Number(number),
        token,
        timelineCursor,
      );
      if (page) {
        setTimeline((prev) => [...(prev ?? []), ...page.events]);
        setTimelineCursor(page.endCursor);
        setTimelineHasMore(page.hasNextPage);
      }
    } catch (e) {
      toastError(apiErrorMessage(e, "加载更多时间线失败"));
    } finally {
      setTimelineLoadingMore(false);
    }
  };

  // 新评论即时追加：评论列表计数 + 时间线事件（官方发表评论后立即出现在 Conversation）
  const appendTimelineComment = (c: IssueComment) => {
    setComments((prev) => [...(prev ?? []), c]);
    setTimeline((prev) =>
      prev
        ? [
            ...prev,
            {
              kind: "comment",
              id: String(c.id),
              author: { login: c.user.login, avatarUrl: c.user.avatar_url ?? null },
              authorAssociation: null,
              createdAt: c.created_at,
              lastEditedAt: null,
              body: c.body ?? "",
              reactions: [],
            } satisfies PullTimelineEvent,
          ]
        : prev,
    );
  };

  // 订阅切换（GraphQL 首选）
  const toggleSubscribe = async () => {
    if (!token) return;
    setSubscribing(true);
    try {
      const next = await setIssueSubscriptionSmart(
        owner!,
        repo!,
        Number(number),
        subscribed,
        token,
      );
      setSubscribed(next);
    } catch (e) {
      toastError(apiErrorMessage(e, "订阅操作失败"));
    } finally {
      setSubscribing(false);
    }
  };

  // fixed 精简头触发（官方 StickyPullRequestHeader 语义；参照 blob 页 scroll 监听模式）：
  // 完整头部滚出视口顶（bottom <= 57 topbar 下沿）→ 精简头 fixed 盖顶（portal 到 body 脱离 page-enter transform）
  const fullHeaderRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const el = fullHeaderRef.current;
      if (el) setStuck(el.getBoundingClientRect().bottom <= 57);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // 内容加载完成后补测一次（scroll 未触发时完整头可能已滚出，如 URL 带锚点直达；blob 页同款）
  useEffect(() => {
    const el = fullHeaderRef.current;
    if (el) setStuck(el.getBoundingClientRect().bottom <= 57);
  }, [pr, comments, files, tab]);

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        right={{
          node: (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          {/* 返回按钮 */}
          <Skeleton className="h-6 w-32" />
          {/* 标题 + 状态徽标/meta 行 + badges */}
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-6 w-1/3" />
          {/* Tabs */}
          <Skeleton className="h-10 w-full" />
          {/* 时间线项 + 评论 */}
          <Skeleton className="h-24 w-full rounded-lg border" />
          <Skeleton className="h-32 w-full rounded-lg border" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（PR 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !pr) throw error ?? new ApiError(404);

  // 操作区可见性：仅「有本仓库写权限（WRITE+）或本人参与的 PR（作者 = 自己）」
  // 显示 Merge / Review changes / 关闭 操作框——非本人项目无操作框（2026-08-14 用户要求；
  // 官方：无 base 仓库写权限即无 merge/review 入口，作者可关闭自己的 PR）。
  // 令牌写 scope（canWrite）与仓库级写权限（canWriteRepo）双门槛叠加。
  const isMyPr = pr.user.login?.toLowerCase() === user?.login?.toLowerCase();
  const showOps = Boolean(token) && canWrite && (canWriteRepo || isMyPr);

  /** 驳回评审（确认后执行；review 状态置 DISMISSED） */
  const handleDismiss = async () => {
    if (!token || !dismissTarget || dismissSubmitting) return;
    setDismissSubmitting(true);
    try {
      await dismissPullReviewSmart(
        owner!,
        repo!,
        Number(number),
        { nodeId: dismissTarget.nodeId, id: dismissTarget.id },
        dismissMessage.trim(),
        token,
      );
      setReviewSummary(
        (prev) =>
          prev && {
            ...prev,
            reviews: prev.reviews.map((r) =>
              r.id === dismissTarget.id && r.user?.login === dismissTarget.user?.login
                ? { ...r, state: "DISMISSED" as const }
                : r,
            ),
          },
      );
      setDismissTarget(null);
      setDismissMessage("");
      toastSuccess(t("pullDetail.reviewDismissed"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("pullDetail.dismissFailed")));
    } finally {
      setDismissSubmitting(false);
    }
  };

  /** 更新 pending 评审草稿（确认后执行） */
  const handleEditReview = async () => {
    if (!token || !editReviewTarget || editReviewBusy || !editReviewBody.trim()) return;
    setEditReviewBusy(true);
    try {
      await updatePullReviewSmart(
        owner!,
        repo!,
        Number(number),
        { nodeId: editReviewTarget.nodeId, id: editReviewTarget.id },
        editReviewBody.trim(),
        token,
      );
      setReviewSummary(
        (prev) =>
          prev && {
            ...prev,
            reviews: prev.reviews.map((r) =>
              r.id === editReviewTarget.id && r.user?.login === editReviewTarget.user?.login
                ? { ...r, body: editReviewBody.trim() }
                : r,
            ),
          },
      );
      setEditReviewTarget(null);
      toastSuccess(t("review.updated"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("review.editFailed")));
    } finally {
      setEditReviewBusy(false);
    }
  };

  /** 删除 pending 评审草稿（确认后执行；不可恢复） */
  const handleDeleteReview = async () => {
    if (!token || !deleteReviewTarget || deleteReviewBusy) return;
    setDeleteReviewBusy(true);
    try {
      await deletePendingReviewSmart(
        owner!,
        repo!,
        Number(number),
        { nodeId: deleteReviewTarget.nodeId, id: deleteReviewTarget.id },
        token,
      );
      setReviewSummary(
        (prev) =>
          prev && {
            ...prev,
            reviews: prev.reviews.filter(
              (r) =>
                !(
                  r.id === deleteReviewTarget.id && r.user?.login === deleteReviewTarget.user?.login
                ),
            ),
          },
      );
      setDeleteReviewTarget(null);
      toastSuccess(t("review.deleted"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("review.deleteFailed")));
    } finally {
      setDeleteReviewBusy(false);
    }
  };

  /** 更新 PR 分支（merge base into head） */
  const handleUpdateBranch = async () => {
    if (!token || updatingBranch) return;
    setUpdatingBranch(true);
    try {
      await updatePullBranchSmart(
        owner!,
        repo!,
        Number(number),
        reviewSummary?.pullRequestId,
        token,
      );
      toastSuccess(t("pullDetail.branchUpdated"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("pullDetail.updateBranchFailed")));
    } finally {
      setUpdatingBranch(false);
    }
  };

  // 参与者 = 作者 + 指派人 + 评论者 + 评审作者（去重，官方同源聚合——Copilot 评审也计入）
  const participants = Array.from(
    new Map(
      [
        pr.user,
        ...(pr.assignees ?? []),
        ...(comments ?? []).map((c) => c.user),
        ...(reviewSummary?.reviews ?? []).map((r) => r.user),
      ]
        .filter((u) => u?.login)
        .map((u) => [u!.login, u!] as const),
    ).values(),
  ).map((u) => ({
    ...u,
    // Copilot 头像归一（REST review 作者返回 bot 头像/可能为空 → 统一官方 in/946600，与真实用户同尺寸同风格）
    avatar_url: isCopilotLogin(u.login) ? COPILOT_AVATAR : u.avatar_url,
  }));

  return (
    /* 官方 F 型：完整头部（随内容滚动，滚出视口后触发精简头）+ fixed 精简头 portal 到 body + 下方左右栏 */
    <div className="space-y-4">
      {/* ① 完整头部：不 sticky，正常文档流（官方 PageHeader 语义；滚出视口后精简头接管） */}
      <div ref={fullHeaderRef} className="space-y-3">
        <div className="pt-2">
          <Button variant="ghost" asChild className="-ml-2">
            <Link to={`/${owner}/${repo}/pulls`}>
              <ArrowLeft className="size-4" />
              {t("pullDetail.backToList")}
            </Link>
          </Button>
        </div>

        {/* Header：标题 + #号 + 状态 + 分支信息（官方 wants to merge N commits into base from head） */}
        <header className="space-y-3 pt-1">
          {/* 标题行：标题与 #号 同属文本流（官方 gh-header-title + gh-header-number 并列；
              不设 flex-1——#号紧贴标题，与滚动后 sticky 精简头「名称 #{n}」布局一致） */}
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="min-w-0 text-2xl font-bold wrap-break-word">{pr.title}</h1>
            <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <PullStateBadge pr={pr} />
            <span className="flex items-center gap-1">
              <User className="size-3.5" />
              <Link
                to={`/${pr.user.login}`}
                className="font-medium text-foreground hover:underline"
              >
                {pr.user.login}
              </Link>
            </span>
            <span className="flex items-center gap-1">
              {pr.merged_at ? "merged" : pr.state === "open" ? "opened" : "closed"}{" "}
              {fmt ? fmt(pr.merged_at ?? pr.created_at) : ""}
            </span>
            {pr.base && (
              <span className="flex items-center gap-1">
                <GitBranch className="size-3.5" />
                wants to merge {pr.commits} commits into {pr.base.ref} from {pr.head?.ref}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <FileDiff className="size-3" />
              {t("pullDetail.filesCount", { count: pr.changed_files })}
            </Badge>
            <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-add-fg)" }}>
              <Plus className="size-3" />
              {pr.additions}
            </Badge>
            <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-del-fg)" }}>
              <Minus className="size-3" />
              {pr.deletions}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <MessageSquare className="size-3" />
              {t("pullDetail.commentsCount", { count: pr.comments })}
            </Badge>
          </div>
        </header>

        {/* 评审操作区：Merge + Review changes + 关闭/重新打开（本人管理/参与的 PR 才显示；
            非本人项目无操作框） */}
        {(pr.state === "open" || pr.merged_at) && showOps && (
          <div className="mt-4 space-y-3">
            {pr.state === "open" && !pr.merged_at && (
              <MergePanel
                owner={owner!}
                repo={repo!}
                number={Number(number)}
                pullRequestId={reviewSummary?.pullRequestId}
                mergeable={reviewSummary?.mergeable ?? null}
                onMerged={() => setReviewSummary((prev) => prev && { ...prev, mergeable: null })}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {pr.state === "open" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void handleUpdateBranch()}
                    disabled={updatingBranch}
                  >
                    <RefreshCw className={`size-3.5 ${updatingBranch ? "animate-spin" : ""}`} />
                    {updatingBranch ? t("common.loading") : t("pullDetail.updateBranch")}
                  </Button>
                  <ReviewChangesDialog
                    owner={owner!}
                    repo={repo!}
                    number={Number(number)}
                    onReviewed={(r) =>
                      setReviewSummary(
                        (prev) =>
                          prev && {
                            ...prev,
                            reviews: [
                              r,
                              ...prev.reviews.filter((x) => x.user?.login !== r.user?.login),
                            ],
                          },
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await updatePullRequestStateSmart(
                          owner!,
                          repo!,
                          Number(number),
                          "closed",
                          token,
                          reviewSummary?.pullRequestId,
                        );
                        setPr((p) => (p ? { ...p, state: "closed" } : p));
                        toastSuccess(t("pullDetail.closed"));
                      } catch (e) {
                        toastError(apiErrorMessage(e, "关闭失败"));
                      }
                    }}
                  >
                    <CircleX className="size-3.5" />
                    {t("pullDetail.close")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 四 tab（官方 Conversation / Commits / Checks / Files changed；line 型 = ghost 风格：
            宽度自适应内容（参考 repo 页 tabs nav）+ 底部 border-b 分割线 + 活动下划线） */}
        {/* 四 tab：TabsList 为 inline-flex w-fit（宽度自适应内容）——全宽分割线画在最外层 Tabs
            （flex 容器撑满父宽）底部 border-b，TabsList 自身不再画线，与内容区分区 */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="border-b">
          <TabsList variant="line">
            <TabsTrigger value="conversation">
              <MessageSquare className="size-3.5" />
              Conversation
              {/* 总评论数（含行内评审评论，详情查询一次拿到；官方 totalCommentsCount 语义） */}
              {(pr.total_comments ?? 0) > 0 && (
                <span className="text-muted-foreground">{pr.total_comments}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="commits">
              <GitCommit className="size-3.5" />
              Commits
              {pr.commits > 0 && <span className="text-muted-foreground">{pr.commits}</span>}
            </TabsTrigger>
            <TabsTrigger value="checks">
              <CheckCircle2 className="size-3.5" />
              Checks
              {checks && <span className="text-muted-foreground">{checks.total}</span>}
            </TabsTrigger>
            <TabsTrigger value="files">
              <FileDiff className="size-3.5" />
              Files changed
              {/* 文件总数（详情查询一次拿到；不再依赖 files 分页加载进度） */}
              {pr.changed_files > 0 && (
                <span className="text-muted-foreground">{pr.changed_files}</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ② 滚动后 fixed 精简头（官方 StickyPullRequestHeader：状态标 + 标题 + #号，不含 tabs）：
          portal 到 body——脱离 .page-enter transform 的 containing block（否则 fixed 相对 transform 容器失效） */}
      {stuck &&
        createPortal(
          <div className="fixed inset-x-0 top-14 z-40 border-b bg-background/95 shadow-sm backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
              <PullStateBadge pr={pr} />
              <span className="min-w-0 truncate text-sm font-semibold">{pr.title}</span>
              <span className="shrink-0 text-sm text-muted-foreground">#{pr.number}</span>
            </div>
          </div>,
          document.body,
        )}

      {/* ③ 下方左右栏：主列 tab 内容 + 右 metadata（官方 gutter-condensed 分型） */}
      <PageLayout
        gap="sm"
        right={{
          node: (
            <PullMetadataSidebar
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              authorLogin={pr.user.login}
              reviewSummary={reviewSummary ?? null}
              reviewSummaryLoading={reviewSummary === undefined}
              onRequestReviewers={async (logins) => {
                if (!token) return;
                await requestReviewersSmart(
                  owner!,
                  repo!,
                  Number(number),
                  logins,
                  token,
                  reviewSummary?.pullRequestId,
                );
                setReviewSummary(
                  (prev) =>
                    prev && {
                      ...prev,
                      reviewRequests: [
                        ...prev.reviewRequests,
                        ...logins.map((l) => ({ login: l, avatarUrl: "" })),
                      ],
                    },
                );
              }}
              assignees={pr.assignees ?? []}
              labels={pr.labels ?? []}
              milestone={pr.milestone ?? null}
              locked={pr.locked ?? false}
              pullRequestId={reviewSummary?.pullRequestId}
              prBody={pr.body ?? ""}
              onPrBodyChange={(body) => setPr((p) => (p ? { ...p, body } : p))}
              participants={participants}
              subscribed={subscribed}
              subscribing={subscribing}
              onToggleSubscribe={toggleSubscribe}
              onAssigneesChange={(users) => setPr((p) => (p ? { ...p, assignees: users } : p))}
              onLabelsChange={(labels) => setPr((p) => (p ? { ...p, labels } : p))}
              onMilestoneChange={(m) => setPr((p) => (p ? { ...p, milestone: m } : p))}
              onLockedChange={(locked) => setPr((p) => (p ? { ...p, locked } : p))}
            />
          ),
          width: 280,
          sticky: "nav",
          // stuck 时固定精简头（覆盖 56-112px）盖住侧栏顶 → 侧栏锚点下移至精简头下方
          // （!important 覆盖 SIDEBAR_STICKY 的 md:top-20；120px = topbar 56 + 精简头 56 + 8px 间隔）
          className: cn(stuck && "md:!top-[120px]"),
        }}
      >
        <div className="space-y-4">
          {/* Conversation：作者正文 + 时间线（失败降级：评审列表 + 评论区） */}
          {tab === "conversation" && (
            <div className="mt-4 space-y-4">
              {pr.body && (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-3 border-b pb-3 text-xs text-muted-foreground">
                      <UserAvatar src={pr.user.avatar_url} alt={pr.user.login} className="size-8" />
                      <span className="flex flex-wrap items-center gap-x-1.5">
                        <Link
                          to={`/${pr.user.login}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {pr.user.login}
                        </Link>
                        <span>
                          {pr.merged_at ? "merged" : pr.state === "open" ? "opened" : "closed"}{" "}
                          {fmt ? fmt(pr.merged_at ?? pr.created_at) : ""}
                        </span>
                      </span>
                    </div>
                    <div className="">
                      <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{pr.body}</MarkdownView>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 时间线（GraphQL timelineItems 事件混排；null=失败降级回退下方三段式） */}
              {timeline !== null && timeline !== undefined ? (
                <>
                  <PullTimeline
                    events={timeline}
                    owner={owner!}
                    repo={repo!}
                    prAuthor={pr.user?.login ?? null}
                    hasMore={timelineHasMore}
                    loadingMore={timelineLoadingMore}
                    onLoadMore={() => void loadMoreTimeline()}
                  />
                  {/* 评论区仅保留编辑器（评论列表已在时间线内；新评论即时追加到时间线） */}
                  {comments && (
                    <CommentsSection
                      owner={owner!}
                      repo={repo!}
                      number={Number(number)}
                      comments={[]}
                      onCommentAdded={appendTimelineComment}
                    />
                  )}
                </>
              ) : (
                <>
                  {/* 评审摘要：已提交的 review（approve/request changes/comment，官方 Conversation 顺序） */}
                  {reviewSummary && reviewSummary.reviews.length > 0 && (
                    <div className="space-y-3">
                      {reviewSummary.reviews.map((r) => {
                        const isMyReview =
                          r.user?.login?.toLowerCase() === user?.login?.toLowerCase();
                        return (
                          <Card key={r.id}>
                            <CardContent className="space-y-2 p-4">
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <UserAvatar
                                  src={r.user?.avatar_url}
                                  alt={r.user?.login ?? "ghost"}
                                  className="size-7"
                                />
                                <span className="flex flex-wrap items-center gap-x-1.5">
                                  <Link
                                    to={`/${r.user?.login ?? ""}`}
                                    className="font-medium text-foreground hover:underline"
                                  >
                                    {copilotDisplayName(r.user?.login ?? "ghost")}
                                  </Link>
                                  <span>
                                    {r.state === "APPROVED"
                                      ? t("timeline.approved")
                                      : r.state === "CHANGES_REQUESTED"
                                        ? t("timeline.requestedChanges")
                                        : t("timeline.proposed")}
                                    {r.submitted_at ? ` · ${fmt ? fmt(r.submitted_at) : ""}` : ""}
                                  </span>
                                </span>
                                <ReviewStateBadge state={r.state} />
                                {r.state === "PENDING" && showOps && isMyReview && (
                                  <span className="ml-auto flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-muted-foreground"
                                      onClick={() => {
                                        setEditReviewTarget(r);
                                        setEditReviewBody(r.body ?? "");
                                      }}
                                    >
                                      <Pencil className="size-3.5" />
                                      {t("review.editPending")}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                      onClick={() => setDeleteReviewTarget(r)}
                                    >
                                      <Trash2 className="size-3.5" />
                                      {t("review.deletePending")}
                                    </Button>
                                  </span>
                                )}
                                {showOps && r.state !== "DISMISSED" && r.state !== "PENDING" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      setDismissTarget(r);
                                      setDismissMessage("");
                                    }}
                                  >
                                    {t("pullDetail.dismiss")}
                                  </Button>
                                )}
                              </div>
                              {r.body && (
                                <div className="text-sm">
                                  <MarkdownView rawBase={repoRawBase(owner!, repo!)}>
                                    {r.body}
                                  </MarkdownView>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                  {comments && (
                    <CommentsSection
                      owner={owner!}
                      repo={repo!}
                      number={Number(number)}
                      comments={comments}
                      onCommentAdded={(c) => setComments((prev) => [...(prev ?? []), c])}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Commits：commit 列表（hash + 消息 + 作者 + 时间） */}
          {tab === "commits" && (
            <div className="mt-4 space-y-2">
              {commits === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : commits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("pullDetail.noCommits")}
                </p>
              ) : (
                commits.map((c) => (
                  <Card key={c.sha}>
                    <CardContent className="flex items-start gap-3 p-4">
                      <UserAvatar
                        src={c.author?.avatar_url}
                        alt={c.author?.login ?? "unknown"}
                        className="size-8"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium wrap-break-word">
                          {c.commit.message.split("\n")[0]}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {copilotDisplayName(c.author?.login ?? c.commit.author.name)} ·{" "}
                          {fmt ? fmt(c.commit.author.date) : ""}
                        </p>
                      </div>
                      <code className="shrink-0 font-mono text-xs text-muted-foreground">
                        {c.sha.slice(0, 7)}
                      </code>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Checks：check-runs 汇总 + 状态 + 关联 workflow run */}
          {tab === "checks" && (
            <div className="mt-4 space-y-3">
              {checks === undefined ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  {checks !== null && (
                    <Card>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center gap-2">
                          <ChecksBadge summary={checks} />
                          <span className="text-sm text-muted-foreground">
                            {t("pullDetail.checkRunCount", { count: checks.total })}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("pullDetail.checkSummary", {
                            success: checks.success,
                            failure: checks.failure,
                            pending: checks.pending,
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {checkRunList && checkRunList.length > 0 && (
                    <Card>
                      <CardContent className="divide-y p-0">
                        {checkRunList.map((run, i) => (
                          <CheckRunRow key={`${run.name}-${i}`} run={run} />
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  {workflowRuns && workflowRuns.length > 0 && (
                    <Card>
                      <div className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                        {t("pullDetail.workflowRuns")}
                      </div>
                      <CardContent className="divide-y p-0">
                        {workflowRuns.map((run) => (
                          <WorkflowRunRow
                            key={run.id}
                            run={run}
                            owner={owner!}
                            repo={repo!}
                            fmt={fmt ?? ((s: string) => s)}
                          />
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  {checks === null &&
                    (!checkRunList || checkRunList.length === 0) &&
                    (!workflowRuns || workflowRuns.length === 0) && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {t("pullDetail.noCheckRun")}
                      </p>
                    )}
                </>
              )}
            </div>
          )}

          {/* Files changed：diff 视图（分页加载，每次 5 个 + 加载更多） */}
          {tab === "files" && (
            <div className="mt-4">
              {files === null ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <DiffView
                    files={files.items}
                    owner={owner}
                    repo={repo}
                    number={Number(number)}
                    baseSha={pr.base?.sha}
                    headSha={pr.head?.sha}
                    onCommentAdded={() => void refreshTimeline()}
                  />
                  {files.hasMore && (
                    <div className="flex justify-center pt-1">
                      <Button variant="outline" onClick={loadMoreFiles} disabled={filesLoadingMore}>
                        {filesLoadingMore ? t("common.loading") : t("pullDetail.loadMoreFiles")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </PageLayout>

      {/* 驳回评审确认（输入理由） */}
      <AlertDialog
        open={dismissTarget !== null}
        onOpenChange={(open) => !open && setDismissTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pullDetail.dismissTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pullDetail.dismissDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Textarea
              value={dismissMessage}
              onChange={(e) => setDismissMessage(e.target.value)}
              rows={3}
              placeholder={t("pullDetail.dismissPlaceholder")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void handleDismiss()}
              disabled={dismissSubmitting || !dismissMessage.trim()}
            >
              {dismissSubmitting ? t("common.loading") : t("pullDetail.dismiss")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 编辑 pending 评审草稿 */}
      <Dialog
        open={editReviewTarget !== null}
        onOpenChange={(open) => !open && setEditReviewTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("review.editPendingTitle")}</DialogTitle>
            <DialogDescription>{t("review.editPendingDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={editReviewBody}
            onChange={(e) => setEditReviewBody(e.target.value)}
            rows={4}
            placeholder={t("review.placeHolder")}
          />
          <DialogFooter>
            <Button
              disabled={editReviewBusy || !editReviewBody.trim()}
              onClick={() => void handleEditReview()}
            >
              {editReviewBusy ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除 pending 评审草稿（确认） */}
      <AlertDialog
        open={deleteReviewTarget !== null}
        onOpenChange={(open) => !open && setDeleteReviewTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("review.deletePendingTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("review.deletePendingDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void handleDeleteReview()}
              disabled={deleteReviewBusy}
            >
              {deleteReviewBusy ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
