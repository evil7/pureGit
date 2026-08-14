/**
 * Releases 列表（重写）
 * 官方两栏布局：左版本列表（sticky 滚动定位）+ 右 release 卡（完整 notes）。
 * 单页合并：去掉独立详情路由（官方无详情页，点击版本号滚动定位）。
 * Latest 绿徽标 + Pre-release 黄徽章 + Assets details 折叠。
 * 数据源：REST /releases（GraphQL 无 release 端点，octokit 自动额度跟踪）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Tag, Calendar, Download, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchReleasesSmart } from "@/lib/api";
import { normalizeApiError, type ApiError } from "@/lib/restapi";
import { useI18n, tStatic } from "@/i18n";
import type { Release } from "@/lib/restapi";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";

export default function ReleasesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // activeTag 用唯一 tag_name（⚠️ 勿用 id：GraphQL 降级时可能占位 -1 → 全部亮起）
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setHasMore(true);
    fetchReleasesSmart(owner!, repo!, token)
      .then((items) => {
        if (!cancelled) {
          setReleases(items);
          setHasMore(items.length >= 20);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  /** 加载更多：追加下一页并去重（按 tag_name） */
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchReleasesSmart(owner!, repo!, token, page + 1);
      setReleases((prev) => {
        const seen = new Set(prev.map((r) => r.tag_name));
        return [...prev, ...next.filter((r) => !seen.has(r.tag_name))];
      });
      setPage((p) => p + 1);
      setHasMore(next.length >= 20);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        left={{
          node: (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（404/限流/5xx）→ 路由 errorElement 全局错误页
  if (error) throw error;

  if (releases.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.releases")}</p>;
  }

  // 最新非草稿 release 标 Latest（官方语义）
  const latestId = releases.find((r) => !r.draft)?.id ?? null;

  const scrollToRelease = (tag: string) => {
    setActiveTag(tag);
    document
      .getElementById(`release-${tag}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <PageLayout
      gap="sm"
      left={{
        node: (
          <nav aria-label={t("releases.versions")}>
            <ul className="space-y-0.5">
              {releases.map((r) => (
                <li key={r.tag_name}>
                  <button
                    type="button"
                    onClick={() => scrollToRelease(r.tag_name)}
                    className={cn(
                      "block w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors",
                      activeTag === r.tag_name
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {r.tag_name}
                  </button>
                </li>
              ))}
            </ul>
            {/* 加载更多（追加到左侧版本列表） */}
            {hasMore && (
              <Button
                variant="link"
                className="mt-2 h-auto px-2 text-xs text-primary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t("common.loading") : tStatic("home.showMore")}
              </Button>
            )}
          </nav>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      {/* 右主区：release 卡列表 */}
      <div className="space-y-6">
        {releases.map((r) => (
          <section
            key={r.tag_name}
            id={`release-${r.tag_name}`}
            className="scroll-mt-20 border-b border-border pb-6 last:border-b-0"
          >
            {/* 版本号 + 徽标 */}
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">{r.name ?? r.tag_name}</h3>
              {r.id === latestId && <Badge className="bg-green-600 text-white">Latest</Badge>}
              {r.prerelease && (
                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300">
                  Pre-release
                </Badge>
              )}
              {r.draft && <Badge variant="secondary">Draft</Badge>}
            </header>

            {/* 发布者行 */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {r.author.login} {t("releases.releasedThis")}
              </span>
              <span className="flex items-center gap-1">
                <Tag className="size-3.5" />
                {r.tag_name}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" />
                {fmt(r.published_at)}
              </span>
            </div>

            {/* Release notes 完整显示 */}
            {r.body && (
              <div className="pt-3">
                <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{r.body}</MarkdownView>
              </div>
            )}

            {/* Assets 折叠（details 元素） */}
            {r.assets.length > 0 && (
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  {t("releases.assets")} {r.assets.length}
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.assets.map((a) => (
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
              </details>
            )}
          </section>
        ))}
      </div>
    </PageLayout>
  );
}
