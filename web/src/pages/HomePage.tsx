/**
 * 首页 Dashboard（动态 Feed + 热点）
 *
 * 仿 GitHub 官方登录后首页三栏骨架（去掉非必要内容）：
 * - 左栏（lg 显示，移动端折叠到中栏下方）：账户切换器（用户 + 组织）+ Top 仓库（新建/查找/Show more）
 * - 中栏：Home 标题 + Tab（动态默认 / 热点），动态 = 好友动态 Feed（Events API），热点 = 今日/本周/本月
 * - 右栏：去掉（官方 changelog 属非核心，化简）
 * - 匿名：仅显示热点（动态需登录态）
 * - Tab 路由：`?feed`（无值，仅区分路由到动态 tab）→ 动态；`?hot=day|week|month` → 热点
 * - 动态 Feed 无类型过滤：received_events API 无官方过滤选项，前端只全量列出 + 加载更多
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  Star,
  GitFork,
  GitCommitHorizontal,
  GitBranch,
  Tag,
  Info,
  TrendingUp,
  Inbox,
  MessageSquare,
  CircleDot,
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/Tip";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { InlineStarButton } from "@/components/InlineStarButton";
import { InlineError } from "@/components/InlineError";
import { LangDot } from "@/components/LangDot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WriteGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat, formatDate } from "@/hooks/useDateFormat";
import {
  fetchTrendingRepositoriesSmart,
  fetchMyReposSmart,
  fetchRepositorySmart,
  fetchReceivedEvents,
  scheduleFeedPr,
  scheduleFeedCommit,
  forkRepositorySmart,
  apiErrorMessage,
  type Repository,
  type ReceivedEvent,
} from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/ui/toast";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { useI18n, tStatic } from "@/i18n";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";

const PERIODS: SegmentedOption<"day" | "week" | "month">[] = [
  { value: "day", label: tStatic("home.today") },
  { value: "week", label: tStatic("home.week") },
  { value: "month", label: tStatic("home.month") },
];

/** 每页条数（Feed 卡片宽 → 10 条；热点行窄 → 10 条；翻页式搜索每页重新请求，per_page 不再贪大防详情放大） */
const FEED_PAGE_SIZE = 10;
const TRENDING_PAGE_SIZE = 10;

/**
 * 通用翻页器 → 已提取为共享组件 `@/components/Pager`（核心页统一复用）
 */

export default function HomePage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL 驱动 tab 路由：`?feed`（无值，仅区分路由到动态 tab）；`?hot=day|week|month` → 热点+周期
  const hasFeed = searchParams.has("feed");
  const hotRaw = searchParams.get("hot");
  const defaultTab: "feed" | "trending" = token ? "feed" : "trending";
  const tab: "feed" | "trending" = hasFeed ? "feed" : hotRaw ? "trending" : defaultTab;
  // 周期：显式 URL 参数优先；未登录无参数默认「今日」（今日是热点首页默认 用户要求）
  const days =
    hotRaw === "day" ? 1 : hotRaw === "month" ? 30 : hotRaw === "week" ? 7 : token ? 7 : 1;
  const hotKey = (d: number): "day" | "week" | "month" =>
    d === 1 ? "day" : d === 30 ? "month" : "week";
  const switchTab = (next: "feed" | "trending") => {
    // 动态 tab → `?feed`（无值，仅路由标记）；热点 tab → 默认进入今日（day）
    if (next === "feed") setSearchParams("feed");
    else setSearchParams({ hot: "day" });
  };

  /** 动态/热点 tab 按钮 */
  const feedTabBtn = (
    <button
      type="button"
      onClick={() => switchTab("feed")}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
        tab === "feed"
          ? "border-foreground font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Inbox className="size-4" />
      {t("home.feed")}
    </button>
  );
  const trendingTabBtn = (
    <button
      type="button"
      onClick={() => switchTab("trending")}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
        tab === "trending"
          ? "border-foreground font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <TrendingUp className="size-4" />
      {t("home.trending")}
    </button>
  );

  return (
    // 布局规范：PAGE_SHELL 统一外层（仅顶部 padding）；PageLayout H 型左栏（tool sticky）
    <div className={PAGE_SHELL}>
      {/* 左栏仅登录态传入（登出收敛单列）；移动端 hidden 折叠到下方 */}
      <PageLayout
        gap="md"
        left={
          token
            ? {
                node: <SidebarContent />,
                width: 300,
                sticky: "tool",
                breakpoint: "lg",
                className: "hidden lg:block",
              }
            : undefined
        }
      >
        {/* 中栏 */}
        <main className="min-w-0">
          {/* Tab 横线：左 tab 按钮 + 右周期切换（去首页标题） */}
          <div className="mb-4 flex items-end justify-between border-b">
            <div className="flex gap-1">
              {token && feedTabBtn}
              {trendingTabBtn}
            </div>

            {/* 横线最右（官方同排）：热点→周期切换；动态无过滤（API 无官方类型过滤选项，全量列出） */}
            {tab === "trending" && (
              <SegmentedControl
                variant="tab"
                options={PERIODS}
                value={hotKey(days)}
                onValueChange={(k) => setSearchParams({ hot: k })}
                className="pb-1.5"
              />
            )}
          </div>

          {tab === "feed" ? <FeedSection /> : <TrendingSection days={days} />}
        </main>
      </PageLayout>

      {/* 移动端左栏（折叠到中栏下方，官方 hide-lg 模式） */}
      {token && (
        <div className="mt-8 space-y-6 lg:hidden">
          <SidebarContent />
        </div>
      )}
    </div>
  );
}

// ===== 左栏：Top 仓库（用户要求：去掉切换卡片，仅保留 Top 仓库）=====
// 官方 API 数量限制核查：REST /user/repos per_page 上限 100；GraphQL viewer.repositories first 上限 100
// → 单次请求的完整列表 = 100 条（按最近更新排序 = 官方「最近操作过的项目」）。一次拉满直接全部渲染
// （无折叠/显示更多）；超过 100 条 → 显示「全部仓库」链接引导到设置页（完整列表走专门页，首页不无限续接）
function SidebarContent() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchMyReposSmart(token)
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        setHasMore(r.hasNextPage);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  return (
    <div className="space-y-4">
      {/* Top 仓库 */}
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Top 仓库</h3>
          <WriteGate>
            <Tip label="新建仓库">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="新建仓库"
                onClick={() => navigate("/new")}
              >
                <Plus className="size-4" />
              </Button>
            </Tip>
          </WriteGate>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="查找仓库…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        {repos === null ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">无匹配仓库</p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((r, i) => (
              /* 加载完成后逐项交错入场（与 Feed/热点一致的列表增长动画） */
              <li
                key={r.id}
                className="list-item-enter"
                style={{ animationDelay: `${Math.min(i * 50, 350)}ms` }}
              >
                <Link
                  to={`/${r.full_name}`}
                  className="block truncate rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  title={r.full_name}
                >
                  {r.full_name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {/* 超过单次请求上限（100 条）→ 引导全部仓库（首页不无限续接） */}
        {repos && hasMore && (
          <Link
            to="/settings/repositories"
            className="mt-1 block px-1.5 text-xs text-primary hover:underline"
          >
            全部仓库
          </Link>
        )}
      </div>
    </div>
  );
}

// ===== 中栏：动态 Feed（好友动态，Events API）=====
// received_events 无官方类型过滤选项 → 全量列出 + 分页加载更多（不做前端伪过滤）

/** 动态 Feed：加载更多（瀑布流 append）——按 API 页递增拉取**全部**事件（无类型过滤）。
 * - 每批不足一页（<FEED_PAGE_SIZE）→ 视为末页 endReached（隐藏加载更多）
 * - received_events 只保留最近 300 条：拉到上限后 422 → 已有数据时静默视为末页（不当作加载失败）
 * 逻辑极简：单一直线请求方向 + append，无过滤/重发竞态 */
function FeedSection() {
  const { token, user } = useAuth();
  const [allEvents, setAllEvents] = useState<ReceivedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endReached, setEndReached] = useState(false);
  // API 页码（下一页从上次结束位置续拉）
  const apiPageRef = useRef(1);
  // 已有数据标记（422 静默末页判定：从未拉到数据时 422 才显示加载失败）
  const hasDataRef = useRef(false);
  const loadingRef = useRef(false);

  // 加载更多（初始批次 + 点击追加共用）
  const loadMore = useCallback(async () => {
    if (!token || !user?.login || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const batch = await fetchReceivedEvents(
        user.login,
        token,
        FEED_PAGE_SIZE,
        apiPageRef.current,
      );
      apiPageRef.current += 1;
      if (batch.length > 0) hasDataRef.current = true;
      setEndReached(batch.length < FEED_PAGE_SIZE);
      setAllEvents((prev) => [...prev, ...batch]);
    } catch (e) {
      if (hasDataRef.current) setEndReached(true);
      else setError(apiErrorMessage(e, "动态加载失败"));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [token, user?.login]);

  // 首次挂载加载（无类型切换：仅一次）
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  if (loading && allEvents.length === 0) {
    return (
      /* 骨架屏：按真实 FeedCard 尺寸精确占位（10 条 · 间隔 12px · 卡片高 ~187px） */
      <div className="space-y-3">
        {Array.from({ length: FEED_PAGE_SIZE }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card">
            {/* 标题行：头像 40px + 动作文字 20px + 时间 16px（p-4 pb-3，时间 mt-0.5 与真实一致） */}
            <div className="flex gap-3 p-4 pb-3">
              <div className="relative shrink-0">
                <Skeleton className="size-10 rounded-full" />
                <span className="absolute -bottom-1 -right-1 size-4 rounded-full ring-2 ring-card">
                  <Skeleton className="size-4 rounded-full" />
                </span>
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <Skeleton className="h-5 w-2/3" />
                <div className="mt-0.5">
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            </div>
            {/* 仓库体：头像 24px + 链接 20px + Star 28px / 描述 20px / 元信息 16px（p-3，mt-1.5 与真实一致） */}
            <div className="px-4 pb-4">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Skeleton className="size-6 shrink-0 rounded" />
                    <Skeleton className="h-5 w-1/2" />
                  </div>
                  <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
                </div>
                <div className="mt-1.5">
                  <Skeleton className="h-5 w-full" />
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-10" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && allEvents.length === 0) {
    return <InlineError message={error} />;
  }

  if (allEvents.length === 0) {
    return (
      <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {tStatic("empty.noResults")}
      </p>
    );
  }

  return (
    <div>
      <div className="space-y-3">
        {allEvents.map((ev, i) => (
          /* 逐项交错入场（list-item-enter + delay） */
          <div
            key={ev.id}
            className="list-item-enter"
            style={{ animationDelay: `${Math.min(i * 60, 480)}ms` }}
          >
            <FeedCard ev={ev} />
          </div>
        ))}
      </div>
      {/* 加载更多：瀑布流 append；endReached（探测到末页）后隐藏 */}
      {!loading && error && <InlineError message={error} />}
      <LoadMoreButton
        loading={loading}
        endReached={endReached}
        onClick={() => void loadMore()}
        className="mt-4"
      />
    </div>
  );
}

/** 事件 → 图标/配色/动作文案（官方 feed 语义） */
function feedMeta(ev: ReceivedEvent) {
  switch (ev.type) {
    case "WatchEvent":
      return {
        icon: <Star className="size-2.5" fill="currentColor" />,
        bg: "bg-amber-500",
        text: "starred a repository",
      };
    case "ForkEvent":
      return {
        icon: <GitFork className="size-2.5" />,
        bg: "bg-sky-500",
        text: "forked a repository",
      };
    case "PushEvent":
      return {
        icon: <GitCommitHorizontal className="size-2.5" />,
        bg: "bg-emerald-500",
        text: "pushed to",
      };
    case "CreateEvent":
      return {
        icon: <GitBranch className="size-2.5" />,
        bg: "bg-violet-500",
        text: `created ${ev.payload?.ref_type ?? "ref"}${
          ev.payload?.ref ? ` ${ev.payload.ref}` : ""
        } in`,
      };
    case "ReleaseEvent":
      return {
        icon: <Tag className="size-2.5" />,
        bg: "bg-green-600",
        text: "released",
      };
    case "IssueCommentEvent":
    case "PullRequestReviewEvent":
    case "PullRequestReviewCommentEvent":
    case "CommitCommentEvent":
      return {
        icon: <MessageSquare className="size-2.5" />,
        bg: "bg-blue-500",
        text: "commented on",
      };
    case "IssuesEvent":
      return {
        icon: <CircleDot className="size-2.5" />,
        bg: "bg-red-500",
        text: `${ev.payload?.action ?? "updated"} issue in`,
      };
    case "PullRequestEvent":
      return {
        icon: <GitPullRequest className="size-2.5" />,
        bg: "bg-purple-500",
        text: `${ev.payload?.action ?? "updated"} PR in`,
      };
    default:
      return {
        icon: <Info className="size-2.5" />,
        bg: "bg-muted-foreground",
        text: "updated",
      };
  }
}

function FeedCard({ ev }: { ev: ReceivedEvent }) {
  const { token } = useAuth();
  const { format, fmt } = useDateFormat();
  const meta = feedMeta(ev);
  const repoName = ev.repo.name;
  return (
    <div className="rounded-lg border bg-card">
      {/* 标题行：头像 + 事件图标角标 + 动作文案（官方 feed 结构） */}
      <div className="flex gap-3 p-4 pb-3">
        <div className="relative shrink-0">
          <Avatar className="size-10">
            <AvatarImage src={ev.actor.avatar_url} alt={ev.actor.login} />
            <AvatarFallback>{ev.actor.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full text-white ring-2 ring-card",
              meta.bg,
            )}
          >
            {meta.icon}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          {/* 动作文案行：单行截断（长仓库名/动作不换行撑高卡片） */}
          <p className="truncate text-sm text-muted-foreground">
            <Link to={`/${ev.actor.login}`} className="font-medium text-foreground hover:underline">
              {ev.actor.login}
            </Link>{" "}
            {meta.text}{" "}
            <Link
              to={`/${repoName}`}
              className="font-medium text-foreground hover:underline"
              title={repoName}
            >
              {repoName}
            </Link>
          </p>
          {/* 时间行：按偏好格式——absolute 双显（绝对·相对，样式随语言）；relative 单显相对 */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format === "relative"
              ? fmt(ev.created_at)
              : `${fmt(ev.created_at)} · ${formatDate(ev.created_at, "relative")}`}
          </p>
          {ev.type === "CreateEvent" && ev.payload?.description ? (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {ev.payload.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* 内容区：按事件类型差异化（push 提交摘要 / release / issue / PR / 评论正文；无 payload 回退仓库体） */}
      <div className="px-4 pb-4">
        <FeedContent ev={ev} token={token} />
      </div>
    </div>
  );
}

/** Feed 内容区：push/pr/issue/评论 → 统一 PRs 列表单行式行卡（可点击跳转）；release/其余 → 仓库体卡片 */
function FeedContent({ ev, token }: { ev: ReceivedEvent; token: string | null }) {
  const repoName = ev.repo.name;
  // push / PR / issue / 评论（含 commit 行内评论）→ 统一行卡（参考官方 PRs 列表单行结构，按 feed 返回取舍）
  const isActionRow =
    ev.type === "PushEvent" ||
    ev.type === "PullRequestEvent" ||
    ev.type === "IssuesEvent" ||
    ev.type === "IssueCommentEvent" ||
    ev.type === "PullRequestReviewEvent" ||
    ev.type === "PullRequestReviewCommentEvent" ||
    ev.type === "CommitCommentEvent";
  if (isActionRow) return <FeedActionRow ev={ev} />;
  // release：仓库体 + 版本摘要；其余（star/fork 等）：仓库体
  if (ev.type === "ReleaseEvent" && ev.payload?.release) {
    return <FeedRepoCard fullName={repoName} token={token} desc={<ReleaseDesc ev={ev} />} />;
  }
  return <FeedRepoCard fullName={repoName} token={token} />;
}

/** PR 详情补拉结果（覆盖 feed payload 缺失字段；数据来自 api-feed-batch 批量调度） */
interface FeedPrDetail {
  title: string;
  state: string;
  merged: boolean;
  comments: number;
  baseRef: string;
  headRef: string;
  headOwner: string | null;
}

/**
 * 统一行动行卡（参考官方 PRs 列表单行结构，按 feed 接口返回取舍）：
 * [状态 icon] [title（点击跳转）] [meta：#n · state / ref · shas / file:line] [右列：comments 计数]
 */
function FeedActionRow({ ev }: { ev: ReceivedEvent }) {
  const { token } = useAuth();
  const repoName = ev.repo.name;
  const [owner, repo] = repoName.split("/");
  // PR 类事件 payload 缺 title/state（实测仅 url/id/number）→ 挂载时异步补拉 PR 详情（合并态/标题/评论数/分支）
  const prNumber = ev.payload?.pull_request?.number;
  const [prDetail, setPrDetail] = useState<FeedPrDetail | null>(null);
  // push 事件补拉 head commit message（desc 行展示；payload 无 commits 列表）
  const headSha = ev.payload?.head;
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  useEffect(() => {
    if (ev.type !== "PushEvent" || !headSha || !token) return;
    let cancelled = false;
    // 批量调度（同帧合并 1 次 GraphQL 请求，模块级缓存）；null 降级 = 不显示 commit 行
    scheduleFeedCommit(owner, repo, headSha, token).then((m) => {
      if (!cancelled && m) setCommitMsg(m);
    });
    return () => {
      cancelled = true;
    };
  }, [ev.type, owner, repo, headSha, token]);

  useEffect(() => {
    // PR 类事件统一补拉（PullRequestEvent/ReviewEvent 缺 title；ReviewCommentEvent 有 title 但需分支 badge）
    if (!prNumber || !token) return;
    let cancelled = false;
    scheduleFeedPr(owner, repo, prNumber, token).then((pr) => {
      if (cancelled || !pr) return;
      setPrDetail({
        title: pr.title,
        state: pr.state,
        merged: Boolean(pr.mergedAt),
        comments: pr.comments,
        baseRef: pr.baseRefName,
        headRef: pr.headRefName,
        headOwner: pr.headOwner,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, prNumber, token]);

  const c = useMemo(
    () => actionRowContent(ev, owner, repo, prDetail, commitMsg),
    [ev, owner, repo, prDetail, commitMsg],
  );
  if (!c) return null;
  const title = c.title || repoName;
  return (
    <div className="group flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          {c.isExternal ? (
            <a
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="line-clamp-1 truncate font-medium text-foreground transition-colors hover:text-primary hover:underline"
              title={title}
            >
              {title}
            </a>
          ) : (
            <Link
              to={c.href}
              className="line-clamp-1 truncate font-medium text-foreground transition-colors hover:text-primary hover:underline"
              title={title}
            >
              {title}
            </Link>
          )}
        </div>
        {c.meta.length > 0 && (
          /* meta 行：单行（truncate，超长省略；多段用 · 分隔）；分支/状态段为 badge */
          <div className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {c.meta.map((m, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="shrink-0">·</span>}
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
      {c.right !== null && (
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {formatCount(c.right)}
          </span>
        </div>
      )}
    </div>
  );
}

/** 状态色常量（PR/issue/评论通用：open 绿 / closed·merged 紫） */
const FEED_GREEN = "text-[#1a7f37] dark:text-[#3fb950]";
const FEED_PURPLE = "text-[#8250df] dark:text-[#a371f7]";

/** meta 行内 badge：icon + 文字（分支标签 / 状态 badge）；border + font-mono 截断，对齐 GitHub 标签风格 */
function FeedBadge({
  children,
  icon,
  title,
  className,
}: {
  children: ReactNode;
  /** 前置小图标（状态 badge：合并/拒绝/推送等专属 icon） */
  icon?: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-40 shrink-0 items-center gap-0.5 overflow-hidden rounded border border-border bg-background px-1 py-px font-mono text-[11px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** 各事件 → 行卡内容（标题/跳转/元信息/右列；行首无独立 icon——状态以 meta 行专属 badge 呈现） */
function actionRowContent(
  ev: ReceivedEvent,
  owner: string,
  repo: string,
  prDetail: FeedPrDetail | null,
  commitMsg: string | null,
): {
  title: string;
  href: string;
  isExternal: boolean;
  meta: ReactNode[];
  right: number | null;
} | null {
  const repoBase = `/${owner}/${repo}`;
  switch (ev.type) {
    // ===== PR 统一卡（PullRequestEvent / PullRequestReviewEvent / PullRequestReviewCommentEvent）=====
    // title
    //      [icon 状态] # 123 · (base) ← (head)   ← 状态 badge 前置（合并/拒绝/待确认），fork PR head 显 owner:branch
    case "PullRequestEvent":
    case "PullRequestReviewEvent":
    case "PullRequestReviewCommentEvent": {
      const pr = ev.payload?.pull_request;
      if (!pr) return null;
      const merged = prDetail?.merged ?? pr.merged;
      const closed = prDetail?.state === "closed" || pr.state === "closed";
      const title = prDetail?.title ?? pr.title ?? (pr.number ? `PR #${pr.number}` : "PR");
      // 状态 badge：合并 → GitMerge+已合并(紫)；关闭未合并 → GitPullRequestClosed+已拒绝(紫)；打开 → GitPullRequest+待确认(绿)
      const stateBadge =
        merged || closed ? (
          <FeedBadge
            icon={
              merged ? <GitMerge className="size-3" /> : <GitPullRequestClosed className="size-3" />
            }
            className={FEED_PURPLE}
          >
            {merged ? tStatic("feed.state.merged") : tStatic("feed.state.rejected")}
          </FeedBadge>
        ) : (
          <FeedBadge icon={<GitPullRequest className="size-3" />} className={FEED_GREEN}>
            {tStatic("feed.state.pending")}
          </FeedBadge>
        );
      // 来源分支：base ← head（head 合入 base）；fork PR（headOwner ≠ 本仓库）head 带 owner 前缀
      const branchBadge =
        prDetail && (prDetail.baseRef || prDetail.headRef)
          ? (() => {
              const headLabel =
                prDetail.headOwner && prDetail.headOwner !== owner
                  ? `${prDetail.headOwner}:${prDetail.headRef}`
                  : prDetail.headRef;
              return (
                <span className="flex min-w-0 items-center gap-1">
                  <FeedBadge title={prDetail.baseRef}>{prDetail.baseRef || "?"}</FeedBadge>
                  <span className="shrink-0 text-muted-foreground">←</span>
                  <FeedBadge title={headLabel}>{headLabel || "?"}</FeedBadge>
                </span>
              );
            })()
          : null;
      const meta: ReactNode[] = [stateBadge];
      if (pr.number) meta.push(`#${pr.number}`);
      if (branchBadge) meta.push(branchBadge);
      return {
        title,
        href: pr.number ? `${repoBase}/pull/${pr.number}` : (pr.html_url ?? "#"),
        isExternal: !pr.number,
        meta,
        right: prDetail?.comments ?? pr.comments ?? null,
      };
    }
    case "PushEvent": {
      // received_events 的 PushEvent 无 commits 列表（仅 ref/head/before）→
      // 标题行 = head commit message（补拉 messageHeadline，降级 `update: ${ref}`）；
      // meta 行 = [icon 已推送] (ref | before7) → (ref | head7)
      if (!ev.payload?.ref && !ev.payload?.head) return null;
      const ref = ev.payload.ref?.replace("refs/heads/", "") ?? "HEAD";
      const head = ev.payload.head ?? "";
      const before = ev.payload.before ?? "";
      const range = (
        <span className="flex min-w-0 items-center gap-1">
          <FeedBadge title={`${ref} ${before}`}>
            {`${ref} ${before ? before.slice(0, 7) : "0000000"}`}
          </FeedBadge>
          <span className="shrink-0 text-muted-foreground">→</span>
          <FeedBadge title={`${ref} ${head}`}>{`${ref} ${head.slice(0, 7)}`}</FeedBadge>
        </span>
      );
      return {
        title: commitMsg ?? `update: ${ref}`,
        href: head
          ? `https://github.com/${owner}/${repo}/commit/${head}`
          : `${repoBase}/commits/${ref}`,
        isExternal: Boolean(head),
        meta: [
          <FeedBadge
            key="pushed"
            icon={<GitCommitHorizontal className="size-3" />}
            className={FEED_GREEN}
          >
            {tStatic("feed.state.pushed")}
          </FeedBadge>,
          range,
        ],
        right: null,
      };
    }
    case "IssuesEvent": {
      const issue = ev.payload?.issue;
      if (!issue) return null;
      const closed = issue.state === "closed";
      return {
        title: issue.title ?? (issue.number ? `#${issue.number}` : ""),
        href: issue.number ? `${repoBase}/issues/${issue.number}` : (issue.html_url ?? "#"),
        isExternal: !issue.number,
        meta: [
          // 状态 badge：打开 → CircleDot+新问题(绿)；关闭 → CircleDot+已关闭(紫)
          <FeedBadge
            key="state"
            icon={<CircleDot className="size-3" />}
            className={closed ? FEED_PURPLE : FEED_GREEN}
          >
            {closed ? tStatic("feed.state.closed") : tStatic("feed.state.opened")}
          </FeedBadge>,
          issue.number ? `#${issue.number}` : "",
          ev.payload?.action ?? "",
        ].filter(Boolean),
        right: issue.comments ?? null,
      };
    }
    case "IssueCommentEvent": {
      const issue = ev.payload?.issue;
      if (!issue) return null;
      const closed = issue.state === "closed";
      return {
        title: issue.title ?? (issue.number ? `#${issue.number}` : ""),
        href: issue.number ? `${repoBase}/issues/${issue.number}` : (issue.html_url ?? "#"),
        isExternal: !issue.number,
        meta: [
          <FeedBadge
            key="state"
            icon={<CircleDot className="size-3" />}
            className={closed ? FEED_PURPLE : FEED_GREEN}
          >
            {closed ? tStatic("feed.state.closed") : tStatic("feed.state.opened")}
          </FeedBadge>,
          issue.number ? `#${issue.number}` : "",
        ].filter(Boolean),
        right: issue.comments ?? null,
      };
    }
    case "CommitCommentEvent": {
      // commit 行内评论：无 issue/PR/title → 降级 commit short_sha；站内无 commit 页 → 外链
      const sha = ev.payload?.commit_id ?? "";
      const loc = ev.payload?.comment?.path;
      const line = ev.payload?.comment?.line;
      return {
        title: sha ? `commit ${sha.slice(0, 7)}` : "commit",
        href: ev.payload?.comment?.html_url ?? `https://github.com/${owner}/${repo}/commit/${sha}`,
        isExternal: true,
        meta: [loc ? `${loc}${line ? `:${line}` : ""}` : ""].filter(Boolean),
        right: null,
      };
    }
    default:
      return null;
  }
}

/** Release desc：版本号 + 正文预览（line-clamp-2） */
function ReleaseDesc({ ev }: { ev: ReceivedEvent }) {
  const rel = ev.payload?.release;
  if (!rel) return null;
  const body = rel.body?.trim() ?? "";
  return (
    <div className="text-sm text-muted-foreground">
      <a
        href={rel.html_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground hover:underline"
      >
        {rel.tag_name ?? rel.name ?? ev.repo.name}
      </a>
      {body && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap wrap-break-word">{body}</p>}
    </div>
  );
}

/**
 * 官方 feed「仓库体」：owner/repo + 元信息（语言 · forks）+ Star / Fork 按钮。
 * desc 行按事件类型差异化：默认仓库描述；push/release/issue/pr/comment 传入各自摘要节点。
 * - 元数据经 fetchRepositorySmart 获取（GraphQL 首选），模块级缓存避免同仓库重复请求
 * - Star 用仓库查询自带的 viewer_has_starred 初始态；切换经 setStarredSmart（GraphQL 首选）
 * - Fork 经 forkRepositorySmart（REST POST /forks；GraphQL 无 mutation），成功后跳转 fork 仓库
 */
const feedRepoCache = new Map<string, Promise<Repository | null>>();
function fetchFeedRepo(fullName: string, token: string | null): Promise<Repository | null> {
  const key = token ? `a:${fullName}` : `n:${fullName}`;
  let p = feedRepoCache.get(key);
  if (!p) {
    const [owner, repo] = fullName.split("/");
    p = fetchRepositorySmart(owner, repo, token)
      .then((r) => r.data)
      .catch(() => null);
    feedRepoCache.set(key, p);
  }
  return p;
}

function FeedRepoCard({
  fullName,
  token,
  desc,
}: {
  fullName: string;
  token: string | null;
  /** 差异化 desc 行（事件类型摘要）；缺省 → 仓库描述 */
  desc?: ReactNode;
}) {
  const { t } = useI18n();
  const [repo, setRepo] = useState<Repository | null | undefined>(undefined);
  const [forkBusy, setForkBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepo(undefined);
    fetchFeedRepo(fullName, token).then((r) => {
      if (cancelled) return;
      setRepo(r);
    });
    return () => {
      cancelled = true;
    };
  }, [fullName, token]);

  // Fork（真实写操作）：REST POST /forks → 跳转 fork 后的仓库
  const doFork = async () => {
    if (!token) return;
    setForkBusy(true);
    try {
      const [forkOwner, forkRepo] = fullName.split("/");
      const forkedName = await forkRepositorySmart(token, forkOwner, forkRepo);
      toastSuccess(t("feed.forked"), forkedName);
      window.open(`/${forkedName}`, "_blank", "noopener");
    } catch {
      toastError(t("feed.forkFailed"));
    } finally {
      setForkBusy(false);
    }
  };

  if (repo === undefined) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Skeleton className="size-6 shrink-0 rounded" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="h-7 w-16 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    );
  }
  if (!repo) return null;

  const [owner] = fullName.split("/");
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      {/* 首行：仓库头像 + 链接 + Star / Fork */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="size-6 rounded">
            <AvatarImage src={repo.owner.avatar_url} alt={owner} />
            <AvatarFallback>{owner.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <Link
            to={`/${fullName}`}
            className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
          >
            {fullName}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <InlineStarButton
            fullName={fullName}
            initialStarred={repo.viewer_has_starred}
            initialCount={repo.stargazers_count}
          />
          <Tip label={t("feed.fork")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => void doFork()}
              disabled={forkBusy}
            >
              {forkBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitFork className="size-3.5" />
              )}
            </Button>
          </Tip>
        </div>
      </div>

      {/* desc 行：差异化摘要（push/release/issue/pr/comment）或仓库描述 */}
      {desc ??
        (repo.description && (
          <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">{repo.description}</p>
        ))}

      {/* 元信息：语言 · forks（stars 已在按钮内；单行截断，不换行撑高） */}
      <div className="mt-1.5 flex min-w-0 items-center gap-x-3 truncate text-xs text-muted-foreground">
        {repo.language && (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <LangDot lang={repo.language} />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-1 whitespace-nowrap">
          <GitFork className="size-3" />
          {formatCount(repo.forks_count)}
        </span>
      </div>
    </div>
  );
}

// ===== 中栏：热点（今日/本周/本月，复用搜索模拟）=====

/**
 * 热点行（官方 /trending 单列风格）：排名 + 仓库链接 + 描述 + 元信息行 + Star。
 * 排名前 3 金色强调，其余 muted。
 */
function TrendingCard({ repo, rank }: { repo: Repository; rank: number }) {
  const { fmt } = useDateFormat();
  return (
    <div className="flex items-start gap-3 py-3">
      {/* 排名（官方 trending 左侧序号） */}
      <span
        className={cn(
          "w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums",
          rank <= 3 ? "text-amber-500" : "text-muted-foreground",
        )}
      >
        {rank}.
      </span>
      <div className="min-w-0 flex-1">
        {/* 首行：仓库链接 + Star */}
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/${repo.full_name}`}
            className="min-w-0 truncate text-sm font-semibold text-primary hover:underline"
          >
            {repo.full_name}
          </Link>
          <InlineStarButton
            fullName={repo.full_name}
            initialStarred={repo.viewer_has_starred}
            initialCount={repo.stargazers_count}
          />
        </div>

        {repo.description && (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{repo.description}</p>
        )}

        {/* 元信息行：语言 · stars · forks · 更新时间（官方 trending 底部行） */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {repo.language && (
            <span className="flex items-center gap-1">
              <LangDot lang={repo.language} />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Star className="size-3" />
            {formatCount(repo.stargazers_count)}
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <GitFork className="size-3" />
            {formatCount(repo.forks_count)}
          </span>
          <span className="whitespace-nowrap">Updated {fmt(repo.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

/** 热点：加载更多（瀑布流 append）——按当前周期从 search 页码逐页追加；
 * 空页/不足一页 → endReached（隐藏加载更多）。周期变化重置重载。
 * 逻辑简化：单一请求方向（page++ 追加），无页码跳转/回退/竞态等旧分页 bug */
function TrendingSection({ days }: { days: number }) {
  const { token } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endReached, setEndReached] = useState(false);
  // search 页码（下一页）；周期变化重置为 1
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  // 周期/重试变化 → 重置并重新加载
  useEffect(() => {
    pageRef.current = 1;
    setEndReached(false);
    setRepos([]);
    setError(null);
    setLoading(true);
  }, [days, reloadKey]);

  // 加载更多（初始批次 + 点击追加共用）
  const loadMore = useCallback(async () => {
    if (!token || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const items = await fetchTrendingRepositoriesSmart(
        days,
        TRENDING_PAGE_SIZE,
        token,
        pageRef.current,
      );
      pageRef.current++;
      // 不足一页 = 末页（search 分页语义）
      setEndReached(items.length < TRENDING_PAGE_SIZE);
      setRepos((prev) => [...prev, ...items]);
    } catch (e) {
      setError(apiErrorMessage(e, "加载失败"));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [token, days]);

  // 初始加载
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  return (
    <div>
      {loading && repos.length === 0 && !error && (
        /* 骨架屏：按真实热点行尺寸精确占位（10 行 · border-b 分隔 · 行高 ~97px） */
        <div className="rounded-lg border bg-card px-4">
          {Array.from({ length: TRENDING_PAGE_SIZE }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 border-b py-3 last:border-b-0">
              {/* 排名 16px */}
              <Skeleton className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                {/* 首行：链接 20px + Star 按钮 28px */}
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
                </div>
                {/* 描述 20px（mt-1 与真实一致） */}
                <div className="mt-1">
                  <Skeleton className="h-5 w-full" />
                </div>
                {/* 元信息 16px（mt-1 与真实一致） */}
                <div className="mt-1 flex items-center gap-3">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-8" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && repos.length === 0 && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <InlineError message={error} className="flex-1" />
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </Button>
        </div>
      )}

      {repos.length > 0 && (
        <>
          <div className="divide-y rounded-lg border bg-card px-4">
            {repos.map((repo, i) => (
              /* 逐项交错入场（官方 trending 分隔线列表），瀑布流追加 */
              <div
                key={repo.id}
                className="list-item-enter"
                style={{
                  animationDelay: `${Math.min(i * 60, 480)}ms`,
                }}
              >
                <TrendingCard repo={repo} rank={i + 1} />
              </div>
            ))}
          </div>
          {/* 加载更多：瀑布流 append；endReached（探测到末页）后隐藏 */}
          {error && <InlineError message={error} className="mt-4" />}
          <LoadMoreButton
            loading={loading}
            endReached={endReached}
            onClick={() => void loadMore()}
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}
