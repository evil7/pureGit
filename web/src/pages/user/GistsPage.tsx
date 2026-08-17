/**
 * Gist 列表（/gist，对应 gist.github.com 官方）
 *
 * topbar「Gist」入口（需登录）。数据源 fetchMyGistsSmart（GraphQL viewer.gists privacy:ALL
 * 首选 + REST 降级），游标续接加载更多；Type（All/Public/Secret）前端过滤。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, FileCode2, MessageSquare, Plus, StickyNote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ThrowError } from "@/components/ErrorPages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import {
  fetchMyGistsSmart,
  fetchStarredGists,
  fetchPublicGists,
  fetchUserGists,
  normalizeApiError,
  ApiError,
  type Gist,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { LoadingList } from "./shared";

export default function GistsPage() {
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const targetUser = searchParams.get("user")?.trim() || null;
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // C7：Type 过滤（官方 All/Public/Secret）
  const [type, setType] = useState<"all" | "public" | "secret">("all");
  // 列表来源（我的 / Starred）——仅登录且无 targetUser 时生效
  const [listKind, setListKind] = useState<"mine" | "starred">("mine");
  // 模式：匿名公开浏览（discover）/ 指定用户 gists / 我的 gists
  const isDiscover = !token && !targetUser;
  const isUserGists = Boolean(targetUser);
  // 加载更多：游标续接（GraphQL pageInfo；REST 降级无游标按「批次是否拉满」判断）
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setGists(null);
    setError(null);
    setEndCursor(null);
    setHasMore(true);
    let loader: Promise<{ gists: Gist[]; endCursor: string | null; hasNextPage: boolean }>;
    if (targetUser) {
      // 指定用户公开 gists（profile 入口）
      loader = fetchUserGists(targetUser, token, 100).then((g) => ({
        gists: g,
        endCursor: null,
        hasNextPage: false,
      }));
    } else if (!token) {
      // 匿名：公开 gists 浏览（discover）
      loader = fetchPublicGists(null, 100).then((g) => ({
        gists: g,
        endCursor: null,
        hasNextPage: false,
      }));
    } else {
      loader =
        listKind === "mine"
          ? fetchMyGistsSmart(token)
          : fetchStarredGists(token, 100).then((g) => ({
              gists: g,
              endCursor: null,
              hasNextPage: false,
            }));
    }
    loader
      .then((r) => {
        if (!cancelled) {
          setGists(r.gists);
          setEndCursor(r.endCursor);
          setHasMore(r.hasNextPage);
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    return () => {
      cancelled = true;
    };
  }, [token, listKind, targetUser]);

  /** 加载更多：追加下一页并去重 */
  const loadMore = async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMyGistsSmart(token, endCursor);
      setGists((prev) => {
        const seen = new Set((prev ?? []).map((g) => g.id));
        return [...(prev ?? []), ...next.gists.filter((g) => !seen.has(g.id))];
      });
      setEndCursor(next.endCursor);
      setHasMore(next.hasNextPage);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  const visible = useMemo(() => {
    if (!gists) return null;
    if (listKind === "starred" || isDiscover || isUserGists) return gists;
    return gists.filter((g) => {
      if (type === "public") return g.public;
      if (type === "secret") return !g.public;
      return true;
    });
  }, [gists, type, listKind, isDiscover, isUserGists]);

  return (
    /* 官方 E 型：左用户卡 + 右列表（单栏→两栏对齐 gist.github.com） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={
          isDiscover
            ? undefined
            : {
                node: targetUser ? (
                  <div className="flex flex-col gap-3">
                    <Avatar className="size-16">
                      <AvatarFallback>{targetUser.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <h1 className="text-lg font-semibold leading-tight">{targetUser}</h1>
                      <p className="text-sm text-muted-foreground">gist</p>
                    </div>
                    <Button variant="outline" className="w-full" asChild>
                      <Link to={`/${targetUser}`}>
                        <ExternalLink className="size-3.5" />
                        {t("navpage.gists.viewProfile")}
                      </Link>
                    </Button>
                  </div>
                ) : user ? (
                  <div className="flex flex-col gap-3">
                    <Avatar className="size-16">
                      <AvatarImage src={user.avatarUrl ?? undefined} alt={user.login} />
                      <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <h1 className="text-lg font-semibold leading-tight">{user.login}</h1>
                      <p className="text-sm text-muted-foreground">gist</p>
                    </div>
                    <Button variant="outline" className="w-full" asChild>
                      <Link to={`/${user.login}`}>
                        <ExternalLink className="size-3.5" />
                        {t("navpage.gists.viewProfile")}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="size-16 rounded-full" />
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ),
                width: 260,
                sticky: "nav",
              }
        }
      >
        <div className="space-y-4">
          {/* 标题 + 新建 */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileCode2 className="size-6 text-muted-foreground" />
              <div>
                <h1 className="text-2xl font-semibold">
                  {isDiscover
                    ? t("gist.discoverTitle")
                    : isUserGists
                      ? t("gist.userGistsTitle", { user: targetUser })
                      : "Gist"}
                </h1>
                <p className="text-sm text-muted-foreground">{t("navpage.gists.desc")}</p>
              </div>
            </div>
            {token && !isUserGists && (
              <PermissionGate permission="gist">
                <Button className="gap-1" asChild>
                  <Link to="/gist/new">
                    <Plus className="size-3.5" />
                    {t("gist.newGist")}
                  </Link>
                </Button>
              </PermissionGate>
            )}
          </header>

          {/* 列表来源 tabs + Type 过滤（仅登录且浏览自己的 gists 时显示） */}
          {token && !targetUser && (
            <>
              <div className="flex border-b">
                <button
                  type="button"
                  onClick={() => setListKind("mine")}
                  className={cn(
                    "border-b-2 px-3 py-1.5 text-sm transition-colors",
                    listKind === "mine"
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("gist.tab.mine")}
                </button>
                <button
                  type="button"
                  onClick={() => setListKind("starred")}
                  className={cn(
                    "border-b-2 px-3 py-1.5 text-sm transition-colors",
                    listKind === "starred"
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("gist.tab.starred")}
                </button>
              </div>

              {/* C7：Type 过滤（仅我的 gists；官方 All/Public/Secret） */}
              {listKind === "mine" && visible !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={type}
                    onValueChange={(v) => setType(v as "all" | "public" | "secret")}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("gist.type.all")}</SelectItem>
                      <SelectItem value="public">{t("gist.type.public")}</SelectItem>
                      <SelectItem value="secret">{t("gist.type.secret")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {visible.length} {t("gist.type.count")}
                  </span>
                </div>
              )}
            </>
          )}

          {error ? (
            <ThrowError err={error} />
          ) : visible === null ? (
            <LoadingList />
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.gists")}</p>
          ) : (
            <div className="space-y-3">
              {visible.map((g) => {
                const firstFile = Object.values(g.files)[0];
                return (
                  <Card key={g.id} className="hover:bg-accent/50 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        {/* 左侧：身份 + 时间 + 描述（官方 gist-snippet-meta 排布） */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                            {/* 便签 icon 替代头像（列表接口无头像场景兜底） */}
                            <StickyNote className="size-4 shrink-0 text-muted-foreground" />
                            <Link
                              to={`/${g.owner?.login ?? ""}`}
                              className="text-muted-foreground hover:underline"
                            >
                              {g.owner?.login ?? ""}
                            </Link>
                            <span className="text-muted-foreground">/</span>
                            <Link
                              to={`/gist/${g.id}`}
                              className="min-w-0 truncate font-semibold text-primary hover:underline"
                              title={firstFile?.filename}
                            >
                              {firstFile?.filename || g.id}
                            </Link>
                            {g.public ? (
                              <Badge variant="outline" className="ml-1 shrink-0 text-xs">
                                {t("gist.public")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="ml-1 shrink-0 text-xs">
                                {t("gist.secret")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("gist.card.created").replace("{date}", fmt(g.created_at))}
                          </p>
                          {g.description && (
                            <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                              {g.description}
                            </p>
                          )}
                        </div>
                        {/* 右侧统计（files/comments；forks/stars 列表接口不提供计数，省略） */}
                        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-3">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <FileCode2 className="size-3.5" />
                            {t("gist.card.files").replace(
                              "{count}",
                              String(Object.keys(g.files).length),
                            )}
                          </span>
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <MessageSquare className="size-3.5" />
                            {t("gist.card.comments").replace("{count}", String(g.comments ?? 0))}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {/* 加载更多（type 过滤为前端过滤，追加后自动可见） */}
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
        </div>
      </PageLayout>
    </div>
  );
}
