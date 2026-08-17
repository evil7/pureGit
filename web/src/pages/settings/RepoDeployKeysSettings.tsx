/**
 * 仓库 Deploy keys 设置页（官方 github.com/:owner/:repo/settings/keys）
 *
 * 官方结构：H1「Deploy keys」→ 列表（标题 + 指纹 + 只读标记 + 添加时间 + 删除）→
 * 「Add deploy key」按钮 → 添加表单（标题 + 公钥 + Allow write access 开关）。
 * 整体 REST-only：GraphQL 无 deploy key mutation，且 DeployKey 无数字 id 字段
 * （REST 删除仅接受数字 key_id），读取 GraphQL 无法与写操作衔接。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { fetchDeployKeysSmart, addDeployKeySmart, deleteDeployKeySmart } from "@/lib/api";
import type { RepoDeployKey } from "@/lib/restapi";

export default function RepoDeployKeysSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [keys, setKeys] = useState<RepoDeployKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 添加弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoDeployKey | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setKeys(null);
    setError(null);
    fetchDeployKeysSmart(owner, repo, token)
      .then(setKeys)
      .catch((e) => setError(apiErrorMessage(e, t("repoKeys.loadFailed"))));
  };

  useEffect(() => {
    let cancelled = false;
    setKeys(null);
    setError(null);
    fetchDeployKeysSmart(owner, repo, token)
      .then((list) => !cancelled && setKeys(list))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("repoKeys.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const openAdd = () => {
    setTitle("");
    setKey("");
    setReadOnly(true);
    setAddError(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!token || !title.trim() || !key.trim() || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      await addDeployKeySmart(owner, repo, title.trim(), key.trim(), readOnly, token);
      toastSuccess(t("repoKeys.added"));
      setAddOpen(false);
      load();
    } catch (e) {
      setAddError(apiErrorMessage(e, t("repoKeys.addFailed")));
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteDeployKeySmart(owner, repo, deleting.id, token);
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== deleting.id));
      toastSuccess(t("repoKeys.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoKeys.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("repoKeys.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("repoKeys.desc")}</p>
        </div>
        <Button onClick={openAdd} disabled={!token}>
          <Plus className="size-4" />
          {t("repoKeys.add")}
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {keys === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("repoKeys.empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{k.title}</p>
                  {k.read_only ? (
                    <Badge variant="secondary">{t("repoKeys.readOnly")}</Badge>
                  ) : (
                    <Badge>{t("repoKeys.readWrite")}</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {k.key.split(/\s+/)[0]}… {k.key.split(/\s+/).slice(1).join(" ").slice(0, 16)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("repoKeys.addedAt")} {fmt(k.created_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(k)}
                disabled={deleteBusy}
                title={t("repoKeys.remove")}
                aria-label={t("repoKeys.remove")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 添加 deploy key 弹窗 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("repoKeys.addTitle")}</DialogTitle>
            <DialogDescription>{t("repoKeys.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="dk-title" className="mb-1.5 block">
                {t("repoKeys.titleLabel")}
              </Label>
              <Input
                id="dk-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("repoKeys.titlePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="dk-key" className="mb-1.5 block">
                {t("repoKeys.keyLabel")}
              </Label>
              <Textarea
                id="dk-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA…"
                className="min-h-24 font-mono"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("repoKeys.writeAccess")}</p>
                <p className="text-sm text-muted-foreground">{t("repoKeys.writeAccessDesc")}</p>
              </div>
              <Switch checked={!readOnly} onCheckedChange={(v) => setReadOnly(!v)} />
            </div>
            {addError && <InlineError message={addError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submitAdd()}
              disabled={addBusy || !title.trim() || !key.trim()}
            >
              {addBusy ? t("common.submitting") : t("repoKeys.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repoKeys.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("repoKeys.removeDesc", { title: deleting?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("repoKeys.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
