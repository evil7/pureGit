/**
 * 首页 Dashboard（动态 Feed + 热点）
 *
 * 仿 GitHub 官方登录后首页三栏骨架（去掉非必要内容）：
 * - 左栏（lg 显示，移动端折叠到中栏下方）：Top 仓库（新建/查找/Show more）
 * - 中栏：Tab（动态默认 / 热点），动态 = 好友动态 Feed（Events API），热点 = 今日/本周/本月
 * - 匿名：仅显示热点（动态需登录态）
 * - Tab 路由：`?feed`（无值，仅区分路由到动态 tab）→ 动态；`?hot=day|week|month` → 热点
 * - 动态 Feed 无类型过滤：received_events API 无官方过滤选项，前端只全量列出 + 加载更多
 *
 * Feed / Trending 组件已拆至 ./Feed.tsx / ./Trending.tsx（臃肿拆分）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, TrendingUp, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/Tip";
import { WriteGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyReposSmart, type Repository } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { useI18n, tStatic } from "@/i18n";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";
import { FeedSection } from "./Feed";
import { TrendingSection } from "./Trending";

const PERIODS: SegmentedOption<"day" | "week" | "month">[] = [
  { value: "day", label: tStatic("home.today") },
  { value: "week", label: tStatic("home.week") },
  { value: "month", label: tStatic("home.month") },
];

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
  const { t } = useI18n();
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
          <h3 className="text-sm font-semibold">{t("home.topRepos")}</h3>
          <WriteGate>
            <Tip label={t("home.newRepo")}>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("home.newRepo")}
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
            placeholder={t("home.filterRepos")}
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
          <p className="py-2 text-xs text-muted-foreground">{t("home.noMatchRepos")}</p>
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
            {t("home.allRepos")}
          </Link>
        )}
      </div>
    </div>
  );
}
