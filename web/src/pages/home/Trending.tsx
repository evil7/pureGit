/**
 * 首页热点（今日/本周/本月）—— 自 HomePage.tsx 拆出。
 * 官方 /trending 单列风格：排名 + 仓库链接 + 描述 + 元信息行 + Star。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Star, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineStarButton } from "@/components/InlineStarButton";
import { InlineError } from "@/components/InlineError";
import { LangDot } from "@/components/LangDot";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchTrendingRepositoriesSmart, apiErrorMessage, type Repository } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { useI18n } from "@/i18n";

/** 每页条数（热点行窄 → 10 条） */
const TRENDING_PAGE_SIZE = 10;

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

/**
 * 热点：加载更多（瀑布流 append）——按当前周期从 search 页码逐页追加；
 * 空页/不足一页 → endReached（隐藏加载更多）。周期变化重置重载。
 * 逻辑简化：单一请求方向（page++ 追加），无页码跳转/回退/竞态等旧分页 bug。
 */
export function TrendingSection({ days }: { days: number }) {
  const { token } = useAuth();
  const { t } = useI18n();
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
  // 匿名也允许加载：fetchTrendingRepositoriesSmart 在未登录时走 REST（GraphQL 仅登录态）——
  // 这里不能以 !token 短路，否则未登录用户永远加载不出热点列表。
  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
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
            {t("common.retry")}
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
