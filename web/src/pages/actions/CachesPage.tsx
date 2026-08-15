/**
 * Actions Caches 管理页（/:owner/:repo/actions/caches）
 *
 * 官方 GitHub「Caches」页：用量概览 + 缓存列表（key/ref/大小/最后访问）+ 删除。
 * 数据源：REST only（GraphQL 无 cache 端点）——fetchActionsCaches / fetchActionsCacheUsage /
 * deleteActionsCache。删除需仓库写权限（WriteGate）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { toastSuccess, toastError } from "@/lib/ui/toast";
import {
  fetchActionsCaches,
  fetchActionsCacheUsage,
  deleteActionsCache,
  apiErrorMessage,
  ApiError,
  normalizeApiError,
} from "@/lib/api";
import type { ActionsCache, ActionsCacheUsage } from "@/lib/restapi";

/** 字节 → 人类可读（KB/MB/GB；缓存通常 MB 级） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function CachesPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [caches, setCaches] = useState<ActionsCache[]>([]);
  const [usage, setUsage] = useState<ActionsCacheUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // 删除确认（记录待删缓存）
  const [deleting, setDeleting] = useState<ActionsCache | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchActionsCaches(owner, repo, token).catch(() => ({ total_count: 0, caches: [] })),
      fetchActionsCacheUsage(owner, repo, token),
    ])
      .then(([list, usageData]) => {
        if (cancelled) return;
        setCaches(list.caches);
        setUsage(usageData);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(normalizeApiError(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  const confirmDelete = async () => {
    if (!token || !deleting) return;
    setBusy(true);
    try {
      await deleteActionsCache(owner, repo, deleting.id, token);
      setCaches((prev) => prev.filter((c) => c.id !== deleting.id));
      toastSuccess(t("actions.caches.deleted"));
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorMessage(e, t("actions.caches.deleteFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (error) throw error;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("actions.mgmt.caches")}</h1>

      {/* 用量概览（官方：active caches size + count） */}
      {usage && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("actions.caches.usageSize")}</p>
            <p className="font-medium">{formatBytes(usage.active_caches_size_in_bytes)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("actions.caches.usageCount")}</p>
            <p className="font-medium">{usage.active_caches_count}</p>
          </div>
        </div>
      )}

      {caches.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("actions.caches.empty")}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {caches.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm" title={c.key}>
                  {c.key}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {c.ref}
                  </Badge>
                  <span>{formatBytes(c.size_in_bytes)}</span>
                  <span>
                    {t("actions.caches.lastAccessed")} {fmt(c.last_accessed_at)}
                  </span>
                </div>
              </div>
              <WriteGate>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive"
                  onClick={() => setDeleting(c)}
                  title={t("actions.caches.delete")}
                  aria-label={t("actions.caches.delete")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </WriteGate>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.caches.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("actions.caches.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
