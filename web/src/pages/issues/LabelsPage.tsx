/**
 * 仓库 Labels 管理页（/:owner/:repo/labels，官方 /labels 复刻）
 *
 * 官方结构：标题「Labels」+ New label 按钮 → label 列表（彩色徽标 + 名称 + 描述 + Edit/Delete）。
 * 数据源：fetchRepoLabelsSmart（GraphQL 首选 + REST 降级）；写操作 createLabelSmart /
 * updateLabelSmart / deleteLabelSmart（GraphQL mutation 首选 + REST 降级）。
 * 需仓库写权限（WriteGate 门控写操作）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useIsDark } from "@/hooks/useIsDark";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { getLabelStyle } from "@/lib/ui/label-color";
import {
  fetchRepoLabelsSmart,
  createLabelSmart,
  updateLabelSmart,
  deleteLabelSmart,
  apiErrorMessage,
} from "@/lib/api";
import type { RepoLabel } from "@/lib/restapi";

/** hex 颜色归一化：去 #，补足 6 位（GitHub label color 语义） */
function normalizeColor(c: string): string {
  let h = c.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((x) => x + x)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "ededed";
  return h.toLowerCase();
}

export default function LabelsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const { t } = useI18n();
  const isDark = useIsDark();
  const [labels, setLabels] = useState<RepoLabel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 表单弹窗：editing = null → 新建；否则编辑该 label
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RepoLabel | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [description, setDescription] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoLabel | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const reload = () =>
    fetchRepoLabelsSmart(owner, repo, token)
      .then(setLabels)
      .catch((e) => setError(apiErrorMessage(e, t("labels.loadFailed"))));

  useEffect(() => {
    let cancelled = false;
    setLabels(null);
    setError(null);
    fetchRepoLabelsSmart(owner, repo, token)
      .then((ls) => !cancelled && setLabels(ls))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("labels.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor("ededed");
    setDescription("");
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (l: RepoLabel) => {
    setEditing(l);
    setName(l.name);
    setColor(l.color);
    setDescription(l.description ?? "");
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async () => {
    if (!token || !name.trim() || formBusy) return;
    setFormBusy(true);
    setFormError(null);
    const input = {
      name: name.trim(),
      color: normalizeColor(color),
      description: description.trim() || undefined,
    };
    try {
      if (editing) {
        await updateLabelSmart(
          owner,
          repo,
          { nodeId: editing.nodeId, name: editing.name },
          input,
          token,
        );
        toastSuccess(t("labels.updated"));
      } else {
        await createLabelSmart(owner, repo, input, token);
        toastSuccess(t("labels.created"));
      }
      setFormOpen(false);
      await reload();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("labels.saveFailed")));
    } finally {
      setFormBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteLabelSmart(owner, repo, { nodeId: deleting.nodeId, name: deleting.name }, token);
      setLabels((prev) => (prev ?? []).filter((l) => l.name !== deleting.name));
      toastSuccess(t("labels.deleted"));
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorMessage(e, t("labels.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (error) return <InlineError message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("labels.title")}</h1>
        {canWriteRepo && (
          <WriteGate>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t("labels.new")}
            </Button>
          </WriteGate>
        )}
      </div>

      {labels === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : labels.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("labels.empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {labels.map((l) => (
            <li key={l.name} className="flex items-center gap-3 px-4 py-3">
              <Badge
                className="shrink-0 text-[11px] font-medium"
                style={getLabelStyle(l.color, isDark)}
              >
                {l.name}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground">{l.description || ""}</p>
              </div>
              {canWriteRepo && (
                <WriteGate>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(l)}
                      title={t("labels.edit")}
                      aria-label={t("labels.edit")}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => setDeleting(l)}
                      title={t("labels.delete")}
                      aria-label={t("labels.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </WriteGate>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 新建/编辑 label 弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("labels.edit") : t("labels.new")}</DialogTitle>
            <DialogDescription>{t("labels.formDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="label-name" className="mb-1.5 block">
                {t("labels.name")}
              </Label>
              <Input
                id="label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("labels.namePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="label-desc" className="mb-1.5 block">
                {t("labels.description")}
              </Label>
              <Input
                id="label-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("labels.descPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="label-color" className="mb-1.5 block">
                {t("labels.color")}
              </Label>
              <div className="flex items-center gap-2">
                <span
                  className="size-8 shrink-0 rounded-md border"
                  style={getLabelStyle(normalizeColor(color), isDark)}
                />
                <Input
                  id="label-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="ededed"
                  className="font-mono"
                />
              </div>
            </div>
            {formError && <InlineError message={formError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={formBusy || !name.trim()}>
              {formBusy ? t("common.submitting") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("labels.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("labels.deleteDesc", { name: deleting?.name ?? "" })}
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
