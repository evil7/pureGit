/**
 * 全站搜索页（type tabs：repos/issues/prs/users/discussions，全部 GraphQL 主通道）
 *
 * 布局（用户拍板，极简 · 不遵循官方）：
 * - 第一行：搜索框 + 搜索按钮
 * - 过滤 chips 行紧挨 input 下方（shadcn Popover + Command，按当前 tab 显示对应 qualifier）
 * - 结果面板 tabs（仿主页手写下划线：border-b 容器 + border-b-2 高亮）+ 排序下拉最右
 * - 分页：InfinitePager 无限翻页（翻页式搜索每页重新请求、空页探测，不预测总体量）；去语法高亮；qualifier 全部原生传给 API
 *
 * 状态模型：URL 唯一真源 `q`（完整查询串含全部 qualifier）+ `type`（tab 类型）。
 * 搜索策略（官方同一 search 端点 + 按类型独立路由，全部 GraphQL）：
 *   issues/prs 同走 search type:ISSUE，注入 is:issue / is:pr 限定（PR 走 `... on PullRequest` 片段）；
 *   discussions 走 search type:DISCUSSION；code/commits 官方 GraphQL 无此 SearchType → 不提供。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Search, X, CircleDot, XCircle, MessageSquare, ThumbsUp } from "lucide-react";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { RepositoryCard } from "@/components/RepositoryCard";
import { UserAvatar } from "@/components/UserAvatar";
import { SearchInput } from "@/components/SearchInput";
import { InfinitePager } from "@/components/InfinitePager";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import { get as emojiGet } from "node-emoji";
import {
  searchRepositoriesSmart,
  searchUsersSmart,
  searchIssuesSmart,
  searchPullsSmart,
  searchDiscussionsSmart,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/restapi";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { formatCount } from "@/lib/ui/format";
import { getLabelStyle } from "@/lib/ui/label-color";
import { addQualifier, removeQualifier, getQualifier } from "@/lib/api/search-syntax";
import type {
  Repository,
  GitHubUser,
  Issue,
  DiscussionSearchItem,
  SearchResponse,
} from "@/lib/restapi";

/** 搜索结果每页条数（翻页式搜索：每页按条件重新请求，单次请求少量） */
const PAGE_SIZE = 20;

/** 搜索页 i18n key（t 需要 I18nKey 具体联合） */
type SearchLabelKey =
  | "search.sort.best"
  | "search.sort.stars"
  | "search.sort.updated"
  | "search.tab.repos"
  | "search.tab.issues"
  | "search.tab.prs"
  | "search.tab.users"
  | "search.tab.discussions"
  | "search.advanced.language"
  | "search.advanced.stars"
  | "search.advanced.forks"
  | "search.advanced.created"
  | "search.advanced.topic"
  | "search.advanced.license"
  | "search.advanced.archived"
  | "search.advanced.author"
  | "search.advanced.label"
  | "search.advanced.assignee"
  | "search.advanced.milestone"
  | "search.advanced.location"
  | "search.advanced.followers"
  | "search.advanced.repos";

/** 结果类型 tab（官方 /search 的 type 维度；issues/prs 共用 search type:ISSUE 注入 is: 区分） */
type SearchTab = "repos" | "issues" | "prs" | "users" | "discussions";

/** tab 顺序（对齐官方：Repos→Issues→PR→Users→Discussions；code/commits 官方 GraphQL 无 SearchType 不提供） */
const TABS: { value: SearchTab; labelKey: SearchLabelKey }[] = [
  { value: "repos", labelKey: "search.tab.repos" },
  { value: "issues", labelKey: "search.tab.issues" },
  { value: "prs", labelKey: "search.tab.prs" },
  { value: "users", labelKey: "search.tab.users" },
  { value: "discussions", labelKey: "search.tab.discussions" },
];

/** URL type 参数 ↔ tab 值映射（repos 为默认无参数） */
const TYPE_PARAM: Record<SearchTab, string | null> = {
  repos: null,
  issues: "issues",
  prs: "prs",
  users: "users",
  discussions: "discussions",
};

/** 语言下拉选项（datalist：可输入 + 下拉选择） */
const LANG_OPTIONS = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Rust",
  "C++",
  "Java",
  "HTML",
  "CSS",
  "Shell",
  "Ruby",
];

/** 排序（值 = q 内 sort: qualifier；best 不写；仅 repos 类型生效） */
const SORT_OPTIONS: { value: string; labelKey: SearchLabelKey }[] = [
  { value: "best", labelKey: "search.sort.best" },
  { value: "stars", labelKey: "search.sort.stars" },
  { value: "updated", labelKey: "search.sort.updated" },
];

/** 过滤 chip（点击展开 inline 输入/选择，回车加入 q） */
interface FilterItem {
  key: string;
  labelKey: SearchLabelKey;
  kind: "lang" | "number" | "date" | "text" | "license" | "archived";
  placeholder: string;
}

/** issue/PR 共享过滤 qualifier（PR 另有 review:/draft: 等高级词，chips 保留高频子集） */
const ISSUE_FILTER_ITEMS: FilterItem[] = [
  { key: "author", labelKey: "search.advanced.author", kind: "text", placeholder: "username" },
  { key: "label", labelKey: "search.advanced.label", kind: "text", placeholder: "bug" },
  { key: "assignee", labelKey: "search.advanced.assignee", kind: "text", placeholder: "username" },
  { key: "milestone", labelKey: "search.advanced.milestone", kind: "text", placeholder: "v1.0" },
];

/** 按 tab 配置过滤 chips（官方各类型高级过滤字段子集，qualifier 原生传给 API） */
const FILTER_ITEMS: Record<SearchTab, FilterItem[]> = {
  repos: [
    {
      key: "language",
      labelKey: "search.advanced.language",
      kind: "lang",
      placeholder: "TypeScript",
    },
    { key: "stars", labelKey: "search.advanced.stars", kind: "number", placeholder: ">100" },
    { key: "forks", labelKey: "search.advanced.forks", kind: "number", placeholder: ">50" },
    {
      key: "created",
      labelKey: "search.advanced.created",
      kind: "date",
      placeholder: ">2024-01-01",
    },
    { key: "topic", labelKey: "search.advanced.topic", kind: "text", placeholder: "react" },
    { key: "license", labelKey: "search.advanced.license", kind: "license", placeholder: "mit" },
    {
      key: "archived",
      labelKey: "search.advanced.archived",
      kind: "archived",
      placeholder: "true",
    },
  ],
  issues: ISSUE_FILTER_ITEMS,
  prs: ISSUE_FILTER_ITEMS,
  users: [
    { key: "location", labelKey: "search.advanced.location", kind: "text", placeholder: "China" },
    {
      key: "followers",
      labelKey: "search.advanced.followers",
      kind: "number",
      placeholder: ">100",
    },
    { key: "repos", labelKey: "search.advanced.repos", kind: "number", placeholder: ">10" },
  ],
  discussions: [
    { key: "author", labelKey: "search.advanced.author", kind: "text", placeholder: "username" },
  ],
};

/** 常见 license（License chip 选择器） */
const LICENSE_OPTIONS = [
  "mit",
  "apache-2.0",
  "gpl-3.0",
  "agpl-3.0",
  "lgpl-3.0",
  "mpl-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "unlicense",
  "cc0-1.0",
];

function UserCard({ user }: { user: GitHubUser }) {
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="flex items-center gap-3 p-4">
        <UserAvatar src={user.avatar_url} alt={user.login} className="size-10" />
        <div className="min-w-0">
          <Link to={`/${user.login}`} className="font-semibold text-primary hover:underline">
            {user.login}
          </Link>
          {user.bio && <p className="text-sm text-muted-foreground truncate">{user.bio}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** issue/PR 搜索结果卡片（跨仓库：标题 + 来源仓库 + 状态/评论 + 作者/时间/标签） */
function IssueSearchCard({
  item,
  isPr,
  fmt,
}: {
  item: Issue;
  isPr: boolean;
  fmt: (iso: string) => string;
}) {
  const isDark = useIsDark();
  const repo = item.repository?.full_name ?? "";
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <Link
              to={isPr ? `/${repo}/pull/${item.number}` : `/${repo}/issues/${item.number}`}
              className="line-clamp-2 font-medium text-primary hover:underline"
            >
              {item.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {repo} · #{item.number}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {item.state === "open" ? (
              <CircleDot className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
            ) : (
              <XCircle className="size-3.5 text-[#8250df] dark:text-[#a371f7]" />
            )}
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {item.comments}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <Link
              to={`/${item.user.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {item.user.login}
            </Link>{" "}
            {item.state === "closed" ? tStatic("issues.closed") : tStatic("issues.opened")}{" "}
            {fmt(item.state === "closed" && item.closed_at ? item.closed_at : item.created_at)}
          </span>
          {item.labels && item.labels.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {item.labels.slice(0, 3).map((l) => (
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
        </div>
      </CardContent>
    </Card>
  );
}

/** 讨论搜索结果卡片（跨仓库：标题 + 分类 emoji + 来源仓库 + 作者 + 评论/点赞 + answered） */
function DiscussionSearchCard({
  item,
  fmt,
}: {
  item: DiscussionSearchItem;
  fmt: (iso: string) => string;
}) {
  const repo = item.repository.full_name;
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <Link
              to={`/${repo}/discussions/${item.number}`}
              className="line-clamp-2 font-medium text-primary hover:underline"
            >
              <span className="mr-1.5">{emojiGet(item.category.emoji) ?? item.category.emoji}</span>
              {item.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {repo} · #{item.number} · {item.category.name}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {item.answered ? (
              <CircleDot className="size-3.5 text-[#1a7f37] dark:text-[#3fb950]" />
            ) : (
              <CircleDot className="size-3.5 text-muted-foreground" />
            )}
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {item.commentsCount}
            </span>
            <span className="flex items-center gap-1">
              <ThumbsUp className="size-3.5" />
              {item.upvoteCount}
            </span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/${item.author.login}`}
            className="font-medium text-foreground hover:underline"
          >
            {item.author.login}
          </Link>{" "}
          {tStatic("discussions.opened")} {fmt(item.createdAt)}
        </p>
      </CardContent>
    </Card>
  );
}

/** issue/PR 搜索注入类型词：尊重用户已写的 is:/type: 类型词，未指定时补 is:issue / is:pr */
function withIssueType(raw: string, word: "issue" | "pr"): string {
  if (/(?:^|\s)(?:is|type):(?:issue|pr)(?:\s|$)/i.test(raw)) return raw;
  const base = raw.trim();
  return base ? `${base} is:${word}` : `is:${word}`;
}

export default function SearchPage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL 唯一真源：q（完整查询串含全部 qualifier）+ type（tab 类型）
  const q = searchParams.get("q") ?? "";
  const [tab, setTab] = useState<SearchTab>(() => {
    const tp = searchParams.get("type");
    return TABS.find((x) => TYPE_PARAM[x.value] === tp)?.value ?? "repos";
  });

  // 输入框草稿（URL q 变化时同步）
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  // 各类型结果（仅当前 tab 有数据；切换 tab 触发重新搜索）
  const [repos, setRepos] = useState<Repository[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<Issue[]>([]);
  const [users, setUsers] = useState<GitHubUser[]>([]);
  const [discussions, setDiscussions] = useState<DiscussionSearchItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // 高级过滤展开项（null = 收起）
  const [openChip, setOpenChip] = useState<string | null>(null);
  // 搜索竞态防护
  const searchSeq = useRef(0);
  // 末页探测：空页 → endReached + 回退最近有效页（InfinitePager 不再预测体量）
  const [endReached, setEndReached] = useState(false);
  const lastValidRef = useRef(1);

  /** 更新 URL q（提交 / chips / 排序统一入口） */
  const setQ = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    setSearchParams(params, { replace: true });
  };

  /** 切换 tab：更新 URL type 并重置页码 */
  const changeTab = (v: SearchTab) => {
    setTab(v);
    setPage(1);
    const params = new URLSearchParams(searchParams);
    const tp = TYPE_PARAM[v];
    if (tp) params.set("type", tp);
    else params.delete("type");
    setSearchParams(params, { replace: true });
  };

  /** 提交搜索（输入框 Enter/按钮）：重置页码 */
  const submitSearch = (raw: string) => {
    setPage(1);
    setQ(raw);
  };

  /** chips 通用操作：追加/替换（空值 = 移除）；重置页码并收起展开 */
  const applyQualifier = (key: string, value: string) => {
    setOpenChip(null);
    setPage(1);
    if (!value.trim()) setQ(removeQualifier(q, key));
    else setQ(addQualifier(q, key, value.trim()));
  };
  const sortValue = getQualifier(q, "sort") ?? "best";
  const changeSort = (v: string) => {
    setPage(1);
    if (v === "best") setQ(removeQualifier(q, "sort"));
    else setQ(addQualifier(q, "sort", v));
  };

  // q / token / tab / page 变化 → 按当前 tab 调用对应 smart 搜索（仅搜当前 tab，避免并发浪费额度）
  useEffect(() => {
    if (!q.trim()) return;
    const seq = ++searchSeq.current;
    setLoading(true);
    setError(null);
    setTotal(null);
    const started = performance.now();
    const finish = () => {
      if (seq === searchSeq.current) {
        setElapsedMs(Math.round(performance.now() - started));
        setLoading(false);
      }
    };
    const apply = <T,>(d: SearchResponse<T>, set: (items: T[]) => void) => {
      if (seq === searchSeq.current) {
        set(d.items);
        setTotal(d.total_count);
        // 末页探测（每次搜索自洽重算）：空页 → 回退最近有效页 + endReached；非空 → 记录有效页
        if (d.items.length > 0) {
          lastValidRef.current = page;
          setEndReached(d.items.length < PAGE_SIZE);
        } else if (page > 1) {
          setEndReached(true);
          if (lastValidRef.current < page) setPage(lastValidRef.current);
        } else {
          // page===1 且空 → 无结果（EmptyHint 展示）
          setEndReached(true);
        }
      }
    };
    (async () => {
      switch (tab) {
        case "repos":
          apply(await searchRepositoriesSmart(q, token, page), setRepos);
          break;
        case "issues":
          apply(await searchIssuesSmart(withIssueType(q, "issue"), token, page), setIssues);
          break;
        case "prs":
          apply(await searchPullsSmart(withIssueType(q, "pr"), token, page), setPrs);
          break;
        case "users":
          apply(await searchUsersSmart(q, token, page), setUsers);
          break;
        case "discussions":
          apply(await searchDiscussionsSmart(q, token, page), setDiscussions);
          break;
      }
    })()
      .catch((e) => {
        if (seq === searchSeq.current) setError(apiErrorMessage(e, "搜索失败"));
      })
      .finally(finish);
  }, [q, token, tab, page]);

  /** 翻页（当前 tab 通用） */
  const goPage = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** 渲染当前 tab 结果列表（空态 + 列表 + 无限翻页） */
  function renderResults<T>(items: T[], render: (item: T) => ReactNode): ReactNode {
    if (items.length === 0) return <EmptyHint />;
    return (
      <>
        <div className="flex flex-col gap-3">{items.map(render)}</div>
        {/* 无限翻页：翻页重新请求对应页；空页探测后 endReached（下一页禁用），不预测总体量 */}
        <InfinitePager page={page} endReached={endReached} onChange={goPage} />
      </>
    );
  }

  // 过滤 chips 行（按当前 tab 显示对应 qualifier；点击展开 inline 输入/选择，回车加入输入框 q）
  const filterChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("search.filterLabel")}</span>
      {FILTER_ITEMS[tab].map((item) => {
        const active = getQualifier(q, item.key);
        return (
          <Popover
            key={item.key}
            open={openChip === item.key}
            onOpenChange={(o) => setOpenChip(o ? item.key : null)}
          >
            <PopoverTrigger asChild>
              <Badge
                variant={active ? "default" : "outline"}
                className={cn("cursor-pointer select-none", active && "pr-1.5")}
              >
                {t(item.labelKey)}
                {active && <span className="ml-1 text-[11px] opacity-80">{active}</span>}
                {active && (
                  <span
                    role="button"
                    aria-label="clear"
                    className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-background/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyQualifier(item.key, "");
                    }}
                  >
                    <X className="size-2.5" />
                  </span>
                )}
              </Badge>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1">
              {item.kind === "lang" || item.kind === "license" ? (
                // 语言/许可证：Command 可搜索 combobox（输入任意值回车提交，或点选列表项）
                <Command>
                  <CommandInput
                    placeholder={item.placeholder}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) applyQualifier(item.key, v);
                      }
                    }}
                  />
                  <CommandList>
                    <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">
                      回车使用输入值
                    </CommandEmpty>
                    <CommandGroup>
                      {(item.kind === "lang" ? LANG_OPTIONS : LICENSE_OPTIONS).map((opt) => (
                        <CommandItem
                          key={opt}
                          value={opt}
                          onSelect={() => applyQualifier(item.key, opt)}
                          className="text-xs"
                        >
                          <Check
                            className={cn("size-3.5", active === opt ? "opacity-100" : "opacity-0")}
                          />
                          {opt}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              ) : item.kind === "archived" ? (
                <Command>
                  <CommandList>
                    <CommandGroup>
                      <CommandItem
                        value="true"
                        onSelect={() => applyQualifier(item.key, "true")}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            active === "true" ? "opacity-100" : "opacity-0",
                          )}
                        />
                        是
                      </CommandItem>
                      <CommandItem
                        value="false"
                        onSelect={() => applyQualifier(item.key, "false")}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            active === "false" ? "opacity-100" : "opacity-0",
                          )}
                        />
                        否
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              ) : (
                // 数值/日期/文本：输入框回车提交
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = (e.currentTarget.elements.namedItem("value") as HTMLInputElement)
                      .value;
                    applyQualifier(item.key, v);
                  }}
                >
                  <Input
                    name="value"
                    defaultValue={active ?? ""}
                    placeholder={item.placeholder}
                    className="h-8 text-xs"
                    autoFocus
                  />
                </form>
              )}
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );

  return (
    <div className={PAGE_SHELL}>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{t("search.title")}</h1>
        <p className="text-muted-foreground">{t("search.desc")}</p>
      </header>

      {/* 第一行：搜索框 + 按钮 */}
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) submitSearch(draft);
        }}
      >
        <SearchInput
          defaultValue={draft}
          placeholder={t("search.placeholder")}
          onSubmit={submitSearch}
          className="min-w-0 flex-1"
          size="lg"
        />
        <Button type="submit" className="h-10 shrink-0">
          <Search className="size-4" />
          {t("search.button")}
        </Button>
      </form>

      {/* 过滤 chips 行：紧挨 input 下方 */}
      <div className="mt-3">{filterChips}</div>

      {/* 结果面板 tabs（仿主页手写下划线：border-b 容器 + border-b-2 高亮）+ 计数 label + 排序下拉最右（仅 repos） */}
      <div className="mb-4 mt-4 flex items-end justify-between border-b">
        <div className="flex gap-1">
          {TABS.map((tb) => (
            <button
              key={tb.value}
              type="button"
              onClick={() => changeTab(tb.value)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === tb.value
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tb.labelKey)}
              {tab === tb.value && total != null && (
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-xs font-normal text-muted-foreground"
                >
                  {formatCount(total)}
                </Badge>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          {elapsedMs != null && (
            <span className="mb-2 text-xs text-muted-foreground">{elapsedMs} ms</span>
          )}
          {tab === "repos" && (
            <Select value={sortValue} onValueChange={changeSort}>
              <SelectTrigger className="mb-1 h-8 w-36 text-xs">
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
          )}
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="mt-4">
          <InlineError message={error} />
        </div>
      )}

      {/* 加载态 */}
      {loading && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      )}

      {/* 结果区：按 tab 渲染对应卡片（计数已移到 tab label，仅当前 tab 有数据） */}
      {!loading && !error && q.trim() && (
        <div>
          {tab === "repos" && renderResults(repos, (r) => <RepositoryCard key={r.id} repo={r} />)}
          {tab === "issues" &&
            renderResults(issues, (i) => (
              <IssueSearchCard key={i.id} item={i} isPr={false} fmt={fmt} />
            ))}
          {tab === "prs" &&
            renderResults(prs, (p) => <IssueSearchCard key={p.id} item={p} isPr fmt={fmt} />)}
          {tab === "users" && renderResults(users, (u) => <UserCard key={u.login} user={u} />)}
          {tab === "discussions" &&
            renderResults(discussions, (d) => (
              <DiscussionSearchCard
                key={`${d.repository.full_name}#${d.number}`}
                item={d}
                fmt={fmt}
              />
            ))}
        </div>
      )}

      {!q.trim() && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("search.noQuery")}</p>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{tStatic("search.noResult")}</p>
  );
}
