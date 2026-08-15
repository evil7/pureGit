/**
 * Run 详情页（/:owner/:repo/actions/runs/:runId）
 *
 * 自 ActionsPages.tsx 拆出。官方 D 型布局：左导航（Summary/All jobs/Run details）+
 * 右内容（Summary 卡 [Status/Total duration/Artifacts] + job 卡 step 耗时）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Download, FileText, GitBranch, Package, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import {
  fetchWorkflowRunDetail,
  fetchWorkflowRunJobs,
  fetchRunArtifacts,
  cancelWorkflowRun,
  rerunWorkflowRun,
  rerunWorkflowFailedJobs,
  deleteWorkflowRun,
  apiErrorMessage,
  ApiError,
} from "@/lib/api";
import type { WorkflowRun, WorkflowJob, RunArtifact } from "@/lib/restapi";
import PageLayout from "@/components/PageLayout";
import { fmtDuration, runBadge, runStatusIcon, stepIcon } from "./shared";

export default function RunDetailPage() {
  const { owner = "", repo = "", runId = "" } = useParams();
  const { token, canWrite } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const navigate = useNavigate();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // run 操作（取消/重跑/删除）进行中 + 删除确认弹窗
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // 操作权限：令牌写 scope（canWrite）叠加仓库级写权限（canWriteRepo），同 PR 详情双门槛
  const canOperate = Boolean(token) && canWrite && canWriteRepo;

  /** run 操作统一处理：成功后刷新详情（取消→重拉；重跑→跳新 run 由 API 返回触发，此处仅提示） */
  const operate = async (fn: () => Promise<void>, okMsg: string) => {
    if (!token || !run || busy) return;
    setBusy(true);
    try {
      await fn();
      toastSuccess(okMsg);
      // 取消/重跑/删除后状态已变，重拉一次详情刷新徽标与操作区
      const fresh = await fetchWorkflowRunDetail(owner, repo, run.id, token).catch(() => null);
      if (fresh) setRun(fresh);
    } catch (e) {
      toastError(apiErrorMessage(e, t("actions.opFailed")));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !run) return;
    setBusy(true);
    try {
      await deleteWorkflowRun(owner, repo, run.id, token);
      toastSuccess(t("actions.deleted"));
      navigate(`/${owner}/${repo}/actions`);
    } catch (e) {
      toastError(apiErrorMessage(e, t("actions.opFailed")));
    } finally {
      setBusy(false);
    }
  };

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
                {run.path ? (
                  <Link
                    to={`/${owner}/${repo}/blob/${run.head_sha}/${run.path}`}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    {t("actions.workflowFile")}
                  </Link>
                ) : (
                  <a
                    href={run.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    {t("actions.workflowFile")}
                  </a>
                )}
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

          {/* run 操作区（官方：进行中可取消；完成后可重跑/重跑失败；均可删除；需仓库写权限） */}
          {canOperate && (
            <div className="flex flex-wrap gap-2 pt-1">
              {run.status !== "completed" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void operate(
                      () => cancelWorkflowRun(owner, repo, run.id, token),
                      t("actions.cancelled"),
                    )
                  }
                  disabled={busy}
                >
                  <XCircle className="size-3.5" />
                  {t("actions.cancelRun")}
                </Button>
              ) : (
                <>
                  {run.conclusion === "failure" && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void operate(
                          () => rerunWorkflowFailedJobs(owner, repo, run.id, token),
                          t("actions.rerunning"),
                        )
                      }
                      disabled={busy}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("actions.rerunFailed")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      void operate(
                        () => rerunWorkflowRun(owner, repo, run.id, token),
                        t("actions.rerunning"),
                      )
                    }
                    disabled={busy}
                  >
                    <RotateCcw className="size-3.5" />
                    {t("actions.rerunAll")}
                  </Button>
                </>
              )}
              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  {t("actions.deleteRun")}
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("actions.deleteRunTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("actions.deleteRunDesc")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleDelete()}
                      disabled={busy}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      {busy ? t("common.deleting") : t("common.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
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
                  {a.archive_download_url && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      asChild
                      title={t("actions.download")}
                    >
                      <a href={a.archive_download_url} target="_blank" rel="noreferrer">
                        <Download className="size-3.5" />
                      </a>
                    </Button>
                  )}
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
