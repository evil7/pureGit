/**
 * 仓库 Secrets & Variables 设置页（官方 github.com/:owner/:repo/settings/secrets/actions）
 *
 * 官方结构：Tabs（Actions secrets / Actions variables）→ 各自列表 + 新建/删除。
 * 安全约定：secret 值加密存储、不可读回（仅 name + 更新时间，无「编辑」只有「新建/覆盖」）；
 * variable 值明文可读，支持编辑 value。
 * 整体 REST-only（GraphQL 无 secrets/variables 端点，见 api-secrets.ts 理由）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { KeyRound, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { toastSuccess } from "@/lib/ui/toast";
import { useDateFormat } from "@/hooks/useDateFormat";
import { apiErrorMessage } from "@/lib/restapi";
import {
  fetchRepoSecretsSmart,
  fetchRepoVariablesSmart,
  upsertRepoSecretSmart,
  deleteRepoSecretSmart,
  createRepoVariableSmart,
  updateRepoVariableSmart,
  deleteRepoVariableSmart,
} from "@/lib/api";
import type { RepoSecret, RepoVariable } from "@/lib/restapi";

export default function RepoSecretsSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState("secrets");
  const [addOpen, setAddOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const isSecret = tab === "secrets";

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="secrets">{t("repoSecrets.tabSecrets")}</TabsTrigger>
            <TabsTrigger value="variables">{t("repoSecrets.tabVariables")}</TabsTrigger>
          </TabsList>
          <Button onClick={() => setAddOpen(true)} disabled={!token} className="shrink-0">
            <Plus className="size-4" />
            {isSecret ? t("repoSecrets.newSecret") : t("repoSecrets.newVariable")}
          </Button>
        </div>
        <TabsContent value="secrets" className="mt-4">
          <SecretsPanel reloadKey={reloadKey} />
        </TabsContent>
        <TabsContent value="variables" className="mt-4">
          <VariablesPanel reloadKey={reloadKey} />
        </TabsContent>
      </Tabs>

      <AddSecretVariableDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        isSecret={isSecret}
        owner={owner}
        repo={repo}
        token={token}
        onAdded={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

/** Actions secrets 面板（值加密存储、不可读回 → 仅列表 + 删除；新建由父级 Add 弹窗统一处理） */
function SecretsPanel({ reloadKey }: { reloadKey: number }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [secrets, setSecrets] = useState<RepoSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoSecret | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setSecrets(null);
    setError(null);
    fetchRepoSecretsSmart(owner, repo, token)
      .then(setSecrets)
      .catch((e) => setError(apiErrorMessage(e, t("repoSecrets.loadFailedSecrets"))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token, reloadKey]);

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteRepoSecretSmart(owner, repo, deleting.name, token);
      setSecrets((prev) => (prev ?? []).filter((s) => s.name !== deleting.name));
      toastSuccess(t("repoSecrets.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSecrets.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("repoSecrets.secretNote")}</p>

      {error && <InlineError message={error} />}

      {secrets === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : secrets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("repoSecrets.emptySecrets")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {secrets.map((s) => (
            <li key={s.name} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("repoSecrets.updated")} {fmt(s.updated_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(s)}
                disabled={deleteBusy}
                title={t("repoSecrets.remove")}
                aria-label={t("repoSecrets.remove")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("repoSecrets.removeTitle", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("repoSecrets.removeSecretDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("repoSecrets.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Actions variables 面板（值明文可读 → 列表 + 编辑 value + 删除；新建由父级 Add 弹窗统一处理） */
function VariablesPanel({ reloadKey }: { reloadKey: number }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [variables, setVariables] = useState<RepoVariable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 编辑弹窗（name 固定，仅改 value）
  const [editing, setEditing] = useState<RepoVariable | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoVariable | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setVariables(null);
    setError(null);
    fetchRepoVariablesSmart(owner, repo, token)
      .then(setVariables)
      .catch((e) => setError(apiErrorMessage(e, t("repoSecrets.loadFailedVariables"))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token, reloadKey]);

  const openEdit = (v: RepoVariable) => {
    setEditing(v);
    setEditValue(v.value);
    setFormError(null);
  };

  const submitEdit = async () => {
    if (!token || !editing || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await updateRepoVariableSmart(owner, repo, editing.name, editValue, token);
      toastSuccess(t("repoSecrets.variableUpdated"));
      setEditing(null);
      load();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("repoSecrets.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteRepoVariableSmart(owner, repo, deleting.name, token);
      setVariables((prev) => (prev ?? []).filter((v) => v.name !== deleting.name));
      toastSuccess(t("repoSecrets.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSecrets.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("repoSecrets.variableNote")}</p>

      {error && <InlineError message={error} />}

      {variables === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : variables.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("repoSecrets.emptyVariables")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {variables.map((v) => (
            <li key={v.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{v.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {t("repoSecrets.updated")} {fmt(v.updated_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => openEdit(v)}
                title={t("repoSecrets.edit")}
                aria-label={t("repoSecrets.edit")}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(v)}
                disabled={deleteBusy}
                title={t("repoSecrets.remove")}
                aria-label={t("repoSecrets.remove")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 编辑 variable 弹窗（仅 value） */}
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("repoSecrets.editVariable", { name: editing?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("repoSecrets.variableNote")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="var-edit-value" className="mb-1.5 block">
                {t("repoSecrets.valueLabel")}
              </Label>
              <Input
                id="var-edit-value"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </div>
            {formError && <InlineError message={formError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submitEdit()} disabled={busy}>
              {busy ? t("common.submitting") : t("repoSecrets.updateVariable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("repoSecrets.removeTitle", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("repoSecrets.removeVariableDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("repoSecrets.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 新建 secret / variable 弹窗（父级根据当前 tab 决定类型；提交成功后通知父级刷新列表） */
function AddSecretVariableDialog({
  open,
  onOpenChange,
  isSecret,
  owner,
  repo,
  token,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isSecret: boolean;
  owner: string;
  repo: string;
  token: string | null;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      setName("");
      setValue("");
      setFormError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!token || !name.trim() || busy) return;
    if (isSecret && !value) return;
    setBusy(true);
    setFormError(null);
    try {
      if (isSecret) {
        await upsertRepoSecretSmart(owner, repo, name.trim(), value, token);
        toastSuccess(t("repoSecrets.secretAdded"));
      } else {
        await createRepoVariableSmart(owner, repo, name.trim(), value, token);
        toastSuccess(t("repoSecrets.variableAdded"));
      }
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("repoSecrets.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isSecret ? t("repoSecrets.newSecret") : t("repoSecrets.newVariable")}
          </DialogTitle>
          <DialogDescription>
            {isSecret ? t("repoSecrets.secretNote") : t("repoSecrets.variableNote")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="secvar-name" className="mb-1.5 block">
              {t("repoSecrets.nameLabel")}
            </Label>
            <Input
              id="secvar-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("repoSecrets.namePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="secvar-value" className="mb-1.5 block">
              {t("repoSecrets.valueLabel")}
            </Label>
            <Input
              id="secvar-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isSecret ? t("repoSecrets.secretPlaceholder") : t("repoSecrets.variablePlaceholder")
              }
            />
          </div>
          {formError && <InlineError message={formError} size="sm" />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || (isSecret && !value)}
          >
            {busy
              ? t("common.submitting")
              : isSecret
                ? t("repoSecrets.addSecret")
                : t("repoSecrets.addVariable")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
