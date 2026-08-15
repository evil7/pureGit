/**
 * Releases 列表
 * 官方两栏布局：左版本时间线（Stepper vertical，sticky）+ 右 release 卡片（Card）。
 * 版本号可点击：跳独立详情页 /releases/tag/:tag（官方同路径）。
 * Latest 绿徽标 + Pre-release 黄徽章 + Assets details 折叠。
 * 数据源：fetchReleasesSmart（GraphQL releases 首选 + REST 降级）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Tag, Calendar, Download, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchReleasesSmart } from "@/lib/api";
import { normalizeApiError, type ApiError } from "@/lib/restapi";
import { useI18n, tStatic } from "@/i18n";
import type { Release } from "@/lib/restapi";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import PageLayout from "@/components/PageLayout";

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
            <Stepper
              steps={releases.map((r) => ({ id: r.tag_name, title: r.tag_name }))}
              orientation="vertical"
              value={activeTag ?? undefined}
              onValueChange={(id) => scrollToRelease(id)}
            >
              <StepperNav className="w-full">
                {releases.map((r) => (
                  <StepperItem key={r.tag_name} stepId={r.tag_name} className="items-start">
                    <StepperTrigger className="w-full rounded-md text-left">
                      <StepperIndicator
                        variant="plain"
                        className="size-8 shrink-0 overflow-visible rounded-full bg-transparent"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full border bg-card text-muted-foreground ring-2 ring-background">
                          <Tag className="size-4" />
                        </span>
                      </StepperIndicator>
                      <div className="flex min-w-0 flex-col items-start text-left">
                        <StepperTitle className="truncate">{r.tag_name}</StepperTitle>
                        <StepperDescription className="truncate">
                          {fmt(r.published_at)}
                        </StepperDescription>
                      </div>
                    </StepperTrigger>
                  </StepperItem>
                ))}
              </StepperNav>
            </Stepper>
            {/* 加载更多（追加到左侧版本时间线） */}
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
      {/* 右主区：release 卡片列表 */}
      <div className="space-y-4">
        {releases.map((r) => (
          <Card key={r.tag_name} id={`release-${r.tag_name}`} className="scroll-mt-20">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/${owner}/${repo}/releases/tag/${encodeURIComponent(r.tag_name)}`}
                  className="hover:underline"
                >
                  {r.name ?? r.tag_name}
                </Link>
                {r.id === latestId && (
                  <Badge className="bg-green-600 text-white">{t("releases.latest")}</Badge>
                )}
                {r.prerelease && (
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300">
                    {t("releases.prerelease")}
                  </Badge>
                )}
                {r.draft && <Badge variant="secondary">{t("releases.draft")}</Badge>}
              </CardTitle>
              {/* 发布者行 */}
              <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5">
                  <UserAvatar src={r.author.avatar_url} alt={r.author.login} className="size-4" />
                  {r.author.login}
                </span>
                <span>{t("releases.releasedThis")}</span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  {fmt(r.published_at)}
                </span>
              </CardDescription>
            </CardHeader>

            {/* Release notes 完整显示 */}
            {r.body && (
              <CardContent>
                <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{r.body}</MarkdownView>
              </CardContent>
            )}

            {/* Assets 折叠（details 元素） */}
            {r.assets.length > 0 && (
              <CardFooter className="flex-col items-start gap-2">
                <details className="group w-full">
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
              </CardFooter>
            )}
          </Card>
        ))}
      </div>
    </PageLayout>
  );
}
