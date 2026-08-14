/**
 * PR 详情右侧 metadata 侧栏（B1 补：官方 9 项侧栏对齐）
 *
 * 官方 PR 详情侧栏（github.com 实测）：Reviewers / Assignees / Labels / Projects /
 * Milestone / Development / Notifications / {n} participants / Lock conversation。
 * 本组件承接全部 9 项（审计者栏 ReviewersSidebar 为首个板块，统一在一个侧栏容器内）：
 *   - Reviewers：审计者栏（ReviewersSidebar，评审状态 + 请求的评审者 + 邀请审计弹窗）
 *   - Assignees / Labels / Milestone：只读展示 + shadcn Dialog 编辑弹窗（写走 REST）
 *   - Projects：ProjectsV2 关联只读展示（GraphQL-only）
 *   - Development：closingIssuesReferences + linkedBranches 只读展示（GraphQL-only）
 *   - participants：官方「{n} participants」计数 + AvatarStack（最多 5 个头像，超出 +n）
 *   - 底部操作组（用户指定）：分割线 + 无框按钮「取消订阅 / 锁定会话」（不单独设通知/锁定板块）
 * 数据源 smart 双通道，详见 api-compat.md §2.1。
 */
import { useEffect, useState } from "react";
import { GitPullRequest, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { apiErrorMessage, type GitHubUser } from "@/lib/restapi";
import {
  setPullLockedSmart,
  fetchPullProjectsSmart,
  fetchPullDevelopmentSmart,
  type PullProjectItem,
  type PullDevelopment,
  type PullReviewSummary,
} from "@/lib/api";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { SidebarSection, SubscribeButton } from "@/components/SidebarSection";
import { ParticipantsSection } from "@/components/ParticipantsSection";
import { ReviewersSidebar } from "@/components/PullReviewPanel";
import {
  AssigneesEditor,
  LabelsEditor,
  MilestoneEditor,
  type SidebarLabel,
  type SidebarAssignee,
  type SidebarMilestone,
} from "@/components/MetadataEditors";

/* ── 主组件 ── */

export function PullMetadataSidebar({
  owner,
  repo,
  number,
  authorLogin,
  reviewSummary,
  reviewSummaryLoading,
  onRequestReviewers,
  assignees,
  labels,
  milestone,
  locked,
  pullRequestId,
  participants,
  subscribed,
  subscribing,
  onToggleSubscribe,
  onAssigneesChange,
  onLabelsChange,
  onMilestoneChange,
  onLockedChange,
}: {
  owner: string;
  repo: string;
  number: number;
  /** PR 作者 login（审计者栏弹窗中过滤——官方不可请求作者本人审计） */
  authorLogin?: string;
  /** 评审摘要（审计者栏数据源） */
  reviewSummary: PullReviewSummary | null;
  reviewSummaryLoading: boolean;
  onRequestReviewers?: (logins: string[]) => Promise<void>;
  assignees: SidebarAssignee[];
  labels: SidebarLabel[];
  milestone: SidebarMilestone | null;
  locked: boolean;
  pullRequestId?: string;
  participants: GitHubUser[];
  /** 订阅状态与切换（底部「取消订阅/订阅」无框按钮） */
  subscribed: boolean;
  subscribing: boolean;
  onToggleSubscribe: () => void;
  onAssigneesChange: (users: SidebarAssignee[]) => void;
  onLabelsChange: (labels: SidebarLabel[]) => void;
  onMilestoneChange: (m: SidebarMilestone | null) => void;
  onLockedChange: (locked: boolean) => void;
}) {
  const { token, user, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const { t } = useI18n();
  // Projects / Development（GraphQL-only 只读，登录加载；失败静默空）
  const [projects, setProjects] = useState<PullProjectItem[] | null>(null);
  const [development, setDevelopment] = useState<PullDevelopment | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchPullProjectsSmart(owner, repo, number, token).then((ps) => {
      if (!cancelled) setProjects(ps);
    });
    fetchPullDevelopmentSmart(owner, repo, number, token).then((d) => {
      if (!cancelled) setDevelopment(d);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number, token]);

  // 锁定/解锁（smart 双通道；底部无框按钮触发）
  const toggleLock = async () => {
    if (!token) return;
    setLockBusy(true);
    try {
      await setPullLockedSmart(owner, repo, number, !locked, token, pullRequestId);
      onLockedChange(!locked);
      toastSuccess(locked ? "已解锁对话" : "已锁定对话");
    } catch (e) {
      toastError(apiErrorMessage(e, "锁定操作失败"));
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <aside className="space-y-5 text-sm">
      {/* 审计者（官方 Reviewers metadata 第一位；+邀请审计 弹窗） */}
      <ReviewersSidebar
        owner={owner}
        repo={repo}
        authorLogin={authorLogin}
        summary={reviewSummary}
        loading={reviewSummaryLoading}
        onRequestReviewers={onRequestReviewers}
      />

      {/* Assignees */}
      <AssigneesEditor
        owner={owner}
        repo={repo}
        number={number}
        current={assignees}
        onChange={onAssigneesChange}
        title="指派给"
        emptyText="未指派"
      />

      {/* Labels */}
      <LabelsEditor
        owner={owner}
        repo={repo}
        number={number}
        current={labels}
        onChange={onLabelsChange}
        title="标签"
        emptyText="无标签"
      />

      {/* Projects（GraphQL-only 只读） */}
      <SidebarSection title="项目">
        {projects === null ? (
          <p className="text-muted-foreground">—</p>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground">暂无项目</p>
        ) : (
          <ul className="space-y-1.5">
            {projects.map((p) => (
              <li key={p.id} className="text-sm">
                <a
                  href={p.project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground hover:underline"
                >
                  {p.project.title}
                </a>
                {p.status && (
                  <span className="ml-1.5 text-xs text-muted-foreground">· {p.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      {/* Milestone */}
      <MilestoneEditor
        owner={owner}
        repo={repo}
        number={number}
        current={milestone}
        onChange={onMilestoneChange}
        title="里程碑"
        emptyText="无里程碑"
      />

      {/* Development（GraphQL-only 只读） */}
      <SidebarSection title="开发">
        {development === null ? (
          <p className="text-muted-foreground">—</p>
        ) : development.issues.length === 0 && development.branches.length === 0 ? (
          <p className="text-muted-foreground">暂无关联</p>
        ) : (
          <ul className="space-y-1.5">
            {development.issues.map((i) => (
              <li key={i.number} className="text-sm">
                <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">
                  #{i.number} {i.title}
                </a>
              </li>
            ))}
            {development.branches.map((b) => (
              <li key={b} className="flex items-center gap-1.5 text-sm">
                <GitPullRequest className="size-3.5 text-muted-foreground" />
                <code className="font-mono text-xs">{b}</code>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      {/* Participants：官方「{n} participants」计数 + 重叠头像栈（超出 +n） */}
      <ParticipantsSection
        title={t("pullDetail.participants").replace("{n}", String(participants.length))}
        participants={participants}
      />

      {/* 底部操作组：分割线 + 无框按钮（订阅 / 锁定会话；用户指定：不单独设通知/锁定板块） */}
      {token && (
        <div className="space-y-1 border-t pt-3">
          <SubscribeButton
            subscribed={subscribed}
            busy={subscribing}
            onToggle={onToggleSubscribe}
            subscribeLabel="订阅"
            unsubscribeLabel="取消订阅"
          />
          {/* 锁定会话：仅仓库协作权限（TRIAGE+）或 PR 作者可见（令牌写 scope + 仓库权限双门槛） */}
          {canWrite && (canCollaborate || user?.login === authorLogin) && (
            <Button
              variant="ghost"
              className="w-full justify-start px-2 text-muted-foreground"
              onClick={toggleLock}
              disabled={lockBusy}
            >
              {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
              {locked ? "解锁会话" : "锁定会话"}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
