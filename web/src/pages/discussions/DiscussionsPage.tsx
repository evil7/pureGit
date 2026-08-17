/**
 * Discussions 列表页（重构对齐官方）
 *
 * 数据源：GraphQL only（REST 无 discussion 端点），需登录 token。
 * 列表：官方结构——工具栏（Search/Sort/Filter/New discussion）+ 左栏
 *       （Categories 含 Manage categories/View all/Most helpful/Community links）
 *       + 右栏（讨论行/空态欢迎卡片）。URL query 驱动（category slug/state/sort/q）。
 * 详情页 → DiscussionDetail.tsx；新建两段式 → NewDiscussion.tsx。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, ArrowUp, Plus, Pin, Heart, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchDiscussionsSmart, categorySlug } from "@/lib/api";
import { normalizeApiError, ApiError } from "@/lib/restapi";
import { parseSearchSyntax } from "@/lib/api/search-syntax";
import { UserAvatar } from "@/components/UserAvatar";
import { LoginPrompt } from "@/components/LoginPrompt";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import type { DiscussionSummary, DiscussionsData } from "@/lib/restapi";
import { emoji, SORT_OPTIONS } from "./constants";

export default function DiscussionsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL query 驱动（官方风格）：category / state / sort / q
  const categorySlugUrl = searchParams.get("category") ?? "";
  const state = searchParams.get("state") ?? "OPEN";
  const sort = searchParams.get("sort") ?? "latest";
  const q = searchParams.get("q") ?? "";

  const [data, setData] = useState<DiscussionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // 游标分页：追加的讨论 + 续接游标 + 是否有下一页（搜索模式恒 false 不触发）
  const [extraDiscussions, setExtraDiscussions] = useState<DiscussionSummary[]>([]);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchInput = q;

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  // slug → id 映射（分类加载后解析）
  const categoryId =
    data?.categories.find((c) => categorySlug(c.name) === categorySlugUrl)?.id ?? null;
  const order = SORT_OPTIONS.find((s) => s.value === sort)?.order;
  // 搜索语法解析 → states（is:answered/unanswered 等；effect 与 loadMore 共用）
  const states = useMemo(() => {
    const parsed = parseSearchSyntax(q);
    const stateIs = parsed.is.find((v) => ["open", "closed", "answered", "unanswered"].includes(v));
    return stateIs ? [stateIs.toUpperCase()] : null;
  }, [q]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDiscussionsSmart(owner!, repo!, token, categoryId, states, order ?? null, q || null)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setExtraDiscussions([]);
        setEndCursor(d.endCursor);
        setHasNextPage(d.hasNextPage);
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
  }, [owner, repo, token, categoryId, state, sort, order, q, states]);

  /** 加载更多：游标续接追加讨论（仅列表模式；搜索模式 hasNextPage=false 不触发） */
  const loadMore = async () => {
    if (loadingMore || !endCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchDiscussionsSmart(
        owner!,
        repo!,
        token,
        categoryId,
        states,
        order ?? null,
        q || null,
        endCursor,
      );
      setExtraDiscussions((prev) => [...prev, ...next.discussions]);
      setEndCursor(next.endCursor);
      setHasNextPage(next.hasNextPage);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        left={{
          node: (
            <div className="space-y-5">
              <div className="space-y-2">
                <Skeleton className="h-5 w-1/2" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（列表加载失败/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !data) throw error ?? new ApiError(404);

  // 搜索提交：语法原文进 q（GraphQL search 端点消费 buildSearchQuery）
  const onSearchSubmit = (raw: string) => {
    const next = new URLSearchParams(searchParams);
    if (raw) next.set("q", raw);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      {/* Pinned Discussions */}
      {data.pinned.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Pin className="size-4" />
            {t("discussions.pinned")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.pinned.map((p) => (
              <Link
                key={p.number}
                to={`/${owner}/${repo}/discussions/${p.number}`}
                className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm hover:bg-accent/50"
              >
                <span className="text-base">{emoji(p.category.emoji)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {p.category.name}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      <PageLayout
        gap="sm"
        left={{
          node: (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("discussions.categories")}</h3>
                  <Link
                    to={`/${owner}/${repo}/discussions/categories`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t("discussions.manageCategories")}
                  </Link>
                </div>
                <ul className="space-y-0.5">
                  <li>
                    <Link
                      to={`/${owner}/${repo}/discussions`}
                      className={cn(
                        "block w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors",
                        !categorySlugUrl
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {t("discussions.viewAll")}
                    </Link>
                  </li>
                  {data.categories.map((c) => {
                    const slug = categorySlug(c.name);
                    return (
                      <li key={c.id}>
                        <Link
                          to={`/${owner}/${repo}/discussions/categories/${slug}`}
                          className={cn(
                            "block w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors",
                            categorySlugUrl === slug
                              ? "bg-accent font-medium text-foreground"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                          )}
                        >
                          {emoji(c.emoji)} {c.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("discussions.mostHelpful")}</h3>
                {data.mostHelpful.length > 0 ? (
                  <ul className="space-y-1">
                    {data.mostHelpful.map((u) => (
                      <li key={u.login} className="flex items-center gap-2 px-2 text-sm">
                        <UserAvatar src={u.avatarUrl} alt={u.login} className="size-4" />
                        <Link
                          to={`/${u.login}`}
                          className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground"
                        >
                          {u.login}
                        </Link>
                        <span className="text-xs text-muted-foreground">{u.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-start gap-1.5 px-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="mt-0.5 shrink-0">
                      <Heart className="size-3.5" />
                    </span>
                    {t("discussions.mostHelpful.empty")}
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("discussions.communityLinks")}</h3>
                <ul className="space-y-0.5">
                  <li>
                    <a
                      href="https://docs.github.com/articles/github-community-guidelines"
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {t("discussions.communityGuidelines")}
                    </a>
                  </li>
                  <li>
                    <Link
                      to={`/${owner}/${repo}/graphs/community`}
                      className="block truncate px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {t("discussions.communityInsights")}
                    </Link>
                  </li>
                  {data.codeOfConduct && (
                    <li>
                      <a
                        href={data.codeOfConduct.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 truncate px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        {data.codeOfConduct.name}
                      </a>
                    </li>
                  )}
                </ul>
              </section>
            </>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        {/* 右栏：工具栏 + 讨论行 */}
        <div className="min-w-0 space-y-3">
          {/* 工具栏（官方：Search + Sort by + Filter: Open + New discussion） */}
          <div className="flex flex-wrap items-center gap-2">
            <RepoSearchInput
              defaultValue={searchInput}
              placeholder={t("discussions.searchPlaceholder")}
              onSubmit={onSearchSubmit}
              className="min-w-0 flex-1 sm:max-w-xs"
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select
                value={sort}
                onValueChange={(v) => updateParams({ sort: v === "latest" ? null : v })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={state}
                onValueChange={(v) => updateParams({ state: v === "OPEN" ? null : v })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">{t("discussions.filterOpen")}</SelectItem>
                  <SelectItem value="ANSWERED">{t("discussions.filterAnswered")}</SelectItem>
                  <SelectItem value="UNANSWERED">{t("discussions.filterUnanswered")}</SelectItem>
                  <SelectItem value="CLOSED">{t("discussions.filterClosed")}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {data.totalCount} {t("discussions.count")}
              </span>
              <Button className="h-8" asChild>
                <Link to={`/${owner}/${repo}/discussions/new/choose`}>
                  <Plus className="size-4" />
                  {t("discussions.new")}
                </Link>
              </Button>
            </div>
          </div>

          {data.discussions.length === 0 ? (
            /* 空态：官方 Welcome to discussions 欢迎卡片 */
            <div className="rounded-lg border bg-card px-6 py-12 text-center">
              <MessageSquare className="mx-auto size-10 text-muted-foreground" />
              <h3 className="mt-3 text-base font-semibold">{t("discussions.empty.title")}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {t("discussions.empty.desc")}{" "}
                <Link
                  to={`/${owner}/${repo}/discussions/new/choose`}
                  className="text-primary hover:underline"
                >
                  {t("discussions.empty.link")}
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {data.discussions.map((d) => (
                  <DiscussionRow key={d.number} d={d} owner={owner!} repo={repo!} fmt={fmt} />
                ))}
                {extraDiscussions.map((d) => (
                  <DiscussionRow key={d.number} d={d} owner={owner!} repo={repo!} fmt={fmt} />
                ))}
              </ul>
              {hasNextPage && (
                <div className="text-center">
                  <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? t("common.loading") : t("home.showMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PageLayout>
    </div>
  );
}

/** 讨论行（emoji + 标题 + asked in + 统计） */
function DiscussionRow({
  d,
  owner,
  repo,
  fmt,
}: {
  d: DiscussionSummary;
  owner: string;
  repo: string;
  fmt: (s: string) => string;
}) {
  return (
    <li className="flex items-start gap-2 px-4 py-3 hover:bg-accent/50">
      <span className="mt-1 text-lg leading-none">{emoji(d.category.emoji)}</span>
      <div className="min-w-0 flex-1">
        <Link
          to={`/${owner}/${repo}/discussions/${d.number}`}
          className="block truncate font-medium hover:text-primary hover:underline"
        >
          {d.title}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {d.author.login} asked in {d.category.name}
          </span>
          {d.answered ? (
            <Badge className="bg-green-600 text-white">Answered</Badge>
          ) : (
            <Badge variant="secondary">Unanswered</Badge>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" />
            {d.commentsCount}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="size-3" />
            {d.upvoteCount}
          </span>
          <span>{fmt(d.createdAt)}</span>
        </div>
      </div>
    </li>
  );
}
