/**
 * PR 状态徽标与 checks 展示组件（ChecksBadge / CheckRunRow / WorkflowRunRow / PullStateBadge）
 * —— 自 PullDetailPage 拆出，均为纯展示组件（无 state，props 驱动）。
 */
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATE_BADGE_SOLID } from "@/lib/ui/state-colors";
import { cn } from "@/lib/utils";
import {
  type CheckRunsSummary,
  type CheckRunItem,
  type PullRequest,
  type WorkflowRun,
} from "@/lib/restapi";
import { runStatusIcon } from "../actions/shared";

/** CI checks 徽标（完整文字版——详情页 Checks tab 用：绿=全过 / 黄=pending / 红=失败） */
export function ChecksBadge({ summary }: { summary: CheckRunsSummary }) {
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

/** 单个 check run 行（Checks tab 列表项：状态图标 + 名字 [workflow / job] + Details 链接） */
export function CheckRunRow({ run }: { run: CheckRunItem }) {
  const done = run.status === "COMPLETED";
  const failed =
    done &&
    (run.conclusion === "FAILURE" ||
      run.conclusion === "CANCELLED" ||
      run.conclusion === "TIMED_OUT" ||
      run.conclusion === "STARTUP_FAILURE" ||
      run.conclusion === "ACTION_REQUIRED");
  const ok = done && run.conclusion === "SUCCESS";
  const Icon = ok ? CheckCircle2 : failed ? CircleX : done ? CircleDashed : Loader2;
  const iconCls = ok
    ? "text-green-600"
    : failed
      ? "text-red-600"
      : done
        ? "text-muted-foreground"
        : "text-yellow-500";
  const name = run.workflowName ? `${run.workflowName} / ${run.name}` : run.name;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <Icon className={cn("size-4 shrink-0", iconCls, !done && "animate-spin")} />
      <span className="min-w-0 flex-1 truncate text-sm">{name || "—"}</span>
      {run.detailsUrl && (
        <a
          href={run.detailsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Details
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

/** 单个 workflow run 行（Checks tab：关联 head commit 的实际运行 workflow；站内跳 run 详情） */
export function WorkflowRunRow({
  run,
  owner,
  repo,
  fmt,
}: {
  run: WorkflowRun;
  owner: string;
  repo: string;
  fmt: (s: string) => string;
}) {
  const title = run.display_title || run.name || `Run #${run.run_number}`;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <span className="shrink-0">{runStatusIcon(run.status, run.conclusion)}</span>
      <Link
        to={`/${owner}/${repo}/actions/runs/${run.id}`}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary hover:underline"
      >
        {title}
      </Link>
      <span className="shrink-0 text-xs text-muted-foreground">{fmt(run.created_at)}</span>
    </div>
  );
}

/** PR 状态徽标（merged=紫 / open=绿 / closed=红） */
export function PullStateBadge({ pr }: { pr: PullRequest }) {
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
