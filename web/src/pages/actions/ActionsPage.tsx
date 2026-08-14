/**
 * Actions 列表页（/:owner/:repo/actions）
 *
 * 自 ActionsPages.tsx 拆出。官方结构：左栏三分组（Actions/Workflows/Management）+
 * 右栏（搜索 + Workflow/Event/Status/Branch/Actor 五过滤 + Run 行 + 分页）。
 * REST only（GraphQL 无 workflow/run 端点）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Boxes, Gauge, GitBranch, Package, Search, ShieldCheck } from "lucide-react";
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
import { Pager } from "@/components/Pager";
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
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
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
            <>
              {/* Actions 分组 */}
              <section>
                <h3 className="mb-2 px-2 text-sm font-semibold">{t("actions.group.actions")}</h3>
                <ul className="space-y-0.5">
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
              </section>

              {/* Workflows 分组（短名 + 完整路径） */}
              <section>
                <h3 className="mb-2 px-2 text-sm font-semibold">{t("actions.group.workflows")}</h3>
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
                  <li>
                    <Link
                      to={`/${owner}/${repo}/actions/workflows`}
                      className="block truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    >
                      {t("actions.workflowsPage")}
                    </Link>
                  </li>
                </ul>
              </section>

              {/* Management 分组（官方；外链官方或占位，去杂项） */}
              <section>
                <h3 className="mb-2 px-2 text-sm font-semibold">{t("actions.group.management")}</h3>
                <ul className="space-y-0.5">
                  <ManagementLink
                    icon={Package}
                    label={t("actions.mgmt.caches")}
                    href={`https://github.com/${owner}/${repo}/actions/caches`}
                  />
                  <ManagementLink
                    icon={Boxes}
                    label={t("actions.mgmt.deployments")}
                    href={`https://github.com/${owner}/${repo}/deployments`}
                  />
                  <ManagementLink
                    icon={ShieldCheck}
                    label={t("actions.mgmt.attestations")}
                    href={`https://github.com/${owner}/${repo}/attestations`}
                  />
                  <ManagementLink
                    icon={Gauge}
                    label={t("actions.mgmt.usage")}
                    href={`https://github.com/${owner}/${repo}/settings/billing`}
                  />
                  <ManagementLink
                    icon={Activity}
                    label={t("actions.mgmt.performance")}
                    href={`https://github.com/${owner}/${repo}/actions/metrics`}
                  />
                </ul>
              </section>
            </>
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

          {/* 分页（复用通用 Pager；官方 Previous/Next 语义；全站翻页上限 999 页） */}
          <Pager
            page={page}
            totalPages={Math.min(999, Math.ceil(totalCount / PER_PAGE))}
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

/** Management 分组外链项 */
function ManagementLink({
  icon: Icon,
  label,
  href,
}: {
  icon: typeof Package;
  label: string;
  href: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
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
  const prDesc =
    r.event === "pull_request" || r.event === "pull_request_target"
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
