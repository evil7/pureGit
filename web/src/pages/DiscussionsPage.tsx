/**
 * Discussions 列表 + 详情（重构对齐官方）
 *
 * 数据源：GraphQL only（REST 无 discussion 端点），需登录 token。
 * 列表：官方结构——工具栏（Search/Sort/Filter/New discussion）+ 左栏
 *       （Categories 含 Manage categories/View all/Most helpful/Community links）
 *       + 右栏（讨论行/空态欢迎卡片）。URL query 驱动（category slug/state/sort/q）。
 * 详情：主帖 + 评论列表（isAnswer 徽标）+ MarkdownEditor 评论表单。
 * 新建：整页两段式（/discussions/new/choose 选分类 → /discussions/new 填写）。
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare, ArrowUp, Plus, CheckCircle2, Pin, Heart, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  fetchDiscussionsSmart,
  fetchDiscussionDetailSmart,
  createDiscussionSmart,
  addDiscussionCommentSmart,
  fetchRepositoryIdSmart,
  categorySlug,
} from "@/lib/api";
import { apiErrorMessage, normalizeApiError, ApiError } from "@/lib/restapi";
import { parseSearchSyntax } from "@/lib/api/search-syntax";
import { get as emojiGet } from "node-emoji";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { UserAvatar } from "@/components/UserAvatar";
import { LoginPrompt } from "@/components/LoginPrompt";
import { WriteGate } from "@/components/WriteGate";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import type {
  DiscussionSummary,
  DiscussionDetail,
  DiscussionComment,
  DiscussionsData,
} from "@/lib/restapi";

/** :emoji: → unicode（GraphQL category.emoji 返回 shortcode） */
const emoji = (code: string) => emojiGet(code) ?? code;

/** 官方排序（Latest activity / Top / Newest）→ GraphQL DiscussionOrder */
const SORT_OPTIONS: {
  value: string;
  labelKey: I18nKey;
  order: { field: string; direction: "ASC" | "DESC" };
}[] = [
  {
    value: "latest",
    labelKey: "discussions.sort.latest",
    order: { field: "UPDATED_AT", direction: "DESC" },
  },
  {
    value: "top",
    labelKey: "discussions.sort.top",
    order: { field: "UPVOTE_COUNT", direction: "DESC" },
  },
  {
    value: "newest",
    labelKey: "discussions.sort.newest",
    order: { field: "CREATED_AT", direction: "DESC" },
  },
];

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
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
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

// ===== 新建讨论：两段式整页（官方 /discussions/new/choose → /discussions/new） =====

/** 第一段：选择分类（官方 grid 卡片，点击跳转 /discussions/new?category={slug}） */
export function NewDiscussionChoosePage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const [categories, setCategories] = useState<
    { id: string; name: string; emoji: string; description?: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchDiscussionsSmart(owner!, repo!, token, null, null, null, null)
      .then((d) => !cancelled && setCategories(d.categories))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("discussions.new")}</h1>
        <p className="text-sm text-muted-foreground">{t("discussions.chooseCategory")}</p>
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              to={`/${owner}/${repo}/discussions/new?category=${categorySlug(c.name)}`}
              className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50"
            >
              <span className="text-2xl">{emoji(c.emoji)}</span>
              <h3 className="mt-2 font-medium group-hover:text-primary">{c.name}</h3>
              {c.description && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {c.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** 第二段：填写标题 + 正文（官方 /discussions/new?category={slug}） */
export function NewDiscussionPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const categorySlugUrl = searchParams.get("category") ?? "";

  const [categories, setCategories] = useState<
    { id: string; name: string; emoji: string; description?: string | null }[]
  >([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchDiscussionsSmart(owner!, repo!, token, null, null, null, null)
      .then((d) => !cancelled && setCategories(d.categories))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  const categoryId = categories.find((c) => categorySlug(c.name) === categorySlugUrl)?.id ?? "";
  const canSubmit = categoryId && title.trim() && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const tk = token!;
    setSubmitting(true);
    setError(null);
    try {
      const repositoryId = await fetchRepositoryIdSmart(tk, owner!, repo!);
      if (!repositoryId) throw new Error(t("discussions.createFailed"));
      const number = await createDiscussionSmart(
        repositoryId,
        categoryId,
        title.trim(),
        body.trim(),
        tk,
      );
      setBody("");
      setTitle("");
      setResetKey((k) => k + 1);
      navigate(`/${owner}/${repo}/discussions/${number}`);
    } catch (err) {
      setError(apiErrorMessage(err, t("discussions.createFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* 面包屑（官方：repo / Category name） */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Link
          to={`/${owner!}/${repo!}/discussions`}
          className="font-medium text-foreground hover:underline"
        >
          {repo}
        </Link>
        <span aria-hidden>/</span>
        <Link
          to={`/${owner!}/${repo!}/discussions/new/choose`}
          className="text-muted-foreground hover:text-foreground"
        >
          {t("discussions.new")}
        </Link>
        {categoryId && (
          <>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">
              {categories.find((c) => c.id === categoryId)?.name}
            </span>
          </>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {/* 分类徽标 */}
        <div className="flex items-center gap-2">
          {categories
            .filter((c) => c.id === categoryId)
            .map((c) => (
              <Badge key={c.id} variant="secondary">
                {emoji(c.emoji)} {c.name}
              </Badge>
            ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("discussions.titleLabel")}</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("discussions.titlePlaceholder")}
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("discussions.bodyLabel")}</label>
          <MarkdownEditor
            key={resetKey}
            owner={owner}
            repo={repo}
            defaultValue=""
            rows={10}
            placeholder={t("discussions.bodyPlaceholder")}
            onChange={setBody}
          />
        </div>

        {error && <InlineError message={error} size="sm" />}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? t("discussions.submitting") : t("discussions.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ===== 详情页 =====

export function DiscussionDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [discussion, setDiscussion] = useState<DiscussionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDiscussionDetailSmart(owner!, repo!, Number(number), token)
      .then((d) => {
        if (!cancelled) setDiscussion(d);
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

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // 整页级致命错误（discussion 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !discussion) throw error ?? new ApiError(404);

  const onCommentAdded = (c: DiscussionComment) => {
    setDiscussion((prev) => (prev ? { ...prev, comments: [...prev.comments, c] } : prev));
  };

  return (
    /* 官方 F 型：主讨论 + 右 metadata（分类/投票/参与 单列→两栏对齐） */
    <PageLayout
      gap="sm"
      right={{
        node: (
          <aside className="space-y-5 text-sm">
            {/* 分类 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("discussions.categories")}
              </h3>
              <Link
                to={`/${owner}/${repo}/discussions?category=${categorySlug(discussion.category.name)}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent/60 hover:text-foreground"
              >
                <span className="text-base">{emoji(discussion.category.emoji)}</span>
                <span className="truncate">{discussion.category.name}</span>
              </Link>
            </section>

            {/* 投票 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("discussions.upvotes")}
              </h3>
              <Button variant="outline" className="w-full gap-1.5">
                <ArrowUp className="size-3.5" />
                {discussion.upvoteCount}
              </Button>
            </section>

            {/* 参与者（作者 + 评论者聚合） */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.participants")}
              </h3>
              <div className="flex items-center gap-1.5">
                <UserAvatar
                  src={discussion.author.avatar_url}
                  alt={discussion.author.login}
                  title={discussion.author.login}
                  className="size-6 ring-1 ring-border"
                />
                {discussion.comments
                  .map((c) => c.author)
                  .filter(
                    (a, i, arr) =>
                      a.login !== discussion.author.login &&
                      arr.findIndex((x) => x.login === a.login) === i,
                  )
                  .slice(0, 7)
                  .map((a) => (
                    <UserAvatar
                      key={a.login}
                      src={a.avatar_url}
                      alt={a.login}
                      title={a.login}
                      className="size-6 ring-1 ring-border"
                    />
                  ))}
              </div>
            </section>
          </aside>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      <div className="space-y-4">
        {/* 主帖头 */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {emoji(discussion.category.emoji)} {discussion.category.name}
            </Badge>
            {discussion.answered && (
              <Badge className="gap-1 bg-green-600 text-white">
                <CheckCircle2 className="size-3" />
                Answered
              </Badge>
            )}
            {discussion.locked && <Badge variant="secondary">Locked</Badge>}
          </div>
          <h1 className="text-2xl font-bold wrap-break-word">{discussion.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <UserAvatar src={discussion.author.avatar_url} alt={discussion.author.login} />
            <Link
              to={`/${discussion.author.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {discussion.author.login}
            </Link>
            <span>
              {t("discussions.opened")} {fmt(discussion.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <ArrowUp className="size-3" />
              {discussion.upvoteCount}
            </span>
          </div>
        </header>

        {/* 主帖正文 */}
        {discussion.body && (
          <div className="rounded-lg border bg-card p-4">
            <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{discussion.body}</MarkdownView>
          </div>
        )}

        {/* 评论列表 */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {discussion.comments.length} {t("discussions.comments")}
          </h2>
          {discussion.comments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("discussions.noComments")}
            </p>
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {discussion.comments.map((c) => (
                <div key={c.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <UserAvatar src={c.author.avatar_url} alt={c.author.login} />
                    <span className="font-medium text-foreground">{c.author.login}</span>
                    <span>{fmt(c.createdAt)}</span>
                    {c.isAnswer && (
                      <Badge className="gap-1 bg-green-600 text-white">
                        <CheckCircle2 className="size-3" />
                        Answer
                      </Badge>
                    )}
                    {c.repliesCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="size-3" />
                        {c.repliesCount}
                      </span>
                    )}
                  </div>
                  <div className="">
                    <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{c.body}</MarkdownView>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 评论表单 */}
        <WriteGate>
          <DiscussionCommentForm
            discussionId={discussion.id}
            token={token}
            onCommentAdded={onCommentAdded}
          />
        </WriteGate>
      </div>
    </PageLayout>
  );
}

/** 讨论评论表单 */
function DiscussionCommentForm({
  discussionId,
  token,
  onCommentAdded,
}: {
  discussionId: string;
  token: string;
  onCommentAdded: (c: DiscussionComment) => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const c = await addDiscussionCommentSmart(discussionId, body.trim(), token);
      setBody("");
      setResetKey((k) => k + 1);
      onCommentAdded(c);
    } catch (err) {
      setError(apiErrorMessage(err, t("comments.addFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <MarkdownEditor
        key={resetKey}
        defaultValue=""
        rows={5}
        placeholder={t("discussions.commentPlaceholder")}
        onChange={setBody}
      />
      {error && <InlineError message={error} size="sm" />}
      <div className="flex justify-end">
        <Button type="submit" disabled={!body.trim() || submitting}>
          {t("comments.submit")}
        </Button>
      </div>
    </form>
  );
}
