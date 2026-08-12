/**
 * 用户级导航页（Issues/Pulls/Repos/Gist/Notifications）
 *
 * topbar 官方图标按钮对应的「我的维度」列表页（均需登录，REST 直连）：
 * - /issues        All issues（GET /issues?filter=created）
 * - /pulls         All PRs（search is:pr author:@me）
 * - /repositories  All repos（fetchMyReposSmart）
 * - /notifications 通知（GET /notifications）
 * - /gist          Gist 列表（GET /gists）
 * 未登录 → 登录引导；行内链接均为站内路由。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  Calendar,
  CircleDot,
  FileCode2,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquare,
  BookOpen,
  Star,
  GitFork,
  Settings,
  Plus,
  UserPlus,
  Check,
  X,
  StickyNote,
  ExternalLink,
  Inbox,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InlineError } from "@/components/InlineError";
import { ThrowError } from "@/components/ErrorPages";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/Tip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RepoVisibilityBadge } from "@/components/RepoVisibilityBadge";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoginPrompt } from "@/components/LoginPrompt";
import { PermissionGate, WriteGate } from "@/components/WriteGate";
import { LangDot } from "@/components/LangDot";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import {
  fetchMyIssues,
  fetchMyPulls,
  fetchMyGists,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationThreadRead,
  fetchRepoInvitations,
  acceptRepoInvitation,
  declineRepoInvitation,
  fetchMyReposSmart,
  fetchUserOrgsSmart,
  apiErrorMessage,
  normalizeApiError,
  ApiError,
  type Issue,
  type Gist,
  type Notification,
  type RepositoryInvitation,
  type Repository,
  type UserOrgItem,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/layout";
import { STATE_BADGE_SOLID } from "@/lib/state-colors";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { matchSearch } from "@/lib/search-syntax";

/** 解析 html_url（https://github.com/owner/repo/...）→ [owner, repo] */
function parseRepoFromUrl(url: string): { owner: string; repo: string } {
  const parts = url.replace("https://github.com/", "").split("/");
  return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
}

/** 共享页骨架：标题 + 说明 + 可选右上角操作 + 内容（未登录 → 登录引导） */
function NavPageShell({
  title,
  desc,
  icon,
  action,
  children,
}: {
  title: string;
  desc: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  return (
    <div className={PAGE_SHELL}>
      <header className="mb-6 flex items-center gap-3">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>
        {action && token && <div className="shrink-0">{action}</div>}
      </header>
      {token ? (
        children
      ) : (
        <div className="mx-auto max-w-sm">
          {/* 统一登录引导模板：只提醒 + 聚光灯指引右上角，不做按钮 */}
          <LoginPrompt title={title} desc={`${title} ${t("common.loginRequired")}`} />
        </div>
      )}
    </div>
  );
}

function LoadingList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

// ===== 用户级 Issues（/issues/*，官方 4 tab URL 驱动：assigned/created/mentioned/recent）=====

/** 顶部 tab（官方 UnderlineNav：Assigned to me / Created by me / Mentioned / Recent activity） */
const ISSUE_TABS: {
  key: string;
  filter: "assigned" | "created" | "mentioned" | "recent";
  labelKey: "issues.assigned" | "issues.created" | "issues.mentioned" | "issues.recent";
}[] = [
  { key: "assigned", filter: "assigned", labelKey: "issues.assigned" },
  { key: "created", filter: "created", labelKey: "issues.created" },
  { key: "mentioned", filter: "mentioned", labelKey: "issues.mentioned" },
  { key: "recent", filter: "recent", labelKey: "issues.recent" },
];

export function UserIssuesPage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const navigate = useNavigate();
  const { tab } = useParams();
  // URL 段驱动：/issues/assigned → assigned（默认 created，官方默认 assigned→本项目默认 created 语义一致）
  const current = ISSUE_TABS.find((x) => x.key === tab) ?? ISSUE_TABS[1];
  const [items, setItems] = useState<Issue[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 搜索（官方 token 化搜索框；简化：前端过滤已加载列表，支持 title/body/state/repo 关键词）
  const [q, setQ] = useState("");
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setQ("");
    setPage(1);
    setHasMore(true);
    fetchMyIssues(token, current.filter, 50)
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
      const next = await fetchMyIssues(token, current.filter, 50, page + 1);
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

  // 前端搜索过滤（统一语法系统：is:/label:/author:/repo: + 自由文本）
  const visible = items?.filter((i) => {
    const { owner, repo } = parseRepoFromUrl(i.html_url);
    return matchSearch(q, {
      title: i.title,
      body: i.body ?? "",
      repo: `${owner}/${repo}`,
      author: i.user?.login,
      labels: i.labels?.map((l) => l.name) ?? [],
      state: i.state,
    });
  });

  return (
    <NavPageShell
      title="Issues"
      desc={t("navpage.issues.desc")}
      icon={<CircleDot className="size-6" />}
    >
      {/* 顶部 tab（官方 UnderlineNav 风格，URL 驱动可分享） */}
      <Tabs value={current.key} onValueChange={(k) => navigate(`/issues/${k}`)}>
        <TabsList>
          {ISSUE_TABS.map((x) => (
            <TabsTrigger key={x.key} value={x.key}>
              {t(x.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 搜索框（官方 token 化搜索框；统一语法系统） */}
      <div className="mt-4">
        <RepoSearchInput
          defaultValue={q}
          placeholder={t("navpage.issues.search")}
          onSubmit={(raw) => setQ(raw)}
        />
      </div>

      {/* 结果区 */}
      {error ? (
        <ThrowError err={error} />
      ) : visible === null ? (
        <div className="mt-4">
          <LoadingList />
        </div>
      ) : !visible || visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {q.trim() ? t("empty.noResults") : t("empty.issues")}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((issue) => {
            const { owner, repo } = parseRepoFromUrl(issue.html_url);
            return (
              <Card key={issue.id} className="hover:bg-accent/50 transition-colors">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <Link
                      to={`/${owner}/${repo}/issues/${issue.number}`}
                      className="min-w-0 text-primary hover:underline line-clamp-2"
                    >
                      {issue.title}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-xs font-mono">
                      {owner}/{repo} #{issue.number}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {/* 状态图标（官方：open=绿圈 / closed=紫圈叉） */}
                    {issue.state === "open" ? (
                      <CircleDot className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
                    ) : (
                      <XCircle className="size-3.5 text-[#8250df] dark:text-[#a371f7]" />
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-transparent text-xs",
                        issue.state === "open"
                          ? STATE_BADGE_SOLID.open
                          : STATE_BADGE_SOLID["issue-closed"],
                      )}
                    >
                      {issue.state}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="size-3.5" />
                      {issue.comments}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {fmt(issue.created_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {/* 加载更多（搜索态下前端过滤，不追加） */}
          {hasMore && !q.trim() && (
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
    </NavPageShell>
  );
}

// ===== 用户级 Pulls（/pulls/*，官方左侧导航：inbox/authored/assigned/involves/reviews）=====

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

export function UserPullsPage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const { tab } = useParams();
  const current = PULL_NAV.find((x) => x.key === tab) ?? PULL_NAV[1];
  const [items, setItems] = useState<Issue[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
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
    fetchMyPulls(token, current.filter, 50)
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
      const next = await fetchMyPulls(token, current.filter, 50, page + 1);
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
                        to={`/${owner}/${repo}/pulls/${pr.number}`}
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

// ===== All repos（/repositories）=====

export function ReposNavPage() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [orgs, setOrgs] = useState<UserOrgItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  // C4 工具条：Type（全部/公开/私有）/ Language / Sort（名字/最近更新）
  const [type, setType] = useState<"all" | "public" | "private">("all");
  const [lang, setLang] = useState<string>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setRepos(null);
    setError(null);
    fetchMyReposSmart(token)
      .then((list) => !cancelled && setRepos(list))
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    // 组织列表（识别「自己组织的仓库」可管理）
    fetchUserOrgsSmart(token)
      .then((o) => !cancelled && setOrgs(o))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 可管理 = 自己 或 自己所属组织的仓库（均可设置；deepwn/xxx 属组织仓库）
  const canManageRepo = (r: Repository) => {
    const l = user?.login;
    return Boolean(l && (r.owner.login === l || orgs.some((o) => o.login === r.owner.login)));
  };

  // C4 过滤 + 排序（前端，免重拉 API）：Type → Language → Sort
  const langs = useMemo(() => {
    const s = new Set<string>();
    repos?.forEach((r) => r.language && s.add(r.language));
    return [...s].sort();
  }, [repos]);

  const visible = useMemo(() => {
    if (!repos) return null;
    let out = repos.filter((r) => {
      if (type === "public" && r.private) return false;
      if (type === "private" && !r.private) return false;
      if (lang !== "all" && r.language !== lang) return false;
      return true;
    });
    out = [...out].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    return out;
  }, [repos, type, lang, sort]);

  return (
    <NavPageShell
      title="All repos"
      desc={t("navpage.repos.desc")}
      icon={<BookOpen className="size-6" />}
      action={
        <Button size="sm" asChild>
          <Link to="/new">
            <Plus className="size-4" />
            {t("navpage.repos.new")}
          </Link>
        </Button>
      }
    >
      {/* C4 工具条（官方：Type / Language / Sort + New） */}
      {visible !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as "all" | "public" | "private")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("navpage.repos.type.all")}</SelectItem>
              <SelectItem value="public">{t("navpage.repos.type.public")}</SelectItem>
              <SelectItem value="private">{t("navpage.repos.type.private")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("navpage.repos.lang.all")}</SelectItem>
              {langs.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">{t("navpage.repos.sort.updated")}</SelectItem>
              <SelectItem value="name">{t("navpage.repos.sort.name")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {visible.length} {t("navpage.repos.count")}
          </span>
        </div>
      )}

      {error ? (
        <ThrowError err={error} />
      ) : visible === null ? (
        <LoadingList />
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.repos")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map((r) => (
            <div
              key={r.full_name}
              className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <Link to={`/${r.full_name}`} className="font-medium hover:underline">
                  {r.full_name}
                </Link>
                {/* 状态徽章（私有/归档，i18n；公开不显示） */}
                <RepoVisibilityBadge repo={r} />
                {r.description && (
                  <p className="truncate text-sm text-muted-foreground">{r.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {r.language && (
                  <span className="flex items-center gap-1">
                    <LangDot lang={r.language} />
                    {r.language}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Star className="size-3.5" />
                  {r.stargazers_count}
                </span>
                <span className="flex items-center gap-1">
                  <GitFork className="size-3.5" />
                  {r.forks_count}
                </span>
                <span>{fmt(r.updated_at)}</span>
                {/* 设置按钮全部显示：可管理（自己/自己组织）→ 有写权限可点；
                    无写权限或非本人/组织仓库 → 置灰不可点击 */}
                {canManageRepo(r) ? (
                  <PermissionGate>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" asChild>
                      <Link to={`/${r.owner.login}/${r.name}/settings`}>
                        <Settings className="size-3.5" />
                        设置
                      </Link>
                    </Button>
                  </PermissionGate>
                ) : (
                  <Tip label="仅仓库所有者可设置">
                    <span className="inline-flex cursor-not-allowed opacity-40">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled>
                        <Settings className="size-3.5" />
                        设置
                      </Button>
                    </span>
                  </Tip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </NavPageShell>
  );
}

// ===== Gist（GET /gists）=====

export function GistsPage() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // C7：Type 过滤（官方 All/Public/Secret）
  const [type, setType] = useState<"all" | "public" | "secret">("all");
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setGists(null);
    setError(null);
    setPage(1);
    setHasMore(true);
    fetchMyGists(token, 50)
      .then((list) => {
        if (!cancelled) {
          setGists(list);
          setHasMore(list.length >= 50);
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** 加载更多：追加下一页并去重 */
  const loadMore = async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchMyGists(token, 50, page + 1);
      setGists((prev) => {
        const seen = new Set((prev ?? []).map((g) => g.id));
        return [...(prev ?? []), ...next.filter((g) => !seen.has(g.id))];
      });
      setPage((p) => p + 1);
      setHasMore(next.length >= 50);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  const visible = useMemo(() => {
    if (!gists) return null;
    return gists.filter((g) => {
      if (type === "public") return g.public;
      if (type === "secret") return !g.public;
      return true;
    });
  }, [gists, type]);

  return (
    /* 官方 E 型：左用户卡 + 右列表（单栏→两栏对齐 gist.github.com） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={{
          node: user ? (
            <div className="flex flex-col gap-3">
              <Avatar className="size-16">
                <AvatarImage src={user.avatarUrl ?? undefined} alt={user.login} />
                <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-lg font-semibold leading-tight">{user.login}</h1>
                <p className="text-sm text-muted-foreground">gist</p>
              </div>
              <Button variant="outline" size="sm" className="w-full" asChild>
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
        }}
      >
        <div className="space-y-4">
          {/* 标题 + 新建 */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileCode2 className="size-6 text-muted-foreground" />
              <div>
                <h1 className="text-2xl font-semibold">Gist</h1>
                <p className="text-sm text-muted-foreground">{t("navpage.gists.desc")}</p>
              </div>
            </div>
            <PermissionGate permission="gist">
              <Button size="sm" className="gap-1" asChild>
                <Link to="/gist/new">
                  <Plus className="size-3.5" />
                  新建 Gist
                </Link>
              </Button>
            </PermissionGate>
          </header>

          {/* C7：Type 过滤（官方 All/Public/Secret） */}
          {visible !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={type} onValueChange={(v) => setType(v as "all" | "public" | "secret")}>
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

// ===== 通知（/notifications）=====

export function NotificationsPage() {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 协作邀请（通知联动）
  const [invites, setInvites] = useState<RepositoryInvitation[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // 通知已读（需 notifications scope；无权限时静默失败并提示）
  const [marking, setMarking] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
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
    fetchNotifications(token, 20)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setHasMore(list.length >= 20);
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    // 协作邀请（repo scope 可读；404/403 静默忽略——无权限或已过期）
    fetchRepoInvitations(token, 20)
      .then((list) => !cancelled && setInvites(list))
      .catch(() => !cancelled && setInvites([]));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** 加载更多：追加下一页并去重 */
  const loadMore = async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotifications(token, 20, page + 1);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id));
        return [...(prev ?? []), ...next.filter((n) => !seen.has(n.id))];
      });
      setPage((p) => p + 1);
      setHasMore(next.length >= 20);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  // 全部标记已读（PUT /notifications，需 notifications scope）
  const markAll = async () => {
    if (!token || marking) return;
    setMarking(true);
    setMarkError(null);
    try {
      await markAllNotificationsRead(token);
      setItems((prev) => prev?.map((n) => ({ ...n, unread: false })) ?? null);
    } catch (e) {
      setMarkError(apiErrorMessage(e, t("notifications.markFailed")));
    } finally {
      setMarking(false);
    }
  };

  // 单条线程标记已读（PATCH /notifications/threads/{id}，需 notifications scope）
  const markOne = async (n: Notification) => {
    if (!token || markingId !== null) return;
    setMarkingId(n.id);
    setMarkError(null);
    try {
      await markNotificationThreadRead(n.id, token);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, unread: false } : x)) ?? null);
    } catch (e) {
      setMarkError(apiErrorMessage(e, t("notifications.markFailed")));
    } finally {
      setMarkingId(null);
    }
  };

  const actOnInvite = async (inv: RepositoryInvitation, accept: boolean) => {
    if (!token || busyId !== null) return;
    setBusyId(inv.id);
    setInviteError(null);
    try {
      if (accept) {
        await acceptRepoInvitation(inv.id, token);
      } else {
        await declineRepoInvitation(inv.id, token);
      }
      setInvites((prev) => prev?.filter((i) => i.id !== inv.id) ?? null);
    } catch (e) {
      setInviteError(
        apiErrorMessage(e, accept ? t("invite.acceptFailed") : t("invite.declineFailed")),
      );
    } finally {
      setBusyId(null);
    }
  };

  const permissionLabel: Record<string, string> = {
    read: t("invite.permission.read"),
    write: t("invite.permission.write"),
    admin: t("invite.permission.admin"),
  };

  const reasonLabel: Record<string, string> = {
    mention: t("notifications.reason.mention"),
    author: t("notifications.reason.author"),
    comment: t("notifications.reason.comment"),
    review_requested: t("notifications.reason.review_requested"),
    assign: t("notifications.reason.assign"),
    state_change: t("notifications.reason.state_change"),
    security_alert: t("notifications.reason.security_alert"),
  };

  return (
    /* 官方 C 型：左 Folders/Filters 导航 + 右通知列表（单栏→两栏对齐） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={{
          node: (
            <nav className="rounded-lg border bg-card p-2">
              <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("notifications.folders")}
              </h3>
              <ul className="space-y-0.5">
                <li>
                  <span className="flex w-full items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-foreground">
                    <Inbox className="size-4 shrink-0" />
                    {t("notifications.inbox")}
                  </span>
                </li>
                <li>
                  <span className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60">
                    <Check className="size-4 shrink-0" />
                    {t("notifications.done")}
                  </span>
                </li>
              </ul>
              <h3 className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("notifications.filters")}
              </h3>
              <ul className="space-y-0.5">
                {(["assign", "participating", "mention"] as const).map((r) => (
                  <li key={r}>
                    <span className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60">
                      <span className="size-4 shrink-0" />
                      {reasonLabel[r] ?? r}
                    </span>
                  </li>
                ))}
              </ul>
            </nav>
          ),
          width: 240,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          {/* 标题 + Mark all（官方通知中心头部） */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Bell className="size-6 text-muted-foreground" />
              <div>
                <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
                <p className="text-sm text-muted-foreground">{t("navpage.notifications.desc")}</p>
              </div>
            </div>
            <WriteGate>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={marking || !canWrite}
                onClick={() => void markAll()}
              >
                <Check className="size-3.5" />
                {marking ? t("notifications.markAllBusy") : t("notifications.markAll")}
              </Button>
            </WriteGate>
          </header>

          {markError && <InlineError message={markError} />}
          {/* 协作邀请（官方：邀请出现在通知中心；接受后成为协作者） */}
          {invites && invites.length > 0 && (
            <div className="mb-6 space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <UserPlus className="size-5 text-primary" />
                {t("invite.title")}
                <Badge variant="outline" className="text-xs">
                  {invites.length}
                </Badge>
              </h2>
              {inviteError && <InlineError message={inviteError} />}
              {invites.map((inv) => (
                <Card key={inv.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/${inv.repository.full_name}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {inv.repository.full_name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserPlus className="size-3.5" />
                          {inv.inviter?.login ?? "未知用户"} {t("invite.invitedYou")}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {permissionLabel[inv.permissions] ?? inv.permissions}
                        </Badge>
                        {inv.repository.private && (
                          <Badge variant="outline" className="text-xs">
                            {t("common.repoPrivate")}
                          </Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3.5" />
                          {fmt(inv.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <WriteGate>
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={!canWrite || busyId !== null}
                          onClick={() => void actOnInvite(inv, true)}
                        >
                          {busyId === inv.id ? (
                            t("invite.processing")
                          ) : (
                            <>
                              <Check className="size-3.5" />
                              {t("invite.accept")}
                            </>
                          )}
                        </Button>
                      </WriteGate>
                      <WriteGate>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={!canWrite || busyId !== null}
                          onClick={() => void actOnInvite(inv, false)}
                        >
                          {busyId === inv.id ? (
                            t("invite.processing")
                          ) : (
                            <>
                              <X className="size-3.5" />
                              {t("invite.decline")}
                            </>
                          )}
                        </Button>
                      </WriteGate>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {error ? (
            <ThrowError err={error} />
          ) : items === null ? (
            <LoadingList />
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("empty.notifications")}
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((n) => {
                // subject.url 形如 https://api.github.com/repos/o/r/issues/123
                const m = n.subject.url?.match(/\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/);
                const owner = m?.[1] ?? "";
                const repo = m?.[2] ?? "";
                const kind = m?.[3] ?? "";
                const num = m?.[4] ?? "";
                const to =
                  owner && repo
                    ? `/${owner}/${repo}/${kind === "pulls" ? "pulls" : "issues"}/${num}`
                    : `/${n.repository.full_name}`;
                return (
                  <Card key={n.id} className="hover:bg-accent/50 transition-colors">
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <Link to={to} className="min-w-0 text-primary hover:underline line-clamp-2">
                          {n.subject.title}
                        </Link>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {n.unread && (
                            <Badge className="shrink-0 text-xs">{t("notifications.unread")}</Badge>
                          )}
                          {/* 单条标记已读（未读 + 完全控制时显示） */}
                          {n.unread && canWrite && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-primary"
                              title={t("notifications.markRead")}
                              disabled={markingId !== null}
                              onClick={() => void markOne(n)}
                            >
                              {markingId === n.id ? (
                                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                              ) : (
                                <Check className="size-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {reasonLabel[n.reason] ?? n.reason}
                        </Badge>
                        <span className="font-mono">{n.repository.full_name}</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3.5" />
                          {fmt(n.updated_at)}
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
        </div>
      </PageLayout>
    </div>
  );
}
