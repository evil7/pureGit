/**
 * 单个 release 详情页（/:owner/:repo/releases/tag/:tag，官方 /releases/tag/:tag 复刻）
 *
 * 官方结构：版本名 + 徽标（Pre-release/Draft）→ 发布者头像 + login + released + 时间 →
 * 完整 release notes（Markdown）→ Assets 下载列表。
 * 数据源：fetchReleaseDetailSmart（GraphQL release(tagName) 首选 + REST getReleaseByTag 降级）。
 * 站内补全：feed release 卡片 → 跳转本页（替代原 github.com html_url 外链）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Calendar, Download, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import { fetchReleaseDetailSmart } from "@/lib/api";
import { normalizeApiError, type ApiError, type Release } from "@/lib/restapi";
import { repoRawBase } from "@/lib/repo/repo-raw";

export default function ReleaseDetailPage() {
  const { owner = "", repo = "", tag = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

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

      {/* 版本名 + 徽标 */}
      <header className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{release.name ?? release.tag_name}</h1>
        {release.prerelease && (
          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300">
            {t("releases.prerelease")}
          </Badge>
        )}
        {release.draft && <Badge variant="secondary">{t("releases.draft")}</Badge>}
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

      {/* Assets 下载列表 */}
      {release.assets.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">{t("releases.assets")}</h2>
          <div className="flex flex-wrap gap-2">
            {release.assets.map((a) => (
              <Button key={a.name} variant="outline" asChild>
                <a href={a.browser_download_url} target="_blank" rel="noreferrer">
                  <Download className="size-3.5" />
                  {a.name}
                  <span className="text-xs text-muted-foreground">
                    ({(a.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </a>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
