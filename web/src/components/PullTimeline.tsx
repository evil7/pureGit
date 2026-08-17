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
  GitBranch,
  GitCommit,
  GitMerge,
  Lock,
  MessageSquare,
  Milestone,
  PencilLine,
  Rocket,
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
import { Button } from "@/components/ui/button";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, type I18nKey } from "@/i18n";
import { MarkdownView } from "@/components/MarkdownView";
import { UserAvatar } from "@/components/UserAvatar";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { isCopilotLogin, COPILOT_AVATAR, copilotDisplayName } from "@/lib/repo/copilot";
import type { PullReaction, PullReviewComment, PullTimelineEvent } from "@/lib/api";
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
  "head-ref-deleted": GitBranch,
  deployed: Rocket,
  "cross-referenced": GitCommit,
  commit: GitCommit,
};

/** 关键事件强调色（icon 与文字同色；对齐 STATE_BADGE_SOLID 的 primer 状态色：紫=合并/红=关闭/绿=重开/琥珀=强推/蓝=部署） */
const EVENT_COLOR: Partial<Record<PullTimelineEvent["kind"], string>> = {
  merged: "text-[#8250df] dark:text-[#a371f7]",
  closed: "text-[#cf222e] dark:text-[#f85149]",
  reopened: "text-[#1a7f37] dark:text-[#3fb950]",
  "force-pushed": "text-[#9a6700] dark:text-[#d4a72c]",
  "ready-for-review": "text-[#1a7f37] dark:text-[#3fb950]",
  deployed: "text-[#0969da] dark:text-[#2f81f7]",
  "head-ref-deleted": "text-[#cf222e] dark:text-[#f85149]",
};

/** ReactionContent 枚举 → emoji（官方 reaction pill 表情） */
const REACTION_EMOJI: Record<string, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

/** 角色徽标（官方：Author/Collaborator/Contributor/First-time contributor/Bot） */
function AuthorAssociationBadge({
  login,
  association,
  prAuthor,
}: {
  login: string;
  association: string | null;
  prAuthor: string | null;
}) {
  const { t } = useI18n();
  const badgeCls =
    "gap-1 border-border text-muted-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground";
  const isBot = login.endsWith("[bot]") || isCopilotLogin(login);
  if (isBot) {
    return (
      <Badge variant="outline" className={badgeCls}>
        {t("timeline.roleBot")}
      </Badge>
    );
  }
  if (prAuthor && login === prAuthor) {
    return (
      <Badge variant="outline" className="gap-1 border-border text-foreground">
        {t("timeline.roleAuthor")}
      </Badge>
    );
  }
  if (association === "COLLABORATOR" || association === "MEMBER" || association === "OWNER") {
    return (
      <Badge variant="outline" className="gap-1 border-border text-foreground">
        {t("timeline.roleCollaborator")}
      </Badge>
    );
  }
  if (association === "CONTRIBUTOR") {
    return (
      <Badge variant="outline" className={badgeCls}>
        {t("timeline.roleContributor")}
      </Badge>
    );
  }
  if (association === "FIRST_TIME_CONTRIBUTOR" || association === "FIRST_TIMER") {
    return (
      <Badge variant="outline" className={badgeCls}>
        {t("timeline.roleFirstTimer")}
      </Badge>
    );
  }
  return null;
}

/** 标签彩色徽标（label.color 十六进制 → 背景/文字色） */
function LabelBadge({ name, color }: { name: string; color: string }) {
  const text = isLightColor(color) ? "#1f2328" : "#ffffff";
  return (
    <Badge className="gap-1 border-0" style={{ backgroundColor: `#${color}`, color: text }}>
      {name}
    </Badge>
  );
}

/** 判断标签色是否浅色（决定文字用深色/白） */
function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

/** emoji 反应条（官方 reaction pill：👍 3 · ❤️ 1，置于评论/评审卡底部） */
function ReactionBar({ reactions }: { reactions: PullReaction[] }) {
  if (!reactions.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <span
          key={r.content}
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
        >
          <span className="text-sm leading-none">{REACTION_EMOJI[r.content] ?? r.content}</span>
          <span className="font-medium">{r.count}</span>
        </span>
      ))}
    </div>
  );
}

/** diff hunk 代码片段（行内评论线程：上下文/删减/新增三色渲染） */
function DiffHunk({ hunk }: { hunk: string }) {
  const lines = hunk.split("\n");
  return (
    <div className="mt-2 overflow-x-auto rounded-md border bg-muted/40">
      <pre className="p-2 font-mono text-xs leading-5">
        {lines.map((line, i) => {
          const cls = line.startsWith("+")
            ? "text-[var(--diff-add-fg)]"
            : line.startsWith("-")
              ? "text-[var(--diff-del-fg)]"
              : line.startsWith("@@")
                ? "text-muted-foreground"
                : "text-foreground";
          return (
            <div key={i} className={cls}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** 事件节点（stepper-indicator 内容）：评论/评审用头像，commit/纯事件行用图标圆框 */
function TimelineMark({ event }: { event: PullTimelineEvent }) {
  const hasAvatar = event.kind === "comment" || event.kind === "review";
  if (hasAvatar && (event.author?.login || event.author?.avatarUrl)) {
    return (
      <UserAvatar
        src={avatarOf(event.author?.login, event.author?.avatarUrl)}
        alt={event.author?.login ?? "unknown"}
        className="size-8 ring-2 ring-background"
      />
    );
  }
  const Icon = EVENT_ICON[event.kind] ?? MessageSquare;
  // 事件节点 = 圆形彩色头像式图标：关键事件用对应强调色，其余统一灰
  const iconColor = EVENT_COLOR[event.kind] ?? "text-muted-foreground";
  return (
    <span
      className={`flex size-8 items-center justify-center rounded-full border bg-card ring-2 ring-background ${iconColor}`}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** 纯事件行事件（comment/review/review-thread/commit 外的全部——均含 actor + createdAt） */
type RowEvent = Exclude<
  PullTimelineEvent,
  { kind: "comment" | "review" | "review-thread" | "commit" }
>;

/** 事件行中文文案（对齐官方语义；t 注入 i18n 翻译函数，actor 归一 Copilot） */
function eventText(
  e: RowEvent,
  t: (key: I18nKey, vars?: Record<string, unknown>) => string,
): string {
  const actor = copilotDisplayName(e.actor?.login ?? t("common.unknownUser"));
  switch (e.kind) {
    case "merged":
      return t("timeline.mergedCard", {
        actor,
        sha: e.commit?.abbreviatedOid ?? e.commit?.oid ?? "",
        ref: e.mergeRefName ?? t("common.targetBranch"),
      });
    case "closed":
      return t("timeline.closed", { actor });
    case "reopened":
      return t("timeline.reopened", { actor });
    case "assigned":
      return e.assignee === actor || !e.assignee
        ? t("timeline.assignedSelf", { actor })
        : t("timeline.assigned", { actor, assignee: e.assignee });
    case "unassigned":
      return e.assignee
        ? t("timeline.unassignedOther", { actor, assignee: e.assignee })
        : t("timeline.unassigned", { actor });
    case "labeled":
      return t("timeline.labeled", { actor, label: e.label?.name ?? "" });
    case "unlabeled":
      return t("timeline.unlabeled", { actor, label: e.label?.name ?? "" });
    case "milestoned":
      return t("timeline.milestoned", { actor, milestone: e.milestoneTitle ?? "" });
    case "demilestoned":
      return t("timeline.demilestoned", { actor, milestone: e.milestoneTitle ?? "" });
    case "review-requested":
      return t("timeline.reviewRequested", { actor });
    case "review-request-removed":
      return t("timeline.reviewRequestRemoved", { actor });
    case "locked":
      return t("timeline.locked", { actor });
    case "unlocked":
      return t("timeline.unlocked", { actor });
    case "renamed":
      return t("timeline.renamed", { actor, from: e.previousTitle, to: e.currentTitle });
    case "force-pushed":
      return t("timeline.forcePushed", { actor });
    case "head-ref-deleted":
      return t("timeline.headRefDeleted", { actor, ref: e.headRefName });
    case "mentioned":
      return t("timeline.mentioned", { actor });
    case "ready-for-review":
      return t("timeline.markedReady", { actor });
    default:
      return t("timeline.updated", { actor });
  }
}

/** 纯事件行（图标 + 文案 + 时间；labeled/unlabeled 带彩色标签徽标，force-pushed 带 SHA 对比） */
function TimelineEventRow({ event }: { event: RowEvent }) {
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  const actor = copilotDisplayName(event.actor?.login ?? t("common.unknownUser"));
  // 关键事件文字强调色（与节点 icon 同色；非关键事件为空 → 默认灰）
  const color = EVENT_COLOR[event.kind] ?? "";

  // labeled/unlabeled：文案 + 彩色标签徽标
  if (event.kind === "labeled" || event.kind === "unlabeled") {
    const label = event.label;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm text-muted-foreground">
        <span className="shrink-0">
          {event.kind === "labeled"
            ? t("timeline.labeledShort", { actor })
            : t("timeline.unlabeledShort", { actor })}
        </span>
        {label && <LabelBadge name={label.name} color={label.color} />}
        <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
      </div>
    );
  }

  // force-pushed：actor 强制推送 + before→after SHA
  if (event.kind === "force-pushed") {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm text-muted-foreground">
        <span className={`shrink-0 ${color}`}>{t("timeline.forcePushed", { actor })}</span>
        {event.beforeCommit && event.afterCommit && (
          <span className="shrink-0 font-mono text-xs">
            <code>{event.beforeCommit.slice(0, 7)}</code> →{" "}
            <code>{event.afterCommit.slice(0, 7)}</code>
          </span>
        )}
        <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
      </div>
    );
  }

  // deployed：actor 部署到环境 + 查看部署链接
  if (event.kind === "deployed") {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm text-muted-foreground">
        <span className={`shrink-0 ${color}`}>
          {t("timeline.deployed", { actor, env: event.environment ?? "" })}
        </span>
        {event.environmentUrl && (
          <a
            href={event.environmentUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-medium text-primary hover:underline"
          >
            {t("timeline.viewDeployment")}
          </a>
        )}
        <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
      </div>
    );
  }

  // cross-referenced：actor 引用此 PR + 引用源链接
  if (event.kind === "cross-referenced") {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm text-muted-foreground">
        <span className="shrink-0">{t("timeline.crossReferenced", { actor })}</span>
        {event.source?.url && event.source.number > 0 && (
          <a
            href={event.source.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-medium text-primary hover:underline"
          >
            #{event.source.number}
          </a>
        )}
        <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5 text-sm text-muted-foreground">
      <span className={`min-w-0 truncate ${color}`}>{eventText(event, t)}</span>
      <span className="shrink-0 text-xs"> · {fmt(event.createdAt)}</span>
    </div>
  );
}

/** 评审内嵌行内评论卡（review.comments：diff 代码片段 + 作者 + 正文，对齐官方 review 内联评论） */
function ReviewCommentCard({
  comment,
  owner,
  repo,
  prAuthor,
}: {
  comment: PullReviewComment;
  owner: string;
  repo: string;
  prAuthor: string | null;
}) {
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="p-4">
        {comment.diffHunk && <DiffHunk hunk={comment.diffHunk} />}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Link
            to={`/${comment.author?.login ?? ""}`}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            {copilotDisplayName(comment.author?.login ?? "ghost")}
          </Link>
          {comment.author && (
            <AuthorAssociationBadge
              login={comment.author.login}
              association={comment.authorAssociation}
              prAuthor={prAuthor}
            />
          )}
          <span> · {fmt(comment.createdAt)}</span>
          {comment.lastEditedAt && <span className="shrink-0"> · {t("timeline.edited")}</span>}
        </div>
        <div className="mt-1 text-sm">
          <MarkdownView rawBase={repoRawBase(owner, repo)}>{comment.body}</MarkdownView>
          <ReactionBar reactions={comment.reactions} />
        </div>
      </CardContent>
    </Card>
  );
}

/** 评审卡（作者 + 状态徽标 + 时间 + body——评论态「提出了 · 时间」后直接展示评论，无折叠） */
function ReviewCard({
  event,
  owner,
  repo,
  prAuthor,
}: {
  event: Extract<PullTimelineEvent, { kind: "review" }>;
  owner: string;
  repo: string;
  prAuthor: string | null;
}) {
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  const isComment = event.state === "COMMENTED";
  return (
    <div className="pb-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Link
          to={`/${event.author?.login ?? ""}`}
          className="text-sm font-semibold text-foreground hover:underline"
        >
          {copilotDisplayName(event.author?.login ?? "ghost")}
        </Link>
        {event.author && (
          <AuthorAssociationBadge
            login={event.author.login}
            association={event.authorAssociation}
            prAuthor={prAuthor}
          />
        )}
        <span>
          {isComment
            ? t("timeline.proposed")
            : event.state === "APPROVED"
              ? t("timeline.approved")
              : t("timeline.requestedChanges")}
          {event.submittedAt ? ` · ${fmt(event.submittedAt)}` : ""}
        </span>
        {!isComment && <ReviewStateBadge state={event.state} />}
      </div>
      {event.body && (
        <Card className="mt-2">
          <CardContent className="p-4">
            <MarkdownView rawBase={repoRawBase(owner, repo)}>{event.body}</MarkdownView>
            <ReactionBar reactions={event.reactions} />
          </CardContent>
        </Card>
      )}
      {event.comments.length > 0 && (
        <div className="mt-2 space-y-2">
          {event.comments.map((c) => (
            <ReviewCommentCard
              key={c.id}
              comment={c}
              owner={owner}
              repo={repo}
              prAuthor={prAuthor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 评论卡（作者 + 角色徽标 + 时间 + edited + body） */
function CommentCard({
  event,
  owner,
  repo,
  prAuthor,
}: {
  event: Extract<PullTimelineEvent, { kind: "comment" }>;
  owner: string;
  repo: string;
  prAuthor: string | null;
}) {
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  return (
    <div className="pb-4">
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
            <Link
              to={`/${event.author?.login ?? ""}`}
              className="text-sm font-semibold text-foreground hover:underline"
            >
              {copilotDisplayName(event.author?.login ?? "ghost")}
            </Link>
            {event.author && (
              <AuthorAssociationBadge
                login={event.author.login}
                association={event.authorAssociation}
                prAuthor={prAuthor}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{fmt(event.createdAt)}</span>
            {event.lastEditedAt && <span className="shrink-0"> · {t("timeline.edited")}</span>}
          </div>
          <MarkdownView rawBase={repoRawBase(owner, repo)}>{event.body}</MarkdownView>
          <ReactionBar reactions={event.reactions} />
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
  prAuthor,
}: {
  event: Extract<PullTimelineEvent, { kind: "review-thread" }>;
  owner: string;
  repo: string;
  prAuthor: string | null;
}) {
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  // 默认展开（官方行内评论线程直接展示评论内容，非折叠；用户发布评论后需立即可见）
  const [expanded, setExpanded] = useState(true);
  const first = event.comments[0];
  const line = event.line ?? event.originalLine ?? null;
  return (
    <div className="pb-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Link
              to={`/${first?.author?.login ?? ""}`}
              className="text-sm font-semibold text-foreground hover:underline"
            >
              {copilotDisplayName(first?.author?.login ?? "ghost")}
            </Link>
            {first?.author && (
              <AuthorAssociationBadge
                login={first.author.login}
                association={first.authorAssociation}
                prAuthor={prAuthor}
              />
            )}
            <span>
              {t("timeline.commentedOn", {
                path: event.path,
                line: line != null ? `:${line}` : "",
              })}
            </span>
            {event.isResolved && (
              <Badge
                variant="outline"
                className="gap-1 border-transparent bg-emerald-500/15 text-[11px] text-emerald-600"
              >
                <CheckCircle2 className="size-3" />
                {t("diff.resolved")}
              </Badge>
            )}
            {first && <span className="shrink-0 text-xs"> · {fmt(first.createdAt)}</span>}
          </div>
          {first?.diffHunk && <DiffHunk hunk={first.diffHunk} />}
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
            {t("timeline.viewComments", { count: event.comments.length })}
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
                        className="text-sm font-semibold text-foreground hover:underline"
                      >
                        {copilotDisplayName(c.author?.login ?? "ghost")}
                      </Link>
                      <span> · {fmt(c.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 text-sm">
                      <MarkdownView rawBase={repoRawBase(owner, repo)}>{c.body}</MarkdownView>
                      <ReactionBar reactions={c.reactions} />
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
function renderEvent(
  event: PullTimelineEvent,
  owner: string,
  repo: string,
  prAuthor: string | null,
) {
  switch (event.kind) {
    case "comment":
      return <CommentCard event={event} owner={owner} repo={repo} prAuthor={prAuthor} />;
    case "review":
      return <ReviewCard event={event} owner={owner} repo={repo} prAuthor={prAuthor} />;
    case "review-thread":
      return <ReviewThreadCard event={event} owner={owner} repo={repo} prAuthor={prAuthor} />;
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
  prAuthor,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: PullTimelineEvent[];
  owner: string;
  repo: string;
  prAuthor: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  // stepper 步骤定义（仅 id 用于节点/竖线骨架；事件内容自定义渲染）
  const steps = useMemo(() => events.map((e) => ({ id: e.id })), [events]);
  const { t } = useI18n();

  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("timeline.empty")}</p>;
  }

  return (
    <>
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
              <div className="min-w-0 flex-1 pt-0.5">
                {renderEvent(event, owner, repo, prAuthor)}
              </div>
            </StepperItem>
          ))}
        </StepperNav>
      </Stepper>
      {hasMore && (
        <div className="mt-2 flex justify-center border-t pt-3">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t("common.loading") : t("timeline.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}
