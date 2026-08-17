/**
 * Actions 用量指标页（/:owner/:repo/actions/metrics/usage）
 *
 * 官方该页核心是「运行分钟数（按 OS）+ 存储账单」，但仓库级公开 API 无此类数据
 * （仅有组织/企业级 billing API）；本页以「缓存用量」真实数据
 * （getActionsCacheUsage，anyone with read access）替代，其余完整用量指标
 * 外链官方并标注「仅官方」，不捏造分钟数/账单数据。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchActionsCacheUsage } from "@/lib/restapi";
import type { ActionsCacheUsage } from "@/lib/restapi";
import InsightsShell from "@/pages/insights/InsightsShell";

/** 字节 → 人类可读（缓存通常 MB 级） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ActionsUsagePage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [usage, setUsage] = useState<ActionsCacheUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    // 无权限/请求失败时内部降级为 null（fetchActionsCacheUsage catch → null）
    fetchActionsCacheUsage(owner, repo, token).then((d) => {
      if (!cancelled) {
        setUsage(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  return (
    <InsightsShell title={t("actions.usage.title")} desc={t("actions.usage.desc")}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* 缓存用量（真实数据；无权限时显示占位符） */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{t("actions.caches.usageSize")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {usage ? formatBytes(usage.active_caches_size_in_bytes) : "—"}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{t("actions.caches.usageCount")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {usage ? usage.active_caches_count : "—"}
              </p>
            </div>
          </section>

          {/* 完整用量指标 → 官方（无仓库级公开 API） */}
          <section className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t("actions.usage.officialNote")}</p>
            <a
              href={`https://github.com/${owner}/${repo}/actions/metrics/usage`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              {t("actions.usage.viewOfficial")}
              <ExternalLink className="size-3.5" />
            </a>
          </section>
        </div>
      )}
    </InsightsShell>
  );
}
