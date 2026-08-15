/**
 * Actions 列表页（/:owner/:repo/actions）
 *
 * 自 ActionsPages.tsx 拆出。官方结构：左栏三分组（Actions/Workflows/Management）+
 * 右栏（搜索 + Workflow/Event/Status/Branch/Actor 五过滤 + Run 行 + 分页）。
 * REST only（GraphQL 无 workflow/run 端点）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ExternalLink,
  Gauge,
  GitBranch,
  Package,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchWorkflows, fetchWorkflowRuns, fetchBranchesSmart, ApiError } from "@/lib/api";
import type { Workflow, WorkflowRun } from "@/lib/restapi";
import { InfinitePager } from "@/components/InfinitePager";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { EVENT_OPTIONS, STATUS_OPTIONS, runStatusIcon } from "./shared";

export default function ActionsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // 过滤（官方 Workflow/Event/Status/Branch/Actor + 搜索）
  const [workflowId, setWorkflowId] = useState<string>("");
  const [event, setEvent] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [branch, setBranch] = useState<string>("");
  const [actor, setActor] = useState<string>("");
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  // 分页（官方 Previous/Next；per_page=20）
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  // 分支下拉数据（一次加载）
  useEffect(() => {
    if (!token) return;
    fetchBranchesSmart(owner, repo, token)
      .then((bs) => setBranches(bs))
      .catch(() => undefined);
  }, [owner, repo, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWorkflows(owner, repo, token).catch(() => []),
      fetchWorkflowRuns(owner, repo, token, {
        perPage: PER_PAGE,
        page,
        workflowId: workflowId ? Number(workflowId) : undefined,
        event: event || undefined,
        status: status || undefined,
        branch: branch || undefined,
        actor: actor || undefined,
      }).catch(() => ({ total_count: 0, runs: [] })),
    ]).then(([wfs, runsData]) => {
      if (cancelled) return;
      setWorkflows(wfs);
      setRuns(runsData.runs);
      setTotalCount(runsData.total_count);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, workflowId, event, status, branch, actor, page]);

  // 搜索过滤（前端：query 匹配标题/分支/作者）
  const filteredRuns = useMemo(() => {
    if (!query.trim()) return runs;
    const q = query.trim().toLowerCase();
    return runs.filter(
      (r) =>
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.head_branch ?? "").toLowerCase().includes(q) ||
        (r.actor?.login ?? "").toLowerCase().includes(q),
    );
  }, [runs, query]);

  // Actor 过滤候选（从当前 runs 提取触发者去重；官方 Actor 过滤按触发者精确过滤）
  const actorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) if (r.actor?.login) set.add(r.actor.login);
    return Array.from(set);
  }, [runs]);

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        left={{
          node: (
            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_g, g) => (
                <div key={g} className="space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  {Array.from({ length: 3 }).map((_i, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ))}
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </PageLayout>
    );
  }

  if (error) throw error;

  return (
    <div className="space-y-4">
      <PageLayout
        gap="sm"
        left={{
          node: (
            <nav aria-label={t("actions.group.actions")}>
              {/* 顶部标题行：Actions + 右侧 New workflow（官方外链） */}
              <div className="flex items-center justify-between px-2">
                <h2 className="text-sm font-semibold">{t("actions.group.actions")}</h2>
                <a
                  href={`https://github.com/${owner}/${repo}/actions/new`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {t("actions.newWorkflow")}
                </a>
              </div>

              {/* All workflows（唯一站内入口） */}
              <ul className="mt-1.5 space-y-0.5">
                <li>
                  <Link
                    to={`/${owner}/${repo}/actions`}
                    className={cn(
                      "block truncate rounded-md px-2 py-1 text-sm transition-colors",
                      !workflowId
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {t("actions.allWorkflows")}
                  </Link>
                </li>
              </ul>

              {/* 分隔线 */}
              <div className="my-2 border-t" />

              {/* Workflow 列表（官方无标题，直接列名；点击过滤当前 run 列表） */}
              <ul className="space-y-0.5">
                {workflows.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkflowId(String(w.id));
                        setPage(1);
                      }}
                      title={w.path}
                      className={cn(
                        "block w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors",
                        workflowId === String(w.id)
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {w.name}
                    </button>
                  </li>
                ))}
              </ul>

              {/* 分隔线 */}
              <div className="my-2 border-t" />

              {/* Management 分组（Caches 站内，其余外链官方并标注） */}
              <h3 className="px-2 text-sm font-semibold">{t("actions.group.management")}</h3>
              <ul className="mt-1 space-y-0.5">
                <li>
                  <Link
                    to={`/${owner}/${repo}/actions/caches`}
                    className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <Package className="size-3.5 shrink-0" />
                    <span className="truncate">{t("actions.mgmt.caches")}</span>
                  </Link>
                </li>
                <ManagementLink
                  icon={ShieldCheck}
                  label={t("actions.mgmt.attestations")}
                  href={`https://github.com/${owner}/${repo}/attestations`}
                  officialOnly
                />
                <ManagementLink
                  icon={Server}
                  label={t("actions.mgmt.runners")}
                  href={`https://github.com/${owner}/${repo}/actions/runners`}
                  officialOnly
                />
                <ManagementLink
                  icon={Gauge}
                  label={t("actions.mgmt.usage")}
                  href={`https://github.com/${owner}/${repo}/actions/metrics/usage`}
                  officialOnly
                />
                <ManagementLink
                  icon={Activity}
                  label={t("actions.mgmt.performance")}
                  href={`https://github.com/${owner}/${repo}/actions/metrics/performance`}
                  officialOnly
                />
              </ul>
            </nav>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        {/* 右栏：搜索 + 过滤 + runs */}
        <div className="space-y-3">
          {/* Filter workflow runs 搜索框（官方） */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("actions.filterRuns")}
              className="pl-8"
            />
          </div>

          {/* 过滤下拉：Workflow / Event / Status / Branch（官方） */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={workflowId}
              onValueChange={(v) => {
                setWorkflowId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("actions.filterWorkflow")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("actions.allWorkflows")}</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={event}
              onValueChange={(v) => {
                setEvent(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("actions.filterEvent")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("actions.allEvents")}</SelectItem>
                {EVENT_OPTIONS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("actions.filterStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("actions.allStatuses")}</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={branch}
              onValueChange={(v) => {
                setBranch(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder={t("actions.filterBranch")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("actions.allBranches")}</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={actor}
              onValueChange={(v) => {
                setActor(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("actions.filterActor")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("actions.allActors")}</SelectItem>
                {actorOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {totalCount} {t("actions.runs")}
            </span>
          </div>

          {filteredRuns.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("empty.actions")}</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {filteredRuns.map((r) => (
                <RunRow key={r.id} r={r} owner={owner} repo={repo} fmt={fmt} />
              ))}
            </ul>
          )}

          {/* 分页（官方 Previous/Next 语义；总数已知时按页算 endReached 禁用下一页） */}
          <InfinitePager
            page={page}
            endReached={page * PER_PAGE >= totalCount}
            onChange={(p) => {
              setPage(p);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      </PageLayout>
    </div>
  );
}

/** Management 分组外链项（officialOnly=true 时标注「仅官方」，API 不可实现的官方专属功能） */
function ManagementLink({
  icon: Icon,
  label,
  href,
  officialOnly = false,
}: {
  icon: typeof Package;
  label: string;
  href: string;
  officialOnly?: boolean;
}) {
  const { t } = useI18n();
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={officialOnly ? t("actions.mgmt.officialOnlyTitle") : undefined}
        className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {officialOnly && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {t("actions.mgmt.officialOnly")}
          </span>
        )}
        <ExternalLink className="size-3 shrink-0 text-muted-foreground/50" />
      </a>
    </li>
  );
}

/** Run 行（官方结构：状态图标最左 + 标题；元信息在左，时间/commit sha 在右） */
function RunRow({
  r,
  owner,
  repo,
  fmt,
}: {
  r: WorkflowRun;
  owner: string;
  repo: string;
  fmt: (s: string) => string;
}) {
  const { t } = useI18n();
  // 关联 PR（head_sha/head_branch 匹配的 PR；pull_request 事件触发时非空）
  const linkedPrs = r.pull_requests ?? [];
  // 无关联 PR 时的回退文案（旧式事件描述；仅 pull_request 事件）
  const prDesc =
    linkedPrs.length === 0 && (r.event === "pull_request" || r.event === "pull_request_target")
      ? t("actions.prDesc")
          .replace("{number}", String(r.run_number))
          .replace(
            "{mode}",
            r.event === "pull_request_target" ? t("actions.target") : t("actions.synchronize"),
          )
      : "";
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
      {/* 运行状态图标（最左） */}
      <span className="shrink-0">{runStatusIcon(r.status, r.conclusion)}</span>
      {/* 左：标题 + 元信息（分支 · workflow名 #号 · by 作者） */}
      <div className="min-w-0 flex-1">
        <Link
          to={`/${owner}/${repo}/actions/runs/${r.id}`}
          className="block truncate font-medium hover:text-primary hover:underline"
        >
          {r.display_title || r.name || `Run #${r.run_number}`}
        </Link>
        <div className="mt-0.5 flex items-center gap-x-2 text-xs text-muted-foreground">
          {r.head_branch && (
            <span className="flex shrink-0 items-center gap-0.5">
              <GitBranch className="size-3" />
              {r.head_branch}
            </span>
          )}
          <span className="truncate">
            {r.name} #{r.run_number}
            {linkedPrs.map((p) => (
              <Link
                key={p.number}
                to={`/${owner}/${repo}/pull/${p.number}`}
                className="ml-1 font-medium text-primary hover:underline"
              >
                PR #{p.number}
              </Link>
            ))}
            {prDesc}
          </span>
          <span className="shrink-0">
            {t("actions.by").replace("{actor}", r.actor?.login ?? "ghost")}
          </span>
        </div>
      </div>
      {/* 右：时间 + commit sha */}
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div className="whitespace-nowrap">{fmt(r.created_at)}</div>
        <div className="font-mono text-[10px]">{r.head_sha.slice(0, 7)}</div>
      </div>
    </li>
  );
}
