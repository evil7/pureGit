/**
 * 仓库 Environments 设置页（官方 github.com/:owner/:repo/settings/environments）
 *
 * 官方结构：H1「Environments」→ 描述 → New environment 按钮 → 环境列表
 * （名称 + protection rules 数量 + 置顶标记 + 删除）。
 * 数据与写操作走 GraphQL environments（主通道）+ REST 降级。
 * 环境详情（branch policies / secrets / variables / protection rules / reviewers）
 * 留待 Secrets and variables 大项一并实现。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pin, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
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
import { apiErrorMessage } from "@/lib/restapi";
import { fetchEnvironmentsSmart, createEnvironmentSmart, deleteEnvironmentSmart } from "@/lib/api";
import type { RepoEnvironment } from "@/lib/restapi";

export default function RepoEnvironmentsSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [envs, setEnvs] = useState<RepoEnvironment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 新建弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoEnvironment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setEnvs(null);
    setError(null);
    fetchEnvironmentsSmart(owner, repo, token)
      .then(setEnvs)
      .catch((e) => setError(apiErrorMessage(e, t("repoEnv.loadFailed"))));
  };

  useEffect(() => {
    let cancelled = false;
    setEnvs(null);
    setError(null);
    fetchEnvironmentsSmart(owner, repo, token)
      .then((list) => !cancelled && setEnvs(list))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("repoEnv.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const openAdd = () => {
    setName("");
    setAddError(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!token || !name.trim() || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      await createEnvironmentSmart(owner, repo, name.trim(), token);
      toastSuccess(t("repoEnv.created"));
      setAddOpen(false);
      load();
    } catch (e) {
      setAddError(apiErrorMessage(e, t("repoEnv.createFailed")));
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteEnvironmentSmart(
        owner,
        repo,
        { nodeId: deleting.nodeId, name: deleting.name },
        token,
      );
      setEnvs((prev) => (prev ?? []).filter((e) => e.name !== deleting.name));
      toastSuccess(t("repoEnv.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoEnv.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("repoEnv.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("repoEnv.desc")}</p>
        </div>
        <Button onClick={openAdd} disabled={!token}>
          <Plus className="size-4" />
          {t("repoEnv.new")}
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {envs === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : envs.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("repoEnv.empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {envs.map((e) => (
            <li key={e.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  {e.isPinned && (
                    <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="pinned" />
                  )}
                </div>
                {e.protectionRules > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("repoEnv.protectionRules", { count: e.protectionRules })}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(e)}
                disabled={deleteBusy}
                title={t("repoEnv.delete")}
                aria-label={t("repoEnv.delete")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 新建 environment 弹窗 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("repoEnv.newTitle")}</DialogTitle>
            <DialogDescription>{t("repoEnv.newDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="env-name" className="mb-1.5 block">
              {t("repoEnv.nameLabel")}
            </Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("repoEnv.namePlaceholder")}
            />
            {addError && <InlineError message={addError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submitAdd()} disabled={addBusy || !name.trim()}>
              {addBusy ? t("common.submitting") : t("repoEnv.new")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repoEnv.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("repoEnv.deleteDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("repoEnv.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
