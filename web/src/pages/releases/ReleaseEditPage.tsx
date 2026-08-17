/**
 * Release 新建/编辑单页（官方 /releases/new + /releases/edit/{tag} 复刻）
 *
 * 官方结构（单列宽表单，非弹框）：返回面包屑 → 标题（New/Edit release）→
 * Choose a tag（必填）→ Target（仅新建）→ Release title（可选）→
 * Write/Preview 发布说明（Markdown）→ 预发布/草稿开关 → Publish release。
 *
 * 数据通道：createReleaseSmart / updateReleaseSmart（GraphQL 首选 + REST 降级）；
 * 自动生成 notes = generateReleaseNotes（REST-only）。资产上传不在此页——
 * release 需先创建拿到 id，故上传仍在 ReleaseDetailPage（官方同流程）。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { LoginPrompt } from "@/components/LoginPrompt";
import { MarkdownEditor } from "@/components/MarkdownEditor";
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
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import {
  createReleaseSmart,
  updateReleaseSmart,
  generateReleaseNotes,
  fetchReleaseDetailSmart,
  uploadReleaseAsset,
  deleteReleaseAsset,
  deleteReleaseSmart,
} from "@/lib/api";
import { apiErrorMessage, normalizeApiError, type ApiError, type Release } from "@/lib/restapi";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { formatBytes } from "@/lib/ui/format";

export default function ReleaseEditPage() {
  const { owner = "", repo = "", tag } = useParams();
  const { token, canWrite: canWriteToken } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  // 写操作门控：令牌级写 scope 且 仓库级写权限
  const canWrite = canWriteToken && canWriteRepo;
  const { t } = useI18n();
  const navigate = useNavigate();
  // 有 tag 参数 = 编辑模式；否则新建
  const isEdit = Boolean(tag);

  // ---- 表单状态 ----
  const [tagName, setTagName] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [draft, setDraft] = useState(false);
  const [targetCommitish, setTargetCommitish] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MarkdownEditor 非受控：编辑态加载/自动生成后重建以注入 defaultValue
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState<ApiError | null>(null);
  // 编辑态完整 release（含 id/nodeId/assets；新建态为 null）
  const [release, setRelease] = useState<Release | null>(null);
  // 编辑态资产列表（上传/删除后本地刷新）
  const [assets, setAssets] = useState<Release["assets"]>([]);
  // 资产上传/删除忙态
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(false);
  // 新建态待上传文件（发布时一并上传）
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // 删除 release 确认
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 编辑模式：按 tag 拉详情填表（新建跳过）
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(null);
    fetchReleaseDetailSmart(owner, repo, tag!, token)
      .then((r) => {
        if (cancelled) return;
        setRelease(r);
        setAssets(r.assets);
        setTagName(r.tag_name);
        setName(r.name ?? "");
        setBody(r.body ?? "");
        setPrerelease(r.prerelease ?? false);
        setDraft(r.draft ?? false);
        setEditorKey((k) => k + 1);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadFailed(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, owner, repo, tag, token]);

  const submit = async () => {
    if (!token || !tagName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const input = {
      tag_name: tagName.trim(),
      name: name.trim() || undefined,
      body: body || undefined,
      prerelease,
      draft,
      ...(targetCommitish.trim() ? { target_commitish: targetCommitish.trim() } : {}),
    };
    try {
      if (isEdit) {
        await updateReleaseSmart(
          owner,
          repo,
          release ? { nodeId: release.nodeId, id: release.id } : { id: -1 },
          input,
          token,
        );
        toastSuccess(t("releases.saved"));
        navigate(`/${owner}/${repo}/releases/tag/${encodeURIComponent(input.tag_name)}`);
      } else {
        await createReleaseSmart(owner, repo, input, token);
        toastSuccess(t("releases.created"));
        // 待上传资产：先拿 release id 再逐个上传（createReleaseSmart 仅返回 tag）
        if (pendingFiles.length > 0) {
          const r = await fetchReleaseDetailSmart(owner, repo, input.tag_name, token);
          for (const f of pendingFiles) {
            const data = await f.arrayBuffer();
            await uploadReleaseAsset(owner, repo, r.id, f.name, data, token);
          }
        }
        navigate(`/${owner}/${repo}/releases/tag/${encodeURIComponent(input.tag_name)}`);
      }
    } catch (e) {
      setError(apiErrorMessage(e, t("releases.saveFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  const generate = async () => {
    if (!token || !tagName.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const notes = await generateReleaseNotes(owner, repo, tagName.trim(), token);
      setBody(notes);
      setEditorKey((k) => k + 1);
    } catch (e) {
      setError(apiErrorMessage(e, t("releases.generateFailed")));
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  /** 上传资产（编辑态即时上传；成功后刷新资产列表） */
  const handleUploadAsset = async (file: File) => {
    if (!token || !release || uploading) return;
    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      await uploadReleaseAsset(owner, repo, release.id, file.name, data, token);
      toastSuccess(t("releases.uploaded"));
      const r = await fetchReleaseDetailSmart(owner, repo, tag!, token);
      setAssets(r.assets);
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.uploadFailed")));
    } finally {
      setUploading(false);
    }
  };

  /** 删除资产（编辑态；成功后刷新资产列表） */
  const handleDeleteAsset = async (assetId: number) => {
    if (!token || deletingAsset) return;
    setDeletingAsset(true);
    try {
      await deleteReleaseAsset(owner, repo, assetId, token);
      toastSuccess(t("releases.assetDeleted"));
      const r = await fetchReleaseDetailSmart(owner, repo, tag!, token);
      setAssets(r.assets);
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.assetDeleteFailed")));
    } finally {
      setDeletingAsset(false);
    }
  };

  /** 删除 release（编辑态；危险操作，确认后回列表） */
  const handleDeleteRelease = async () => {
    if (!token || !release || deleting) return;
    setDeleting(true);
    try {
      await deleteReleaseSmart(owner, repo, { nodeId: release.nodeId, id: release.id }, token);
      toastSuccess(t("releases.deleted"));
      navigate(`/${owner}/${repo}/releases`);
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.saveFailed")));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  /** 新建态：追加待上传文件 */
  const addPendingFiles = (list: FileList | File[]) =>
    setPendingFiles((prev) => [...prev, ...Array.from(list)]);
  /** 新建态：移除待上传文件 */
  const removePendingFile = (idx: number) =>
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  if (!token || !canWrite) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt title={isEdit ? t("releases.editTitle") : t("releases.newTitle")} />
      </div>
    );
  }

  if (loadFailed) throw loadFailed;

  if (loading) {
    return (
      <div className={PAGE_SHELL}>
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL}>
      <div className="mx-auto max-w-3xl">
        {/* 面包屑：返回 Releases 列表（官方左上角返回） */}
        <Button variant="ghost" asChild className="mb-3 -ml-3">
          <Link to={`/${owner}/${repo}/releases`}>
            <ArrowLeft className="size-4" />
            {t("releases.versions")}
          </Link>
        </Button>
        <h1 className="mb-4 text-2xl font-semibold">
          {isEdit ? t("releases.editTitle") : t("releases.newTitle")}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Choose a tag（必填） */}
          <div className="space-y-1.5">
            <Label htmlFor="release-tag" className="text-sm font-medium">
              {t("releases.tagName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="release-tag"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="v1.0.0"
              required
            />
          </div>

          {/* Target（仅新建：可选目标分支/提交） */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="release-target" className="text-sm font-medium">
                {t("releases.targetCommitish")}
              </Label>
              <Input
                id="release-target"
                value={targetCommitish}
                onChange={(e) => setTargetCommitish(e.target.value)}
                placeholder="main"
              />
            </div>
          )}

          {/* Release title（可选） */}
          <div className="space-y-1.5">
            <Label htmlFor="release-name" className="text-sm font-medium">
              {t("releases.name")}
            </Label>
            <Input
              id="release-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("releases.namePlaceholder")}
            />
          </div>

          {/* Release notes（Write/Preview + 自动生成） */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="release-body" className="text-sm font-medium">
                {t("releases.body")}
              </Label>
              {!isEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void generate()}
                  disabled={generating || !tagName.trim()}
                >
                  {generating ? t("common.loading") : t("releases.generateNotes")}
                </Button>
              )}
            </div>
            <MarkdownEditor
              id="release-body"
              key={`release-${isEdit ? tag : "new"}-${editorKey}`}
              owner={owner}
              repo={repo}
              defaultValue={body}
              placeholder={t("releases.bodyPlaceholder")}
              rows={12}
              onChange={setBody}
              onSubmit={() => void submit()}
            />
          </div>

          {/* 预发布 / 草稿 */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2">
              <Switch checked={prerelease} onCheckedChange={setPrerelease} />
              <span className="text-sm">{t("releases.prereleaseLabel")}</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={draft} onCheckedChange={setDraft} />
              <span className="text-sm">{t("releases.draftLabel")}</span>
            </label>
          </div>

          {/* 资产区（编辑态：管理现有资产；新建态：待上传文件列表） */}
          {isEdit ? (
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("releases.assets")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="size-3.5" />
                  {uploading ? t("common.loading") : t("releases.uploadAsset")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadAsset(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {assets.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {assets.map((a) => (
                    <li key={a.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatBytes(a.size)}
                      </span>
                      {a.id != null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => void handleDeleteAsset(a.id!)}
                          title={t("releases.deleteAsset")}
                          aria-label={t("releases.deleteAsset")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("releases.noAssets")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("releases.attachAssets")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {t("releases.uploadAsset")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addPendingFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {pendingFiles.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {pendingFiles.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatBytes(f.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removePendingFile(i)}
                        title={t("common.remove")}
                        aria-label={t("common.remove")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <InlineError message={error} size="sm" />}

          {/* 底部操作（编辑态：Cancel + 删除 + 保存；新建态：Cancel + 发布） */}
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" asChild>
              <Link to={`/${owner}/${repo}/releases`}>{t("common.cancel")}</Link>
            </Button>
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {t("releases.delete")}
              </Button>
            )}
            <Button type="submit" className="ml-auto" disabled={submitting || !tagName.trim()}>
              <Send className="size-3.5" />
              {submitting
                ? t("common.submitting")
                : isEdit
                  ? t("releases.save")
                  : t("releases.create")}
            </Button>
          </div>
        </form>

        {/* 删除 release 确认 */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("releases.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("releases.deleteDesc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => void handleDeleteRelease()}
                disabled={deleting}
              >
                {deleting ? t("common.loading") : t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
