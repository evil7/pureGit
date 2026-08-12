import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  CircleX,
  FileDiff,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  MessageSquare,
  Minus,
  Plus,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/Pager";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useI18n } from "@/i18n";
import {
  fetchPullsSmart,
  setIssueSubscriptionSmart,
  fetchPullDetailWithCommentsSmart,
  fetchPullReviewSummarySmart,
  fetchPullTimelineSmart,
  requestReviewersSmart,
  updatePullRequestStateSmart,
} from "@/lib/api";
import {
  apiErrorMessage,
  fetchPullCheckRuns,
  fetchPullCommits,
  fetchPullFiles,
  normalizeApiError,
  ApiError,
  type CheckRunsSummary,
  type PullCommit,
} from "@/lib/rest";
import type { PullRequest, IssueComment, PullFile } from "@/lib/rest";
import type { PullReviewSummary, PullTimelineEvent } from "@/lib/api";
import { CommentsSection } from "@/components/CommentsSection";
import { PullTimeline } from "@/components/PullTimeline";
import { MarkdownView } from "@/components/MarkdownView";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { repoRawBase } from "@/lib/repo-raw";
import { UserAvatar } from "@/components/UserAvatar";
import { DiffView } from "@/components/DiffView";
import {
  ReviewersSidebar,
  ReviewChangesDialog,
  MergePanel,
  ReviewStateBadge,
} from "@/components/PullReviewPanel";
import { COPILOT_AVATAR, isCopilotLogin } from "@/lib/copilot";
import { PullMetadataSidebar } from "@/components/PullMetadataSidebar";
import { getLabelStyle } from "@/lib/label-color";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { useDateFormat } from "@/hooks/useDateFormat";
import PageLayout from "@/components/PageLayout";
import { toastError, toastSuccess } from "@/lib/toast";

type PullState = "open" | "closed" | "all";

export default function PullsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL query 驱动（官方风格）：state / author / labels / q / sort
  const state = (searchParams.get("state") as PullState) ?? "open";
  const author = searchParams.get("author") ?? "";
  const labels = searchParams.get("labels") ?? "";
  const q = searchParams.get("q") ?? "";
  // 页码分页（URL 驱动，可分享）
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInput = q;

  // 更新 URL query
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = {
      author: author || undefined,
      labels: labels || undefined,
      q: q || undefined,
    };
    fetchPullsSmart(owner!, repo!, state, token, filters, page)
      .then(({ items, openCount: openCountRes, closedCount: closedCountRes }) => {
        if (!cancelled) {
          setPulls(items);
          setOpenCount(openCountRes);
          setClosedCount(closedCountRes);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e, "加载失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, state, token, author, labels, q, page]);

  /** 页码分页：无过滤时按官方计数计算总页数（过滤态无总数，不渲染分页器） */
  const baseTotal =
    openCount != null && closedCount != null
      ? state === "open"
        ? openCount
        : state === "closed"
          ? closedCount
          : openCount + closedCount
      : null;
  const totalPages =
    baseTotal != null && !author && !labels && !q ? Math.max(1, Math.ceil(baseTotal / 30)) : 1;
  const goPage = (p: number) => {
    updateParams({ page: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4">
      {/* 搜索 + 过滤工具条（官方 is:pr is:open 预填；New pull request 最右） */}
      <div className="flex flex-wrap items-center gap-2">
        <RepoSearchInput
          defaultValue={searchInput}
          placeholder={`is:pr is:${state}`}
          onSubmit={(raw) => updateParams({ q: raw || null })}
          className="min-w-0 flex-1"
        />
        <Select value={author} onValueChange={(v) => updateParams({ author: v || null })}>
          <SelectTrigger className="h-8 w-auto min-w-24 text-xs">
            <User className="size-3.5" />
            <SelectValue placeholder="作者" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="@me">作者 @me</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={q ? "search" : "newest"}
          onValueChange={(v) => updateParams({ sort: v === "newest" ? null : v })}
        >
          <SelectTrigger className="h-8 w-auto min-w-24 text-xs">
            <SlidersHorizontal className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">最新</SelectItem>
            <SelectItem value="comments">评论最多</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" className="h-8" asChild>
            <Link to={`/${owner}/${repo}/pulls/new`}>
              <Plus className="size-4" />
              New pull request
            </Link>
          </Button>
        </div>
      </div>

      {/* Open/Closed 计数 tab（Link 形式，URL 驱动） */}
      <div className="flex items-center gap-1 border-b">
        <Link
          to={`/${owner}/${repo}/pulls?state=open`}
          onClick={(e) => {
            e.preventDefault();
            updateParams({ state: "open" });
          }}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
            state === "open"
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <GitPullRequest className="size-4" />
          Open
          {openCount !== null && (
            <span className="text-xs text-muted-foreground">{formatCount(openCount)}</span>
          )}
        </Link>
        <Link
          to={`/${owner}/${repo}/pulls?state=closed`}
          onClick={(e) => {
            e.preventDefault();
            updateParams({ state: "closed" });
          }}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
            state === "closed"
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <CheckCircle2 className="size-4" />
          Closed
          {closedCount !== null && (
            <span className="text-xs text-muted-foreground">{formatCount(closedCount)}</span>
          )}
        </Link>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && <InlineError message={error} />}

      {!loading && !error && (
        <div className="space-y-3">
          {pulls.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.prs")}</p>
          ) : (
            pulls.map((pr) => <PullRow key={pr.id} pr={pr} owner={owner!} repo={repo!} fmt={fmt} />)
          )}
          {/* 页码分页（每页 30；仅 >1 页时渲染） */}
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={goPage} />}
        </div>
      )}
    </div>
  );
}

/** CI checks 徽标（绿=全过 / 黄=pending / 红=失败；官方 N/M checks OK） */
function ChecksBadge({ summary }: { summary: CheckRunsSummary }) {
  const failed = summary.failure > 0;
  const pending = !failed && summary.pending > 0;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
        failed
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : pending
            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
            : "bg-green-500/10 text-green-600 dark:text-green-400",
      )}
    >
      {failed ? (
        <CircleX className="size-3" />
      ) : pending ? (
        <CircleDashed className="size-3" />
      ) : (
        <CheckCircle2 className="size-3" />
      )}
      {summary.success}/{summary.total} checks OK
    </span>
  );
}

function PullStateBadge({ pr }: { pr: PullRequest }) {
  if (pr.state === "closed" && pr.merged_at) {
    return (
      <Badge className="bg-chart-3 text-white text-xs">
        <GitMerge className="size-3" />
        merged
      </Badge>
    );
  }
  if (pr.state === "open") {
    return (
      <Badge className="bg-chart-1 text-white text-xs">
        <GitPullRequest className="size-3" />
        open
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      closed
    </Badge>
  );
}

export function PullRow({
  pr,
  owner,
  repo,
  fmt,
}: {
  pr: PullRequest;
  owner: string;
  repo: string;
  fmt: (iso: string) => string;
}) {
  const { token } = useAuth();
  const isDark = useIsDark();
  const [checks, setChecks] = useState<CheckRunsSummary | null>(null);

  // check-runs 懒加载（仅 open PR 且 head.sha 存在）
  useEffect(() => {
    if (pr.state !== "open" || !pr.head?.sha) return;
    let cancelled = false;
    fetchPullCheckRuns(owner, repo, pr.head.sha, token)
      .then((s) => !cancelled && setChecks(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, pr.state, pr.head?.sha, token]);

  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* 状态图标：open=绿 / merged=紫 / closed=灰 / draft=边框（官方） */}
              {pr.draft ? (
                <GitPullRequestDraft className="size-4 shrink-0 text-muted-foreground" />
              ) : pr.state === "open" ? (
                <GitPullRequest className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : pr.merged_at ? (
                <GitMerge className="size-4 shrink-0 text-purple-600 dark:text-purple-400" />
              ) : (
                <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
              )}
              <Link
                to={`/${owner}/${repo}/pulls/${pr.number}`}
                className="min-w-0 text-primary hover:underline line-clamp-2"
              >
                {pr.title}
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {/* CI checks（官方 N/M checks OK） */}
              {checks && <ChecksBadge summary={checks} />}
              {/* Draft 徽标 */}
              {pr.draft && (
                <Badge variant="outline" className="text-[11px]">
                  Draft
                </Badge>
              )}
              {/* labels */}
              {pr.labels && pr.labels.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  {pr.labels.slice(0, 3).map((l) => (
                    <Badge
                      key={l.name}
                      className="rounded-full text-[11px] font-medium"
                      style={getLabelStyle(l.color, isDark)}
                    >
                      {l.name}
                    </Badge>
                  ))}
                </span>
              )}
              {/* 元信息：#号 · opened by 作者 · 时间（fmt） */}
              <span className="flex items-center gap-1">
                #{pr.number} · opened by{" "}
                <Link
                  to={`/${pr.user.login}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {pr.user.login}
                </Link>{" "}
                {fmt(pr.created_at)}
              </span>
              {/* 分支 */}
              {pr.base && (
                <span className="flex items-center gap-1">
                  <GitBranch className="size-3.5" />
                  {pr.base.ref} ← {pr.head?.ref}
                </span>
              )}
            </div>
          </div>
          {/* 右列：assignee 头像 + 评论数 */}
          <div className="flex shrink-0 items-center gap-2">
            {pr.assignees && pr.assignees.length > 0 && (
              <span className="flex items-center -space-x-1.5">
                {pr.assignees.slice(0, 3).map((a) => (
                  <UserAvatar
                    key={a.login}
                    src={a.avatar_url}
                    alt={a.login}
                    title={a.login}
                    className="size-5 ring-1 ring-border"
                  />
                ))}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="size-3.5" />
              {pr.comments}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PullDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [files, setFiles] = useState<PullFile[] | null>(null);
  const [commits, setCommits] = useState<PullCommit[] | null>(null);
  const [checks, setChecks] = useState<CheckRunsSummary | null | undefined>(undefined); // undefined=加载中 null=无checks
  const [reviewSummary, setReviewSummary] = useState<PullReviewSummary | null | undefined>(
    undefined,
  );
  // 时间线（GraphQL timelineItems；null=查询失败降级回退三段式渲染）
  const [timeline, setTimeline] = useState<PullTimelineEvent[] | null | undefined>(undefined);
  const [tab, setTab] = useState<"conversation" | "commits" | "checks" | "files">("conversation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPullDetailWithCommentsSmart(owner!, repo!, Number(number), token),
      token
        ? fetchPullReviewSummarySmart(owner!, repo!, Number(number), token)
        : Promise.resolve(null),
      token ? fetchPullTimelineSmart(owner!, repo!, Number(number), token) : Promise.resolve(null),
    ])
      .then(([{ pr: data, comments: cs }, summary, tl]) => {
        if (!cancelled) {
          setPr(data);
          setComments(cs);
          setReviewSummary(summary);
          setTimeline(tl);
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
    fetchPullCommits(owner!, repo!, Number(number), token)
      .then((list) => !cancelled && setCommits(list))
      .catch(() => !cancelled && setCommits([]));
    return () => {
      cancelled = true;
    };
  }, [tab, commits, owner, repo, number, token]);

  // Checks：切到该 tab 时懒加载（open PR 且 head.sha 存在）
  useEffect(() => {
    if (tab !== "checks" || checks !== undefined || !pr?.head?.sha) return;
    let cancelled = false;
    fetchPullCheckRuns(owner!, repo!, pr.head.sha, token)
      .then((s) => !cancelled && setChecks(s ?? null))
      .catch(() => !cancelled && setChecks(null));
    return () => {
      cancelled = true;
    };
  }, [tab, checks, pr?.head?.sha, owner, repo, token]);

  // Files changed：切到该 tab 时懒加载
  useEffect(() => {
    if (tab !== "files" || files !== null) return;
    let cancelled = false;
    fetchPullFiles(owner!, repo!, Number(number), token)
      .then((list) => !cancelled && setFiles(list))
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [tab, files, owner, repo, number, token]);

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
              createdAt: c.created_at,
              body: c.body ?? "",
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

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        right={{
          node: (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（PR 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !pr) throw error ?? new ApiError(404);

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
    /* 官方 F 型：主列 + 右 metadata（PageLayout 收编 GRID_2COL_ASIDE_280） */
    <PageLayout
      gap="sm"
      right={{
        node: (
          <aside className="space-y-5 text-sm">
            {/* 审计者（官方 Reviewers metadata 第一位；+邀请审计 弹窗） */}
            <ReviewersSidebar
              owner={owner!}
              repo={repo!}
              authorLogin={pr.user.login}
              summary={reviewSummary ?? null}
              loading={reviewSummary === undefined}
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
            />

            {/* Assignees / Labels / Projects / Milestone / Development / participants / 底部订阅+锁定（官方 metadata 第二位起） */}
            <PullMetadataSidebar
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              assignees={pr.assignees ?? []}
              labels={pr.labels ?? []}
              milestone={pr.milestone ?? null}
              locked={pr.locked ?? false}
              pullRequestId={reviewSummary?.pullRequestId}
              participants={participants}
              subscribed={subscribed}
              subscribing={subscribing}
              onToggleSubscribe={toggleSubscribe}
              onAssigneesChange={(users) => setPr((p) => (p ? { ...p, assignees: users } : p))}
              onLabelsChange={(labels) => setPr((p) => (p ? { ...p, labels } : p))}
              onMilestoneChange={(m) => setPr((p) => (p ? { ...p, milestone: m } : p))}
              onLockedChange={(locked) => setPr((p) => (p ? { ...p, locked } : p))}
            />
          </aside>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      {/* 主列 */}
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link to={`/${owner}/${repo}/pulls`}>
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>

        {/* Header：标题 + #号 + 状态 + 分支信息（官方 wants to merge N commits into base from head） */}
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 flex-1 text-2xl font-bold wrap-break-word">{pr.title}</h1>
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
              {pr.changed_files} 文件
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
              {pr.comments} 评论
            </Badge>
          </div>
        </header>

        {/* 评审操作区：Merge + Review changes + 关闭/重新打开（open PR 且有权限时） */}
        {(pr.state === "open" || pr.merged_at) && (
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
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await updatePullRequestStateSmart(
                          owner!,
                          repo!,
                          Number(number),
                          "closed",
                          token,
                        );
                        setPr((p) => (p ? { ...p, state: "closed" } : p));
                        toastSuccess("已关闭 PR");
                      } catch (e) {
                        toastError(apiErrorMessage(e, "关闭失败"));
                      }
                    }}
                  >
                    <CircleX className="size-3.5" />
                    关闭
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 四 tab（官方 Conversation / Commits / Checks / Files changed） */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-4">
          <TabsList>
            <TabsTrigger value="conversation">
              <MessageSquare className="size-3.5" />
              Conversation
              {comments && <span className="text-muted-foreground">{comments.length}</span>}
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
              {files && <span className="text-muted-foreground">{files.length}</span>}
            </TabsTrigger>
          </TabsList>

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
                  <PullTimeline events={timeline} owner={owner!} repo={repo!} />
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
                      {reviewSummary.reviews.map((r) => (
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
                                  {r.user?.login ?? "ghost"}
                                </Link>
                                <span>
                                  {r.state === "APPROVED"
                                    ? "批准了这些更改"
                                    : r.state === "CHANGES_REQUESTED"
                                      ? "请求更改"
                                      : "评论了"}
                                  {r.submitted_at ? ` · ${fmt ? fmt(r.submitted_at) : ""}` : ""}
                                </span>
                              </span>
                              <ReviewStateBadge state={r.state} />
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
                      ))}
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
                <p className="py-8 text-center text-sm text-muted-foreground">暂无 commit</p>
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
                          {c.author?.login ?? c.commit.author.name} ·{" "}
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

          {/* Checks：check-runs 汇总 + 状态 */}
          {tab === "checks" && (
            <div className="mt-4 space-y-3">
              {checks === undefined ? (
                <Skeleton className="h-24 w-full" />
              ) : checks === null ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  该 commit 无 check-run
                </p>
              ) : (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <ChecksBadge summary={checks} />
                      <span className="text-sm text-muted-foreground">
                        {checks.total} 个 check-run
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {checks.success} 通过 · {checks.failure} 失败 · {checks.pending} 进行中
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Files changed：diff 视图 */}
          {tab === "files" && (
            <div className="mt-4">
              {files === null ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <DiffView
                  files={files}
                  owner={owner}
                  repo={repo}
                  number={Number(number)}
                  baseSha={pr.base?.sha}
                  headSha={pr.head?.sha}
                />
              )}
            </div>
          )}
        </Tabs>
      </div>
    </PageLayout>
  );
}
