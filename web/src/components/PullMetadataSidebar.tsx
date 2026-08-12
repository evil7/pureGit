/**
 * PR 详情右侧 metadata 增强侧栏（B1 补：官方 9 项侧栏对齐）
 *
 * 官方 PR 详情侧栏（github.com 实测）：Reviewers / Assignees / Labels / Projects /
 * Milestone / Development / Notifications / {n} participants / Lock conversation。
 * 本组件承接 Reviewers 之外的全部项：
 *   - Assignees / Labels / Milestone：只读展示 + shadcn Dialog 编辑弹窗（写走 REST）
 *   - Projects：ProjectsV2 关联只读展示（GraphQL-only）
 *   - Development：closingIssuesReferences + linkedBranches 只读展示（GraphQL-only）
 *   - participants：官方「{n} participants」计数 + AvatarStack（最多 5 个头像，超出 +n）
 *   - 底部操作组（用户指定）：分割线 + 无框按钮「取消订阅 / 锁定会话」（不单独设通知/锁定板块）
 * 数据源 smart 双通道，详见 api-compat.md §2.1。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  BellRing,
  Check,
  GitPullRequest,
  Lock,
  LockOpen,
  Milestone as MilestoneIcon,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useIsDark } from "@/hooks/useIsDark";
import { useI18n } from "@/i18n";
import { UserAvatar } from "@/components/UserAvatar";
import {
  fetchRepoAssignees,
  fetchRepoLabels,
  fetchRepoMilestones,
  updatePullAssignees,
  updatePullLabels,
  updatePullMilestone,
  apiErrorMessage,
  type GitHubUser,
  type RepoLabel,
  type RepoMilestone,
} from "@/lib/rest";
import {
  setPullLockedSmart,
  fetchPullProjectsSmart,
  fetchPullDevelopmentSmart,
  type PullProjectItem,
  type PullDevelopment,
} from "@/lib/api";
import { getLabelStyle } from "@/lib/label-color";
import { toastSuccess, toastError } from "@/lib/toast";

/* ── 编辑弹窗基础外壳（统一三态：加载/空/列表） ── */

function EditorDialog({
  open,
  onOpenChange,
  trigger,
  title,
  desc,
  children,
  onSave,
  busy,
  error,
  saveLabel = "保存",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
  onSave: () => void;
  busy?: boolean;
  error?: string | null;
  saveLabel?: string;
}) {
  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {desc && <DialogDescription>{desc}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">{children}</div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={onSave} disabled={busy}>
              {busy ? "保存中…" : saveLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 侧栏「编辑」小触发按钮（官方 metadata 项的 ghost 编辑入口） */
function EditTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mt-1.5 h-7 px-2 text-xs" onClick={onClick}>
      <Plus className="size-3.5" />
      {label}
    </Button>
  );
}

/* ── Assignees 编辑 ── */

function AssigneesEditor({
  owner,
  repo,
  number,
  current,
  onChange,
}: {
  owner: string;
  repo: string;
  number: number;
  current: GitHubUser[];
  onChange: (users: GitHubUser[]) => void;
}) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<GitHubUser[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setOpen(true);
    setError(null);
    setSelected(current.map((u) => u.login));
    if (candidates) return;
    fetchRepoAssignees(owner, repo, token)
      .then(setCandidates)
      .catch(() => setCandidates([]));
  };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    const cur = current.map((u) => u.login);
    const add = selected.filter((l) => !cur.includes(l));
    const remove = cur.filter((l) => !selected.includes(l));
    try {
      await updatePullAssignees(owner, repo, number, add, remove, token);
      onChange(candidates!.filter((u) => selected.includes(u.login)));
      toastSuccess("已更新指派");
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新指派失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<EditTrigger label="添加指派" onClick={openDialog} />}
      title="指派给"
      desc={`Assign up to 10 people to this pull request（PR #${number}）`}
      onSave={save}
      busy={busy}
      error={error}
      saveLabel="保存指派"
    >
      {candidates === null ? (
        <Skeleton className="h-40 w-full" />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无可用用户</p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {candidates.map((u) => {
            const checked = selected.includes(u.login);
            return (
              <label
                key={u.login}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) =>
                      checked ? prev.filter((l) => l !== u.login) : [...prev, u.login],
                    )
                  }
                />
                <UserAvatar src={u.avatar_url} alt={u.login} className="size-5" />
                <span>{u.login}</span>
              </label>
            );
          })}
        </div>
      )}
    </EditorDialog>
  );
}

/* ── Labels 编辑 ── */

/** 侧栏标签类型（与 pr.labels 一致：name+color，无仓库标签 id） */
type SidebarLabel = { name: string; color: string };

function LabelsEditor({
  owner,
  repo,
  number,
  current,
  onChange,
}: {
  owner: string;
  repo: string;
  number: number;
  current: SidebarLabel[];
  onChange: (labels: SidebarLabel[]) => void;
}) {
  const { token } = useAuth();
  const isDark = useIsDark();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<RepoLabel[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setOpen(true);
    setError(null);
    setSelected(current.map((l) => l.name));
    if (candidates) return;
    fetchRepoLabels(owner, repo, token)
      .then(setCandidates)
      .catch(() => setCandidates([]));
  };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await updatePullLabels(owner, repo, number, selected, token);
      onChange(candidates!.filter((l) => selected.includes(l.name)));
      toastSuccess("已更新标签");
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新标签失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<EditTrigger label="添加标签" onClick={openDialog} />}
      title="标签"
      desc={`Apply labels to this pull request（PR #${number}）`}
      onSave={save}
      busy={busy}
      error={error}
      saveLabel="保存标签"
    >
      {candidates === null ? (
        <Skeleton className="h-40 w-full" />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无标签</p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {candidates.map((l) => {
            const checked = selected.includes(l.name);
            return (
              <label
                key={l.name}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) =>
                      checked ? prev.filter((n) => n !== l.name) : [...prev, l.name],
                    )
                  }
                />
                <Badge
                  variant="outline"
                  className="text-[11px] font-medium"
                  style={getLabelStyle(l.color, isDark)}
                >
                  {l.name}
                </Badge>
              </label>
            );
          })}
        </div>
      )}
    </EditorDialog>
  );
}

/* ── Milestone 编辑 ── */

function MilestoneEditor({
  owner,
  repo,
  number,
  current,
  onChange,
}: {
  owner: string;
  repo: string;
  number: number;
  current: { title: string; number?: number } | null;
  onChange: (m: { title: string; number: number } | null) => void;
}) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [milestones, setMilestones] = useState<RepoMilestone[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setOpen(true);
    setError(null);
    setSelected(current?.number ?? null);
    if (milestones) return;
    fetchRepoMilestones(owner, repo, token)
      .then(setMilestones)
      .catch(() => setMilestones([]));
  };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await updatePullMilestone(owner, repo, number, selected, token);
      const m = milestones?.find((x) => x.number === selected) ?? null;
      onChange(m ? { title: m.title, number: m.number } : null);
      toastSuccess(selected ? "已设置里程碑" : "已清除里程碑");
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新里程碑失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<EditTrigger label="添加里程碑" onClick={openDialog} />}
      title="里程碑"
      desc={`Set milestone for PR #${number}`}
      onSave={save}
      busy={busy}
      error={error}
      saveLabel="保存里程碑"
    >
      <button
        type="button"
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
          selected === null ? "bg-muted/60" : ""
        }`}
        onClick={() => setSelected(null)}
      >
        <MilestoneIcon className="size-3.5 text-muted-foreground" />
        无里程碑
      </button>
      {milestones === null ? (
        <Skeleton className="h-32 w-full" />
      ) : milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无里程碑</p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {milestones.map((m) => (
            <button
              key={m.number}
              type="button"
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                selected === m.number ? "bg-muted/60" : ""
              }`}
              onClick={() => setSelected(m.number)}
            >
              <MilestoneIcon className="size-3.5 text-muted-foreground" />
              <span className="flex-1">{m.title}</span>
              {selected === m.number && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      )}
    </EditorDialog>
  );
}

/* ── 主组件 ── */

export function PullMetadataSidebar({
  owner,
  repo,
  number,
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
  assignees: GitHubUser[];
  labels: SidebarLabel[];
  milestone: { title: string; number?: number } | null;
  locked: boolean;
  pullRequestId?: string;
  participants: GitHubUser[];
  /** 订阅状态与切换（底部「取消订阅/订阅」无框按钮） */
  subscribed: boolean;
  subscribing: boolean;
  onToggleSubscribe: () => void;
  onAssigneesChange: (users: GitHubUser[]) => void;
  onLabelsChange: (labels: SidebarLabel[]) => void;
  onMilestoneChange: (m: { title: string; number: number } | null) => void;
  onLockedChange: (locked: boolean) => void;
}) {
  const { token } = useAuth();
  const isDark = useIsDark();
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
      {/* Assignees */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">指派给</h3>
        {assignees.length > 0 ? (
          <ul className="space-y-1.5">
            {assignees.map((a) => (
              <li key={a.login} className="flex items-center gap-2">
                <UserAvatar src={a.avatar_url} alt={a.login} />
                <Link to={`/${a.login}`} className="text-sm text-foreground hover:underline">
                  {a.login}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">未指派</p>
        )}
        {token && (
          <AssigneesEditor
            owner={owner}
            repo={repo}
            number={number}
            current={assignees}
            onChange={onAssigneesChange}
          />
        )}
      </section>

      {/* Labels */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">标签</h3>
        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <Badge
                key={l.name}
                className="text-[11px] font-medium"
                style={getLabelStyle(l.color, isDark)}
              >
                {l.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">无标签</p>
        )}
        {token && (
          <LabelsEditor
            owner={owner}
            repo={repo}
            number={number}
            current={labels}
            onChange={onLabelsChange}
          />
        )}
      </section>

      {/* Projects（GraphQL-only 只读） */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">项目</h3>
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
      </section>

      {/* Milestone */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">里程碑</h3>
        {milestone ? (
          <span className="flex items-center gap-1.5">
            <MilestoneIcon className="size-3.5 text-muted-foreground" />
            {milestone.title}
          </span>
        ) : (
          <p className="text-muted-foreground">无里程碑</p>
        )}
        {token && (
          <MilestoneEditor
            owner={owner}
            repo={repo}
            number={number}
            current={milestone}
            onChange={onMilestoneChange}
          />
        )}
      </section>

      {/* Development（GraphQL-only 只读） */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">开发</h3>
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
      </section>

      {/* Participants：官方「{n} participants」计数 + AvatarStack（最多 5 个头像，超出 +n） */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
          {t("pullDetail.participants").replace("{n}", String(participants.length))}
        </h3>
        {participants.length > 0 && (
          <div className="flex items-center">
            <div className="flex -space-x-2">
              {participants.slice(0, 5).map((u) => (
                <UserAvatar
                  key={u.login}
                  src={u.avatar_url}
                  alt={u.login}
                  title={u.login}
                  className="size-6 ring-2 ring-background"
                />
              ))}
            </div>
            {participants.length > 5 && (
              <span className="ml-2 text-xs text-muted-foreground">+{participants.length - 5}</span>
            )}
          </div>
        )}
      </section>

      {/* 底部操作组：分割线 + 无框按钮（取消订阅 / 锁定会话；用户指定：不单独设通知/锁定板块） */}
      {token && (
        <div className="space-y-1 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
            onClick={onToggleSubscribe}
            disabled={subscribing}
          >
            {subscribed ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
            {subscribing ? "…" : subscribed ? "取消订阅" : "订阅"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
            onClick={toggleLock}
            disabled={lockBusy}
          >
            {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
            {locked ? "解锁会话" : "锁定会话"}
          </Button>
        </div>
      )}
    </aside>
  );
}
