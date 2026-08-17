/**
 * issue / PR 详情右侧 metadata 编辑组件（共享）
 *
 * 官方侧栏交互：每个可编辑板块（Assignees / Labels / Milestone）标题行内一枚
 * 「齿轮」图标按钮（官方 octicon-gear），点击展开编辑弹窗；不再在板块内容下方
 * 放置独立「添加」按钮。本文件承接 PR 详情侧栏（PullMetadataSidebar）与 issue
 * 详情侧栏（IssuesPages）的共用编辑逻辑，消除两处重复：
 *   - SectionHeading：标题文字 + 右侧齿轮图标（canWrite 才显示）
 *   - AssigneesEditor / LabelsEditor / MilestoneEditor：完整 section（标题+内容+编辑 Dialog）
 * 写操作走 REST（issues.* 端点，issue/PR 通用），数据源 smart 双通道。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import {
  Check,
  Columns3,
  GitPullRequest,
  ListTree,
  Link2,
  Milestone as MilestoneIcon,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useIsDark } from "@/hooks/useIsDark";
import { UserAvatar } from "@/components/UserAvatar";
import { SidebarHeading, EditActionButton } from "@/components/SidebarSection";
import {
  updatePullAssignees,
  updatePullLabels,
  updatePullMilestone,
  fetchIssueDetail,
  apiErrorMessage,
  type RepoLabel,
  type RepoMilestone,
  type Issue,
} from "@/lib/restapi";
import {
  fetchRepoLabelsSmart,
  fetchRepoAssigneesSmart,
  fetchRepoMilestonesSmart,
  fetchRepoProjectsV2Smart,
  fetchIssueProjectsSmart,
  fetchPullProjectsSmart,
  addProjectV2ItemByIdSmart,
  deleteProjectV2ItemSmart,
  resolveIssuePrNodeId,
  fetchIssueDevelopmentSmart,
  fetchPullDevelopmentSmart,
  updatePullRequestBodySmart,
  fetchSubIssuesSmart,
  fetchParentIssueSmart,
  addSubIssueSmart,
  removeSubIssueSmart,
  fetchBlockedByDependenciesSmart,
  addBlockedByDependencySmart,
  removeBlockedByDependencySmart,
  type PullProjectItem,
  type RepoProjectV2,
} from "@/lib/api";
import { getLabelStyle } from "@/lib/ui/label-color";
import { toastSuccess } from "@/lib/ui/toast";

/** 侧栏标签类型（name+color，与 pr.labels / issue.labels 一致） */
export type SidebarLabel = { name: string; color: string };

/** 侧栏指派类型（login + 可选头像，与 issue.assignees 一致；GitHubUser 结构兼容） */
export type SidebarAssignee = { login: string; avatar_url?: string };

/** 侧栏里程碑类型（title + 可选 number，与 issue.milestone / pr.milestone 一致） */
export type SidebarMilestone = { title: string; number?: number };

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
  saveLabel,
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
  const { t } = useI18n();
  const saveText = saveLabel ?? t("common.save");
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
            {t("common.cancel")}
          </Button>
          <Button onClick={onSave} disabled={busy}>
            {busy ? t("common.saving") : saveText}
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
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
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
      toastSuccess(t("metadata.assignSaved"));
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新指派失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={openDialog} />
          ) : undefined
        }
      />
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
        saveLabel={t("metadata.saveAssign")}
      >
        {candidates === null ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("metadata.noUsers")}</p>
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
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
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
      toastSuccess(t("metadata.labelsSaved"));
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新标签失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={openDialog} />
          ) : undefined
        }
      />
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
        saveLabel={t("metadata.saveLabels")}
      >
        {candidates === null ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("metadata.noLabels")}</p>
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
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
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
      toastSuccess(selected ? t("metadata.milestoneSet") : t("metadata.milestoneCleared"));
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "更新里程碑失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={openDialog} />
          ) : undefined
        }
      />
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
        saveLabel={t("metadata.saveMilestone")}
      >
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
            selected === null ? "bg-muted/60" : ""
          }`}
          onClick={() => setSelected(null)}
        >
          <MilestoneIcon className="size-3.5 text-muted-foreground" />
          {t("metadata.noMilestone")}
        </button>
        {milestones === null ? (
          <Skeleton className="h-32 w-full" />
        ) : milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("metadata.noMilestone")}</p>
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

/* ── Projects 编辑（完整 section：标题齿轮 + 关联项目列表 + 添加/移除弹窗） ── */

export function ProjectsEditor({
  owner,
  repo,
  number,
  kind,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const [items, setItems] = useState<PullProjectItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<RepoProjectV2[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = () => {
    if (!token) return;
    const fn = kind === "issue" ? fetchIssueProjectsSmart : fetchPullProjectsSmart;
    fn(owner, repo, number, token)
      .then(setItems)
      .catch(() => setItems([]));
  };

  useEffect(() => {
    setItems(null);
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number, token, kind]);

  const openDialog = () => {
    setOpen(true);
    setError(null);
    if (candidates) return;
    fetchRepoProjectsV2Smart(owner, repo, token)
      .then((ctx) => setCandidates(ctx.projects.filter((p) => !p.closed)))
      .catch(() => setCandidates([]));
  };

  const add = async (projectId: string) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const contentId = await resolveIssuePrNodeId(owner, repo, number, token);
      if (!contentId) throw new Error("resolve node id failed");
      await addProjectV2ItemByIdSmart(projectId, contentId, token);
      loadItems();
      setOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, "添加项目失败"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: PullProjectItem) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProjectV2ItemSmart(item.project.id, item.id, token);
      loadItems();
    } catch (e) {
      setError(apiErrorMessage(e, "移除项目失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={openDialog} />
          ) : undefined
        }
      />
      {items === null ? (
        <p className="text-muted-foreground">—</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <a
                href={p.project.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-foreground hover:underline"
              >
                {p.project.title}
              </a>
              {p.status && (
                <span className="shrink-0 text-xs text-muted-foreground">· {p.status}</span>
              )}
              {canWrite && canCollaborate && (
                <button
                  type="button"
                  onClick={() => remove(p)}
                  disabled={busy}
                  aria-label={`移除 ${p.project.title}`}
                  className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {candidates === null ? (
              <Skeleton className="h-32 w-full" />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pullDetail.noProjects")}</p>
            ) : (
              candidates.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => add(proj.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <Columns3 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{proj.title}</span>
                </button>
              ))
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ── Development 编辑（PR/issue 通用：关联 issue/PR/branch 只读 + PR 手动关联） ── */

export function DevelopmentSection({
  owner,
  repo,
  number,
  kind,
  title,
  emptyText,
  prBody,
  pullRequestId,
  onPrBodyChange,
}: {
  owner: string;
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  emptyText: string;
  /** PR 描述（手动关联 issue 时追加 closing keywords 用；仅 kind="pr" 需要） */
  prBody?: string;
  pullRequestId?: string;
  onPrBodyChange?: (body: string) => void;
}) {
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const [data, setData] = useState<{
    issues: { number: number; title: string; url: string | null }[];
    prs: { number: number; title: string; url: string | null }[];
    branches: string[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [issueInput, setIssueInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    const fallback = { issues: [], prs: [], branches: [] };
    if (kind === "issue") {
      fetchIssueDevelopmentSmart(owner, repo, number, token)
        .then((d) => setData({ issues: [], prs: d.prs, branches: d.branches }))
        .catch(() => setData(fallback));
    } else {
      fetchPullDevelopmentSmart(owner, repo, number, token)
        .then((d) => setData({ issues: d.issues, prs: [], branches: d.branches }))
        .catch(() => setData(fallback));
    }
  };

  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number, token, kind]);

  const linkIssue = async () => {
    if (!token || !pullRequestId || busy) return;
    const n = Number(issueInput.trim());
    if (!Number.isInteger(n) || n <= 0) {
      setError(t("metadata.linkIssueInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const keyword = `Closes #${n}`;
      const base = prBody && prBody.trim() ? `${prBody.trimEnd()}\n\n${keyword}` : keyword;
      await updatePullRequestBodySmart(pullRequestId, base, token);
      onPrBodyChange?.(base);
      setIssueInput("");
      setOpen(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, "关联 issue 失败"));
    } finally {
      setBusy(false);
    }
  };

  const hasContent =
    data !== null && data.issues.length + data.prs.length + data.branches.length > 0;

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          kind === "pr" && canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={() => setOpen(true)} />
          ) : undefined
        }
      />
      {data === null ? (
        <p className="text-muted-foreground">—</p>
      ) : !hasContent ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {data.issues.map((i) => (
            <li key={`i${i.number}`} className="text-sm">
              <a
                href={i.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:underline"
              >
                #{i.number} {i.title}
              </a>
            </li>
          ))}
          {data.prs.map((p) => (
            <li key={`p${p.number}`} className="text-sm">
              <a
                href={p.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:underline"
              >
                #{p.number} {p.title}
              </a>
            </li>
          ))}
          {data.branches.map((b) => (
            <li key={b} className="flex items-center gap-1.5 text-sm">
              <GitPullRequest className="size-3.5 text-muted-foreground" />
              <code className="font-mono text-xs">{b}</code>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("metadata.linkIssueDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={issueInput}
            onChange={(e) => setIssueInput(e.target.value)}
            placeholder={t("metadata.linkIssuePlaceholder")}
            inputMode="numeric"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={linkIssue} disabled={busy || !issueInput.trim()}>
              {busy ? t("common.saving") : t("metadata.linkIssue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ── 子任务与依赖（REST-only：GraphQL 无 sub-issue / dependency 适配） ── */

/** 输入 issue number → 解析 id → 回调 onAdd(id) 的对话框（子任务与依赖共用） */
function AddIssueNumberDialog({
  open,
  onOpenChange,
  busy,
  error,
  onAdd,
  title,
  desc,
  placeholder,
  submitLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  onAdd: (issueId: number) => void;
  title: string;
  desc: string;
  placeholder: string;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onAdd(Number(input.trim()))} disabled={busy || !input.trim()}>
            {busy ? t("common.saving") : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 子任务区块（列表 + 父 issue 引用 + 添加/移除） */
export function SubIssuesSection({
  owner,
  repo,
  number,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const [subs, setSubs] = useState<Issue[] | null>(null);
  const [parent, setParent] = useState<Issue | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setSubs(null);
    setParent(null);
    fetchSubIssuesSmart(owner, repo, number, token)
      .then(setSubs)
      .catch(() => setSubs([]));
    fetchParentIssueSmart(owner, repo, number, token)
      .then(setParent)
      .catch(() => setParent(null));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number, token]);

  const add = async (issueNumber: number) => {
    if (!token || busy) return;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      setError(t("metadata.invalidIssueNumber"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target = await fetchIssueDetail(owner, repo, issueNumber, token);
      await addSubIssueSmart(owner, repo, number, target.id, token);
      setOpen(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("metadata.addSubIssueFailed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!token) return;
    try {
      await removeSubIssueSmart(owner, repo, number, id, token);
      load();
    } catch {
      /* 静默 */
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={() => setOpen(true)} />
          ) : undefined
        }
      />
      {parent && (
        <p className="mb-1.5 text-sm text-muted-foreground">
          {t("metadata.parentIssue")}{" "}
          <Link
            to={`/${owner}/${repo}/issues/${parent.number}`}
            className="text-foreground hover:underline"
          >
            #{parent.number}
          </Link>
        </p>
      )}
      {subs === null ? (
        <p className="text-muted-foreground">—</p>
      ) : subs.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {subs.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-sm">
              <ListTree className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                to={`/${owner}/${repo}/issues/${s.number}`}
                className="min-w-0 flex-1 truncate text-foreground hover:underline"
              >
                #{s.number} {s.title}
              </Link>
              {canWrite && canCollaborate && (
                <button
                  type="button"
                  onClick={() => void remove(s.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("metadata.removeSubIssue")}
                  title={t("metadata.removeSubIssue")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddIssueNumberDialog
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        error={error}
        onAdd={(id) => void add(id)}
        title={t("metadata.addSubIssue")}
        desc={t("metadata.addSubIssueDesc")}
        placeholder={t("metadata.issueNumberPlaceholder")}
        submitLabel={t("metadata.addSubIssue")}
      />
    </section>
  );
}

/** 依赖（blocked by）区块（列表 + 添加/移除） */
export function DependenciesSection({
  owner,
  repo,
  number,
  title,
  emptyText,
}: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  const { token, canWrite } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const [deps, setDeps] = useState<Issue[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setDeps(null);
    fetchBlockedByDependenciesSmart(owner, repo, number, token)
      .then(setDeps)
      .catch(() => setDeps([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number, token]);

  const add = async (issueNumber: number) => {
    if (!token || busy) return;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      setError(t("metadata.invalidIssueNumber"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target = await fetchIssueDetail(owner, repo, issueNumber, token);
      await addBlockedByDependencySmart(owner, repo, number, target.id, token);
      setOpen(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("metadata.addDependencyFailed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!token) return;
    try {
      await removeBlockedByDependencySmart(owner, repo, number, id, token);
      load();
    } catch {
      /* 静默 */
    }
  };

  return (
    <section>
      <SidebarHeading
        title={title}
        action={
          canWrite && canCollaborate ? (
            <EditActionButton label={title} onClick={() => setOpen(true)} />
          ) : undefined
        }
      />
      {deps === null ? (
        <p className="text-muted-foreground">—</p>
      ) : deps.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {deps.map((d) => (
            <li key={d.id} className="flex items-center gap-1.5 text-sm">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                to={`/${owner}/${repo}/issues/${d.number}`}
                className="min-w-0 flex-1 truncate text-foreground hover:underline"
              >
                #{d.number} {d.title}
              </Link>
              {canWrite && canCollaborate && (
                <button
                  type="button"
                  onClick={() => void remove(d.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("metadata.removeDependency")}
                  title={t("metadata.removeDependency")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddIssueNumberDialog
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        error={error}
        onAdd={(id) => void add(id)}
        title={t("metadata.addDependency")}
        desc={t("metadata.addDependencyDesc")}
        placeholder={t("metadata.issueNumberPlaceholder")}
        submitLabel={t("metadata.addDependency")}
      />
    </section>
  );
}
