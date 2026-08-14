/**
 * PR 评审工作流面板（B1：Reviewers 栏 + Review changes 三态弹窗 + Merge 合并区）
 *
 * 复刻 GitHub PR 详情页评审交互，官方 F 型右 metadata + 主列操作区：
 * - Reviewers 栏（官方 metadata 第一位）：已提交评审状态（approve/request changes 徽标）+ 请求的评审者 + 请求入口
 * - Merge 区（主列 header 下方，open PR 且有权限时）：Merge/Squash/Rebase 三方式 + 确认弹窗
 * - Review changes 弹窗：Comment/Approve/Request changes 三态 + body 编辑器
 * 数据源 smart 双通道（GraphQL 首选 + REST 降级），详见 api-compat.md。
 */
import { useEffect, useState } from "react";
import { Check, ChevronDown, GitMerge, GitPullRequest, MessageSquare, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { UserAvatar } from "@/components/UserAvatar";
import {
  apiErrorMessage,
  type PullReview,
  type ReviewEvent,
  type Collaborator,
} from "@/lib/restapi";
import { fetchCollaboratorsSmart } from "@/lib/api";
import { COPILOT_AVATAR, copilotDisplayName, isCopilotLogin } from "@/lib/repo/copilot";
import { REVIEW_STATE_BADGE_TINTED } from "@/lib/ui/state-colors";
import { toastSuccess } from "@/lib/ui/toast";
import type { PullReviewSummary } from "@/lib/api";

// ReviewChangesDialog 内动态 import @/lib/api（submitPullReviewSmart），避免首屏循环依赖

/* ── Copilot 账号统一（官方 avatar in/946600 + 名称 Copilot + AI 徽标 + review effort 下拉） ── */

/** Copilot review effort（介入程度：Lite 轻微 / Balanced 适中 / Max 全面；官方 2026-08 实测）
 * 注意：官方该设置为内部机制（GraphQL/REST 均无公开用户级端点），
 * 本项目以 localStorage 持久化 UX 复刻（切换仅存本地偏好，无真实 API 副作用）。 */
const COPILOT_EFFORTS = [
  { value: "Lite", desc: "高效评审，低成本" },
  { value: "Balanced", desc: "深度分析，中等成本" },
  { value: "Max", desc: "最彻底，高成本 · 即将推出", comingSoon: true },
] as const;
type CopilotEffort = (typeof COPILOT_EFFORTS)[number]["value"];
const EFFORT_KEY = "puregit_copilot_review_effort";
function getCopilotEffort(): CopilotEffort {
  const v = localStorage.getItem(EFFORT_KEY);
  return v === "Lite" || v === "Balanced" || v === "Max" ? v : "Lite";
}
function setCopilotEffort(e: CopilotEffort) {
  localStorage.setItem(EFFORT_KEY, e);
}

/** Copilot effort 下拉（官方 copilot-review-effort-menu 复刻：当前值 + Lite/Balanced/Max）
 * 触发器 = Copilot 项旁的 AI badge 位置（用户指定），当前值显示在 badge 内。 */
function CopilotEffortMenu() {
  const [effort, setEffort] = useState<CopilotEffort>(getCopilotEffort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
        >
          {effort}
          <ChevronDown className="size-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">Copilot 评审介入程度</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {COPILOT_EFFORTS.map((e) => (
          <DropdownMenuItem
            key={e.value}
            className="flex items-start gap-2"
            disabled={("comingSoon" in e && e.comingSoon) || undefined}
            onSelect={() => {
              setCopilotEffort(e.value);
              setEffort(e.value);
            }}
          >
            <span className="flex flex-col">
              <span className="flex items-center gap-1 font-medium">
                {e.value}
                {effort === e.value && <Check className="size-3.5" />}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{e.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 侧栏审计者条目（泛化：任意 login/avatar；Copilot 特判——归一头像 + effort 下拉） */
function ReviewerItem({
  login,
  avatarUrl,
  state,
}: {
  login: string;
  avatarUrl?: string | null;
  state?: string;
}) {
  return (
    <>
      <UserAvatar src={avatarOf(login, avatarUrl)} alt={login} />
      <span className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        <span className="truncate">{copilotDisplayName(login)}</span>
        {isCopilotLogin(login) && <CopilotEffortMenu />}
      </span>
      {state && <ReviewStateBadge state={state} iconOnly />}
    </>
  );
}

/** 头像统一入口：Copilot 归一（官方 in/946600，与参与者同源） */
function avatarOf(login: string, avatarUrl?: string | null) {
  return isCopilotLogin(login) ? COPILOT_AVATAR : (avatarUrl ?? undefined);
}

/* ── 评审状态徽标 ── */

const REVIEW_STATE_META: Record<string, { label: string; className: string }> = {
  APPROVED: {
    label: "已批准",
    className: REVIEW_STATE_BADGE_TINTED.APPROVED,
  },
  CHANGES_REQUESTED: {
    label: "请求修改",
    className: REVIEW_STATE_BADGE_TINTED.CHANGES_REQUESTED,
  },
  COMMENTED: {
    label: "已评论",
    className: REVIEW_STATE_BADGE_TINTED.COMMENTED,
  },
  DISMISSED: {
    label: "已驳回",
    className: REVIEW_STATE_BADGE_TINTED.DISMISSED,
  },
  PENDING: {
    label: "待提交",
    className: REVIEW_STATE_BADGE_TINTED.PENDING,
  },
};

export function ReviewStateBadge({
  state,
  iconOnly = false,
}: {
  state: string;
  /** 仅图标模式（审计者栏紧凑显示——官方审计者状态只有图标色点，无文字/胶囊背景） */
  iconOnly?: boolean;
}) {
  const meta = REVIEW_STATE_META[state];
  if (!meta) return null;
  const Icon = state === "APPROVED" ? Check : state === "CHANGES_REQUESTED" ? X : MessageSquare;
  if (iconOnly) {
    // 审计者栏状态胶囊：shadcn Badge（圆形 tinted 底 + 状态色 icon，官方 GitHub 审计者状态胶囊同款）
    // ——不用裸 svg（无组件化/无配色规范）；Check/X 保持 outline 描边，COMMENTED 填色
    return (
      <Badge
        variant="outline"
        aria-label={meta.label}
        title={meta.label}
        className={`size-5 shrink-0 items-center justify-center rounded-full border-transparent p-0 ${meta.className}`}
      >
        <Icon className="size-3" fill={state === "COMMENTED" ? "currentColor" : undefined} />
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`gap-1 border-transparent text-[11px] ${meta.className}`}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

/* ── 审计者栏（官方 Reviewers metadata 第一位；+邀请审计 弹窗多选） ── */

export function ReviewersSidebar({
  owner,
  repo,
  authorLogin,
  summary,
  loading,
  onRequestReviewers,
}: {
  owner: string;
  repo: string;
  /** PR 作者 login（弹窗中过滤——官方不可请求作者本人审计） */
  authorLogin?: string;
  summary: PullReviewSummary | null;
  loading: boolean;
  onRequestReviewers?: (logins: string[]) => Promise<void>;
}) {
  const { token } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (loading) {
    return (
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">审计者</h3>
        <Skeleton className="h-8 w-full" />
      </section>
    );
  }

  // 已请求（等待评审）→ 按 login 聚合；已评审 → 状态徽标
  const requests = summary?.reviewRequests ?? [];
  const reviews = summary?.reviews ?? [];
  const requestedLogins = new Set(requests.map((r) => r.login));
  // 已评审用户（可能在请求列表中重复出现——优先展示状态）
  const reviewLogins = new Set(reviews.map((r) => r.user?.login ?? ""));
  // 聚合列表过滤作者本人（官方 Reviewers 栏语义：作者不能是评审者——与邀请弹窗一致；
  // 作者提交的 COMMENT 态 review（self-review）会出现在 Conversation 时间线但不在审计者栏）
  const everyone = Array.from(
    new Map(
      [
        ...requests.map((r) => [r.login, { login: r.login, avatarUrl: r.avatarUrl }] as const),
        ...reviews.map(
          (r) =>
            [
              r.user?.login ?? "",
              { login: r.user?.login ?? "", avatarUrl: r.user?.avatar_url },
            ] as const,
        ),
      ].filter(([login]) => login && login !== authorLogin),
    ).values(),
  );

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">审计者</h3>
      {everyone.length === 0 ? (
        <p className="text-muted-foreground">暂无审计者</p>
      ) : (
        <ul className="space-y-1.5">
          {everyone.map((u) => {
            const review = reviews.find((r) => r.user?.login === u.login);
            return (
              <li key={u.login} className="flex items-center gap-2">
                <ReviewerItem login={u.login} avatarUrl={u.avatarUrl} state={review?.state} />
                {!review && requestedLogins.has(u.login) && (
                  <span className="text-xs text-muted-foreground">等待评审</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {token && onRequestReviewers && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-7 px-2 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="size-3.5" />
          邀请审计
        </Button>
      )}
      {/* 邀请审计弹窗（协作者 + Copilot；已请求/已评审不可重复添加；过滤作者本人） */}
      <RequestAuditorsDialog
        owner={owner}
        repo={repo}
        authorLogin={authorLogin}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        requested={requestedLogins}
        reviewed={reviewLogins}
        onRequestReviewers={onRequestReviewers}
      />
    </section>
  );
}

/* ── 邀请审计弹窗（协作者多选 + Copilot 固定项；官方 Request reviewers 弹窗复刻） ── */

function RequestAuditorsDialog({
  owner,
  repo,
  authorLogin,
  open,
  onOpenChange,
  requested,
  reviewed,
  onRequestReviewers,
}: {
  owner: string;
  repo: string;
  authorLogin?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 已请求审计（不可再选） */
  requested: Set<string>;
  /** 已提交评审（不可再选） */
  reviewed: Set<string>;
  onRequestReviewers?: (logins: string[]) => Promise<void>;
}) {
  const { token } = useAuth();
  const [candidates, setCandidates] = useState<Collaborator[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时懒加载协作者（Copilot 固定项恒在）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates(null);
    setSelected(new Set());
    setError(null);
    if (!token) return;
    void fetchCollaboratorsSmart(owner, repo, token)
      .then((list) => {
        if (!cancelled) {
          // 协作者 + 已请求但不在协作者列表的占位（如 Copilot bot）——不可重复添加可见
          const merged = Array.from(
            new Map([
              ...list.map((c) => [c.login, c] as const),
              ...Array.from(requested)
                .filter((l) => !list.some((c) => c.login === l))
                .map((l) => [l, { login: l, avatar_url: "" }] as const),
            ]).values(),
          );
          setCandidates(merged);
        }
      })
      .catch(() => !cancelled && setCandidates([]));
    return () => {
      cancelled = true;
    };
  }, [open, owner, repo, token, requested, reviewed]);

  const toggle = (login: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(login)) next.delete(login);
      else next.add(login);
      return next;
    });
  };

  const invite = async () => {
    if (!onRequestReviewers || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRequestReviewers(Array.from(selected));
      onOpenChange(false);
    } catch (e) {
      setError(apiErrorMessage(e, "邀请审计失败"));
    } finally {
      setBusy(false);
    }
  };

  // 已请求/已评审判断（Copilot 归一：REST 返回 copilot-pull-request-reviewer[bot]）
  const copilotTaken =
    Array.from(requested).some(isCopilotLogin) || Array.from(reviewed).some(isCopilotLogin);
  const isTaken = (login: string) => requested.has(login) || reviewed.has(login);
  const list = (candidates ?? []).filter((c) => c.login !== authorLogin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>邀请审计</DialogTitle>
          <DialogDescription>
            选择对此项目库有权限的用户（协作者与 Copilot），已请求的不可重复添加
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {candidates === null ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              {/* Copilot 固定项（可请求；已请求/已评审时置灰） */}
              <AuditorRow
                login="Copilot"
                avatarUrl={COPILOT_AVATAR}
                disabled={copilotTaken}
                selected={selected.has("Copilot")}
                onToggle={() => toggle("Copilot")}
              />
              {/* 协作者：已请求/已评审置灰（不可重复添加），其余可勾选 */}
              {list.map((c) => (
                <AuditorRow
                  key={c.login}
                  login={c.login}
                  avatarUrl={c.avatar_url}
                  disabled={isTaken(c.login)}
                  selected={selected.has(c.login)}
                  onToggle={() => toggle(c.login)}
                />
              ))}
              {list.length === 0 && !copilotTaken && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  无其他可邀请的审计者
                </p>
              )}
            </>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={invite} disabled={busy || selected.size === 0}>
            {busy ? "邀请中…" : `邀请 ${selected.size} 人`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 弹窗行（头像 + 名称 + 已请求状态 + checkbox；label 包裹避免 button 嵌套 hydration 错误） */
function AuditorRow({
  login,
  avatarUrl,
  disabled,
  selected,
  onToggle,
}: {
  login: string;
  avatarUrl: string;
  disabled: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <UserAvatar src={avatarUrl} alt={login} className="size-6" />
      <span className="min-w-0 flex-1 truncate">{copilotDisplayName(login)}</span>
      {disabled && <span className="text-xs text-muted-foreground">已请求</span>}
      <Checkbox
        checked={selected}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="size-4"
      />
    </label>
  );
}

/* ── Review changes 三态弹窗 ── */

export function ReviewChangesDialog({
  owner,
  repo,
  number,
  onReviewed,
}: {
  owner: string;
  repo: string;
  number: number;
  onReviewed?: (review: PullReview) => void;
}) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 动态 import 避免页面首屏负担（评审弹窗低频）
  const [submit, setSubmit] = useState<
    | ((
        owner: string,
        repo: string,
        number: number,
        event: ReviewEvent,
        body: string,
        token: string,
      ) => Promise<PullReview>)
    | null
  >(null);

  const openDialog = () => {
    if (!submit) {
      void import("@/lib/api").then((m) => {
        setSubmit(() => m.submitPullReviewSmart);
        setOpen(true);
      });
      return;
    }
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!token || !submit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submit(owner, repo, number, event, body.trim(), token);
      toastSuccess("评审已提交");
      onReviewed?.(r);
      setOpen(false);
      setBody("");
      setEvent("COMMENT");
    } catch (e) {
      setError(apiErrorMessage(e, "提交评审失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // 关闭时重置表单状态（重开为默认 COMMENT 空留言）
        if (!v) {
          setEvent("COMMENT");
          setBody("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={openDialog}>
          <MessageSquare className="size-3.5" />
          评审
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>提交评审</DialogTitle>
          <DialogDescription>选择评审结论并填写留言（可选）</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                { value: "COMMENT", label: "评论", icon: <MessageSquare className="size-3.5" /> },
                { value: "APPROVE", label: "批准", icon: <Check className="size-3.5" /> },
                { value: "REQUEST_CHANGES", label: "请求修改", icon: <X className="size-3.5" /> },
              ] as const
            ).map((o) => (
              <Button
                key={o.value}
                type="button"
                variant={event === o.value ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => setEvent(o.value)}
              >
                {o.icon}
                {o.label}
              </Button>
            ))}
          </div>
          <MarkdownEditor defaultValue={body} onChange={setBody} placeholder="评审留言（可选）…" />
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !token}>
            {busy ? "提交中…" : "提交评审"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Merge 合并区（open PR + 可写权限时显示） ── */

export function MergePanel({
  owner,
  repo,
  number,
  pullRequestId,
  mergeable,
  onMerged,
}: {
  owner: string;
  repo: string;
  number: number;
  pullRequestId?: string;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  onMerged?: () => void;
}) {
  const { token, canWrite } = useAuth();
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doMerge, setDoMerge] = useState<
    | ((
        owner: string,
        repo: string,
        number: number,
        method: "merge" | "squash" | "rebase",
        token: string,
        id?: string,
      ) => Promise<{ merged: boolean; message: string }>)
    | null
  >(null);

  if (!token || !canWrite) return null;

  const openMerge = () => {
    if (!doMerge) {
      void import("@/lib/api").then((m) => {
        setDoMerge(() => m.mergePullRequestSmart);
        setOpen(true);
      });
      return;
    }
    setOpen(true);
  };

  const handleMerge = async () => {
    if (!token || !doMerge) return;
    setBusy(true);
    setError(null);
    try {
      const r = await doMerge(owner, repo, number, method, token, pullRequestId);
      if (r.merged) {
        toastSuccess("已合并");
        onMerged?.();
        setOpen(false);
      } else {
        setError(r.message || "合并失败");
      }
    } catch (e) {
      setError(apiErrorMessage(e, "合并失败"));
    } finally {
      setBusy(false);
    }
  };

  const conflict = mergeable === "CONFLICTING";

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-emerald-500" />
          <span className="text-sm font-medium">
            {conflict ? "存在冲突，无法合并" : "合并 Pull Request"}
          </span>
        </div>
        {mergeable !== "CONFLICTING" && (
          <div className="flex gap-2">
            <div className="flex gap-1.5">
              {(
                [
                  { value: "merge", label: "Merge" },
                  { value: "squash", label: "Squash" },
                  { value: "rebase", label: "Rebase" },
                ] as const
              ).map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  variant={method === m.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMethod(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" onClick={openMerge} disabled={busy}>
                  <GitMerge className="size-3.5" />
                  {busy ? "合并中…" : "合并"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认合并</AlertDialogTitle>
                  <AlertDialogDescription>
                    将 PR #{number} 以 {method} 方式合并到 {""}目标分支。
                    {error && <span className="mt-2 block text-red-500">{error}</span>}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleMerge} disabled={busy}>
                    {busy ? "合并中…" : "确认合并"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
