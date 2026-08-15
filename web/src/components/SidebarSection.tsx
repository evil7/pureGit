/**
 * 详情侧栏分区原语（issue / PR 详情右栏共享）
 *
 * 统一 issue / PR 详情右侧 metadata 的分区标题样式——对齐仓库 About 侧栏（RepoAbout）：
 * 标题 `text-sm font-semibold`（前景色，非 muted），内容 `text-muted-foreground`，间距 `mb-2`，
 * 避免标题与内容同色导致视觉混淆。同时提供底部订阅切换按钮（ghost 无框、弱强调）。
 * 供 PullMetadataSidebar / IssueDetailPage / MetadataEditors / ParticipantsSection 共用。
 */
import type { ReactNode } from "react";
import { Bell, BellRing, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

/** 分区标题 + 可选右侧操作（齿轮图标等）；供已有 <section> 外壳的调用方嵌入 */
export function SidebarHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
      <span>{title}</span>
      {action}
    </h3>
  );
}

/**
 * 侧栏标题右侧齿轮编辑按钮（统一样式：Assignees/Labels/Milestone/审计者共用）。
 * 官方侧栏交互：可编辑板块的标题行内一枚齿轮图标，点击展开编辑/邀请弹窗；
 * 不再在板块内容下方放置独立「添加」按钮。
 */
export function EditActionButton({
  label,
  onClick,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  /** 自定义 aria-label（默认「编辑{label}」；审计者栏语义为邀请，可覆盖为「邀请审计」） */
  ariaLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? t("sidebar.editLabel", { label })}
      className="-mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Settings className="size-3.5" />
    </button>
  );
}

/** 完整分区（<section> + 标题 + 内容） */
export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <SidebarHeading title={title} action={action} />
      {children}
    </section>
  );
}

/** 订阅/取消订阅切换按钮（底部操作组；ghost 无框弱强调，与官方次要操作一致） */
export function SubscribeButton({
  subscribed,
  busy,
  onToggle,
  subscribeLabel,
  unsubscribeLabel,
}: {
  subscribed: boolean;
  busy: boolean;
  onToggle: () => void;
  subscribeLabel: string;
  unsubscribeLabel: string;
}) {
  return (
    <Button
      variant="ghost"
      className="w-full justify-start px-2 text-muted-foreground"
      onClick={onToggle}
      disabled={busy}
    >
      {subscribed ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
      {busy ? "…" : subscribed ? unsubscribeLabel : subscribeLabel}
    </Button>
  );
}
