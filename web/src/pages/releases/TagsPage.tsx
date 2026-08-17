/**
 * 仓库 Tags 页（官方 github.com/:owner/:repo/tags）
 *
 * 官方结构：标题「Tags」→ New tag 按钮 → 列表（tag 名 + commit sha + 删除）。
 * 整体 REST-only（GraphQL 无 tag 列表/创建/删除适配，见 api-tags.ts）。
 *
 * 创建 tag：选择目标分支 → 拿其最新 commit sha → createTagSmart（tag 对象 + 引用）。
 * 删除 tag：git.deleteRef（refs/tags/{tag}），经 AlertDialog 确认。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Tag, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { fetchBranches, apiErrorMessage } from "@/lib/restapi";
import { fetchTagsSmart, createTagSmart, deleteTagSmart } from "@/lib/api";
import type { RepoTag } from "@/lib/restapi";
import { ReleasesTabs } from "@/components/ReleasesTabs";

export default function TagsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token, canWrite: canWriteToken } = useAuth();
  const { t } = useI18n();
  const { canWrite: canWriteRepo } = useRepoPermission();
  // 写操作门控：令牌级写 scope 且 仓库级写权限
  const canWrite = canWriteToken && canWriteRepo;
  const [tags, setTags] = useState<RepoTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 新建弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [branches, setBranches] = useState<{ name: string; sha: string }[]>([]);
  const [branch, setBranch] = useState("");
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoTag | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setTags(null);
    setError(null);
    fetchTagsSmart(owner, repo, token)
      .then(setTags)
      .catch((e) => setError(apiErrorMessage(e, t("tags.loadFailed"))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const openCreate = () => {
    setTagName("");
    setMessage("");
    setBranch("");
    setFormError(null);
    setFormOpen(true);
    setBranches([]);
    if (!token) return;
    fetchBranches(owner, repo, 100, token)
      .then((b) => {
        setBranches(b.map((x) => ({ name: x.name, sha: x.commit.sha })));
        const preferred = b.find((x) => x.name === "main" || x.name === "master");
        setBranch((prev) => prev || preferred?.name || b[0]?.name || "");
      })
      .catch(() => setBranches([]));
  };

  const submit = async () => {
    if (!token || !tagName.trim() || !branch || busy) return;
    const target = branches.find((b) => b.name === branch);
    if (!target) return;
    setBusy(true);
    setFormError(null);
    try {
      await createTagSmart(owner, repo, tagName.trim(), message, target.sha, token);
      toastSuccess(t("tags.created"));
      setFormOpen(false);
      load();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("tags.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteTagSmart(owner, repo, deleting.name, token);
      setTags((prev) => (prev ?? []).filter((x) => x.name !== deleting.name));
      toastSuccess(t("tags.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("tags.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* tabs 左 + 新建标签右（同一行） */}
      <div className="flex items-center justify-between">
        <ReleasesTabs active="tags" />
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t("tags.new")}
          </Button>
        )}
      </div>

      {error && <InlineError message={error} />}

      {tags === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("tags.empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tags.map((tag) => (
            <li key={tag.name} className="flex items-center gap-3 px-4 py-3">
              <Tag className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="truncate font-mono text-sm font-medium">{tag.name}</span>
                <Badge variant="outline" className="ml-2 font-mono text-xs">
                  {tag.commit.sha.slice(0, 7)}
                </Badge>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleting(tag)}
                  disabled={deleteBusy}
                  title={t("tags.remove")}
                  aria-label={t("tags.remove")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 新建 tag 弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("tags.new")}</DialogTitle>
            <DialogDescription>{t("tags.formDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tag-name" className="mb-1.5 block">
                {t("tags.nameLabel")}
              </Label>
              <Input
                id="tag-name"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={t("tags.namePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="tag-branch" className="mb-1.5 block">
                {t("tags.branchLabel")}
              </Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger id="tag-branch" className="w-full">
                  <SelectValue placeholder={t("tags.branchPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tag-message" className="mb-1.5 block">
                {t("tags.messageLabel")}
              </Label>
              <Input
                id="tag-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("tags.messagePlaceholder")}
              />
            </div>
            {formError && <InlineError message={formError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !tagName.trim() || !branch}>
              {busy ? t("common.submitting") : t("tags.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tags.removeTitle", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tags.removeDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("tags.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
