import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  BellRing,
  CheckCircle2,
  CircleDot,
  Link2,
  MessageSquare,
  Milestone,
  Plus,
  SlidersHorizontal,
  User,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/Pager";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useI18n, tStatic } from "@/i18n";
import {
  fetchIssuesSmart,
  setIssueSubscriptionSmart,
  fetchIssueDetailWithCommentsSmart,
  updateIssueStateSmart,
} from "@/lib/api";
import { apiErrorMessage, fetchIssueSubscription, normalizeApiError, ApiError } from "@/lib/rest";
import type { Issue, IssueComment } from "@/lib/rest";
import { CommentsSection } from "@/components/CommentsSection";
import { MarkdownView } from "@/components/MarkdownView";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { repoRawBase } from "@/lib/repo-raw";
import { STATE_BADGE_SOLID } from "@/lib/state-colors";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { getLabelStyle } from "@/lib/label-color";
import PageLayout from "@/components/PageLayout";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toastSuccess, toastError } from "@/lib/toast";

type IssueState = "open" | "closed" | "all";

/** 左栏过滤器（官方 Issue filters，URL query 驱动，可分享） */
const FILTERS: {
  key: string;
  labelKey:
    | "issues.all"
    | "issues.assigned"
    | "issues.created"
    | "issues.mentioned"
    | "issues.recent";
  query: string;
}[] = [
  { key: "all", labelKey: "issues.all", query: "" },
  { key: "assigned", labelKey: "issues.assigned", query: "assignee=@me" },
  { key: "created", labelKey: "issues.created", query: "author=@me" },
  { key: "mentioned", labelKey: "issues.mentioned", query: "q=mentions:@me" },
  { key: "recent", labelKey: "issues.recent", query: "sort=updated" },
];

export default function IssuesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL query 驱动（官方风格）：state / author / assignee / labels / sort / q / filter
  const state = (searchParams.get("state") as IssueState) ?? "open";
  const filterKey = searchParams.get("filter") ?? "all";
  const author = searchParams.get("author") ?? "";
  const assignee = searchParams.get("assignee") ?? "";
  const labels = searchParams.get("labels") ?? "";
  const sort = searchParams.get("sort") ?? "created";
  const q = searchParams.get("q") ?? "";
  // 页码分页（URL 驱动，可分享）
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const [issues, setIssues] = useState<Issue[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInput = q;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = {
      author: author || undefined,
      assignee: assignee || undefined,
      labels: labels || undefined,
      sort: sort !== "created" ? sort : undefined,
      q: q || undefined,
    };
    fetchIssuesSmart(owner!, repo!, state, token, filters, undefined, page)
      .then(({ items, openCount: openCountRes, closedCount: closedCountRes }) => {
        if (!cancelled) {
          setIssues(items);
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
  }, [owner, repo, state, token, author, assignee, labels, sort, q, page]);

  // 更新 URL query（官方风格，可分享）
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

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
    baseTotal != null && !author && !assignee && !labels && !q && sort === "created"
      ? Math.max(1, Math.ceil(baseTotal / 30))
      : 1;
  const goPage = (p: number) => {
    updateParams({ page: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    /* 官方 C 型：左 filters + 右列表（PageLayout 收编 GRID_2COL_260） */
    <PageLayout
      gap="md"
      left={{
        node: (
          <nav className="flex flex-col gap-1">
            <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("issues.filters")}
            </h3>
            {FILTERS.map(({ key, labelKey, query }) => {
              const isActive =
                filterKey === key ||
                (key === "assigned" && assignee === "@me" && !author && !q && !sort) ||
                (key === "created" && author === "@me" && !assignee && !q && !sort) ||
                (key === "mentioned" &&
                  q.includes("mentions:@me") &&
                  !author &&
                  !assignee &&
                  !sort) ||
                (key === "recent" && sort === "updated" && !author && !assignee && !q);
              return (
                <Link
                  key={key}
                  to={`/${owner}/${repo}/issues?${query}${query ? "&" : ""}state=${state}`}
                  onClick={(e) => {
                    e.preventDefault();
                    // 解析该 filter 的 query 参数，应用到 URL（其余过滤参数清空）
                    const patch: Record<string, string | null> = {
                      filter: key,
                      author: null,
                      assignee: null,
                      labels: null,
                      q: null,
                      sort: null,
                    };
                    for (const pair of query.split("&").filter(Boolean)) {
                      const [k, v] = pair.split("=");
                      patch[k] = decodeURIComponent(v);
                    }
                    updateParams(patch);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <CircleDot className="size-4 shrink-0" />
                  {t(labelKey)}
                </Link>
              );
            })}
            {(author || assignee || labels || q || sort !== "created") && (
              <button
                type="button"
                onClick={() =>
                  updateParams({
                    author: null,
                    assignee: null,
                    labels: null,
                    q: null,
                    sort: null,
                    filter: "all",
                  })
                }
                className="mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
              >
                <X className="size-3.5" />
                {t("issues.clearFilters")}
              </button>
            )}
          </nav>
        ),
        width: 260,
        sticky: "nav",
      }}
    >
      {/* 右栏 */}
      <div className="space-y-3">
        {/* 标题行：计数 tab + New issue */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 border-b">
            <Link
              to={`/${owner}/${repo}/issues?state=open`}
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
              <CircleDot className="size-4" />
              Open
              {openCount !== null && (
                <span className="text-xs text-muted-foreground">{formatCount(openCount)}</span>
              )}
            </Link>
            <Link
              to={`/${owner}/${repo}/issues?state=closed`}
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
          <Button size="sm" asChild>
            <Link to={`/${owner}/${repo}/issues/new`}>
              <Plus className="size-4" />
              New issue
            </Link>
          </Button>
        </div>

        {/* 过滤工具条：搜索 + Author/Labels/Sort（官方风格） */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <RepoSearchInput
            defaultValue={searchInput}
            placeholder={t("issues.searchPlaceholder")}
            onSubmit={(raw) => updateParams({ q: raw || null })}
            className="min-w-0 flex-1"
          />
          <Select value={author} onValueChange={(v) => updateParams({ author: v || null })}>
            <SelectTrigger className="h-8 w-auto min-w-24 text-xs">
              <SelectValue placeholder={t("issues.author")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="@me">{t("issues.by")} @me</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => updateParams({ sort: v })}>
            <SelectTrigger className="h-8 w-auto min-w-24 text-xs">
              <SlidersHorizontal className="size-3.5" />
              <SelectValue placeholder={t("issues.sort")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">{t("issues.sort.newest")}</SelectItem>
              <SelectItem value="comments">{t("issues.sort.comments")}</SelectItem>
            </SelectContent>
          </Select>
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
            {issues.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.issues")}</p>
            ) : (
              issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} owner={owner!} repo={repo!} fmt={fmt} />
              ))
            )}
            {/* 页码分页（每页 30；仅 >1 页时渲染） */}
            {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={goPage} />}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export function IssueRow({
  issue,
  owner,
  repo,
  fmt,
}: {
  issue: Issue;
  owner: string;
  repo: string;
  fmt: (iso: string) => string;
}) {
  const isDark = useIsDark();
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <Link
            to={`/${owner}/${repo}/issues/${issue.number}`}
            className="min-w-0 text-primary hover:underline line-clamp-2"
          >
            {issue.title}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">#{issue.number}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {/* 状态图标（官方：open=绿圈/closed=紫叉）+ 作者 opened + 时间（fmt 日期格式偏好） */}
          <span className="flex items-center gap-1">
            {issue.state === "open" ? (
              <CircleDot className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
            ) : (
              <XCircle className="size-3.5 text-[#8250df] dark:text-[#a371f7]" />
            )}
          </span>
          <span>
            <Link
              to={`/${issue.user.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {issue.user.login}
            </Link>{" "}
            {issue.state === "closed" ? tStatic("issues.closed") : tStatic("issues.opened")}{" "}
            {fmt(issue.state === "closed" && issue.closed_at ? issue.closed_at : issue.created_at)}
          </span>
          {issue.labels && issue.labels.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {issue.labels.slice(0, 3).map((l) => (
                <Badge
                  key={l.name}
                  className="text-[11px] font-medium"
                  style={getLabelStyle(l.color, isDark)}
                >
                  {l.name}
                </Badge>
              ))}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {issue.comments}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function IssueDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token, canWrite } = useAuth();
  const isDark = useIsDark();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIssue(null);
    setComments(null);
    Promise.all([fetchIssueDetailWithCommentsSmart(owner!, repo!, Number(number), token)])
      .then(([{ issue: data, comments: cs }]) => {
        if (!cancelled) {
          setIssue(data);
          setComments(cs);
          // 订阅状态：GraphQL 优先（viewerSubscription），REST 降级时补查
          if (data.subscription) {
            setSubscribed(data.subscription !== "UNSUBSCRIBED");
          } else if (token) {
            fetchIssueSubscription(owner!, repo!, Number(number), token)
              .then((s) => !cancelled && setSubscribed(Boolean(s?.subscribed)))
              .catch(() => {});
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

  // 切换订阅（需登录；订阅不要求写权限；GraphQL 首选，REST 兜底）
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
      toastError(apiErrorMessage(e, t("issueDetail.subscribeFailed")));
    } finally {
      setSubscribing(false);
    }
  };

  // 关闭 / 重新打开（需 write 权限；关闭前 AlertDialog 确认）
  const updateState = async (state: "closed" | "open") => {
    if (!token) return;
    setClosing(true);
    try {
      const updated = await updateIssueStateSmart(owner!, repo!, Number(number), state, token);
      setIssue((prev) =>
        prev ? { ...prev, state: updated.state, closed_at: updated.closed_at } : prev,
      );
      setConfirmClose(false);
      toastSuccess(state === "closed" ? "Issue 已关闭" : "Issue 已重新打开");
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.stateFailed")));
    } finally {
      setClosing(false);
    }
  };

  // 复制链接（站内相对路径 + 官方 anchor）
  const copyLink = () => {
    const url = `${window.location.origin}/${owner}/${repo}/issues/${number}`;
    navigator.clipboard?.writeText(url).then(
      () => toastSuccess(t("issueDetail.copied")),
      () => undefined,
    );
  };

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        right={{
          node: (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
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
          <Skeleton className="h-40 w-full" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（issue 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !issue) throw error ?? new ApiError(404);

  // 参与者 = 作者 + 指派人 + 评论者（去重，官方同源聚合）
  const participants = Array.from(
    new Map(
      [issue.user, ...(issue.assignees ?? []), ...(comments ?? []).map((c) => c.user)]
        .filter((u) => u?.login)
        .map((u) => [u!.login, u!] as const),
    ).values(),
  );

  return (
    /* 官方 F 型：主列 + 右 metadata（PageLayout 收编 GRID_2COL_ASIDE_280） */
    <PageLayout
      gap="sm"
      right={{
        node: (
          <aside className="space-y-5 text-sm">
            {/* Assignees */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.assignees")}
              </h3>
              {issue.assignees && issue.assignees.length > 0 ? (
                <ul className="space-y-1.5">
                  {issue.assignees.map((a) => (
                    <li key={a.login} className="flex items-center gap-2">
                      <UserAvatar src={a.avatar_url} alt={a.login} />
                      <Link to={`/${a.login}`} className="text-sm text-foreground hover:underline">
                        {a.login}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("issueDetail.noAssignees")}</p>
              )}
            </section>

            {/* Labels */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.labels")}
              </h3>
              {issue.labels && issue.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {issue.labels.map((l) => (
                    <Badge
                      key={l.name}
                      className="text-[11px] font-medium"
                      style={getLabelStyle(l.color, isDark)}
                    >
                      {l.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">{t("issueDetail.noLabels")}</p>
              )}
            </section>

            {/* Milestone */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.milestone")}
              </h3>
              {issue.milestone ? (
                <span className="flex items-center gap-1.5">
                  <Milestone className="size-3.5 text-muted-foreground" />
                  {issue.milestone.title}
                </span>
              ) : (
                <p className="text-muted-foreground">{t("issueDetail.noMilestone")}</p>
              )}
            </section>

            {/* Notifications（订阅） */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("nav.notifications")}
              </h3>
              {token ? (
                <Button
                  variant={subscribed ? "default" : "outline"}
                  size="sm"
                  onClick={toggleSubscribe}
                  disabled={subscribing}
                >
                  {subscribed ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
                  {subscribing
                    ? "…"
                    : subscribed
                      ? t("issueDetail.unsubscribe")
                      : t("issueDetail.subscribe")}
                </Button>
              ) : (
                <p className="text-muted-foreground">{t("comments.loginToComment")}</p>
              )}
            </section>

            {/* Participants */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.participants")}
              </h3>
              {participants.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  {participants.slice(0, 8).map((u) => (
                    <UserAvatar
                      key={u.login}
                      src={u.avatar_url}
                      alt={u.login}
                      title={u.login}
                      className="size-6 ring-1 ring-border"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </section>
          </aside>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      {/* 主列 */}
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/${owner}/${repo}/issues`}>
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>

        <header className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 flex-1 text-2xl font-bold wrap-break-word">{issue.title}</h1>
            <span className="shrink-0 text-muted-foreground">#{issue.number}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={copyLink}
              title={t("issueDetail.copyLink")}
            >
              <Link2 className="size-4" />
            </Button>
          </div>

          {/* 状态徽标 + 作者 + 时间 + 评论数（官方：标题下方元信息行） */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={cn(
                "border-transparent text-xs",
                issue.state === "open" ? STATE_BADGE_SOLID.open : STATE_BADGE_SOLID["issue-closed"],
              )}
            >
              {issue.state === "open" ? "Open" : "Closed"}
            </Badge>
            <span className="flex items-center gap-1">
              <User className="size-3.5" />
              <Link
                to={`/${issue.user.login}`}
                className="font-medium text-foreground hover:underline"
              >
                {issue.user.login}
              </Link>
            </span>
            <span className="flex items-center gap-1">
              {issue.state === "open" ? "opened" : "closed"}{" "}
              {fmt
                ? fmt(
                    issue.state === "closed" && issue.closed_at
                      ? issue.closed_at
                      : issue.created_at,
                  )
                : ""}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {issue.comments} {t("issues.comments")}
            </span>
          </div>
        </header>

        {/* 主帖作者卡 + 正文（官方：作者卡在上，正文在下） */}
        <Card className="mt-4">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3 border-b pb-3 text-xs text-muted-foreground">
              <UserAvatar src={issue.user.avatar_url} alt={issue.user.login} className="size-8" />{" "}
              <span className="flex flex-wrap items-center gap-x-1.5">
                <Link
                  to={`/${issue.user.login}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {issue.user.login}
                </Link>
                <span>
                  {issue.state === "open" ? tStatic("issues.opened") : tStatic("issues.closed")}{" "}
                  {fmt(
                    issue.state === "closed" && issue.closed_at
                      ? issue.closed_at
                      : issue.created_at,
                  )}
                </span>
              </span>
            </div>
            {issue.body ? (
              <div className="">
                <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{issue.body}</MarkdownView>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description provided.</p>
            )}
          </CardContent>
        </Card>

        {/* 关闭 / 重新打开（需 write 权限） */}
        {canWrite && (
          <div className="mt-4 flex justify-end">
            {issue.state === "open" ? (
              <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={closing}>
                    <XCircle className="size-3.5" />
                    {t("issueDetail.close")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("issueDetail.closeConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("issueDetail.closeConfirmDesc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("issueDetail.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => updateState("closed")} disabled={closing}>
                      {t("issueDetail.close")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={closing}
                onClick={() => updateState("open")}
              >
                <CheckCircle2 className="size-3.5" />
                {t("issueDetail.reopen")}
              </Button>
            )}
          </div>
        )}

        {/* 评论区（官方风格：编号 + hover 操作 + 发表） */}
        {comments && (
          <div className="mt-4">
            <CommentsSection
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              comments={comments}
              onCommentAdded={(c) => setComments((prev) => [...(prev ?? []), c])}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
