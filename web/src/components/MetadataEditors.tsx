/**
 * issue / PR 详情右侧 metadata 编辑组件（共享）
 *
 * 官方侧栏交互：每个可编辑板块（Assignees / Labels / Milestone）标题行内一枚
 * 「齿轮」图标按钮（官方 octicon-gear），点击展开编辑弹窗；不再在板块内容下方
 * 放置独立「添加」按钮。本文件承接 PR 详情侧栏（PullMetadataSidebar）与 issue
 * 详情侧栏（IssuesPages）的共用编辑逻辑，消除两处重复：
 *   - SectionHeading：标题文字 + 右侧齿轮图标（canWrite 才显示）
 *   - AssigneesEditor / LabelsEditor / MilestoneEditor：完整 section（标题+内容+编辑 Dialog）
 * 写操作走 REST（issues.* 端点，issue/PR 通用），数据源 smart 双通道，见 api-compat.md §2.1。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Milestone as MilestoneIcon, Settings } from "lucide-react";
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
import { UserAvatar } from "@/components/UserAvatar";
import {
  updatePullAssignees,
  updatePullLabels,
  updatePullMilestone,
  apiErrorMessage,
  type RepoLabel,
  type RepoMilestone,
} from "@/lib/rest";
import { fetchRepoLabelsSmart, fetchRepoAssigneesSmart, fetchRepoMilestonesSmart } from "@/lib/api";
import { getLabelStyle } from "@/lib/label-color";
import { toastSuccess } from "@/lib/toast";

/** 侧栏标签类型（name+color，与 pr.labels / issue.labels 一致） */
export type SidebarLabel = { name: string; color: string };

/** 侧栏指派类型（login + 可选头像，与 issue.assignees 一致；GitHubUser 结构兼容） */
export type SidebarAssignee = { login: string; avatar_url?: string };

/** 侧栏里程碑类型（title + 可选 number，与 issue.milestone / pr.milestone 一致） */
export type SidebarMilestone = { title: string; number?: number };

/* ── 标题 + 右侧齿轮图标 ── */

function SectionHeading({ title, onEdit }: { title: string; onEdit?: () => void }) {
  return (
    <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted-foreground">
      <span>{title}</span>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`编辑${title}`}
          className="-mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-3.5" />
        </button>
      )}
    </h3>
  );
}

/* ── 编辑弹窗基础外壳（统一三态：加载/空/列表） ── */

function EditorDialog({
  open,
  onOpenChange,
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
  title: string;
  desc?: string;
  children: React.ReactNode;
  onSave: () => void;
  busy?: boolean;
  error?: string | null;
  saveLabel?: string;
}) {
  return (
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
  );
}

/* ── Assignees 编辑（完整 section：标题齿轮 + 内容 + 弹窗） ── */

export function AssigneesEditor({
  owner,
  repo,
  number,
  current,
  onChange,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  current: SidebarAssignee[];
  onChange: (users: SidebarAssignee[]) => void;
  title: string;
  emptyText: string;
}) {
  const { token, canWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<SidebarAssignee[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setOpen(true);
    setError(null);
    setSelected(current.map((u) => u.login));
    if (candidates) return;
    fetchRepoAssigneesSmart(owner, repo, token)
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
    <section>
      <SectionHeading title={title} onEdit={canWrite ? openDialog : undefined} />
      {current.length > 0 ? (
        <ul className="space-y-1.5">
          {current.map((a) => (
            <li key={a.login} className="flex items-center gap-2">
              <UserAvatar src={a.avatar_url} alt={a.login} />
              <Link to={`/${a.login}`} className="text-sm text-foreground hover:underline">
                {a.login}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{emptyText}</p>
      )}
      <EditorDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        desc={`Assign up to 10 people to this（#${number}）`}
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
    </section>
  );
}

/* ── Labels 编辑（完整 section） ── */

export function LabelsEditor({
  owner,
  repo,
  number,
  current,
  onChange,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  current: SidebarLabel[];
  onChange: (labels: SidebarLabel[]) => void;
  title: string;
  emptyText: string;
}) {
  const { token, canWrite } = useAuth();
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
    fetchRepoLabelsSmart(owner, repo, token)
      .then(setCandidates)
      .catch(() => setCandidates([]));
  };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await updatePullLabels(owner, repo, number, selected, token);
      onChange(
        candidates!
          .filter((l) => selected.includes(l.name))
          .map((l) => ({ name: l.name, color: l.color })),
      );
      toastSuccess("已更新标签");
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新标签失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHeading title={title} onEdit={canWrite ? openDialog : undefined} />
      {current.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {current.map((l) => (
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
        <p className="text-muted-foreground">{emptyText}</p>
      )}
      <EditorDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        desc={`Apply labels to this（#${number}）`}
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
    </section>
  );
}

/* ── Milestone 编辑（完整 section） ── */

export function MilestoneEditor({
  owner,
  repo,
  number,
  current,
  onChange,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  current: SidebarMilestone | null;
  onChange: (m: SidebarMilestone | null) => void;
  title: string;
  emptyText: string;
}) {
  const { token, canWrite } = useAuth();
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
    fetchRepoMilestonesSmart(owner, repo, token)
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
    <section>
      <SectionHeading title={title} onEdit={canWrite ? openDialog : undefined} />
      {current ? (
        <span className="flex items-center gap-1.5">
          <MilestoneIcon className="size-3.5 text-muted-foreground" />
          {current.title}
        </span>
      ) : (
        <p className="text-muted-foreground">{emptyText}</p>
      )}
      <EditorDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        desc={`Set milestone for #${number}`}
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
    </section>
  );
}
