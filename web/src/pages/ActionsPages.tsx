/**
 * GitHub Actions（完整复刻——REST only，GraphQL 无 workflow/run 端点）
 *
 * 官方结构（research/28 + 28b）：
 * - /actions：左栏三分组（Actions/Workflows/Management）+ 右栏（搜索 + 5 过滤下拉
 *   + Run 行[状态行尾] + Previous/Next 分页）
 * - /actions/workflows：workflow 列表页（+ Run workflow 手动触发）
 * - /actions/runs/{id}：run 详情（左导航 Summary/All jobs + Summary 卡
 *   [Status/Total duration/Artifacts] + job 卡[step 耗时]）
 * - /actions/runs/{id}/job/{jobId}：job 详情（step 点击展开日志 + Search logs）
 * - graph 流程图/Annotations 去杂项（用户决策：核心详情 + job 页日志）
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Zap,
  Play,
  CheckCircle2,
  XCircle,
  CircleSlash,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Search,
  FileText,
  Package,
  Boxes,
  ShieldCheck,
  Gauge,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  fetchWorkflows,
  fetchWorkflowRuns,
  fetchWorkflowRunDetail,
  fetchWorkflowRunJobs,
  fetchRunArtifacts,
  fetchJobLogs,
  fetchBranchesSmart,
  dispatchWorkflow,
  apiErrorMessage,
  normalizeApiError,
  ApiError,
} from "@/lib/api";
import type { Workflow, WorkflowRun, WorkflowJob, RunArtifact } from "@/lib/rest";
import { WriteGate } from "@/components/WriteGate";
import { Pager } from "@/components/Pager";
import { CodeView } from "@/components/CodeView";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";

/** 事件过滤静态选项（官方 Event▾；常见事件） */
const EVENT_OPTIONS = [
  "push",
  "pull_request",
  "workflow_dispatch",
  "schedule",
  "issues",
  "release",
  "pull_request_target",
  "repository_dispatch",
];

/** 状态过滤选项（官方 Status▾） */
const STATUS_OPTIONS = ["completed", "in_progress", "queued", "action_required", "cancelled"];

/** 状态 → 徽标（官方颜色语义；列表行尾 / 详情头部共用） */
function runBadge(status: string, conclusion: string | null) {
  if (status !== "completed") {
    return (
      <Badge
        variant={status === "in_progress" ? "default" : "secondary"}
        className={
          status === "in_progress"
            ? "gap-1 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"
            : ""
        }
      >
        {status === "in_progress" ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            In progress
          </>
        ) : (
          <>
            <Clock className="size-3" />
            Queued
          </>
        )}
      </Badge>
    );
  }
  switch (conclusion) {
    case "success":
      return (
        <Badge className="gap-1 bg-green-600 text-white">
          <CheckCircle2 className="size-3" />
          Success
        </Badge>
      );
    case "failure":
      return (
        <Badge className="gap-1 bg-red-600 text-white">
          <XCircle className="size-3" />
          Failure
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          {conclusion ? conclusion.replace(/_/g, " ") : "Completed"}
        </Badge>
      );
  }
}

/** 运行状态图标（列表行最左 / 左导航；仅图标，替代完整徽标） */
function runStatusIcon(status: string, conclusion: string | null) {
  if (status !== "completed") {
    if (status === "in_progress") {
      return <Loader2 className="size-4 shrink-0 animate-spin text-yellow-500" />;
    }
    return <Clock className="size-4 shrink-0 text-muted-foreground" />;
  }
  switch (conclusion) {
    case "success":
      return <CheckCircle2 className="size-4 shrink-0 text-green-600" />;
    case "failure":
      return <XCircle className="size-4 shrink-0 text-red-600" />;
    case "cancelled":
      return <XCircle className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return <Clock className="size-4 shrink-0 text-muted-foreground" />;
  }
}

/**
 * step 状态图标（官方语义）：success 绿✓ / failure 红✗ / skipped 灰⊘（octicon-skip）/
 * cancelled 灰✗ / in_progress 黄 spinner / 其余（queued/neutral）灰 clock。
 * 供 Run 详情 job 卡内 step 列表与 Job 详情 step 列表共用。
 */
function stepIcon(status: string, conclusion: string | null, size = "size-4") {
  if (conclusion === "skipped") {
    return (
      <CircleSlash
        className={`${size} shrink-0 text-muted-foreground`}
        aria-label="This step was skipped"
      />
    );
  }
  if (status === "in_progress") {
    return <Loader2 className={`${size} shrink-0 animate-spin text-yellow-500`} />;
  }
  if (conclusion === "success") {
    return <CheckCircle2 className={`${size} shrink-0 text-green-600`} />;
  }
  if (conclusion === "failure") {
    return <XCircle className={`${size} shrink-0 text-red-600`} />;
  }
  if (conclusion === "cancelled") {
    return <XCircle className={`${size} shrink-0 text-muted-foreground`} />;
  }
  return <Clock className={`${size} shrink-0 text-muted-foreground`} />;
}

/** 时长格式化（ms → "20s" / "1m 30s"；官方 Total duration/step 耗时） */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * 从 job 全量日志切出单个 step 的日志段（GitHub 日志以 `##[group]` 标记分组）：
 * 匹配 `##[group]{stepName}`（action/run 步骤带 `Run ` 前缀）到 `##[endgroup]` 区间；
 * 匹配不到（内置步骤命名差异）→ 回退全量日志，保证始终有内容可展示。
 */
function sliceStepLog(full: string, stepName: string): string {
  const esc = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = full.match(new RegExp(`##\\[group\\](?:Run )?${esc}`));
  if (!m || m.index === undefined) return full;
  const start = m.index;
  const endIdx = full.indexOf("##[endgroup]", start + m[0].length);
  const end = endIdx === -1 ? full.length : endIdx;
  return full.slice(start, end).trim();
}

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

          {/* 分页（复用通用 Pager；官方 Previous/Next 语义） */}
          <Pager
            page={page}
            totalPages={Math.ceil(totalCount / PER_PAGE)}
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

/** Workflows 列表页（/actions/workflows） */
export function WorkflowsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetchWorkflows(owner, repo, token, 200)
      .then((wfs) => {
        if (!cancelled) setWorkflows(wfs);
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
  }, [owner, repo, token]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (error) throw error;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("actions.workflowsPage")}</h1>
      {workflows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty.actions")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {workflows.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-4 py-3">
              <Zap className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.name}</p>
                <p className="truncate text-xs text-muted-foreground">{w.path}</p>
              </div>
              <Badge variant={w.state === "active" ? "default" : "secondary"}>
                {w.state === "active" ? t("actions.active") : w.state}
              </Badge>
              <WorkflowDispatch w={w} owner={owner} repo={repo} token={token} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 手动触发 workflow（workflow_dispatch；需 write，默认 ref = 默认分支） */
function WorkflowDispatch({
  w,
  owner,
  repo,
  token,
}: {
  w: Workflow;
  owner: string;
  repo: string;
  token: string | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !ref.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await dispatchWorkflow(owner, repo, w.id, ref.trim(), token);
      setOpen(false);
      setRef("");
      navigate(`/${owner}/${repo}/actions`);
    } catch (err) {
      setError(apiErrorMessage(err, t("actions.dispatchFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <WriteGate>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRef("");
            setOpen(true);
          }}
        >
          <Play className="size-3.5" />
          {t("actions.runWorkflow")}
        </Button>
      </WriteGate>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("actions.runWorkflow")}: {w.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("actions.branch")}</label>
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main"
                autoFocus
              />
            </div>
            {error && <InlineError message={error} size="sm" />}
            <DialogFooter>
              <Button type="submit" disabled={busy || !ref.trim()}>
                {busy ? t("common.saving") : t("actions.dispatch")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Run 详情页（/actions/runs/{id}：官方左导航 + Summary 卡 + job 卡 step 耗时） */
export function RunDetailPage() {
  const { owner = "", repo = "", runId = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWorkflowRunDetail(owner, repo, Number(runId), token).catch(() => null),
      fetchWorkflowRunJobs(owner, repo, Number(runId), token).catch(() => []),
      fetchRunArtifacts(owner, repo, Number(runId), token).catch(() => []),
    ]).then(([r, js, arts]) => {
      if (cancelled) return;
      if (!r) setError(new ApiError(404, t("actions.runNotFound")));
      setRun(r);
      setJobs(js);
      setArtifacts(arts);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, runId, token]);

  // Total duration（官方 Summary：updated_at - run_started_at）
  const durationMs = useMemo(() => {
    if (!run?.run_started_at) return null;
    const end = new Date(run.updated_at).getTime();
    const start = new Date(run.run_started_at).getTime();
    return Number.isFinite(end - start) ? end - start : null;
  }, [run]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  // 整页级致命错误（run 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !run) throw error ?? new ApiError(404, t("actions.runNotFound"));

  return (
    /* 官方 D 型：左导航（Summary/All jobs/Run details）+ 右内容（PageLayout 收编手写 grid） */
    <PageLayout
      gap="lg"
      left={{
        node: (
          <nav aria-label={t("actions.summary")}>
            <ul className="space-y-0.5">
              <li>
                <span className="block rounded-md bg-accent px-2 py-1 text-sm font-medium text-foreground">
                  {t("actions.summary")}
                </span>
              </li>
              <li>
                <span className="block px-2 py-1 text-sm font-semibold">
                  {t("actions.allJobs")}
                </span>
              </li>
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link
                    to={`/${owner}/${repo}/actions/runs/${run.id}/job/${j.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <span className="shrink-0">{runStatusIcon(j.status, j.conclusion)}</span>
                    <span className="truncate">{j.name}</span>
                  </Link>
                </li>
              ))}
              <li className="pt-2">
                <span className="block px-2 py-1 text-sm font-semibold">
                  {t("actions.runDetails")}
                </span>
              </li>
              <li>
                <a
                  href={run.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <FileText className="size-3.5 shrink-0" />
                  {t("actions.workflowFile")}
                </a>
              </li>
            </ul>
          </nav>
        ),
        width: 200,
        sticky: "nav",
      }}
    >
      {/* 右内容 */}
      <div className="space-y-4">
        {/* 头部：状态 + #号 + 标题 */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {runBadge(run.status, run.conclusion)}
            <Badge variant="secondary">#{run.run_number}</Badge>
          </div>
          <h1 className="text-2xl font-bold wrap-break-word">{run.display_title || run.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {run.event} · by {run.actor?.login ?? "ghost"}
            </span>
            {run.head_branch && (
              <span className="flex items-center gap-0.5">
                <GitBranch className="size-3" />
                {run.head_branch}
              </span>
            )}
            <span>{fmt(run.created_at)}</span>
            <span className="truncate font-mono text-[10px]">{run.head_sha.slice(0, 7)}</span>
          </div>
        </header>

        {/* Workflow run summary（官方 Summary 卡） */}
        <div className="rounded-lg border bg-card">
          <div className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
            {t("actions.summaryTitle")}
          </div>
          <div className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("actions.summary.triggeredVia")}</span>
              <span className="truncate">{run.event}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("actions.summary.author")}</span>
              <span>{run.actor?.login ?? "ghost"}</span>
            </div>
            {run.head_branch && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t("actions.summary.branch")}</span>
                <span className="truncate">{run.head_branch}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("actions.summary.status")}</span>
              <span>{run.conclusion ?? run.status}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("actions.summary.duration")}</span>
              <span>{durationMs != null ? fmtDuration(durationMs) : "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("actions.summary.artifacts")}</span>
              <span>{artifacts.length > 0 ? artifacts.length : "–"}</span>
            </div>
          </div>
          {artifacts.length > 0 && (
            <ul className="divide-y border-t">
              {artifacts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Package className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {(a.size_in_bytes / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Jobs（官方 job 卡：step 耗时 + 链接到 job 页） */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">{t("actions.jobs")}</h2>
          {jobs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("actions.noJobs")}
            </p>
          ) : (
            jobs.map((j) => (
              <div key={j.id} className="overflow-hidden rounded-lg border bg-card">
                <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm">
                  {runBadge(j.status, j.conclusion)}
                  <Link
                    to={`/${owner}/${repo}/actions/runs/${run.id}/job/${j.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {j.name}
                  </Link>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {j.started_at && j.completed_at
                      ? t("actions.succeededIn").replace(
                          "{duration}",
                          fmtDuration(
                            new Date(j.completed_at).getTime() - new Date(j.started_at).getTime(),
                          ),
                        )
                      : j.status}
                  </span>
                </div>
                <ul className="divide-y">
                  {j.steps.map((s) => (
                    <li key={s.number} className="flex items-center gap-2 px-4 py-2 text-sm">
                      {stepIcon(s.status, s.conclusion, "size-3.5")}
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {s.started_at && s.completed_at
                          ? fmtDuration(
                              new Date(s.completed_at).getTime() - new Date(s.started_at).getTime(),
                            )
                          : (s.conclusion ?? s.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </PageLayout>
  );
}

/** Job 详情页（/actions/runs/{id}/job/{jobId}：step 点击展开日志 + Search logs） */
export function JobDetailPage() {
  const { owner = "", repo = "", runId = "", jobId = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // step 日志展开（step number → 日志文本）
  const [logs, setLogs] = useState<Record<number, string | null>>({});
  const [logLoading, setLogLoading] = useState<Record<number, boolean>>({});
  const [logError, setLogError] = useState<Record<number, boolean>>({});
  // Search logs（官方：前端过滤当前加载日志）
  const [logQuery, setLogQuery] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWorkflowRunDetail(owner, repo, Number(runId), token).catch(() => null),
      fetchWorkflowRunJobs(owner, repo, Number(runId), token).catch(() => []),
    ]).then(([r, js]) => {
      if (cancelled) return;
      if (!r) setError(new ApiError(404, t("actions.runNotFound")));
      setRun(r);
      setJobs(js);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, runId, token]);

  const job = jobs.find((j) => String(j.id) === jobId);

  // 展开 step → 拉 job 日志并按 step 名切片（官方点击 step 显示该 step 日志）
  const toggleStep = async (stepNumber: number) => {
    if (logs[stepNumber] !== undefined) {
      setLogs((prev) => {
        const next = { ...prev };
        delete next[stepNumber];
        return next;
      });
      return;
    }
    if (!token) return;
    setLogLoading((prev) => ({ ...prev, [stepNumber]: true }));
    setLogError((prev) => ({ ...prev, [stepNumber]: false }));
    try {
      const full = await fetchJobLogs(owner, repo, Number(jobId), token);
      const stepName = job?.steps.find((x) => x.number === stepNumber)?.name ?? "";
      const slice = full ? sliceStepLog(full, stepName) : null;
      setLogs((prev) => ({ ...prev, [stepNumber]: slice }));
    } catch {
      setLogError((prev) => ({ ...prev, [stepNumber]: true }));
    } finally {
      setLogLoading((prev) => ({ ...prev, [stepNumber]: false }));
    }
  };

  const visibleLogs = useMemo(() => {
    if (!logQuery.trim()) return logs;
    const q = logQuery.toLowerCase();
    const out: Record<number, string | null> = {};
    for (const [k, v] of Object.entries(logs)) {
      if (v && v.toLowerCase().includes(q)) out[Number(k)] = v;
      else if (v === null) out[Number(k)] = null;
    }
    return out;
  }, [logs, logQuery]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  // 整页级致命错误（run/job 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !run || !job) throw error ?? new ApiError(404, t("actions.jobNotFound"));

  return (
    /* 官方 D 型：左导航（Summary/All jobs/Run details）+ 右内容（单列→两栏对齐） */
    <PageLayout
      gap="lg"
      left={{
        node: (
          <nav aria-label={t("actions.summary")}>
            <ul className="space-y-0.5">
              <li>
                <Link
                  to={`/${owner}/${repo}/actions/runs/${run.id}`}
                  className="block truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  {t("actions.summary")}
                </Link>
              </li>
              <li>
                <span className="block px-2 py-1 text-sm font-semibold">
                  {t("actions.allJobs")}
                </span>
              </li>
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link
                    to={`/${owner}/${repo}/actions/runs/${run.id}/job/${j.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                      j.id === job.id
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="shrink-0">{runStatusIcon(j.status, j.conclusion)}</span>
                    <span className="truncate">{j.name}</span>
                  </Link>
                </li>
              ))}
              <li className="pt-2">
                <span className="block px-2 py-1 text-sm font-semibold">
                  {t("actions.runDetails")}
                </span>
              </li>
              <li>
                <a
                  href={run.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <FileText className="size-3.5 shrink-0" />
                  {t("actions.workflowFile")}
                </a>
              </li>
            </ul>
          </nav>
        ),
        width: 200,
        sticky: "nav",
      }}
    >
      <div className="space-y-4">
        {/* 头部：workflow 名 + 标题 #号 */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {runBadge(job.status, job.conclusion)}
            <Badge variant="secondary">
              #{run.run_number} · {job.name}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold wrap-break-word">{run.display_title || run.name}</h1>
          <div className="text-xs text-muted-foreground">
            {job.name} · {job.status === "completed" ? t("actions.completed") : job.status}
            {job.started_at && job.completed_at
              ? t("actions.completedIn").replace(
                  "{duration}",
                  fmtDuration(
                    new Date(job.completed_at).getTime() - new Date(job.started_at).getTime(),
                  ),
                )
              : ""}
            {" · "}
            {fmt(job.started_at ?? run.created_at)}
          </div>
        </header>

        {/* Search logs（官方） */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={logQuery}
            onChange={(e) => setLogQuery(e.target.value)}
            placeholder={t("actions.searchLogs")}
            className="pl-8"
          />
        </div>

        {/* step 列表（官方：点击展开日志；skip 项不可展开） */}
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {job.steps.map((s) => {
            const isSkipped = s.conclusion === "skipped";
            const isExpanded =
              logs[s.number] !== undefined || logLoading[s.number] || logError[s.number];
            return (
              <li key={s.number} className="text-sm">
                <button
                  type="button"
                  onClick={() => !isSkipped && void toggleStep(s.number)}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2.5 text-left",
                    !isSkipped && "hover:bg-accent/50",
                    isSkipped && "cursor-default",
                  )}
                >
                  {/* 展开指示（skip 项无） */}
                  {!isSkipped && (
                    <span className="shrink-0 text-muted-foreground">
                      {isExpanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </span>
                  )}
                  {stepIcon(s.status, s.conclusion)}
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {s.started_at && s.completed_at
                      ? fmtDuration(
                          new Date(s.completed_at).getTime() - new Date(s.started_at).getTime(),
                        )
                      : (s.conclusion ?? s.status)}
                  </span>
                </button>
                {/* 展开的日志区（带行号只读展示，复用 CodeView） */}
                {(logs[s.number] !== undefined || logLoading[s.number] || logError[s.number]) && (
                  <div className="border-t bg-muted/30 px-4 py-3">
                    {logLoading[s.number] ? (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {t("actions.logLoading")}
                      </p>
                    ) : logError[s.number] ? (
                      <InlineError message={t("actions.logFailed")} size="sm" />
                    ) : visibleLogs[s.number] ? (
                      <div className="max-h-96 overflow-y-auto rounded-md">
                        <CodeView
                          key={`${s.number}-${logQuery}`}
                          code={visibleLogs[s.number] ?? ""}
                          path="workflow.log"
                          minHeight="min-h-32"
                        />
                      </div>
                    ) : logQuery ? (
                      <p className="text-xs text-muted-foreground">{t("actions.logNoMatch")}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("actions.logEmpty")}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </PageLayout>
  );
}
