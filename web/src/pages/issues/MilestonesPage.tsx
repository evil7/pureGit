/**
 * 仓库 Milestones 管理页（/:owner/:repo/milestones，官方 /milestones 复刻）
 *
 * 官方结构：标题「Milestones」+ New milestone 按钮 → Open/Closed tab → milestone 列表
 * （进度条 + 标题 + 截止日期 + 描述 + 关闭/编辑/删除）。
 * 数据源：fetchRepoMilestonesByState（REST-only，GraphQL 无 milestone mutation）。
 * 写操作 createMilestoneSmart / updateMilestoneSmart / deleteMilestoneSmart（REST-only）。
 * 需仓库写权限（WriteGate 门控写操作）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineError } from "@/components/InlineError";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WriteGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import {
  fetchRepoMilestonesByState,
  createMilestoneSmart,
  updateMilestoneSmart,
  deleteMilestoneSmart,
  apiErrorMessage,
} from "@/lib/api";
import type { RepoMilestone } from "@/lib/restapi";

type MilestoneState = "open" | "closed";

/** 进度 = closed / (open + closed)；无 issue 时 0% */
function progressOf(m: RepoMilestone): number {
  const total = (m.open_issues ?? 0) + (m.closed_issues ?? 0);
  return total === 0 ? 0 : Math.round(((m.closed_issues ?? 0) / total) * 100);
}

export default function MilestonesPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [state, setState] = useState<MilestoneState>("open");
  const [milestones, setMilestones] = useState<RepoMilestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 表单弹窗：editing = null → 新建；否则编辑该 milestone
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RepoMilestone | null>(null);
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [description, setDescription] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoMilestone | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = (s: MilestoneState) => {
    setMilestones(null);
    setError(null);
    fetchRepoMilestonesByState(owner, repo, s, token)
      .then(setMilestones)
      .catch((e) => setError(apiErrorMessage(e, t("milestones.loadFailed"))));
  };

  useEffect(() => {
    let cancelled = false;
    setMilestones(null);
    setError(null);
    fetchRepoMilestonesByState(owner, repo, state, token)
      .then((ms) => !cancelled && setMilestones(ms))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("milestones.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, state, token]);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setDueOn("");
    setDescription("");
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (m: RepoMilestone) => {
    setEditing(m);
    setTitle(m.title);
    setDueOn(m.due_on ? m.due_on.slice(0, 10) : "");
    setDescription(m.description ?? "");
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async () => {
    if (!token || !title.trim() || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    const input = {
      title: title.trim(),
      description: description.trim() || undefined,
      due_on: dueOn ? `${dueOn}T00:00:00Z` : null,
    };
    try {
      if (editing) {
        await updateMilestoneSmart(owner, repo, editing.number, input, token);
        toastSuccess(t("milestones.updated"));
      } else {
        await createMilestoneSmart(owner, repo, input, token);
        toastSuccess(t("milestones.created"));
      }
      setFormOpen(false);
      load(state);
    } catch (e) {
      setFormError(apiErrorMessage(e, t("milestones.saveFailed")));
    } finally {
      setFormBusy(false);
    }
  };

  const close = async (m: RepoMilestone) => {
    if (!token) return;
    try {
      await updateMilestoneSmart(owner, repo, m.number, { title: m.title, state: "closed" }, token);
      toastSuccess(t("milestones.closed"));
      load(state);
    } catch (e) {
      toastError(apiErrorMessage(e, t("milestones.closeFailed")));
    }
  };

  const reopen = async (m: RepoMilestone) => {
    if (!token) return;
    try {
      await updateMilestoneSmart(owner, repo, m.number, { title: m.title, state: "open" }, token);
      toastSuccess(t("milestones.reopened"));
      load(state);
    } catch (e) {
      toastError(apiErrorMessage(e, t("milestones.reopenFailed")));
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteMilestoneSmart(owner, repo, deleting.number, token);
      setMilestones((prev) => (prev ?? []).filter((m) => m.number !== deleting.number));
      toastSuccess(t("milestones.deleted"));
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorMessage(e, t("milestones.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("milestones.title")}</h1>
        {canWriteRepo && (
          <WriteGate>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t("milestones.new")}
            </Button>
          </WriteGate>
        )}
      </div>

      <Tabs value={state} onValueChange={(v) => setState(v as MilestoneState)}>
        <TabsList>
          <TabsTrigger value="open">{t("milestones.open")}</TabsTrigger>
          <TabsTrigger value="closed">{t("milestones.closedTab")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? (
        <InlineError message={error} />
      ) : milestones === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : milestones.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {state === "open" ? t("milestones.emptyOpen") : t("milestones.emptyClosed")}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {milestones.map((m) => {
            const pct = progressOf(m);
            return (
              <li key={m.number} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {m.due_on && (
                        <span>
                          {t("milestones.due")} {fmt(m.due_on)}
                        </span>
                      )}
                      <span>{m.description || ""}</span>
                    </div>
                  </div>
                  {canWriteRepo && (
                    <WriteGate>
                      <div className="flex shrink-0 items-center gap-1">
                        {state === "open" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void close(m)}
                            title={t("milestones.close")}
                            aria-label={t("milestones.close")}
                          >
                            <Check className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void reopen(m)}
                            title={t("milestones.reopen")}
                            aria-label={t("milestones.reopen")}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(m)}
                          title={t("milestones.edit")}
                          aria-label={t("milestones.edit")}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => setDeleting(m)}
                          title={t("milestones.delete")}
                          aria-label={t("milestones.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </WriteGate>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Progress value={pct} className="h-1.5" />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {pct}% · {m.closed_issues ?? 0}/{m.open_issues ?? 0}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 新建/编辑 milestone 弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("milestones.edit") : t("milestones.new")}</DialogTitle>
            <DialogDescription>{t("milestones.formDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ms-title" className="mb-1.5 block">
                {t("milestones.titleLabel")}
              </Label>
              <Input
                id="ms-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("milestones.titlePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="ms-due" className="mb-1.5 block">
                {t("milestones.dueLabel")}
              </Label>
              <Input
                id="ms-due"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ms-desc" className="mb-1.5 block">
                {t("milestones.descLabel")}
              </Label>
              <Input
                id="ms-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("milestones.descPlaceholder")}
              />
            </div>
            {formError && <InlineError message={formError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={formBusy || !title.trim()}>
              {formBusy ? t("common.submitting") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("milestones.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("milestones.deleteDesc", { title: deleting?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
