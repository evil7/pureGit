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
 * 数据源 smart 双通道。
 */
import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { apiErrorMessage, type GitHubUser } from "@/lib/restapi";
import { setPullLockedSmart, type PullReviewSummary } from "@/lib/api";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { SubscribeButton } from "@/components/SidebarSection";
import { ParticipantsSection } from "@/components/ParticipantsSection";
import { ReviewersSidebar } from "@/components/PullReviewPanel";
import {
  AssigneesEditor,
  LabelsEditor,
  MilestoneEditor,
  ProjectsEditor,
  DevelopmentSection,
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
  prBody,
  participants,
  subscribed,
  subscribing,
  onToggleSubscribe,
  onAssigneesChange,
  onLabelsChange,
  onMilestoneChange,
  onLockedChange,
  onPrBodyChange,
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
  /** PR 描述（Development 手动关联 issue 时追加 closing keywords 用） */
  prBody?: string;
  participants: GitHubUser[];
  /** 订阅状态与切换（底部「取消订阅/订阅」无框按钮） */
  subscribed: boolean;
  subscribing: boolean;
  onToggleSubscribe: () => void;
  onAssigneesChange: (users: SidebarAssignee[]) => void;
  onLabelsChange: (labels: SidebarLabel[]) => void;
  onMilestoneChange: (m: SidebarMilestone | null) => void;
  onLockedChange: (locked: boolean) => void;
  onPrBodyChange?: (body: string) => void;
}) {
  const { token, user, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const { t } = useI18n();
  const [lockBusy, setLockBusy] = useState(false);

  // 锁定/解锁（smart 双通道；底部无框按钮触发）
  const toggleLock = async () => {
    if (!token) return;
    setLockBusy(true);
    try {
      await setPullLockedSmart(owner, repo, number, !locked, token, pullRequestId);
      onLockedChange(!locked);
      toastSuccess(locked ? t("pullDetail.unlocked") : t("pullDetail.locked"));
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
        title={t("issueDetail.assignees")}
        emptyText={t("issueDetail.noAssignees")}
      />

      {/* Labels */}
      <LabelsEditor
        owner={owner}
        repo={repo}
        number={number}
        current={labels}
        onChange={onLabelsChange}
        title={t("issueDetail.labels")}
        emptyText={t("issueDetail.noLabels")}
      />

      {/* Projects（GraphQL-only；齿轮添加/移除） */}
      <ProjectsEditor
        owner={owner}
        repo={repo}
        number={number}
        kind="pr"
        title={t("pullDetail.projects")}
        emptyText={t("pullDetail.noProjects")}
      />

      {/* Milestone */}
      <MilestoneEditor
        owner={owner}
        repo={repo}
        number={number}
        current={milestone}
        onChange={onMilestoneChange}
        title={t("issueDetail.milestone")}
        emptyText={t("issueDetail.noMilestone")}
      />

      {/* Development（GraphQL-only；PR 侧栏可手动关联 issue） */}
      <DevelopmentSection
        owner={owner}
        repo={repo}
        number={number}
        kind="pr"
        title={t("pullDetail.development")}
        emptyText={t("pullDetail.noDevelopment")}
        prBody={prBody}
        pullRequestId={pullRequestId}
        onPrBodyChange={onPrBodyChange}
      />

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
            subscribeLabel={t("issueDetail.subscribe")}
            unsubscribeLabel={t("issueDetail.unsubscribe")}
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
              {locked ? t("pullDetail.unlockConversation") : t("pullDetail.lockConversation")}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
