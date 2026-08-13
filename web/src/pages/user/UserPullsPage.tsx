/**
 * 用户级 Pulls（/pulls/*，官方左侧导航：inbox/authored/assigned/involves/reviews）
 *
 * topbar「All PRs」对应的「我的维度」列表页（需登录）。
 * 数据源 fetchMyPullsSmart（search is:pr 首选 + REST 降级），page 追加加载更多。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Calendar, GitPullRequest, GitPullRequestClosed, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ThrowError } from "@/components/ErrorPages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import { fetchMyPullsSmart, normalizeApiError, ApiError, type Issue } from "@/lib/api";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { STATE_BADGE_SOLID } from "@/lib/ui/state-colors";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { LoadingList } from "./shared";

/** 左侧导航（官方 ActionList 风格，URL 驱动） */
const PULL_NAV: {
  key: string;
  filter: "inbox" | "authored" | "assigned" | "involves" | "reviews";
  labelKey:
    | "pulls.nav.inbox"
    | "pulls.nav.authored"
    | "pulls.nav.assigned"
    | "pulls.nav.involves"
    | "pulls.nav.reviews";
}[] = [
  { key: "inbox", filter: "inbox", labelKey: "pulls.nav.inbox" },
  { key: "authored", filter: "authored", labelKey: "pulls.nav.authored" },
  { key: "assigned", filter: "assigned", labelKey: "pulls.nav.assigned" },
  { key: "involves", filter: "involves", labelKey: "pulls.nav.involves" },
  { key: "reviews", filter: "reviews", labelKey: "pulls.nav.reviews" },
];

export default function UserPullsPage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const { tab } = useParams();
  const current = PULL_NAV.find((x) => x.key === tab) ?? PULL_NAV[1];
  const [items, setItems] = useState<Issue[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 加载更多：page 追加（GraphQL search 分页需游标 → page>1 走 REST；按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setPage(1);
    setHasMore(true);
    fetchMyPullsSmart(token, current.filter)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setHasMore(list.length >= 50);
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    return () => {
      cancelled = true;
    };
  }, [token, current.filter]);

  /** 加载更多：追加下一页并去重 */
  const loadMore = async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMyPullsSmart(token, current.filter, page + 1);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.id));
        return [...(prev ?? []), ...next.filter((i) => !seen.has(i.id))];
      });
      setPage((p) => p + 1);
      setHasMore(next.length >= 50);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    /* 官方 C 型：左导航 + 右列表（PageLayout 收编 GRID_2COL_240） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={{
          node: (
            <nav className="rounded-lg border bg-card p-2">
              <ul className="space-y-0.5">
                {PULL_NAV.map((x) => (
                  <li key={x.key}>
                    <Link
                      to={`/pulls/${x.key}`}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${cn(
                        x.key === current.key
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}`}
                    >
                      <GitPullRequest className="size-4 shrink-0" />
                      {t(x.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ),
          width: 240,
          sticky: "nav",
        }}
      >
        {/* 主区 */}
        <div className="mb-4 flex items-center gap-3">
          <GitPullRequest className="size-6 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{t(current.labelKey)}</h1>
            <p className="text-sm text-muted-foreground">{t("navpage.pulls.desc")}</p>
          </div>
        </div>

        {error ? (
          <ThrowError err={error} />
        ) : items === null ? (
          <LoadingList />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.prs")}</p>
        ) : (
          <div className="space-y-3">
            {items.map((pr) => {
              const repoName = pr.repository?.full_name ?? "unknown/repo";
              const [owner, repo] = repoName.split("/");
              return (
                <Card key={pr.id} className="hover:bg-accent/50 transition-colors">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <Link
                        to={`/${owner}/${repo}/pull/${pr.number}`}
                        className="min-w-0 text-primary hover:underline line-clamp-2"
                      >
                        {pr.title}
                      </Link>
                      <Badge variant="outline" className="shrink-0 text-xs font-mono">
                        {repoName} #{pr.number}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {/* 状态图标（官方：open=绿 PR / closed=红闭合 PR） */}
                      {pr.state === "open" ? (
                        <GitPullRequest className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
                      ) : (
                        <GitPullRequestClosed className="size-3.5 text-[#cf222e] dark:text-[#f85149]" />
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent text-xs",
                          pr.state === "open" ? STATE_BADGE_SOLID.open : STATE_BADGE_SOLID.closed,
                        )}
                      >
                        {pr.state}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="size-3.5" />
                        {pr.comments}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3.5" />
                        {fmt(pr.created_at)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {/* 加载更多 */}
            {hasMore && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t("common.loading") : tStatic("home.showMore")}
              </Button>
            )}
          </div>
        )}
      </PageLayout>
    </div>
  );
}
