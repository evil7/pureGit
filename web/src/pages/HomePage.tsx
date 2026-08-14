/**
 * 首页 Dashboard（动态 Feed + 热点）
 *
 * 仿 GitHub 官方登录后首页三栏骨架（去掉非必要内容）：
 * - 左栏（lg 显示，移动端折叠到中栏下方）：账户切换器（用户 + 组织）+ Top 仓库（新建/查找/Show more）
 * - 中栏：Home 标题 + Tab（动态默认 / 热点），动态 = 好友动态 Feed（Events API），热点 = 今日/本周/本月
 * - 右栏：去掉（官方 changelog 属非核心，化简）
 * - 匿名：仅显示热点（动态需登录态）
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/Tip";
import { Pager } from "@/components/Pager";
import { InlineStarButton } from "@/components/InlineStarButton";
import { InlineError } from "@/components/InlineError";
import { LangDot } from "@/components/LangDot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WriteGate } from "@/components/WriteGate";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat, formatDate } from "@/hooks/useDateFormat";
import {
  useFeedFilter,
  FEED_TYPES,
  parseFeedTypes,
  isAllFeedTypes,
  type FeedFilterType,
} from "@/hooks/useFeedFilter";
import {
  fetchTrendingRepositoriesSmart,
  fetchReceivedEvents,
  fetchMyReposSmart,
  fetchRepositorySmart,
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
import { useI18n, tStatic, type I18nKey } from "@/i18n";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";

const PERIODS: SegmentedOption<"day" | "week" | "month">[] = [
  { value: "day", label: tStatic("home.today") },
  { value: "week", label: tStatic("home.week") },
  { value: "month", label: tStatic("home.month") },
];

/** 每页条数（Feed 卡片宽 → 5 条；热点行窄 → 10 条） */
const FEED_PAGE_SIZE = 5;
const TRENDING_PAGE_SIZE = 10;

/**
 * 通用翻页器 → 已提取为共享组件 `@/components/Pager`（核心页统一复用）
 */

export default function HomePage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  // Feed 类型过滤：偏好 hook（默认全选）+ URL `?feed=` 覆盖（逗号分隔多选，可分享）
  const { types: prefTypes, setFilter: setPrefFilter } = useFeedFilter();
  const hasFeedParam = searchParams.has("feed");
  const urlTypes = useMemo(
    () => (hasFeedParam ? parseFeedTypes(searchParams.get("feed")) : null),
    [hasFeedParam, searchParams],
  );
  /** 生效勾选：URL 有 feed 参数 → URL 优先；否则偏好（默认全选） */
  const types = urlTypes ?? prefTypes;

  /** 勾选变化：更新偏好（持久默认）+ 同步 URL（replace，全选 → 删除参数） */
  const applyFeedTypes = (next: FeedFilterType[]) => {
    setPrefFilter(next);
    const params = new URLSearchParams(searchParams);
    if (isAllFeedTypes(next)) params.delete("feed");
    else params.set("feed", next.join(","));
    setSearchParams(params, { replace: true });
  };

  // URL 驱动（?feed → 动态；?hot=day|week|month → 热点+周期；无参数 → 登录动态/匿名热点）
  const hasFeed = searchParams.has("feed");
  const hotRaw = searchParams.get("hot");
  const tab: "feed" | "trending" = hasFeed
    ? "feed"
    : hotRaw
      ? "trending"
      : token
        ? "feed"
        : "trending";
  // 周期：显式 URL 参数优先；未登录无参数默认「今日」（今日是热点首页默认 用户要求）
  const days =
    hotRaw === "day" ? 1 : hotRaw === "month" ? 30 : hotRaw === "week" ? 7 : token ? 7 : 1;
  const hotKey = (d: number): "day" | "week" | "month" =>
    d === 1 ? "day" : d === 30 ? "month" : "week";
  const switchTab = (next: "feed" | "trending") => {
    if (next === "feed") setSearchParams("feed");
    // 点击热点 tab → 默认进入今日（day）
    else setSearchParams({ hot: "day" });
  };

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
          {/* Tab 横线：左 tab 按钮 + 右 Filter/周期切换（去首页标题） */}
          <div className="mb-4 flex items-end justify-between border-b">
            <div className="flex gap-1">
              {token && (
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
              )}
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
            </div>

            {/* 横线最右（官方同排）：热点→周期切换；动态→Feed 类型过滤（移入） */}
            {tab === "trending" ? (
              <SegmentedControl
                variant="tab"
                size="xs"
                options={PERIODS}
                value={hotKey(days)}
                onValueChange={(k) => setSearchParams({ hot: k })}
                className="pb-1.5"
              />
            ) : (
              token && <FeedTypeFilterDropdown types={types} onApply={applyFeedTypes} />
            )}
          </div>

          {tab === "feed" ? <FeedSection types={types} /> : <TrendingSection days={days} />}
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

/** Feed 类型过滤下拉（勾选式多选）：各类型 Checkbox；全选 = 全量勾选（默认），无独立「全部」项 */
const FEED_FILTER_LABEL_KEYS: Record<FeedFilterType, I18nKey> = {
  star: "feed.filter.star",
  fork: "feed.filter.fork",
  push: "feed.filter.push",
  comment: "feed.filter.comment",
  release: "feed.filter.release",
  issue: "feed.filter.issue",
  pr: "feed.filter.pr",
};

function FeedTypeFilterDropdown({
  types,
  onApply,
}: {
  types: FeedFilterType[];
  onApply: (next: FeedFilterType[]) => void;
}) {
  const all = isAllFeedTypes(types);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="mb-1 h-8 text-xs">
          <SlidersHorizontal className="size-3.5" />
          {tStatic("feed.filter.title")}
          {!all && (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-medium text-foreground">
              {types.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <div className="flex flex-col gap-0.5 p-1">
          {FEED_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
            >
              <Checkbox
                checked={all || types.includes(type)}
                onCheckedChange={(c) => {
                  const next = c
                    ? [...types.filter((x) => x !== type), type]
                    : types.filter((x) => x !== type);
                  onApply(next);
                }}
              />
              {tStatic(FEED_FILTER_LABEL_KEYS[type])}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ===== 左栏：Top 仓库（用户要求：去掉切换卡片，仅保留 Top 仓库）=====
// 真实加载更多——点「显示更多」原地展开 8→20→全部；单 API 拉满 100 条时
// 追加游标续接再展开（按最近更新排序 = 「最近操作过的项目」）
const TOP_REPO_STEPS = [8, 20];

function SidebarContent() {
  const { token } = useAuth();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [filter, setFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(8);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchMyReposSmart(token)
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        setEndCursor(r.endCursor);
        setHasNextPage(r.hasNextPage);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = filter.trim().toLowerCase();
    const list = q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
    return list.slice(0, visibleCount);
  }, [repos, filter, visibleCount]);

  /** 显示更多：先展开已加载（8→20→全部）；若还有下一页则 GraphQL 游标续接后展开 */
  const handleShowMore = async () => {
    if (!repos || !token) return;
    // 还有下一页（GraphQL 游标）→ 续接加载
    if (hasNextPage && endCursor) {
      setLoadingMore(true);
      try {
        const next = await fetchMyReposSmart(token, endCursor);
        // 追加去重（游标偏移场景防御）
        const seen = new Set(repos.map((r) => r.full_name));
        const merged = [...repos, ...next.repos.filter((r) => !seen.has(r.full_name))];
        setRepos(merged);
        setEndCursor(next.endCursor);
        setHasNextPage(next.hasNextPage);
        setVisibleCount((v) => Math.min(v + TOP_REPO_STEPS[0], merged.length));
      } catch {
        // 续接失败则退化为纯展开
        setVisibleCount((v) => Math.min(v + TOP_REPO_STEPS[0], repos.length));
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    // 纯展开：8 → 20 → 全部
    const step = TOP_REPO_STEPS.find((s) => s > visibleCount) ?? repos.length;
    setVisibleCount(Math.min(step, repos.length));
  };

  return (
    <div className="space-y-4">
      {/* Top 仓库 */}
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Top 仓库</h3>
          <WriteGate>
            <Tip label="新建仓库">
              <Button variant="ghost" size="icon" className="size-6">
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
        {repos && repos.length > visibleCount && (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto px-1.5 text-xs text-primary"
            onClick={handleShowMore}
            disabled={loadingMore}
          >
            {loadingMore ? "加载中…" : "显示更多"}
          </Button>
        )}
        {repos && visibleCount >= repos.length && repos.length > 8 && (
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

/** 事件类型 → Feed 过滤类型匹配（Events API 类型映射；comment 聚合三类评论事件） */
function eventMatchesType(ev: ReceivedEvent, t: FeedFilterType): boolean {
  switch (t) {
    case "star":
      return ev.type === "WatchEvent";
    case "fork":
      return ev.type === "ForkEvent";
    case "push":
      return ev.type === "PushEvent";
    case "comment":
      return (
        ev.type === "IssueCommentEvent" ||
        ev.type === "PullRequestReviewEvent" ||
        ev.type === "PullRequestReviewCommentEvent"
      );
    case "release":
      return ev.type === "ReleaseEvent";
    case "issue":
      return ev.type === "IssuesEvent";
    case "pr":
      return ev.type === "PullRequestEvent";
  }
}

function FeedSection({ types }: { types: FeedFilterType[] }) {
  const { token, user } = useAuth();
  const [events, setEvents] = useState<ReceivedEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // 过滤变化重置页码（Filter 下拉已上移 tabs 横线最右）
  useEffect(() => {
    setPage(1);
  }, [types]);

  useEffect(() => {
    if (!token || !user?.login) return;
    let cancelled = false;
    setEvents(null);
    setError(null);
    setPage(1);
    // 拉取更多（50 条）供本地分页，每页 10
    fetchReceivedEvents(user.login, token, 50)
      .then((es) => !cancelled && setEvents(es))
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e, "动态加载失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.login]);

  // 按事件类型过滤（前端，勾选集合；全选/全不选 = 全部显示）
  const filtered = useMemo(() => {
    if (!events) return null;
    if (isAllFeedTypes(types)) return events;
    return events.filter((ev) => types.some((t) => eventMatchesType(ev, t)));
  }, [events, types]);

  if (events === null && !error) {
    return (
      /* 骨架屏：按真实 FeedCard 尺寸精确占位（5 条 · 间隔 12px · 卡片高 ~187px） */
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

  if (error) {
    return <InlineError message={error} />;
  }

  if (!filtered?.length) {
    return (
      <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {isAllFeedTypes(types) ? tStatic("empty.feed") : tStatic("empty.noResults")}
      </p>
    );
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / FEED_PAGE_SIZE));
  const pageEvents = filtered.slice((page - 1) * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE);

  return (
    <div>
      <div className="space-y-3" key={page}>
        {pageEvents.map((ev, i) => (
          /* 逐项交错入场（list-item-enter + delay），翻页重置动画 */
          <div
            key={ev.id}
            className="list-item-enter"
            style={{ animationDelay: `${Math.min(i * 60, 480)}ms` }}
          >
            <FeedCard ev={ev} />
          </div>
        ))}
      </div>
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
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
          <p className="text-sm text-muted-foreground">
            <Link to={`/${ev.actor.login}`} className="font-medium text-foreground hover:underline">
              {ev.actor.login}
            </Link>{" "}
            {meta.text}{" "}
            <Link to={`/${repoName}`} className="font-medium text-foreground hover:underline">
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

/** Feed 内容区：统一仓库体卡片（owner/repo + Star/Fork + 语言·forks 元信息），仅 desc 行按事件类型差异化 */
function FeedContent({ ev, token }: { ev: ReceivedEvent; token: string | null }) {
  const repoName = ev.repo.name;
  // 评论动态：提取评论内容与所属 issue/PR（无正文时 desc 回退仓库描述）
  const isComment =
    ev.type === "IssueCommentEvent" ||
    ev.type === "PullRequestReviewEvent" ||
    ev.type === "PullRequestReviewCommentEvent";
  const commentBody =
    ev.type === "PullRequestReviewEvent"
      ? (ev.payload?.review?.body ?? "")
      : (ev.payload?.comment?.body ?? "");
  const commentSubject =
    ev.type === "IssueCommentEvent" && ev.payload?.issue
      ? {
          title: ev.payload.issue.title ?? "",
          url: ev.payload.issue.html_url ?? "",
          number: ev.payload.issue.number ?? 0,
        }
      : ev.payload?.pull_request
        ? {
            title: ev.payload.pull_request.title ?? "",
            url: ev.payload.pull_request.html_url ?? "",
            number: ev.payload.pull_request.number ?? 0,
          }
        : null;
  let desc: ReactNode = null;
  if (isComment && commentBody.trim().length > 0) {
    desc = <CommentDesc body={commentBody} subject={commentSubject} />;
  } else {
    switch (ev.type) {
      case "PushEvent":
        // received_events 的 PushEvent 无 commits 数组（仅 ref/head/before）→ 有分支/SHA 即显示 push 摘要
        if (ev.payload?.ref || ev.payload?.head) desc = <PushDesc ev={ev} />;
        break;
      case "ReleaseEvent":
        if (ev.payload?.release) desc = <ReleaseDesc ev={ev} />;
        break;
      case "IssuesEvent":
        if (ev.payload?.issue) desc = <IssueDesc ev={ev} />;
        break;
      case "PullRequestEvent":
        if (ev.payload?.pull_request) desc = <PullDesc ev={ev} />;
        break;
    }
  }
  return <FeedRepoCard fullName={repoName} token={token} desc={desc} />;
}

/** Push desc：分支 + SHA 区间（received_events 无 commits 列表 → before→head；有 commits 显示数量） */
function PushDesc({ ev }: { ev: ReceivedEvent }) {
  const { t } = useI18n();
  const commits = ev.payload?.commits ?? [];
  const ref = ev.payload?.ref?.replace("refs/heads/", "") ?? "HEAD";
  const head = ev.payload?.head ?? "";
  const before = ev.payload?.before ?? "";
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <GitCommitHorizontal className="size-3.5 shrink-0 text-emerald-500" />
      <span className="min-w-0 truncate font-medium text-foreground">{ref}</span>
      {commits.length > 0 ? (
        <span className="shrink-0">
          {t("feed.push.commits").replace("{count}", String(commits.length))}
        </span>
      ) : head ? (
        <code className="shrink-0 text-[11px]">
          {before ? `${before.slice(0, 7)} → ` : ""}
          {head.slice(0, 7)}
        </code>
      ) : null}
    </div>
  );
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

/** Issue desc：#num 标题（状态着色）+ 动作 */
function IssueDesc({ ev }: { ev: ReceivedEvent }) {
  const issue = ev.payload?.issue;
  if (!issue) return null;
  const action = ev.payload?.action ?? "updated";
  const closed = issue.state === "closed";
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <CircleDot
        className={cn(
          "size-3.5 shrink-0",
          closed ? "text-[#8250df] dark:text-[#a371f7]" : "text-[#1a7f37] dark:text-[#3fb950]",
        )}
      />
      <a
        href={issue.html_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate font-medium text-foreground hover:underline"
        title={issue.title}
      >
        #{issue.number} {issue.title}
      </a>
      <span className="shrink-0 text-xs">{action}</span>
    </div>
  );
}

/** PR desc：#num 标题（merged/closed/open 着色）+ 动作 */
function PullDesc({ ev }: { ev: ReceivedEvent }) {
  const pr = ev.payload?.pull_request;
  if (!pr) return null;
  const action = ev.payload?.action ?? "updated";
  const merged = pr.merged;
  const closed = pr.state === "closed";
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <GitPullRequest
        className={cn(
          "size-3.5 shrink-0",
          merged || closed
            ? "text-[#8250df] dark:text-[#a371f7]"
            : "text-[#1a7f37] dark:text-[#3fb950]",
        )}
      />
      <a
        href={pr.html_url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate font-medium text-foreground hover:underline"
        title={pr.title}
      >
        #{pr.number} {pr.title}
      </a>
      <span className="shrink-0 text-xs">{action}</span>
    </div>
  );
}

/** Comment desc：评论正文摘要（line-clamp-2）+ 所属 issue/PR 链接 + Read more 展开 */
function CommentDesc({
  body,
  subject,
}: {
  body: string;
  subject: { title: string; url: string; number: number } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = !expanded && body.split("\n").length > 4;
  return (
    <div className="text-sm text-muted-foreground">
      <p className={cn("whitespace-pre-wrap wrap-break-word", collapsible && "line-clamp-2")}>
        {body}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        {subject?.number ? (
          <a
            href={subject.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            in #{subject.number} {subject.title}
          </a>
        ) : (
          <span />
        )}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {tStatic("feed.readMore")}
          </button>
        )}
      </div>
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

      {/* 元信息：语言 · forks（stars 已在按钮内） */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {repo.language && (
          <span className="flex items-center gap-1">
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

function TrendingSection({ days }: { days: number }) {
  const { token } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    // 拉取更多（100 条）供本地分页，每页 10
    fetchTrendingRepositoriesSmart(days, 100, token)
      .then((items) => {
        if (!cancelled) setRepos(items);
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
  }, [days, reloadKey, token]);

  return (
    <div>
      {loading && (
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

      {error && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <InlineError message={error} className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </Button>
        </div>
      )}

      {!loading && !error && repos.length > 0 && (
        <>
          <div className="divide-y rounded-lg border bg-card px-4">
            {repos
              .slice((page - 1) * TRENDING_PAGE_SIZE, page * TRENDING_PAGE_SIZE)
              .map((repo, i) => (
                /* 逐项交错入场（官方 trending 分隔线列表），翻页重置动画 */
                <div
                  key={repo.id}
                  className="list-item-enter"
                  style={{
                    animationDelay: `${Math.min(i * 60, 480)}ms`,
                  }}
                >
                  <TrendingCard repo={repo} rank={(page - 1) * TRENDING_PAGE_SIZE + i + 1} />
                </div>
              ))}
          </div>
          <Pager
            page={page}
            totalPages={Math.max(1, Math.ceil(repos.length / TRENDING_PAGE_SIZE))}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
