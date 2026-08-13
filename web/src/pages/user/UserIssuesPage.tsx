/**
 * 用户级 Issues（/issues/*，官方 4 tab URL 驱动：assigned/created/mentioned/recent）
 *
 * topbar「All issues」对应的「我的维度」列表页（需登录）。
 * 数据源 fetchMyIssuesSmart（search is:issue + @me 首选 + REST 降级），游标续接加载更多；
 * 搜索框用统一语法系统（matchSearch 前端过滤已加载列表）。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Calendar, CircleDot, MessageSquare, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ThrowError } from "@/components/ErrorPages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import { fetchMyIssuesSmart, normalizeApiError, ApiError, type Issue } from "@/lib/api";
import { STATE_BADGE_SOLID } from "@/lib/ui/state-colors";
import { cn } from "@/lib/utils";
import { matchSearch } from "@/lib/api/search-syntax";
import { LoadingList, NavPageShell } from "./shared";

/** 解析 html_url（https://github.com/owner/repo/...）→ [owner, repo] */
function parseRepoFromUrl(url: string): { owner: string; repo: string } {
  const parts = url.replace("https://github.com/", "").split("/");
  return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
}

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

export default function UserIssuesPage() {
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
  // 加载更多：游标续接（GraphQL pageInfo；REST 降级无游标按「批次是否拉满」判断）
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setQ("");
    setEndCursor(null);
    setHasMore(true);
    fetchMyIssuesSmart(token, current.filter)
      .then((r) => {
        if (!cancelled) {
          setItems(r.items);
          setEndCursor(r.endCursor);
          setHasMore(r.hasNextPage);
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
      const next = await fetchMyIssuesSmart(token, current.filter, endCursor);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.id));
        return [...(prev ?? []), ...next.items.filter((i) => !seen.has(i.id))];
      });
      setEndCursor(next.endCursor);
      setHasMore(next.hasNextPage);
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
