/**
 * 单个 release 详情页（/:owner/:repo/releases/tag/:tag，官方 /releases/tag/:tag 复刻）
 *
 * 官方结构：版本名 + 徽标（Pre-release/Draft）→ 发布者头像 + login + released + 时间 →
 * 完整 release notes（Markdown）→ Assets 下载列表。
 * 数据源：fetchReleaseDetailSmart（GraphQL release(tagName) 首选 + REST getReleaseByTag 降级）。
 * 站内补全：feed release 卡片 → 跳转本页（替代原 github.com html_url 外链）。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Calendar, Download, Pencil, Tag, Trash2, Upload, Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { UserAvatar } from "@/components/UserAvatar";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import {
  fetchReleaseDetailSmart,
  deleteReleaseSmart,
  uploadReleaseAsset,
  deleteReleaseAsset,
  updateReleaseAsset,
} from "@/lib/api";
import { normalizeApiError, apiErrorMessage, type ApiError, type Release } from "@/lib/restapi";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { downloadReleaseAsset } from "@/lib/repo/release-proxy";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { formatBytes } from "@/lib/ui/format";

export default function ReleaseDetailPage() {
  const { owner = "", repo = "", tag = "" } = useParams();
  const { token, canWrite: canWriteToken } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  // 写操作门控：令牌级写 scope 且 仓库级写权限
  const canWrite = canWriteToken && canWriteRepo;
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 下载失败提示（匿名且代理不可用等）
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 编辑资产态
  const [editAsset, setEditAsset] = useState<Release["assets"][number] | null>(null);
  const [editAssetName, setEditAssetName] = useState("");
  const [editAssetLabel, setEditAssetLabel] = useState("");
  const [editAssetBusy, setEditAssetBusy] = useState(false);
  // 复制 SHA256 的资产名（copied 高亮态）
  const [copiedAsset, setCopiedAsset] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRelease(null);
    setError(null);
    fetchReleaseDetailSmart(owner, repo, tag, token)
      .then((r) => {
        if (!cancelled) setRelease(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, tag, token]);

  /** 下载资产：探针直连 → 原生下载；不可达按 RELEASE_PROXY_ENABLE 熔断代理 */
  const handleDownload = async (asset: { name: string; browser_download_url: string }) => {
    setDownloadError(null);
    try {
      await downloadReleaseAsset(
        owner,
        repo,
        release?.tag_name ?? "",
        asset.name,
        asset.browser_download_url,
        token,
      );
    } catch {
      setDownloadError(t("releases.downloadUnavailable"));
    }
  };

  /** 编辑保存成功后刷新详情 */
  const reload = async () => {
    const r = await fetchReleaseDetailSmart(owner, repo, release?.tag_name ?? tag, token);
    setRelease(r);
  };

  /** 删除 release（危险操作，确认后执行 → 回列表） */
  const handleDelete = async () => {
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

  /** 上传资产（REST-only；文件内容 arrayBuffer → uploadReleaseAsset） */
  const handleUpload = async (file: File) => {
    if (!token || !release || uploading) return;
    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      await uploadReleaseAsset(owner, repo, release.id, file.name, data, token);
      toastSuccess(t("releases.uploaded"));
      await reload();
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.uploadFailed")));
    } finally {
      setUploading(false);
    }
  };

  /** 删除资产（REST-only；asset_id 为数字 id） */
  const handleDeleteAsset = async (assetId: number) => {
    if (!token || !release) return;
    try {
      await deleteReleaseAsset(owner, repo, assetId, token);
      toastSuccess(t("releases.assetDeleted"));
      await reload();
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.assetDeleteFailed")));
    }
  };

  /** 保存资产编辑（REST-only；name/label 可选） */
  const handleSaveAsset = async () => {
    if (!token || !editAsset || editAsset.id == null || editAssetBusy || !editAssetName.trim())
      return;
    setEditAssetBusy(true);
    try {
      await updateReleaseAsset(
        owner,
        repo,
        editAsset.id,
        { name: editAssetName.trim(), label: editAssetLabel.trim() || undefined },
        token,
      );
      toastSuccess(t("releases.assetUpdated"));
      setEditAsset(null);
      await reload();
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.assetUpdateFailed")));
    } finally {
      setEditAssetBusy(false);
    }
  };

  /** 复制资产 SHA256（完整 digest，含 sha256: 前缀） */
  const copySha = async (name: string, digest: string) => {
    try {
      await navigator.clipboard.writeText(digest);
      setCopiedAsset(name);
      setTimeout(() => setCopiedAsset(null), 1500);
    } catch {
      /* ignore */
    }
  };

  if (error) throw error;
  if (release === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div>
      {/* 面包屑：返回 Releases 列表 */}
      <Link
        to={`/${owner}/${repo}/releases`}
        className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        ← {t("releases.versions")}
      </Link>

      {/* 版本名 + 徽标 + 操作按钮 */}
      <header className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{release.name ?? release.tag_name}</h1>
        {release.prerelease && (
          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300">
            {t("releases.prerelease")}
          </Badge>
        )}
        {release.draft && <Badge variant="secondary">{t("releases.draft")}</Badge>}
        {canWrite && (
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/${owner}/${repo}/releases/edit/${encodeURIComponent(tag)}`}>
                <Pencil className="size-3.5" />
                {t("releases.edit")}
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              {t("releases.delete")}
            </Button>
          </div>
        )}
      </header>

      {/* 发布者行：头像 + login + released + tag + 时间 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <UserAvatar src={release.author.avatar_url} alt={release.author.login} className="size-5" />
        <span className="font-medium text-foreground">{release.author.login}</span>
        <span>{t("releases.releasedThis")}</span>
        <span className="flex items-center gap-1">
          <Tag className="size-3.5" />
          {release.tag_name}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="size-3.5" />
          {fmt(release.published_at)}
        </span>
      </div>

      {/* Release notes（Markdown） */}
      {release.body && (
        <div className="mt-5 border-t border-border pt-4">
          <MarkdownView rawBase={repoRawBase(owner, repo)}>{release.body}</MarkdownView>
        </div>
      )}

      {/* Assets 下载/上传列表 */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("releases.assets")}</h2>
          {canWrite && (
            <>
              <Button
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
                  if (f) void handleUpload(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
        {downloadError && <p className="mb-2 text-xs text-destructive">{downloadError}</p>}
        {release.assets.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("releases.assetName")}</th>
                  <th className="px-3 py-2 font-medium">{t("releases.assetSha256")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("releases.assetSize")}</th>
                  {canWrite && <th className="w-20 px-3 py-2" aria-hidden="true" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {release.assets.map((a) => (
                  <tr key={a.name}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void handleDownload(a)}
                        className="flex items-center gap-1.5 text-left font-medium text-primary hover:underline"
                      >
                        <Download className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{a.name}</span>
                      </button>
                      {a.label && (
                        <span className="ml-6 block text-xs text-muted-foreground">{a.label}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {a.digest ? (
                        <div className="flex items-center gap-1.5">
                          <code
                            title={a.digest}
                            className="min-w-0 break-all font-mono text-xs text-muted-foreground"
                          >
                            {a.digest}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            onClick={() => void copySha(a.name, a.digest!)}
                            title={t("releases.copySha")}
                            aria-label={t("releases.copySha")}
                          >
                            {copiedAsset === a.name ? (
                              <Check className="size-3.5 text-chart-1" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {formatBytes(a.size)}
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {a.id != null && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-primary"
                                onClick={() => {
                                  setEditAsset(a);
                                  setEditAssetName(a.name);
                                  setEditAssetLabel(a.label ?? "");
                                }}
                                title={t("releases.editAsset")}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                onClick={() => void handleDeleteAsset(a.id!)}
                                title={t("releases.deleteAsset")}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 源码打包（GitHub 自动生成，两种格式；官方始终展示于 Assets 下方） */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <a
            href={`https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(tag)}.zip`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <Download className="size-3.5" />
            {t("releases.sourceZip")}
          </a>
          <a
            href={`https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <Download className="size-3.5" />
            {t("releases.sourceTar")}
          </a>
        </div>
      </div>

      {/* 编辑资产弹窗 */}
      <Dialog open={editAsset !== null} onOpenChange={(open) => !open && setEditAsset(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("releases.editAsset")}</DialogTitle>
            <DialogDescription>{t("releases.editAssetDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="asset-name">{t("releases.assetName")}</Label>
              <Input
                id="asset-name"
                value={editAssetName}
                onChange={(e) => setEditAssetName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-label">{t("releases.assetLabel")}</Label>
              <Input
                id="asset-label"
                value={editAssetLabel}
                onChange={(e) => setEditAssetLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={editAssetBusy || !editAssetName.trim()}
              onClick={() => void handleSaveAsset()}
            >
              {editAssetBusy ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
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
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
