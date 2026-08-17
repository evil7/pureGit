/**
 * Job 详情页（/:owner/:repo/actions/runs/:runId/job/:jobId）
 *
 * 自 ActionsPages.tsx 拆出。官方 D 型布局：左导航（Summary/All jobs/Run details）+
 * 右内容（step 点击展开日志 + Search logs 前端过滤）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchWorkflowRunDetail, fetchWorkflowRunJobs, fetchJobLogs, ApiError } from "@/lib/api";
import type { WorkflowRun, WorkflowJob } from "@/lib/restapi";
import { CodeView } from "@/components/CodeView";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { fmtDuration, runBadge, runStatusIcon, sliceStepLog, stepIcon } from "./shared";

export default function JobDetailPage() {
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
