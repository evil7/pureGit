import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDot,
  CircleX,
  FileDiff,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Milestone,
  Minus,
  Plus,
  SlidersHorizontal,
  Tag,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/Pager";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useI18n, type I18nKey } from "@/i18n";
import {
  fetchPullsSmart,
  setIssueSubscriptionSmart,
  fetchPullDetailFullSmart,
  fetchPullTimelineSmart,
  requestReviewersSmart,
  updatePullRequestStateSmart,
  fetchRepoLabelsSmart,
  fetchRepoAssigneesSmart,
  fetchRepoMilestonesSmart,
  fetchPullCheckRunsSmart,
  fetchPullCommitsSmart,
} from "@/lib/api";
import {
  apiErrorMessage,
  fetchContributors,
  fetchPullFiles,
  fetchRepoLabelCount,
  fetchRepoMilestoneCount,
  normalizeApiError,
  ApiError,
  type CheckRunsSummary,
  type PullCommit,
  type RepoLabel,
  type RepoMilestone,
} from "@/lib/rest";
import type { PullRequest, IssueComment, PullFile } from "@/lib/rest";
import type { PullReviewSummary, PullTimelineEvent } from "@/lib/api";
import { CommentsSection } from "@/components/CommentsSection";
import { PullTimeline } from "@/components/PullTimeline";
import { MarkdownView } from "@/components/MarkdownView";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { repoRawBase } from "@/lib/repo-raw";
import { UserAvatar } from "@/components/UserAvatar";
import { DiffView } from "@/components/DiffView";
import {
  ReviewersSidebar,
  ReviewChangesDialog,
  MergePanel,
  ReviewStateBadge,
} from "@/components/PullReviewPanel";
import { COPILOT_AVATAR, copilotDisplayName, isCopilotLogin } from "@/lib/copilot";
import { STATE_BADGE_SOLID } from "@/lib/state-colors";
import { PullMetadataSidebar } from "@/components/PullMetadataSidebar";
import { getLabelStyle } from "@/lib/label-color";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { useDateFormat } from "@/hooks/useDateFormat";
import PageLayout from "@/components/PageLayout";
import { toastError, toastSuccess } from "@/lib/toast";

type PullState = "open" | "closed" | "all";

/** 官方 Sort 菜单项（URL sort 值 ↔ 文案） */
const SORT_OPTIONS: { value: string; labelKey: I18nKey }[] = [
  { value: "created", labelKey: "pulls.sort.newest" },
  { value: "created-asc", labelKey: "pulls.sort.oldest" },
  { value: "comments", labelKey: "pulls.sort.mostCommented" },
  { value: "comments-asc", labelKey: "pulls.sort.leastCommented" },
  { value: "updated", labelKey: "pulls.sort.recentlyUpdated" },
  { value: "updated-asc", labelKey: "pulls.sort.leastRecentlyUpdated" },
  { value: "best", labelKey: "pulls.sort.bestMatch" },
];

/** 官方结构 pulls 列表页：工具条(Filters+搜索+Labels/Milestones+New) → Box(状态链接+过滤按钮组+行列表) → 空态/ProTip */
export default function PullsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL query 驱动（官方风格）：state / author / labels / milestone / assignee / q / sort / page
  const state = (searchParams.get("state") as PullState) ?? "open";
  const author = searchParams.get("author") ?? "";
  const labels = searchParams.get("labels") ?? "";
  const milestone = searchParams.get("milestone") ?? "";
  const assignee = searchParams.get("assignee") ?? "";
  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const [labelsCount, setLabelsCount] = useState<number | null>(null);
  const [milestonesCount, setMilestonesCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 过滤下拉数据源（contributors/labels/milestones/assignees，进入页面即并行预取一次）
  const [contributors, setContributors] = useState<{ login: string }[]>([]);
  const [repoLabels, setRepoLabels] = useState<RepoLabel[]>([]);
  const [repoMilestones, setRepoMilestones] = useState<RepoMilestone[]>([]);
  const [assignees, setAssignees] = useState<{ login: string; avatar_url?: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchRepoLabelCount(owner!, repo!, token),
      fetchRepoMilestoneCount(owner!, repo!, token),
      fetchContributors(owner!, repo!, token).catch(() => []),
      fetchRepoLabelsSmart(owner!, repo!, token).catch(() => []),
      fetchRepoMilestonesSmart(owner!, repo!, token).catch(() => []),
      fetchRepoAssigneesSmart(owner!, repo!, token).catch(() => []),
    ])
      .then(([lc, mc, cs, rls, rms, as]) => {
        if (!cancelled) {
          setLabelsCount(lc);
          setMilestonesCount(mc);
          setContributors(cs);
          setRepoLabels(rls);
          setRepoMilestones(rms);
          setAssignees(as);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  // 更新 URL query
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = {
      author: author || undefined,
      labels: labels || undefined,
      milestone: milestone || undefined,
      assignee: assignee || undefined,
      q: q || undefined,
      sort: sort || undefined,
    };
    fetchPullsSmart(owner!, repo!, state, token, filters, page)
      .then(({ items, openCount: openCountRes, closedCount: closedCountRes }) => {
        if (!cancelled) {
          setPulls(items);
          setOpenCount(openCountRes);
          setClosedCount(closedCountRes);
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
  }, [owner, repo, state, token, author, labels, milestone, assignee, q, sort, page]);

  /** 页码分页：无过滤时按官方计数计算总页数（过滤态无总数，不渲染分页器） */
  const hasFilters = !!(author || labels || milestone || assignee || q);
  const baseTotal =
    openCount != null && closedCount != null
      ? state === "open"
        ? openCount
        : state === "closed"
          ? closedCount
          : openCount + closedCount
      : null;
  const totalPages = baseTotal != null && !hasFilters ? Math.max(1, Math.ceil(baseTotal / 30)) : 1;
  const goPage = (p: number) => {
    updateParams({ page: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 过滤下拉选项
  const authorOptions = [
    { value: "@me", label: t("pulls.me") },
    ...contributors.map((c) => ({ value: c.login, label: c.login })),
  ];
  const labelOptions = repoLabels.map((l) => ({ value: l.name, label: l.name }));
  const milestoneOptions = repoMilestones.map((m) => ({
    value: m.title,
    label: m.title,
  }));
  const assigneeOptions = [
    { value: "@me", label: t("pulls.me") },
    ...assignees.map((a) => ({ value: a.login, label: a.login })),
  ];

  return (
    <div className="space-y-4">
      {/* ① 搜索工具条：Filters 下拉 + 搜索框 + Labels/Milestones 链接 + New pull request */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FiltersMenu owner={owner!} repo={repo!} />
          <RepoSearchInput
            defaultValue={q}
            placeholder={`is:pr is:${state}`}
            onSubmit={(raw) => updateParams({ q: raw || null, page: null })}
            className="min-w-0 flex-1"
          />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            to={`/${owner}/${repo}/labels`}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Tag className="size-4" />
            {t("pulls.labels")}
            {labelsCount !== null && (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-foreground">
                {labelsCount}
              </span>
            )}
          </Link>
          <Link
            to={`/${owner}/${repo}/milestones`}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Milestone className="size-4" />
            {t("pulls.milestones")}
            {milestonesCount !== null && (
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-foreground">
                {milestonesCount}
              </span>
            )}
          </Link>
          <Button size="sm" className="h-8" asChild>
            <Link to={`/${owner}/${repo}/pulls/new`}>
              <Plus className="size-4" />
              New pull request
            </Link>
          </Button>
        </div>
      </div>

      {/* ② 列表 Box：状态链接 + 过滤按钮组 + 行列表 */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5">
          {/* 状态链接（btn-link 风格：icon + 文字 + 计数，无下划线） */}
          <div className="flex items-center gap-1">
            <Link
              to={`/${owner}/${repo}/pulls?state=open`}
              onClick={(e) => {
                e.preventDefault();
                updateParams({ state: "open", page: null });
              }}
              aria-current={state === "open" ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 px-1.5 py-1.5 text-sm transition-colors",
                state === "open"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitPullRequest className="size-4" />
              Open
              {openCount !== null && (
                <span className="text-xs text-muted-foreground">{formatCount(openCount)}</span>
              )}
            </Link>
            <Link
              to={`/${owner}/${repo}/pulls?state=closed`}
              onClick={(e) => {
                e.preventDefault();
                updateParams({ state: "closed", page: null });
              }}
              aria-current={state === "closed" ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 px-1.5 py-1.5 text-sm transition-colors",
                state === "closed"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CheckCircle2 className="size-4" />
              Closed
              {closedCount !== null && (
                <span className="text-xs text-muted-foreground">{formatCount(closedCount)}</span>
              )}
            </Link>
          </div>
          {/* 过滤按钮组（Author/Label/Milestones/Assignee/Sort，Popover+Command） */}
          <div className="flex items-center gap-0.5">
            <FilterDropdown
              label={t("pulls.author")}
              icon={<User className="size-3.5" />}
              filterPlaceholder={t("pulls.filterAuthor")}
              options={authorOptions}
              value={author}
              onSelect={(v) => updateParams({ author: v, page: null })}
            />
            <FilterDropdown
              label={t("pulls.label")}
              icon={<Tag className="size-3.5" />}
              filterPlaceholder={t("pulls.filterLabel")}
              options={labelOptions}
              value={labels}
              onSelect={(v) => updateParams({ labels: v, page: null })}
            />
            <FilterDropdown
              label={t("pulls.milestone")}
              icon={<Milestone className="size-3.5" />}
              filterPlaceholder={t("pulls.filterMilestone")}
              options={milestoneOptions}
              value={milestone}
              onSelect={(v) => updateParams({ milestone: v, page: null })}
            />
            <FilterDropdown
              label={t("pulls.assignee")}
              icon={<Users className="size-3.5" />}
              filterPlaceholder={t("pulls.filterAssignee")}
              options={assigneeOptions}
              value={assignee}
              onSelect={(v) => updateParams({ assignee: v, page: null })}
            />
            <FilterDropdown
              label={t("pulls.sort")}
              icon={<SlidersHorizontal className="size-3.5" />}
              filterPlaceholder={t("pulls.filterPlaceholder", { label: t("pulls.sort") })}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={sort && sort !== "created" ? sort : ""}
              onSelect={(v) => updateParams({ sort: v === "created" ? null : v, page: null })}
            />
          </div>
        </div>

        {/* 行列表 / 加载骨架 / 错误 / 空态 */}
        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="size-4 shrink-0" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <InlineError message={error} />
          </div>
        ) : pulls.length === 0 ? (
          <EmptyState state={state} />
        ) : (
          <div className="divide-y">
            {pulls.map((pr) => (
              <PullRow key={pr.id} pr={pr} owner={owner!} repo={repo!} fmt={fmt} />
            ))}
          </div>
        )}
      </div>

      {/* 页码分页（每页 30；仅 >1 页时渲染） */}
      {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={goPage} />}
    </div>
  );
}

/** 官方 Filters 下拉：预置搜索链接（Popover + 链接列表） */
function FiltersMenu({ owner, repo }: { owner: string; repo: string }) {
  const { t } = useI18n();
  const items: { labelKey: I18nKey; to: string }[] = [
    { labelKey: "pulls.filterAll", to: `/${owner}/${repo}/pulls` },
    { labelKey: "pulls.filterYour", to: `/${owner}/${repo}/pulls?author=%40me` },
    { labelKey: "pulls.filterAssigned", to: `/${owner}/${repo}/pulls?assignee=%40me` },
    {
      labelKey: "pulls.filterMentioned",
      to: `/${owner}/${repo}/pulls?q=is%3Apr%20mentions%3A%40me`,
    },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 rounded-r-none px-2.5">
          {t("pulls.filters")}
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="border-b px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Filter Issues
        </div>
        {items.map((it) => (
          <Link
            key={it.labelKey}
            to={it.to}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            {t(it.labelKey)}
          </Link>
        ))}
        <div className="mt-1 border-t pt-1">
          <a
            href="https://github.com/search/advanced"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            {t("pulls.filterAdvanced")}
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 通用过滤下拉（官方 SelectMenu 同款：标题 + 过滤输入 + 选项列表；Popover+Command） */
function FilterDropdown({
  label,
  icon,
  filterPlaceholder,
  options,
  value,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  filterPlaceholder: string;
  options: { value: string; label: string }[];
  value?: string;
  onSelect: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1 px-1.5 text-xs font-medium text-muted-foreground",
            "data-[state=open]:text-foreground",
            value && "text-foreground",
          )}
        >
          {icon}
          {label}
          {value && <span className="max-w-24 truncate text-foreground">{value}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <Command>
          <CommandInput
            placeholder={filterPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="h-8"
          />
          <CommandList>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={(v) => {
                    onSelect(v === value ? null : v);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </CommandItem>
              ))}
              {filtered.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              )}
            </CommandGroup>
            {value && (
              <CommandItem
                onSelect={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="border-t"
              >
                {t("issues.clearFilters")}
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 官方空态（blankslate）：图标 + 标题 + 「You could search all of GitHub or try an advanced search.」 */
function EmptyState({ state }: { state: PullState }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <GitPullRequest className="size-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">
        {t("pulls.empty.title", {
          state: state === "open" ? t("pulls.empty.state.open") : t("pulls.empty.state.closed"),
        })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("pulls.empty.desc1")}{" "}
        <Link to="/search" className="text-primary hover:underline">
          {t("pulls.empty.desc2")}
        </Link>{" "}
        {t("pulls.empty.desc3")}{" "}
        <a
          href="https://github.com/search/advanced"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {t("pulls.empty.desc4")}
        </a>{" "}
        {t("pulls.empty.desc5")}
      </p>
    </div>
  );
}

/** CI checks 状态（仅颜色区分图标 + tooltip 显示详情——官方标题后 checks 图标语义：
 * 绿=全过 / 黄=pending / 红=失败；hover tooltip 显示 N/M checks OK） */
function ChecksStatusIcon({ summary }: { summary: CheckRunsSummary }) {
  const failed = summary.failure > 0;
  const pending = !failed && summary.pending > 0;
  const label = failed
    ? `${summary.failure} checks failed`
    : pending
      ? `${summary.pending} checks pending`
      : `${summary.success}/${summary.total} checks OK`;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex shrink-0 items-center",
              failed
                ? "text-red-600 dark:text-red-400"
                : pending
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-green-600 dark:text-green-400",
            )}
          >
            {failed ? (
              <CircleX className="size-4" />
            ) : pending ? (
              <CircleDashed className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={4}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** CI checks 徽标（完整文字版——详情页 Checks tab 用：绿=全过 / 黄=pending / 红=失败） */
function ChecksBadge({ summary }: { summary: CheckRunsSummary }) {
  const failed = summary.failure > 0;
  const pending = !failed && summary.pending > 0;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
        failed
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : pending
            ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
            : "bg-green-500/10 text-green-600 dark:text-green-400",
      )}
    >
      {failed ? (
        <CircleX className="size-3" />
      ) : pending ? (
        <CircleDashed className="size-3" />
      ) : (
        <CheckCircle2 className="size-3" />
      )}
      {summary.success}/{summary.total} checks OK
    </span>
  );
}

function PullStateBadge({ pr }: { pr: PullRequest }) {
  if (pr.state === "closed" && pr.merged_at) {
    return (
      <Badge className={cn(STATE_BADGE_SOLID.merged, "text-xs")}>
        <GitMerge className="size-3" />
        merged
      </Badge>
    );
  }
  if (pr.state === "open") {
    return (
      <Badge className={cn(STATE_BADGE_SOLID.open, "text-xs")}>
        <GitPullRequest className="size-3" />
        open
      </Badge>
    );
  }
  return (
    <Badge className={cn(STATE_BADGE_SOLID.closed, "text-xs")}>
      <GitPullRequestClosed className="size-3" />
      closed
    </Badge>
  );
}

/** 官方 Box-row 行：状态 icon + 标题列(标题+meta) + 右列(评论数+assignee 头像)；hover 灰底 */
export function PullRow({
  pr,
  owner,
  repo,
  fmt,
}: {
  pr: PullRequest;
  owner: string;
  repo: string;
  fmt: (iso: string) => string;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const isDark = useIsDark();
  const [checks, setChecks] = useState<CheckRunsSummary | null>(null);

  // check-runs 懒加载（仅 open PR 且 head.sha 存在）
  useEffect(() => {
    if (pr.state !== "open" || !pr.head?.sha) return;
    let cancelled = false;
    fetchPullCheckRunsSmart(owner, repo, pr.head.sha, token)
      .then((s) => !cancelled && setChecks(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, pr.state, pr.head?.sha, token]);

  // 状态图标：open=绿 PR / merged=紫 merge / closed=红 PR / draft=灰边框（官方 octicon 配色）
  const statusIcon = pr.draft ? (
    <GitPullRequestDraft className="size-4 shrink-0 text-muted-foreground" />
  ) : pr.state === "open" ? (
    <GitPullRequest className="size-4 shrink-0 text-[#1a7f37] dark:text-[#3fb950]" />
  ) : pr.merged_at ? (
    <GitMerge className="size-4 shrink-0 text-[#8250df] dark:text-[#a371f7]" />
  ) : (
    <GitPullRequestClosed className="size-4 shrink-0 text-[#cf222e] dark:text-[#f85149]" />
  );

  // meta 动词语义（官方 was opened/closed/merged by）
  const verb = pr.merged_at
    ? t("pulls.merged")
    : pr.state === "open"
      ? t("pulls.opened")
      : t("pulls.closed");

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50">
      {statusIcon}
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          {/* 标题行：标题 + checks 状态图标（tooltip 详情）+ 标签 badges（官方标题后布局） */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/${owner}/${repo}/pull/${pr.number}`}
              className="line-clamp-2 font-medium text-foreground transition-colors hover:text-primary hover:underline"
            >
              {pr.title}
            </Link>
            {checks && <ChecksStatusIcon summary={checks} />}
            {/* labels（标题后，紧随 checks 图标） */}
            {pr.labels && pr.labels.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {pr.labels.slice(0, 3).map((l) => (
                  <Badge
                    key={l.name}
                    className="rounded-full text-[10px] font-medium"
                    style={getLabelStyle(l.color, isDark)}
                  >
                    {l.name}
                  </Badge>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {/* meta：#n 由 作者 [Owner] 打开于 时间（官方 opened-by 语义） */}
          <span className="flex flex-wrap items-center gap-x-1">
            #{pr.number} {t("pulls.by")}{" "}
            <Link to={`/${pr.user.login}`} className="font-medium text-foreground hover:underline">
              {pr.user.login}
            </Link>
            {pr.user.login === owner && (
              <Badge variant="secondary" className="px-1 text-[10px] font-medium">
                {t("pulls.owner")}
              </Badge>
            )}{" "}
            {verb} {fmt(pr.created_at)}
          </span>
          {/* Draft 徽标 */}
          {pr.draft && (
            <Badge variant="outline" className="text-[10px]">
              Draft
            </Badge>
          )}
        </div>
      </div>
      {/* 右列（官方 col-4 右侧区，自右向左：linked issue → assigned 头像栈 → 评论数） */}
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {/* 关联 issue（tooltip：N linked issues） */}
        {!!pr.linked_issues && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`/${owner}/${repo}/issues/${pr.number}/linked_closing_reference?reference_location=REPO_ISSUES_INDEX`}
                  className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.preventDefault()}
                >
                  <CircleDot className="size-3.5" />
                  <span className="text-xs font-medium">{pr.linked_issues}</span>
                </a>
              </TooltipTrigger>
              <TooltipContent sideOffset={4}>
                {pr.linked_issues} linked {pr.linked_issues === 1 ? "issue" : "issues"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* assigned 头像栈（tooltip：Assigned to xxx） */}
        {pr.assignees && pr.assignees.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center -space-x-1.5">
                  {pr.assignees.slice(0, 3).map((a) => (
                    <UserAvatar
                      key={a.login}
                      src={a.avatar_url}
                      alt={a.login}
                      title={a.login}
                      className="size-5 ring-1 ring-border"
                    />
                  ))}
                </span>
              </TooltipTrigger>
              <TooltipContent sideOffset={4}>
                Assigned to {pr.assignees.map((a) => a.login).join(", ")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* 评论数（官方 octicon-comment：issue + review 合计） */}
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3.5" />
          {pr.comments}
        </span>
      </div>
    </div>
  );
}

export function PullDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [files, setFiles] = useState<PullFile[] | null>(null);
  const [commits, setCommits] = useState<PullCommit[] | null>(null);
  const [checks, setChecks] = useState<CheckRunsSummary | null | undefined>(undefined); // undefined=加载中 null=无checks
  const [reviewSummary, setReviewSummary] = useState<PullReviewSummary | null | undefined>(
    undefined,
  );
  // 时间线（GraphQL timelineItems；null=查询失败降级回退三段式渲染）
  const [timeline, setTimeline] = useState<PullTimelineEvent[] | null | undefined>(undefined);
  const [tab, setTab] = useState<"conversation" | "commits" | "checks" | "files">("conversation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPullDetailFullSmart(owner!, repo!, Number(number), token),
      token ? fetchPullTimelineSmart(owner!, repo!, Number(number), token) : Promise.resolve(null),
    ])
      .then(([{ pr: data, comments: cs, reviewSummary: summary }, tl]) => {
        if (!cancelled) {
          setPr(data);
          setComments(cs);
          setReviewSummary(summary);
          setTimeline(tl);
          // 订阅状态（GraphQL viewerSubscription）
          if (data.subscription) {
            setSubscribed(data.subscription !== "UNSUBSCRIBED");
          }
        }
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

  // Commits：切到该 tab 时懒加载
  useEffect(() => {
    if (tab !== "commits" || commits !== null) return;
    let cancelled = false;
    fetchPullCommitsSmart(owner!, repo!, Number(number), token)
      .then((list) => !cancelled && setCommits(list))
      .catch(() => !cancelled && setCommits([]));
    return () => {
      cancelled = true;
    };
  }, [tab, commits, owner, repo, number, token]);

  // Checks：切到该 tab 时懒加载（open PR 且 head.sha 存在）
  useEffect(() => {
    if (tab !== "checks" || checks !== undefined || !pr?.head?.sha) return;
    let cancelled = false;
    fetchPullCheckRunsSmart(owner!, repo!, pr.head.sha, token)
      .then((s) => !cancelled && setChecks(s ?? null))
      .catch(() => !cancelled && setChecks(null));
    return () => {
      cancelled = true;
    };
  }, [tab, checks, pr?.head?.sha, owner, repo, token]);

  // Files changed：切到该 tab 时懒加载
  useEffect(() => {
    if (tab !== "files" || files !== null) return;
    let cancelled = false;
    fetchPullFiles(owner!, repo!, Number(number), token)
      .then((list) => !cancelled && setFiles(list))
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [tab, files, owner, repo, number, token]);

  // 新评论即时追加：评论列表计数 + 时间线事件（官方发表评论后立即出现在 Conversation）
  const appendTimelineComment = (c: IssueComment) => {
    setComments((prev) => [...(prev ?? []), c]);
    setTimeline((prev) =>
      prev
        ? [
            ...prev,
            {
              kind: "comment",
              id: String(c.id),
              author: { login: c.user.login, avatarUrl: c.user.avatar_url ?? null },
              createdAt: c.created_at,
              body: c.body ?? "",
            } satisfies PullTimelineEvent,
          ]
        : prev,
    );
  };

  // 订阅切换（GraphQL 首选）
  const toggleSubscribe = async () => {
    if (!token) return;
    setSubscribing(true);
    try {
      const next = await setIssueSubscriptionSmart(
        owner!,
        repo!,
        Number(number),
        subscribed,
        token,
      );
      setSubscribed(next);
    } catch (e) {
      toastError(apiErrorMessage(e, "订阅操作失败"));
    } finally {
      setSubscribing(false);
    }
  };

  // fixed 精简头触发（官方 StickyPullRequestHeader 语义；参照 blob 页 scroll 监听模式）：
  // 完整头部滚出视口顶（bottom <= 57 topbar 下沿）→ 精简头 fixed 盖顶（portal 到 body 脱离 page-enter transform）
  const fullHeaderRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const el = fullHeaderRef.current;
      if (el) setStuck(el.getBoundingClientRect().bottom <= 57);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // 内容加载完成后补测一次（scroll 未触发时完整头可能已滚出，如 URL 带锚点直达；blob 页同款）
  useEffect(() => {
    const el = fullHeaderRef.current;
    if (el) setStuck(el.getBoundingClientRect().bottom <= 57);
  }, [pr, comments, files, tab]);

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        right={{
          node: (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（PR 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !pr) throw error ?? new ApiError(404);

  // 参与者 = 作者 + 指派人 + 评论者 + 评审作者（去重，官方同源聚合——Copilot 评审也计入）
  const participants = Array.from(
    new Map(
      [
        pr.user,
        ...(pr.assignees ?? []),
        ...(comments ?? []).map((c) => c.user),
        ...(reviewSummary?.reviews ?? []).map((r) => r.user),
      ]
        .filter((u) => u?.login)
        .map((u) => [u!.login, u!] as const),
    ).values(),
  ).map((u) => ({
    ...u,
    // Copilot 头像归一（REST review 作者返回 bot 头像/可能为空 → 统一官方 in/946600，与真实用户同尺寸同风格）
    avatar_url: isCopilotLogin(u.login) ? COPILOT_AVATAR : u.avatar_url,
  }));

  return (
    /* 官方 F 型：完整头部（随内容滚动，滚出视口后触发精简头）+ fixed 精简头 portal 到 body + 下方左右栏 */
    <div className="space-y-4">
      {/* ① 完整头部：不 sticky，正常文档流（官方 PageHeader 语义；滚出视口后精简头接管） */}
      <div ref={fullHeaderRef} className="space-y-3">
        <div className="pt-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to={`/${owner}/${repo}/pulls`}>
              <ArrowLeft className="size-4" />
              返回列表
            </Link>
          </Button>
        </div>

        {/* Header：标题 + #号 + 状态 + 分支信息（官方 wants to merge N commits into base from head） */}
        <header className="space-y-3 pt-1">
          {/* 标题行：标题与 #号 同属文本流（官方 gh-header-title + gh-header-number 并列；
              不设 flex-1——#号紧贴标题，与滚动后 sticky 精简头「名称 #{n}」布局一致） */}
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="min-w-0 text-2xl font-bold wrap-break-word">{pr.title}</h1>
            <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <PullStateBadge pr={pr} />
            <span className="flex items-center gap-1">
              <User className="size-3.5" />
              <Link
                to={`/${pr.user.login}`}
                className="font-medium text-foreground hover:underline"
              >
                {pr.user.login}
              </Link>
            </span>
            <span className="flex items-center gap-1">
              {pr.merged_at ? "merged" : pr.state === "open" ? "opened" : "closed"}{" "}
              {fmt ? fmt(pr.merged_at ?? pr.created_at) : ""}
            </span>
            {pr.base && (
              <span className="flex items-center gap-1">
                <GitBranch className="size-3.5" />
                wants to merge {pr.commits} commits into {pr.base.ref} from {pr.head?.ref}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <FileDiff className="size-3" />
              {pr.changed_files} 文件
            </Badge>
            <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-add-fg)" }}>
              <Plus className="size-3" />
              {pr.additions}
            </Badge>
            <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-del-fg)" }}>
              <Minus className="size-3" />
              {pr.deletions}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <MessageSquare className="size-3" />
              {pr.comments} 评论
            </Badge>
          </div>
        </header>

        {/* 评审操作区：Merge + Review changes + 关闭/重新打开（open PR 且有权限时） */}
        {(pr.state === "open" || pr.merged_at) && (
          <div className="mt-4 space-y-3">
            {pr.state === "open" && !pr.merged_at && (
              <MergePanel
                owner={owner!}
                repo={repo!}
                number={Number(number)}
                pullRequestId={reviewSummary?.pullRequestId}
                mergeable={reviewSummary?.mergeable ?? null}
                onMerged={() => setReviewSummary((prev) => prev && { ...prev, mergeable: null })}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {pr.state === "open" && (
                <>
                  <ReviewChangesDialog
                    owner={owner!}
                    repo={repo!}
                    number={Number(number)}
                    onReviewed={(r) =>
                      setReviewSummary(
                        (prev) =>
                          prev && {
                            ...prev,
                            reviews: [
                              r,
                              ...prev.reviews.filter((x) => x.user?.login !== r.user?.login),
                            ],
                          },
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await updatePullRequestStateSmart(
                          owner!,
                          repo!,
                          Number(number),
                          "closed",
                          token,
                          reviewSummary?.pullRequestId,
                        );
                        setPr((p) => (p ? { ...p, state: "closed" } : p));
                        toastSuccess("已关闭 PR");
                      } catch (e) {
                        toastError(apiErrorMessage(e, "关闭失败"));
                      }
                    }}
                  >
                    <CircleX className="size-3.5" />
                    关闭
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 四 tab（官方 Conversation / Commits / Checks / Files changed；line 型 = ghost 风格：
            宽度自适应内容（参考 repo 页 tabs nav）+ 底部 border-b 分割线 + 活动下划线） */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList variant="line" className="border-b">
            <TabsTrigger value="conversation">
              <MessageSquare className="size-3.5" />
              Conversation
              {comments && <span className="text-muted-foreground">{comments.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="commits">
              <GitCommit className="size-3.5" />
              Commits
              {pr.commits > 0 && <span className="text-muted-foreground">{pr.commits}</span>}
            </TabsTrigger>
            <TabsTrigger value="checks">
              <CheckCircle2 className="size-3.5" />
              Checks
              {checks && <span className="text-muted-foreground">{checks.total}</span>}
            </TabsTrigger>
            <TabsTrigger value="files">
              <FileDiff className="size-3.5" />
              Files changed
              {files && <span className="text-muted-foreground">{files.length}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ② 滚动后 fixed 精简头（官方 StickyPullRequestHeader：状态标 + 标题 + #号，不含 tabs）：
          portal 到 body——脱离 .page-enter transform 的 containing block（否则 fixed 相对 transform 容器失效） */}
      {stuck &&
        createPortal(
          <div className="fixed inset-x-0 top-14 z-40 border-b bg-background/95 shadow-sm backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
              <PullStateBadge pr={pr} />
              <span className="min-w-0 truncate text-sm font-semibold">{pr.title}</span>
              <span className="shrink-0 text-sm text-muted-foreground">#{pr.number}</span>
            </div>
          </div>,
          document.body,
        )}

      {/* ③ 下方左右栏：主列 tab 内容 + 右 metadata（官方 gutter-condensed 分型） */}
      <PageLayout
        gap="sm"
        right={{
          node: (
            <aside className="space-y-5 text-sm">
              {/* 审计者（官方 Reviewers metadata 第一位；+邀请审计 弹窗） */}
              <ReviewersSidebar
                owner={owner!}
                repo={repo!}
                authorLogin={pr.user.login}
                summary={reviewSummary ?? null}
                loading={reviewSummary === undefined}
                onRequestReviewers={async (logins) => {
                  if (!token) return;
                  await requestReviewersSmart(
                    owner!,
                    repo!,
                    Number(number),
                    logins,
                    token,
                    reviewSummary?.pullRequestId,
                  );
                  setReviewSummary(
                    (prev) =>
                      prev && {
                        ...prev,
                        reviewRequests: [
                          ...prev.reviewRequests,
                          ...logins.map((l) => ({ login: l, avatarUrl: "" })),
                        ],
                      },
                  );
                }}
              />

              {/* Assignees / Labels / Projects / Milestone / Development / participants / 底部订阅+锁定（官方 metadata 第二位起） */}
              <PullMetadataSidebar
                owner={owner!}
                repo={repo!}
                number={Number(number)}
                assignees={pr.assignees ?? []}
                labels={pr.labels ?? []}
                milestone={pr.milestone ?? null}
                locked={pr.locked ?? false}
                pullRequestId={reviewSummary?.pullRequestId}
                participants={participants}
                subscribed={subscribed}
                subscribing={subscribing}
                onToggleSubscribe={toggleSubscribe}
                onAssigneesChange={(users) => setPr((p) => (p ? { ...p, assignees: users } : p))}
                onLabelsChange={(labels) => setPr((p) => (p ? { ...p, labels } : p))}
                onMilestoneChange={(m) => setPr((p) => (p ? { ...p, milestone: m } : p))}
                onLockedChange={(locked) => setPr((p) => (p ? { ...p, locked } : p))}
              />
            </aside>
          ),
          width: 280,
          sticky: "nav",
          // stuck 时固定精简头（覆盖 56-112px）盖住侧栏顶 → 侧栏锚点下移至精简头下方
          // （!important 覆盖 SIDEBAR_STICKY 的 md:top-20；120px = topbar 56 + 精简头 56 + 8px 间隔）
          className: cn(stuck && "md:!top-[120px]"),
        }}
      >
        <div className="space-y-4">
          {/* Conversation：作者正文 + 时间线（失败降级：评审列表 + 评论区） */}
          {tab === "conversation" && (
            <div className="mt-4 space-y-4">
              {pr.body && (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-3 border-b pb-3 text-xs text-muted-foreground">
                      <UserAvatar src={pr.user.avatar_url} alt={pr.user.login} className="size-8" />
                      <span className="flex flex-wrap items-center gap-x-1.5">
                        <Link
                          to={`/${pr.user.login}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {pr.user.login}
                        </Link>
                        <span>
                          {pr.merged_at ? "merged" : pr.state === "open" ? "opened" : "closed"}{" "}
                          {fmt ? fmt(pr.merged_at ?? pr.created_at) : ""}
                        </span>
                      </span>
                    </div>
                    <div className="">
                      <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{pr.body}</MarkdownView>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 时间线（GraphQL timelineItems 事件混排；null=失败降级回退下方三段式） */}
              {timeline !== null && timeline !== undefined ? (
                <>
                  <PullTimeline events={timeline} owner={owner!} repo={repo!} />
                  {/* 评论区仅保留编辑器（评论列表已在时间线内；新评论即时追加到时间线） */}
                  {comments && (
                    <CommentsSection
                      owner={owner!}
                      repo={repo!}
                      number={Number(number)}
                      comments={[]}
                      onCommentAdded={appendTimelineComment}
                    />
                  )}
                </>
              ) : (
                <>
                  {/* 评审摘要：已提交的 review（approve/request changes/comment，官方 Conversation 顺序） */}
                  {reviewSummary && reviewSummary.reviews.length > 0 && (
                    <div className="space-y-3">
                      {reviewSummary.reviews.map((r) => (
                        <Card key={r.id}>
                          <CardContent className="space-y-2 p-4">
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <UserAvatar
                                src={r.user?.avatar_url}
                                alt={r.user?.login ?? "ghost"}
                                className="size-7"
                              />
                              <span className="flex flex-wrap items-center gap-x-1.5">
                                <Link
                                  to={`/${r.user?.login ?? ""}`}
                                  className="font-medium text-foreground hover:underline"
                                >
                                  {copilotDisplayName(r.user?.login ?? "ghost")}
                                </Link>
                                <span>
                                  {r.state === "APPROVED"
                                    ? "批准了这些更改"
                                    : r.state === "CHANGES_REQUESTED"
                                      ? "请求更改"
                                      : "提出了"}
                                  {r.submitted_at ? ` · ${fmt ? fmt(r.submitted_at) : ""}` : ""}
                                </span>
                              </span>
                              <ReviewStateBadge state={r.state} />
                            </div>
                            {r.body && (
                              <div className="text-sm">
                                <MarkdownView rawBase={repoRawBase(owner!, repo!)}>
                                  {r.body}
                                </MarkdownView>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  {comments && (
                    <CommentsSection
                      owner={owner!}
                      repo={repo!}
                      number={Number(number)}
                      comments={comments}
                      onCommentAdded={(c) => setComments((prev) => [...(prev ?? []), c])}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Commits：commit 列表（hash + 消息 + 作者 + 时间） */}
          {tab === "commits" && (
            <div className="mt-4 space-y-2">
              {commits === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : commits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无 commit</p>
              ) : (
                commits.map((c) => (
                  <Card key={c.sha}>
                    <CardContent className="flex items-start gap-3 p-4">
                      <UserAvatar
                        src={c.author?.avatar_url}
                        alt={c.author?.login ?? "unknown"}
                        className="size-8"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium wrap-break-word">
                          {c.commit.message.split("\n")[0]}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {copilotDisplayName(c.author?.login ?? c.commit.author.name)} ·{" "}
                          {fmt ? fmt(c.commit.author.date) : ""}
                        </p>
                      </div>
                      <code className="shrink-0 font-mono text-xs text-muted-foreground">
                        {c.sha.slice(0, 7)}
                      </code>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Checks：check-runs 汇总 + 状态 */}
          {tab === "checks" && (
            <div className="mt-4 space-y-3">
              {checks === undefined ? (
                <Skeleton className="h-24 w-full" />
              ) : checks === null ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  该 commit 无 check-run
                </p>
              ) : (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <ChecksBadge summary={checks} />
                      <span className="text-sm text-muted-foreground">
                        {checks.total} 个 check-run
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {checks.success} 通过 · {checks.failure} 失败 · {checks.pending} 进行中
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Files changed：diff 视图 */}
          {tab === "files" && (
            <div className="mt-4">
              {files === null ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <DiffView
                  files={files}
                  owner={owner}
                  repo={repo}
                  number={Number(number)}
                  baseSha={pr.base?.sha}
                  headSha={pr.head?.sha}
                />
              )}
            </div>
          )}
        </div>
      </PageLayout>
    </div>
  );
}
