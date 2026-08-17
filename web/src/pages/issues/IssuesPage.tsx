import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  CircleDot,
  MessageSquare,
  Plus,
  SlidersHorizontal,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/Pager";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useI18n, tStatic } from "@/i18n";
import { fetchIssuesSmart } from "@/lib/api";
import { apiErrorMessage } from "@/lib/restapi";
import type { Issue } from "@/lib/restapi";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { cn } from "@/lib/utils";
import { addQualifier, getQualifier, hasQualifier, removeQualifier } from "@/lib/api/search-syntax";
import { formatCount } from "@/lib/ui/format";
import { getLabelStyle } from "@/lib/ui/label-color";
import PageLayout from "@/components/PageLayout";
import { useDateFormat } from "@/hooks/useDateFormat";

type IssueState = "open" | "closed" | "all";

/** 左栏过滤器（官方 Issue filters，URL query 驱动，可分享） */
const FILTERS: {
  key: string;
  labelKey:
    | "issues.all"
    | "issues.assigned"
    | "issues.created"
    | "issues.mentioned"
    | "issues.recent";
  /** 点击后设置到搜索框的 qualifier（all 为空 = 清除 q） */
  qualifier: string;
}[] = [
  { key: "all", labelKey: "issues.all", qualifier: "" },
  { key: "assigned", labelKey: "issues.assigned", qualifier: "assignee:@me" },
  { key: "created", labelKey: "issues.created", qualifier: "author:@me" },
  { key: "mentioned", labelKey: "issues.mentioned", qualifier: "mentions:@me" },
  { key: "recent", labelKey: "issues.recent", qualifier: "sort:updated-desc" },
];

export default function IssuesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL query 驱动（官方风格）：单一 q（token 化语法）+ state（Open/Closed tab）+ page
  const state = (searchParams.get("state") as IssueState) ?? "open";
  const q = searchParams.get("q") ?? "";
  // 页码分页（URL 驱动，可分享）
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const [issues, setIssues] = useState<Issue[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // 过滤统一收敛为单一 q 增量（author/assignee/mentions/sort 均为 q 内 qualifier）
    const filters = { q: q || undefined };
    fetchIssuesSmart(owner!, repo!, state, token, filters, undefined, page)
      .then(({ items, openCount: openCountRes, closedCount: closedCountRes }) => {
        if (!cancelled) {
          setIssues(items);
          // 分页响应（page>1 REST 分支）计数可能为 null → 保留已有计数，totalPages 稳定（Pager 不消失）
          if (openCountRes != null) setOpenCount(openCountRes);
          if (closedCountRes != null) setClosedCount(closedCountRes);
        }
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
  }, [owner, repo, state, token, q, page]);

  // 更新 URL query（官方风格，可分享）
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  /** 页码分页：无过滤时按官方计数计算总页数（过滤态无总数，不渲染分页器） */
  const baseTotal =
    openCount != null && closedCount != null
      ? state === "open"
        ? openCount
        : state === "closed"
          ? closedCount
          : openCount + closedCount
      : null;
  // 全站翻页上限 999 页（官方 REST 1000 页上限内；页码窗口 Pager 折叠省略号）
  const totalPages =
    baseTotal != null && !q ? Math.min(999, Math.max(1, Math.ceil(baseTotal / 30))) : 1;
  const goPage = (p: number) => {
    updateParams({ page: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    /* 官方 C 型：左 filters + 右列表（PageLayout 收编 GRID_2COL_260） */
    <PageLayout
      gap="md"
      left={{
        node: (
          <nav className="flex flex-col gap-1">
            <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("issues.filters")}
            </h3>
            {FILTERS.map(({ key, labelKey, qualifier }) => {
              // 高亮判断直接基于 q 内 qualifier（搜索框 token 与左栏预设联动，单一事实源）
              const isActive =
                (key === "all" && !q) ||
                (key === "assigned" && hasQualifier(q, "assignee", "@me")) ||
                (key === "created" && hasQualifier(q, "author", "@me")) ||
                (key === "mentioned" && hasQualifier(q, "mentions", "@me")) ||
                (key === "recent" && hasQualifier(q, "sort", "updated-desc"));
              return (
                <Link
                  key={key}
                  to={`/${owner}/${repo}/issues?${qualifier ? `q=${encodeURIComponent(qualifier)}&` : ""}state=${state}`}
                  onClick={(e) => {
                    e.preventDefault();
                    // 预设项 = 整体替换 q（qualifier 为空即清除过滤）；过滤变化重置页码
                    updateParams({ q: qualifier || null, page: null });
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <CircleDot className="size-4 shrink-0" />
                  {t(labelKey)}
                </Link>
              );
            })}
            {q && (
              <button
                type="button"
                onClick={() => updateParams({ q: null, page: null })}
                className="mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
              >
                <X className="size-3.5" />
                {t("issues.clearFilters")}
              </button>
            )}
          </nav>
        ),
        width: 260,
        sticky: "nav",
      }}
    >
      {/* 右栏 */}
      <div className="space-y-3">
        {/* 标题行：计数 tab + New issue */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 border-b">
            <Link
              to={`/${owner}/${repo}/issues?state=open`}
              onClick={(e) => {
                e.preventDefault();
                updateParams({ state: "open", page: null });
              }}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                state === "open"
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <CircleDot className="size-4" />
              Open
              {openCount !== null && (
                <span className="text-xs text-muted-foreground">{formatCount(openCount)}</span>
              )}
            </Link>
            <Link
              to={`/${owner}/${repo}/issues?state=closed`}
              onClick={(e) => {
                e.preventDefault();
                updateParams({ state: "closed", page: null });
              }}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                state === "closed"
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <CheckCircle2 className="size-4" />
              Closed
              {closedCount !== null && (
                <span className="text-xs text-muted-foreground">{formatCount(closedCount)}</span>
              )}
            </Link>
          </div>
          <Button asChild>
            <Link to={`/${owner}/${repo}/issues/new`}>
              <Plus className="size-4" />
              New issue
            </Link>
          </Button>
        </div>

        {/* 过滤工具条：搜索 + Author/Sort（官方风格；下拉均操作 q 内 qualifier，与搜索框单一事实源联动） */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <RepoSearchInput
            defaultValue={q}
            placeholder={t("issues.searchPlaceholder")}
            onSubmit={(raw) => updateParams({ q: raw || null, page: null })}
            className="min-w-0 flex-1"
          />
          <Select
            value={hasQualifier(q, "author", "@me") ? "@me" : ""}
            onValueChange={(v) => {
              const next =
                v === "@me" ? addQualifier(q, "author", "@me") : removeQualifier(q, "author");
              updateParams({ q: next || null, page: null });
            }}
          >
            <SelectTrigger className="w-auto min-w-24">
              <SelectValue placeholder={t("issues.author")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="@me">{t("issues.by")} @me</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={
              getQualifier(q, "sort") === "comments-desc"
                ? "comments"
                : getQualifier(q, "sort") === "updated-desc"
                  ? "updated"
                  : "created"
            }
            onValueChange={(v) => {
              const next =
                v === "created"
                  ? removeQualifier(q, "sort")
                  : addQualifier(q, "sort", v === "comments" ? "comments-desc" : "updated-desc");
              updateParams({ q: next || null, page: null });
            }}
          >
            <SelectTrigger className="w-auto min-w-24">
              <SlidersHorizontal className="size-3.5" />
              <SelectValue placeholder={t("issues.sort")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">{t("issues.sort.newest")}</SelectItem>
              <SelectItem value="comments">{t("issues.sort.comments")}</SelectItem>
              <SelectItem value="updated">{t("issues.sort.updated")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {error && <InlineError message={error} />}

        {!loading && !error && (
          <div className="space-y-3">
            {issues.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.issues")}</p>
            ) : (
              issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} owner={owner!} repo={repo!} fmt={fmt} />
              ))
            )}
            {/* 页码分页（每页 30；仅 >1 页时渲染） */}
            {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={goPage} />}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export function IssueRow({
  issue,
  owner,
  repo,
  fmt,
}: {
  issue: Issue;
  owner: string;
  repo: string;
  fmt: (iso: string) => string;
}) {
  const isDark = useIsDark();
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <Link
            to={`/${owner}/${repo}/issues/${issue.number}`}
            className="min-w-0 text-primary hover:underline line-clamp-2"
          >
            {issue.title}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">#{issue.number}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {/* 状态图标（官方：open=绿圈/closed=紫叉）+ 作者 opened + 时间（fmt 日期格式偏好） */}
          <span className="flex items-center gap-1">
            {issue.state === "open" ? (
              <CircleDot className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
            ) : (
              <XCircle className="size-3.5 text-[#8250df] dark:text-[#a371f7]" />
            )}
          </span>
          <span>
            <Link
              to={`/${issue.user.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {issue.user.login}
            </Link>{" "}
            {issue.state === "closed" ? tStatic("issues.closed") : tStatic("issues.opened")}{" "}
            {fmt(issue.state === "closed" && issue.closed_at ? issue.closed_at : issue.created_at)}
          </span>
          {issue.labels && issue.labels.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {issue.labels.slice(0, 3).map((l) => (
                <Badge
                  key={l.name}
                  className="text-[11px] font-medium"
                  style={getLabelStyle(l.color, isDark)}
                >
                  {l.name}
                </Badge>
              ))}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            {issue.comments}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
