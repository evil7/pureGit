/**
 * 仓库分支管理页（/branches 与 /branches/:filter，官方 /branches 复刻）
 *
 * 官方结构：标题「Branches」+ 搜索框 + 四个子视图（Overview/Active/Stale/All，URL 驱动）。
 * Overview 视图：默认分支 + 活跃分支（最近 90 天有提交）分节展示；
 * Active/Stale/All 视图：按活跃度过滤的完整列表。
 *
 * 数据通道：fetchBranchesDetailSmart（GraphQL 分页，每页 10 分支 + 内联 Ref.compare 拿相对
 * 默认分支的 ahead/behind；失败/匿名熔断降级 REST 仅 name+sha）。「加载更多」逐页追加，
 * 对齐官方「每页约 10 个、翻页递进加载」，防一次拉全量压垮 API。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitBranch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { UserAvatar } from "@/components/UserAvatar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, tStatic } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useRepoData } from "@/lib/repo/repo-context";
import { fetchBranchesDetailSmart, apiErrorMessage, type BranchDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

/** 活跃/过期分界：90 天（官方「活跃分支」语义：最近 3 个月有提交） */
const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Overview 视图「活跃分支」区最多展示条数（超出显示「查看更多分支」） */
const OVERVIEW_ACTIVE_LIMIT = 10;

/** 子视图（URL 驱动：/branches → overview，/branches/{active|stale|all}） */
const VIEWS = [
  { key: "overview", to: "", labelKey: "branches.overview" },
  { key: "active", to: "/active", labelKey: "branches.active" },
  { key: "stale", to: "/stale", labelKey: "branches.stale" },
  { key: "all", to: "/all", labelKey: "branches.all" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default function BranchesPage() {
  const { owner = "", repo = "" } = useParams();
  const { filter } = useParams<{ filter?: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const repoData = useRepoData();
  const defaultName = repoData?.default_branch ?? "main";

  // 分页状态：已加载分支 + 续接游标（GraphQL）/ 页码（REST 降级）+ 是否有下一页
  const [branches, setBranches] = useState<BranchDetail[] | null>(null);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [restPage, setRestPage] = useState(2);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // URL 子视图归一化：仅 active/stale/all 有效，其余（含无参数）→ overview
  const view: ViewKey =
    filter === "active" || filter === "stale" || filter === "all" ? filter : "overview";

  // 首屏拉取第一页（每页 10）；依赖不含 t——useI18n 的 t 每次渲染新建引用，若入依赖会死循环刷请求
  useEffect(() => {
    let cancelled = false;
    setBranches(null);
    setLoadError(null);
    setEndCursor(null);
    setRestPage(2);
    setHasNextPage(false);
    fetchBranchesDetailSmart(owner, repo, defaultName, null, 1, token)
      .then((r) => {
        if (cancelled) return;
        setBranches(r.branches);
        setEndCursor(r.endCursor);
        setHasNextPage(r.hasNextPage);
        setRestPage(r.restPage ?? 2);
      })
      .catch((e) => {
        if (cancelled) return;
        setBranches([]);
        setLoadError(
          apiErrorMessage(
            e,
            tStatic("common.loadFailed").replace(
              "{error}",
              e instanceof Error ? e.message : String(e),
            ),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, defaultName, token]);

  /** 加载更多：游标（GraphQL）/ 页码（REST 降级）续接追加下一页 */
  const loadMore = async () => {
    if (loadingMore || !hasNextPage) return;
    setLoadingMore(true);
    try {
      const r = await fetchBranchesDetailSmart(
        owner,
        repo,
        defaultName,
        endCursor,
        restPage,
        token,
      );
      setBranches((prev) => [...(prev ?? []), ...r.branches]);
      setEndCursor(r.endCursor);
      setHasNextPage(r.hasNextPage);
      setRestPage(r.restPage ?? restPage);
    } catch {
      // 失败保持原列表（下回点击重试）
    } finally {
      setLoadingMore(false);
    }
  };

  // 按活跃度分组 + 搜索过滤（默认分支单独列出，其余按 90 天窗口分活跃/过期）
  const { defaultBranch, active, stale, all } = useMemo(() => {
    const list = branches ?? [];
    const q = query.trim().toLowerCase();
    const match = (b: BranchDetail) => !q || b.name.toLowerCase().includes(q);
    const def = list.find((b) => b.name === defaultName);
    const others = list.filter((b) => b.name !== defaultName && match(b));
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    const isActive = (b: BranchDetail) =>
      Boolean(b.committedDate && new Date(b.committedDate).getTime() >= cutoff);
    return {
      defaultBranch: def && match(def) ? def : null,
      active: others.filter(isActive),
      stale: others.filter((b) => !isActive(b)),
      all: list.filter(match),
    };
  }, [branches, defaultName, query]);

  // 当前视图要渲染的列表
  const visible = view === "active" ? active : view === "stale" ? stale : view === "all" ? all : [];

  return (
    <div>
      {/* 页头：标题 + 搜索框 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t("branches.title")}</h2>
        <div className="relative ml-auto w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("branches.search")}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* 子视图 tab（URL 驱动，官方 Overview/Active/Stale/All） */}
      <nav className="mb-4 flex gap-1 border-b">
        {VIEWS.map((v) => {
          const isActive = view === v.key;
          return (
            <Link
              key={v.key}
              to={`/${owner}/${repo}/branches${v.to}`}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(v.labelKey)}
            </Link>
          );
        })}
      </nav>

      {loadError ? (
        <InlineError message={loadError} />
      ) : branches === null ? (
        <div className="space-y-6">
          {/* 默认分支分节 */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
          {/* 活跃分支分节 */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {view === "overview" ? (
            <OverviewView
              defaultBranch={defaultBranch}
              active={active}
              activeCount={active.length}
            />
          ) : (
            <BranchList branches={visible} defaultName={defaultName} fmt={fmt} />
          )}
          <LoadMoreButton
            loading={loadingMore}
            endReached={!hasNextPage}
            onClick={() => void loadMore()}
          />
        </>
      )}
    </div>
  );
}

/** Overview 视图：默认分支 + 活跃分支分节（活跃分支超限时「查看更多分支」→ /branches/active） */
function OverviewView({
  defaultBranch,
  active,
  activeCount,
}: {
  defaultBranch: BranchDetail | null;
  active: BranchDetail[];
  activeCount: number;
}) {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const shown = active.slice(0, OVERVIEW_ACTIVE_LIMIT);
  return (
    <div>
      {defaultBranch && (
        <section className="mb-6">
          <SectionTitle>{t("branches.defaultSection")}</SectionTitle>
          <BranchList branches={[defaultBranch]} defaultName={defaultBranch.name} fmt={fmt} />
        </section>
      )}
      <section>
        <SectionTitle>{t("branches.activeBranches")}</SectionTitle>
        {shown.length === 0 ? (
          <EmptyBranches />
        ) : (
          <>
            <BranchList branches={shown} defaultName="" fmt={fmt} />
            {activeCount > OVERVIEW_ACTIVE_LIMIT && (
              <Link
                to={`/${owner}/${repo}/branches/active`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                {t("branches.viewMore")}
              </Link>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** 分支列表（通用行渲染：分支名 + 默认徽章 + ahead/behind + 更新时间 + 最后提交信息/作者） */
function BranchList({
  branches,
  defaultName,
  fmt,
}: {
  branches: BranchDetail[];
  defaultName: string;
  fmt: (iso: string) => string;
}) {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();
  if (branches.length === 0) return <EmptyBranches />;
  return (
    <div className="overflow-hidden rounded-lg border">
      {branches.map((b) => {
        const isDefault = b.name === defaultName;
        const hasAhead =
          b.aheadBy != null && b.behindBy != null && (b.aheadBy > 0 || b.behindBy > 0);
        return (
          <div key={b.name} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  to={`/${owner}/${repo}/tree/${b.name}`}
                  className="truncate font-mono text-sm font-medium hover:underline"
                >
                  {b.name}
                </Link>
                {isDefault && (
                  <Badge variant="outline" className="text-xs">
                    {t("branches.default")}
                  </Badge>
                )}
              </div>
              {b.message && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {b.authorAvatarUrl && (
                    <UserAvatar
                      src={b.authorAvatarUrl}
                      alt={b.authorLogin ?? b.authorName}
                      className="size-4"
                    />
                  )}
                  <span className="truncate">{b.message}</span>
                </div>
              )}
            </div>
            {/* ahead/behind（相对默认分支；REST 降级/匿名 null → 不渲染） */}
            {hasAhead && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {b.aheadBy! > 0 && b.behindBy! > 0
                  ? t("branches.aheadBehind")
                      .replace("{ahead}", String(b.aheadBy))
                      .replace("{behind}", String(b.behindBy))
                  : b.aheadBy! > 0
                    ? t("branches.ahead").replace("{count}", String(b.aheadBy))
                    : t("branches.behind").replace("{count}", String(b.behindBy))}
              </span>
            )}
            {b.committedDate && (
              <span className="shrink-0 text-xs text-muted-foreground">{fmt(b.committedDate)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-sm font-medium text-muted-foreground">{children}</h3>;
}

function EmptyBranches() {
  const { t } = useI18n();
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("branches.empty")}</p>;
}
