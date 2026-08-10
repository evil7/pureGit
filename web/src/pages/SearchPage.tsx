/**
 * 全站搜索页（过滤 chips 换 shadcn Popover+Command + tabs 仿主页手写）
 *
 * 布局（用户拍板，极简 · 不遵循官方）：
 * - 第一行：搜索框 + 搜索按钮
 * - 过滤 chips 行紧挨 input 下方（shadcn Popover + Command：语言可搜索 combobox、
 *   license/archived Command 列表、数值/日期/文本输入）
 * - 结果面板 tabs（仿主页手写下划线：border-b 容器 + border-b-2 高亮）+ 排序下拉最右
 * - 分页最多 99 页；去语法高亮；qualifier 全部原生传给 API
 *
 * 状态模型：URL 唯一真源 `q`（完整查询串含全部 qualifier）+ `type`（tab 类型）。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Search, X } from "lucide-react";
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
import { Pager } from "@/components/Pager";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, tStatic } from "@/i18n";
import { searchRepositoriesSmart, searchUsersSmart } from "@/lib/api";
import { apiErrorMessage } from "@/lib/rest";
import { PAGE_SHELL } from "@/lib/layout";
import { formatCount } from "@/lib/format";
import { addQualifier, removeQualifier, getQualifier } from "@/lib/search-syntax";
import type { Repository, GitHubUser } from "@/lib/rest";

/** 搜索结果每页条数 */
const PAGE_SIZE = 20;
/** 分页页数上限（GitHub 官方搜索仅开放前 100 页；用户要求最多 99 页） */
const MAX_PAGES = 99;

/** 搜索页 i18n key（t 需要 I18nKey 具体联合） */
type SearchLabelKey =
  | "search.sort.best"
  | "search.sort.stars"
  | "search.sort.updated"
  | "search.advanced.language"
  | "search.advanced.stars"
  | "search.advanced.forks"
  | "search.advanced.created"
  | "search.advanced.topic"
  | "search.advanced.license"
  | "search.advanced.archived";

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

/** 排序（值 = q 内 sort: qualifier；best 不写） */
const SORT_OPTIONS: { value: string; labelKey: SearchLabelKey }[] = [
  { value: "best", labelKey: "search.sort.best" },
  { value: "stars", labelKey: "search.sort.stars" },
  { value: "updated", labelKey: "search.sort.updated" },
];

/** 过滤 chips（语言 = datalist 可输入+下拉；点击展开 inline 输入/选择，回车加入 q） */
const ADVANCED_ITEMS: {
  key: string;
  labelKey: SearchLabelKey;
  kind: "lang" | "number" | "date" | "text" | "license" | "archived";
  placeholder: string;
}[] = [
  {
    key: "language",
    labelKey: "search.advanced.language",
    kind: "lang",
    placeholder: "TypeScript",
  },
  { key: "stars", labelKey: "search.advanced.stars", kind: "number", placeholder: ">100" },
  { key: "forks", labelKey: "search.advanced.forks", kind: "number", placeholder: ">50" },
  { key: "created", labelKey: "search.advanced.created", kind: "date", placeholder: ">2024-01-01" },
  { key: "topic", labelKey: "search.advanced.topic", kind: "text", placeholder: "react" },
  { key: "license", labelKey: "search.advanced.license", kind: "license", placeholder: "mit" },
  { key: "archived", labelKey: "search.advanced.archived", kind: "archived", placeholder: "true" },
];

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

export default function SearchPage() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL 唯一真源：q（完整查询串含全部 qualifier）+ type（tab 类型）
  const q = searchParams.get("q") ?? "";
  const [tab, setTab] = useState<"repos" | "users">(
    searchParams.get("type") === "users" ? "users" : "repos",
  );

  // 输入框草稿（URL q 变化时同步）
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const [repos, setRepos] = useState<Repository[]>([]);
  const [users, setUsers] = useState<GitHubUser[]>([]);
  const [repoTotal, setRepoTotal] = useState<number | null>(null);
  const [userTotal, setUserTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  // 两个结果区独立页码
  const [repoPage, setRepoPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  // 高级过滤展开项（null = 收起）
  const [openChip, setOpenChip] = useState<string | null>(null);
  // 搜索竞态防护
  const searchSeq = useRef(0);

  /** 更新 URL q（提交 / chips / 排序统一入口） */
  const setQ = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    setSearchParams(params, { replace: true });
  };

  /** 切换 tab：更新 URL type（保留各自页码） */
  const changeTab = (v: "repos" | "users") => {
    setTab(v);
    const params = new URLSearchParams(searchParams);
    if (v === "users") params.set("type", "users");
    else params.delete("type");
    setSearchParams(params, { replace: true });
  };

  /** 提交搜索（输入框 Enter/按钮）：重置页码 */
  const submitSearch = (raw: string) => {
    setRepoPage(1);
    setUserPage(1);
    setQ(raw);
  };

  /** chips 通用操作：追加/替换（空值 = 移除）；重置页码并收起展开 */
  const applyQualifier = (key: string, value: string) => {
    setOpenChip(null);
    setRepoPage(1);
    setUserPage(1);
    if (!value.trim()) setQ(removeQualifier(q, key));
    else setQ(addQualifier(q, key, value.trim()));
  };
  const sortValue = getQualifier(q, "sort") ?? "best";
  const changeSort = (v: string) => {
    setRepoPage(1);
    setUserPage(1);
    if (v === "best") setQ(removeQualifier(q, "sort"));
    else setQ(addQualifier(q, "sort", v));
  };

  // q / token / repoPage / userPage 变化 → 并行搜索仓库 + 用户/组织
  useEffect(() => {
    if (!q.trim()) return;
    const seq = ++searchSeq.current;
    setLoading(true);
    setError(null);
    setRepoTotal(null);
    setUserTotal(null);
    const started = performance.now();
    const finish = () => {
      if (seq === searchSeq.current) {
        setElapsedMs(Math.round(performance.now() - started));
        setLoading(false);
      }
    };
    Promise.all([
      searchRepositoriesSmart(q, token, repoPage).then((d) => {
        if (seq === searchSeq.current) {
          setRepos(d.items);
          setRepoTotal(d.total_count);
        }
      }),
      searchUsersSmart(q, token, userPage).then((d) => {
        if (seq === searchSeq.current) {
          setUsers(d.items);
          setUserTotal(d.total_count);
        }
      }),
    ])
      .catch((e) => {
        if (seq === searchSeq.current) setError(apiErrorMessage(e, "搜索失败"));
      })
      .finally(finish);
  }, [q, token, repoPage, userPage]);

  /** 仓库区翻页 */
  const goRepoPage = (p: number) => {
    setRepoPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** 用户/组织区翻页 */
  const goUserPage = (p: number) => {
    setUserPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 过滤 chips 行（语言 datalist 可输入+下拉 + 高级过滤；点击展开 inline 输入/选择，回车加入输入框 q）
  const filterChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("search.filterLabel")}</span>
      {ADVANCED_ITEMS.map((item) => {
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

      {/* 结果面板 tabs（仿主页手写下划线：border-b 容器 + border-b-2 高亮）+ 计数 label + 排序下拉最右 */}
      <div className="mb-4 mt-4 flex items-end justify-between border-b">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => changeTab("repos")}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === "repos"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("search.tab.repos")}
            {repoTotal != null && (
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-xs font-normal text-muted-foreground"
              >
                {formatCount(repoTotal)}
              </Badge>
            )}
          </button>
          <button
            type="button"
            onClick={() => changeTab("users")}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === "users"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("search.tab.users")}
            {userTotal != null && (
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-xs font-normal text-muted-foreground"
              >
                {formatCount(userTotal)}
              </Badge>
            )}
          </button>
        </div>
        <div className="flex items-end gap-2">
          {elapsedMs != null && (
            <span className="mb-2 text-xs text-muted-foreground">{elapsedMs} ms</span>
          )}
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

      {/* 结果区：按 tab 显示仓库或用户/组织（计数已移到 tab 的 label，此处不再重复标题） */}
      {!loading && !error && q.trim() && (
        <>
          {tab === "repos" ? (
            <div>
              {repos.length === 0 ? (
                <EmptyHint />
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {repos.map((r) => (
                      <RepositoryCard key={r.id} repo={r} />
                    ))}
                  </div>
                  {repoTotal != null && repoTotal > PAGE_SIZE && (
                    <Pager
                      page={repoPage}
                      totalPages={Math.min(MAX_PAGES, Math.ceil(repoTotal / PAGE_SIZE))}
                      onChange={goRepoPage}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div>
              {users.length === 0 ? (
                <EmptyHint />
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {users.map((u) => (
                      <UserCard key={u.login} user={u} />
                    ))}
                  </div>
                  {userTotal != null && userTotal > PAGE_SIZE && (
                    <Pager
                      page={userPage}
                      totalPages={Math.min(MAX_PAGES, Math.ceil(userTotal / PAGE_SIZE))}
                      onChange={goUserPage}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </>
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
