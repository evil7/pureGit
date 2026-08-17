/**
 * 仓库协作者设置（github.com/:owner/:repo/settings/access 的 Collaborators 子页）
 *
 * 官方语义：列表展示协作者（头像 + login + 权限级别），支持添加（Dialog：username +
 * 权限选择）、权限变更（行内 Select）、移除（AlertDialog 确认）。
 * 权限级别枚举：admin / maintain / write / triage / read（GitHub 官方角色）。
 * 数据层：fetchCollaboratorsSmart（GraphQL 首选含 permission，REST 降级 listCollaborators）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { fetchCollaboratorsSmart } from "@/lib/api";
import {
  addCollaborator,
  removeCollaborator,
  apiErrorMessage,
  type Collaborator,
} from "@/lib/restapi";
import { toastSuccess, toastError } from "@/lib/ui/toast";

/** 协作者权限级别（GitHub API permission 枚举；pull=Read / push=Write） */
type Permission = "admin" | "maintain" | "push" | "triage" | "pull";

const PERMISSION_OPTIONS: { value: Permission; label: I18nKey }[] = [
  { value: "pull", label: "repoCollab.permission.read" },
  { value: "triage", label: "repoCollab.permission.triage" },
  { value: "push", label: "repoCollab.permission.write" },
  { value: "maintain", label: "repoCollab.permission.maintain" },
  { value: "admin", label: "repoCollab.permission.admin" },
];

/** role_name（listCollaborators 返回 read/write）→ API permission 枚举（pull/push） */
function roleToPermission(role?: string): Permission {
  switch (role?.toLowerCase()) {
    case "read":
      return "pull";
    case "write":
      return "push";
    case "triage":
      return "triage";
    case "maintain":
      return "maintain";
    case "admin":
      return "admin";
    default:
      return "pull";
  }
}

export default function RepoCollaboratorsSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [collaborators, setCollaborators] = useState<Collaborator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPermission, setAddPermission] = useState<Permission>("push");
  const [addBusy, setAddBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = () => {
    setError(null);
    fetchCollaboratorsSmart(owner, repo, token)
      .then(setCollaborators)
      .catch(() => setError(t("repoCollab.loadFailed")));
  };

  useEffect(() => {
    if (!token || !owner) return;
    let cancelled = false;
    fetchCollaboratorsSmart(owner, repo, token)
      .then((c) => !cancelled && setCollaborators(c))
      .catch(() => !cancelled && setError(t("repoCollab.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [token, owner, repo, t]);

  const doAdd = async () => {
    const username = addUsername.trim();
    if (!username || addBusy) return;
    setAddBusy(true);
    try {
      await addCollaborator(owner, repo, username, addPermission, token!);
      toastSuccess(t("repoCollab.added"));
      setAddOpen(false);
      setAddUsername("");
      setAddPermission("push");
      load();
    } catch (e) {
      toastError(apiErrorMessage(e, t("repoCollab.addFailed")));
    } finally {
      setAddBusy(false);
    }
  };

  const doChangePermission = async (username: string, permission: Permission) => {
    if (updating) return;
    setUpdating(username);
    try {
      await addCollaborator(owner, repo, username, permission, token!);
      toastSuccess(t("repoCollab.updated"));
      load();
    } catch (e) {
      toastError(apiErrorMessage(e, t("repoCollab.updateFailed")));
    } finally {
      setUpdating(null);
    }
  };

  const doRemove = async (username: string) => {
    if (removing) return;
    setRemoving(username);
    try {
      await removeCollaborator(owner, repo, username, token!);
      toastSuccess(t("repoCollab.removed"));
      load();
    } catch (e) {
      toastError(apiErrorMessage(e, t("repoCollab.removeFailed")));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("repoCollab.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("repoCollab.desc")}</p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={!token}>
          <Plus className="size-4" />
          {t("repoCollab.add")}
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {collaborators === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border">
          {collaborators.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("repoCollab.empty")}</p>
          ) : (
            collaborators.map((c) => (
              <div key={c.login} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                <UserAvatar src={c.avatar_url} alt={c.login} className="size-8" />
                <span className="min-w-0 flex-1 truncate font-medium">{c.login}</span>
                {/* 权限级别（行内 Select 直接改；当前角色转小写对齐枚举） */}
                <Select
                  value={roleToPermission(c.role_name)}
                  onValueChange={(v) => void doChangePermission(c.login, v as Permission)}
                  disabled={updating === c.login || !token}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      disabled={removing === c.login || !token}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("repoCollab.removeTitle").replace("{login}", c.login)}
                      </AlertDialogTitle>
                      <AlertDialogDescription>{t("repoCollab.removeDesc")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void doRemove(c.login)}
                      >
                        {t("repoCollab.remove")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </div>
      )}

      {/* 添加协作者（Dialog：username + 权限选择） */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("repoCollab.addTitle")}</DialogTitle>
            <DialogDescription>{t("repoCollab.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              placeholder={t("repoCollab.usernamePlaceholder")}
              autoFocus
            />
            <Select value={addPermission} onValueChange={(v) => setAddPermission(v as Permission)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void doAdd()} disabled={addBusy || !addUsername.trim()}>
              {t("repoCollab.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
