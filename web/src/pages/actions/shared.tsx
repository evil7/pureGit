/**
 * Actions 页面共享工具（自 ActionsPages.tsx 拆出）
 *
 * 供 /actions（列表）、/actions/runs/:id（run 详情）、/actions/runs/:id/job/:jobId（job 详情）
 * 三页共用的小写辅助函数与静态选项——均为返回 JSX 的纯函数，非组件，故独立成文件避免
 * fast refresh 的「组件文件混导出非组件」警告。
 */
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleSlash, Clock, Loader2, XCircle } from "lucide-react";

/** 事件过滤静态选项（官方 Event▾；常见事件） */
export const EVENT_OPTIONS = [
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
export const STATUS_OPTIONS = [
  "completed",
  "in_progress",
  "queued",
  "action_required",
  "cancelled",
];

/** 状态 → 徽标（官方颜色语义；列表行尾 / 详情头部共用） */
export function runBadge(status: string, conclusion: string | null) {
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
export function runStatusIcon(status: string, conclusion: string | null) {
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
export function stepIcon(status: string, conclusion: string | null, size = "size-4") {
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
export function fmtDuration(ms: number): string {
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
export function sliceStepLog(full: string, stepName: string): string {
  const esc = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = full.match(new RegExp(`##\\[group\\](?:Run )?${esc}`));
  if (!m || m.index === undefined) return full;
  const start = m.index;
  const endIdx = full.indexOf("##[endgroup]", start + m[0].length);
  const end = endIdx === -1 ? full.length : endIdx;
  return full.slice(start, end).trim();
}
