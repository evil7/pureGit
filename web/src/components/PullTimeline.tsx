/**
 * PR Conversation 时间线（复刻官方 TimelineItem）
 *
 * 官方 Conversation 自上而下按时间正序混排：作者正文 → commit → 评论 → 评审 → 线程 → 合并 → 关闭 等。
 * 视觉：左侧贯穿竖线 + 事件项（评论/评审用头像，commit/纯事件行用图标圆框）+ 右侧内容。
 *
 * 布局基于自定义 stepper 组件（ui/stepper.tsx）vertical 模式适配：
 * Stepper(vertical) → StepperItem（flex-row 左列节点 + 右列内容）→ StepperIndicator(plain) 节点
 * + StepperSeparator 竖线连接；plain 变体无状态变色，纯展示事件节点。
 *
 * 数据源：GraphQL timelineItems（PR_TIMELINE_QUERY → fetchPullTimelineSmart）；
 * 加载失败由父组件降级回退「作者正文 + 评审列表 + CommentsSection」三段式渲染。
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  GitCommit,
  GitMerge,
  Lock,
  MessageSquare,
  Milestone,
  PencilLine,
  RotateCcw,
  Tag,
  Unlock,
  UserMinus,
  UserPlus,
  Zap,
} from "lucide-react";
import { Stepper, StepperItem, StepperIndicator, StepperNav } from "@/components/ui/stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDateFormat } from "@/hooks/useDateFormat";
import { MarkdownView } from "@/components/MarkdownView";
import { UserAvatar } from "@/components/UserAvatar";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { isCopilotLogin, COPILOT_AVATAR, copilotDisplayName } from "@/lib/repo/copilot";
import type { PullTimelineEvent } from "@/lib/api";
import { ReviewStateBadge } from "./PullReviewPanel";

/** 头像统一入口：Copilot 归一（与参与者/侧栏一致 in/946600） */
function avatarOf(login: string | null | undefined, avatarUrl: string | null | undefined) {
  return isCopilotLogin(login ?? "") ? COPILOT_AVATAR : (avatarUrl ?? undefined);
}

const EVENT_ICON: Partial<Record<PullTimelineEvent["kind"], typeof GitCommit>> = {
  merged: GitMerge,
  closed: CircleX,
  reopened: RotateCcw,
  assigned: UserPlus,
  unassigned: UserMinus,
  labeled: Tag,
  unlabeled: Tag,
  milestoned: Milestone,
  demilestoned: Milestone,
  locked: Lock,
  unlocked: Unlock,
  renamed: PencilLine,
  "force-pushed": Zap,
  "ready-for-review": CheckCircle2,
  commit: GitCommit,
};

/** 事件节点（stepper-indicator 内容）：评论/评审用头像，commit/纯事件行用图标圆框 */
function TimelineMark({ event }: { event: PullTimelineEvent }) {
  const hasAvatar = event.kind === "comment" || event.kind === "review";
  if (hasAvatar && (event.author?.login || event.author?.avatarUrl)) {
    return (
      <UserAvatar
        src={avatarOf(event.author?.login, event.author?.avatarUrl)}
        alt={event.author?.login ?? "unknown"}
        className="size-6 ring-2 ring-background"
      />
    );
  }
  const Icon = EVENT_ICON[event.kind] ?? MessageSquare;
  return (
    <span className="flex size-8 items-center justify-center rounded-full border bg-card text-muted-foreground ring-2 ring-background">
      <Icon className="size-4" />
    </span>
  );
}

/** 纯事件行事件（comment/review/review-thread/commit 外的全部——均含 actor + createdAt） */
type RowEvent = Exclude<
  PullTimelineEvent,
  { kind: "comment" | "review" | "review-thread" | "commit" }
>;

/** 事件行中文文案（对齐官方语义；与 PullReviewPanel 硬编码中文一致） */
function eventText(e: RowEvent): string {
  const actor = copilotDisplayName(e.actor?.login ?? "未知用户");
  switch (e.kind) {
    case "merged":
      return `${actor} 将提交合并到 ${e.mergeRefName ?? "目标分支"}`;
    case "closed":
      return `${actor} 关闭了此 PR`;
    case "reopened":
      return `${actor} 重新打开了此 PR`;
    case "assigned":
      return e.assignee === actor || !e.assignee
        ? `${actor} 自行指派`
        : `${actor} 指派给了 ${e.assignee}`;
    case "unassigned":
      return e.assignee ? `${actor} 取消了 ${e.assignee} 的指派` : `${actor} 取消了指派`;
    case "labeled":
      return `${actor} 添加了标签 ${e.label?.name ?? ""}`;
    case "unlabeled":
      return `${actor} 移除了标签 ${e.label?.name ?? ""}`;
    case "milestoned":
      return `${actor} 将此 PR 添加到里程碑 ${e.milestoneTitle ?? ""}`;
    case "demilestoned":
      return `${actor} 将此 PR 移出里程碑 ${e.milestoneTitle ?? ""}`;
    case "review-requested":
      return `${actor} 请求了评审`;
    case "review-request-removed":
      return `${actor} 移除了评审请求`;
    case "locked":
      return `${actor} 锁定了会话`;
    case "unlocked":
      return `${actor} 解锁了会话`;
    case "renamed":
      return `${actor} 将标题「${e.previousTitle}」改为「${e.currentTitle}」`;
    case "force-pushed":
      return `${actor} 强制推送了分支`;
    case "ready-for-review":
      return `${actor} 将此 PR 标记为就绪`;
    default:
      return `${actor} 更新了此 PR`;
  }
}

/** 纯事件行（图标 + 文案 + 时间，无卡片；时间用「 · 」紧跟文案分隔） */
function TimelineEventRow({ event }: { event: RowEvent }) {
  const { fmt } = useDateFormat();
  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5 text-sm text-muted-foreground">
      <span className="min-w-0 truncate">{eventText(event)}</span>
      <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
    </div>
  );
}

/** 评审卡（作者 + 状态徽标 + 时间 + body——评论态「提出了 · 时间」后直接展示评论，无折叠） */
function ReviewCard({
  event,
  owner,
  repo,
}: {
  event: Extract<PullTimelineEvent, { kind: "review" }>;
  owner: string;
  repo: string;
}) {
  const { fmt } = useDateFormat();
  const isComment = event.state === "COMMENTED";
  return (
    <div className="pb-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Link
          to={`/${event.author?.login ?? ""}`}
          className="font-medium text-foreground hover:underline"
        >
          {copilotDisplayName(event.author?.login ?? "ghost")}
        </Link>
        <span>
          {isComment ? "提出了" : event.state === "APPROVED" ? "批准了这些更改" : "请求更改"}
          {event.submittedAt ? ` · ${fmt(event.submittedAt)}` : ""}
        </span>
        {!isComment && <ReviewStateBadge state={event.state} />}
      </div>
      {event.body && (
        <Card className="mt-2">
          <CardContent className="p-4">
            <MarkdownView rawBase={repoRawBase(owner, repo)}>{event.body}</MarkdownView>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 评论卡（作者 + 时间 + body） */
function CommentCard({
  event,
  owner,
  repo,
}: {
  event: Extract<PullTimelineEvent, { kind: "comment" }>;
  owner: string;
  repo: string;
}) {
  const { fmt } = useDateFormat();
  return (
    <div className="pb-4">
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
            <Link
              to={`/${event.author?.login ?? ""}`}
              className="font-medium text-foreground hover:underline"
            >
              {copilotDisplayName(event.author?.login ?? "ghost")}
            </Link>
            <span className="min-w-0 flex-1 truncate">{fmt(event.createdAt)}</span>
          </div>
          <MarkdownView rawBase={repoRawBase(owner, repo)}>{event.body}</MarkdownView>
        </CardContent>
      </Card>
    </div>
  );
}

/** commit 行（message + sha + 作者/时间，无卡片——官方 Commit 条目） */
function CommitRow({ event }: { event: Extract<PullTimelineEvent, { kind: "commit" }> }) {
  const { fmt } = useDateFormat();
  return (
    <div className="flex min-w-0 items-center gap-2 py-1 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{event.messageHeadline}</span>
      <code className="shrink-0 font-mono text-xs text-muted-foreground">{event.oid}</code>
      <span className="shrink-0 text-xs text-muted-foreground">
        {copilotDisplayName(event.author?.login ?? event.author?.name ?? "unknown")} ·{" "}
        {fmt(event.committedDate)}
      </span>
    </div>
  );
}

/** 评审线程（折叠区块：path:line 标题 + 展开 comments 列表 + resolved 徽标；只读展示） */
function ReviewThreadCard({
  event,
  owner,
  repo,
}: {
  event: Extract<PullTimelineEvent, { kind: "review-thread" }>;
  owner: string;
  repo: string;
}) {
  const { fmt } = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const first = event.comments[0];
  const line = event.line ?? event.originalLine ?? null;
  return (
    <div className="pb-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Link
              to={`/${first?.author?.login ?? ""}`}
              className="font-medium text-foreground hover:underline"
            >
              {copilotDisplayName(first?.author?.login ?? "ghost")}
            </Link>
            <span>
              在 {event.path}
              {line != null ? `:${line}` : ""} 评论了
            </span>
            {event.isResolved && (
              <Badge
                variant="outline"
                className="gap-1 border-transparent bg-emerald-500/15 text-[11px] text-emerald-600"
              >
                <CheckCircle2 className="size-3" />
                已解决
              </Badge>
            )}
            {first && <span className="shrink-0 text-xs"> · {fmt(first.createdAt)}</span>}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            查看评论（{event.comments.length}）
          </button>
          {expanded && (
            <div className="mt-2 space-y-2 border-t pt-2">
              {event.comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <UserAvatar
                    src={avatarOf(c.author?.login, c.author?.avatarUrl)}
                    alt={c.author?.login ?? "unknown"}
                    className="size-5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">
                      <Link
                        to={`/${c.author?.login ?? ""}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {copilotDisplayName(c.author?.login ?? "ghost")}
                      </Link>
                      <span> · {fmt(c.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 text-sm">
                      <MarkdownView rawBase={repoRawBase(owner, repo)}>{c.body}</MarkdownView>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 事件右侧内容（按 kind 分发） */
function renderEvent(event: PullTimelineEvent, owner: string, repo: string) {
  switch (event.kind) {
    case "comment":
      return <CommentCard event={event} owner={owner} repo={repo} />;
    case "review":
      return <ReviewCard event={event} owner={owner} repo={repo} />;
    case "review-thread":
      return <ReviewThreadCard event={event} owner={owner} repo={repo} />;
    case "commit":
      return <CommitRow event={event} />;
    default:
      return <TimelineEventRow event={event} />;
  }
}

/** PR Conversation 时间线（官方 TimelineItem 竖线 + 事件混排；基于 stepper vertical 适配） */
export function PullTimeline({
  events,
  owner,
  repo,
}: {
  events: PullTimelineEvent[];
  owner: string;
  repo: string;
}) {
  // stepper 步骤定义（仅 id 用于节点/竖线骨架；事件内容自定义渲染）
  const steps = useMemo(() => events.map((e) => ({ id: e.id })), [events]);

  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">暂无时间线事件</p>;
  }

  return (
    <Stepper orientation="vertical" steps={steps} defaultValue={steps[0]?.id} className="w-full">
      <StepperNav className="w-full">
        {events.map((event) => (
          <StepperItem
            key={event.id}
            stepId={event.id}
            className="w-full flex-row items-start gap-3"
          >
            {/* 左列：节点（竖线由 StepperNav 自动贯穿连线，节点圆形盖线） */}
            <div className="flex flex-col items-center">
              <StepperIndicator
                variant="plain"
                className="size-8 shrink-0 overflow-visible rounded-full bg-transparent"
              >
                <TimelineMark event={event} />
              </StepperIndicator>
            </div>
            {/* 右列：事件内容 */}
            <div className="min-w-0 flex-1 pt-0.5">{renderEvent(event, owner, repo)}</div>
          </StepperItem>
        ))}
      </StepperNav>
    </Stepper>
  );
}
