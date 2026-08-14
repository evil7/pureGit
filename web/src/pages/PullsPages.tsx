import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Milestone,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/Pager";
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
  fetchRepoLabelsSmart,
  fetchRepoAssigneesSmart,
  fetchRepoMilestonesSmart,
  fetchPullCheckRunsBatchSmart,
} from "@/lib/api";
import {
  apiErrorMessage,
  fetchContributors,
  fetchRepoLabelCount,
  fetchRepoMilestoneCount,
  type CheckRunsSummary,
  type RepoLabel,
  type RepoMilestone,
} from "@/lib/restapi";
import type { PullRequest } from "@/lib/restapi";
import { RepoSearchInput } from "@/components/RepoSearchInput";
import { UserAvatar } from "@/components/UserAvatar";
import { getLabelStyle } from "@/lib/ui/label-color";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { useDateFormat } from "@/hooks/useDateFormat";

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
  // CI 状态批量映射（sha → 汇总；列表加载后一次批量请求填充，替代逐行单查）
  const [checksMap, setChecksMap] = useState<Map<string, CheckRunsSummary | null>>(new Map());
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
          // 分页响应（page>1 REST 分支）计数可能为 null → 保留已有计数，totalPages 稳定（Pager 不消失）
          if (openCountRes != null) setOpenCount(openCountRes);
          if (closedCountRes != null) setClosedCount(closedCountRes);
        }
        // CI 状态批量拉取（仅 open PR 且有 head sha；一次 GraphQL 别名请求拿全部，替代逐行单查）
        if (!cancelled) {
          const shas: string[] = [];
          for (const p of items) {
            const sha = p.head?.sha;
            if (p.state === "open" && sha) shas.push(sha);
          }
          if (shas.length > 0) {
            fetchPullCheckRunsBatchSmart(owner!, repo!, shas, token)
              .then((m) => !cancelled && setChecksMap(m))
              .catch(() => {});
          } else {
            setChecksMap(new Map());
          }
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
  // 全站翻页上限 999 页（官方 REST 1000 页上限内；页码窗口 Pager 折叠省略号）
  const totalPages =
    baseTotal != null && !hasFilters ? Math.min(999, Math.max(1, Math.ceil(baseTotal / 30))) : 1;
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
              <PullRow
                key={pr.id}
                pr={pr}
                owner={owner!}
                repo={repo!}
                fmt={fmt}
                checks={pr.head?.sha ? checksMap.get(pr.head.sha) : undefined}
              />
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

/** 官方 Box-row 行：状态 icon + 标题列(标题+meta) + 右列(评论数+assignee 头像)；hover 灰底 */
export function PullRow({
  pr,
  owner,
  repo,
  fmt,
  checks,
}: {
  pr: PullRequest;
  owner: string;
  repo: string;
  fmt: (iso: string) => string;
  /** CI 汇总（父级批量拉取注入；undefined = 批量未覆盖，不显示图标） */
  checks?: CheckRunsSummary | null;
}) {
  const { t } = useI18n();
  const isDark = useIsDark();

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
