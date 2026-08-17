/**
 * Releases 列表
 * 官方两栏布局：左版本时间线（Stepper vertical，sticky）+ 右 release 卡片（Card）。
 * 版本号可点击：跳独立详情页 /releases/tag/:tag（官方同路径）。
 * Latest 绿徽标 + Pre-release 黄徽章 + Assets details 折叠。
 * 数据源：fetchReleasesSmart（GraphQL releases 首选 + REST 降级）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Tag,
  Calendar,
  Download,
  ChevronDown,
  Plus,
  Check,
  Copy,
  Pencil,
  ArrowLeft,
  Trash2,
} from "lucide-react";
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
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  fetchReleasesSmart,
  fetchReleasesCountSmart,
  fetchDraftReleasesSmart,
  deleteReleaseSmart,
} from "@/lib/api";
import { normalizeApiError, apiErrorMessage, type ApiError } from "@/lib/restapi";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { useI18n } from "@/i18n";
import type { Release } from "@/lib/restapi";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { downloadReleaseAsset } from "@/lib/repo/release-proxy";
import PageLayout from "@/components/PageLayout";
import { ReleasesTabs } from "@/components/ReleasesTabs";
import { formatBytes } from "@/lib/ui/format";
import { Pager } from "@/components/Pager";

/** release 列表 key：数字 id 为 GitHub release 全局唯一标识（REST id 与 GraphQL databaseId 同源）。
 *  相较 tag_name，id 天然唯一——draft 与 published 可能出现同名 tag，但 id 永不重复。
 *  GraphQL databaseId 缺失时 toRelease 占位 -1 → 兜底用 tag_name 保证 key 唯一。 */
function releaseKey(r: Release): string {
  return r.id > 0 ? `rel-${r.id}` : `rel-tag-${r.tag_name}`;
}

export default function ReleasesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token, canWrite: canWriteToken } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  // 写操作门控：令牌级写 scope 且 仓库级写权限
  const canWrite = canWriteToken && canWriteRepo;
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  // activeTag 用唯一 tag_name（⚠️ 勿用 id：GraphQL 降级时可能占位 -1 → 全部亮起）
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // 分页（官方：每页 20 条 + 分页器；替换式加载，杜绝「加载更多」无限追加累积导致数据爆炸）
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  // 视图切换（published 列表 / drafts 草稿管理）
  const [view, setView] = useState<"published" | "drafts">("published");
  const [drafts, setDrafts] = useState<Release[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReleasesSmart(owner!, repo!, token, page)
      .then((items) => {
        if (!cancelled) setReleases(items);
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
  }, [owner, repo, token, page]);

  // 总数（分页器页码；失败静默保持 0 → Pager 隐藏）
  useEffect(() => {
    let cancelled = false;
    fetchReleasesCountSmart(owner!, repo!, token)
      .then((c) => !cancelled && setTotalCount(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  // 草稿列表（仅写权限可见；draft 通常极少，全量拉取不分页）
  useEffect(() => {
    if (!canWrite) {
      setDrafts([]);
      return;
    }
    let cancelled = false;
    fetchDraftReleasesSmart(owner!, repo!, token)
      .then((d) => !cancelled && setDrafts(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, canWrite]);

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        left={{
          node: (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ),
          width: 280,
          sticky: "tool",
        }}
      >
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（404/限流/5xx）→ 路由 errorElement 全局错误页
  if (error) throw error;

  /** 删除 release 后刷新（列表 + 总数 + 草稿同步） */
  const refreshAfterDelete = () => {
    setLoading(true);
    fetchReleasesSmart(owner!, repo!, token, page)
      .then(setReleases)
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchReleasesCountSmart(owner!, repo!, token)
      .then(setTotalCount)
      .catch(() => {});
    if (canWrite) {
      fetchDraftReleasesSmart(owner!, repo!, token)
        .then(setDrafts)
        .catch(() => {});
    }
  };

  // 顶部行：tabs 左 + 草稿切换/发布新版本 右（同一行；草稿视图切换按钮即「返回列表」）
  const headerRow = (
    <div className="flex items-center justify-between">
      <ReleasesTabs active="releases" />
      <div className="flex items-center gap-2">
        {canWrite && (
          <Button
            variant={view === "drafts" ? "secondary" : "outline"}
            size="sm"
            onClick={() => setView(view === "drafts" ? "published" : "drafts")}
          >
            {view === "drafts" ? (
              <>
                <ArrowLeft className="size-4" />
                {t("releases.backToList")}
              </>
            ) : (
              t("releases.drafts")
            )}
          </Button>
        )}
        {view === "published" && (
          <Button asChild>
            <Link to={`/${owner}/${repo}/releases/new`}>
              <Plus className="size-4" />
              {t("releases.new")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );

  // 草稿视图：复用 ReleaseCard（返回列表已并入 headerRow 的切换按钮）
  const draftSection =
    drafts.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("releases.noDrafts")}</p>
    ) : (
      <div className="space-y-4">
        {drafts.map((d) => (
          <ReleaseCard
            key={releaseKey(d)}
            release={d}
            owner={owner!}
            repo={repo!}
            isDraft
            canWrite={canWrite}
            onDeleted={refreshAfterDelete}
          />
        ))}
      </div>
    );

  if (releases.length === 0) {
    return (
      <div className="space-y-4">
        {headerRow}
        {view === "drafts" ? (
          draftSection
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.releases")}</p>
        )}
      </div>
    );
  }

  // 最新非草稿 release 标 Latest（列表已过滤 draft，第一个即 latest）
  const latestTag = releases[0]?.tag_name ?? null;

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
          </nav>
        ),
        width: 280,
        sticky: "tool",
      }}
    >
      {/* 右主区：header 行 + release 卡片列表 */}
      <div className="space-y-4">
        {headerRow}
        {view === "drafts" ? (
          draftSection
        ) : (
          <>
            {releases.map((r) => (
              <ReleaseCard
                key={releaseKey(r)}
                release={r}
                owner={owner!}
                repo={repo!}
                isLatest={r.tag_name === latestTag}
                scrollId={`release-${r.tag_name}`}
                canWrite={canWrite}
                onDeleted={refreshAfterDelete}
              />
            ))}

            {/* 分页器（官方：每页固定 + Previous/Next；替换式加载，不累积） */}
            <Pager
              page={page}
              totalPages={Math.max(1, Math.ceil(totalCount / 20))}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </PageLayout>
  );
}

/** Release 卡片（published + 草稿共用）
 *  需求 2：草稿复用同一卡片样式，「草稿」徽标放「最新」位置，标题右侧提供编辑按钮。
 *  需求 4：源码打包链接与「[v] 资产 {n}」summary 同一行最右侧。
 */
function ReleaseCard({
  release,
  owner,
  repo,
  isDraft = false,
  isLatest = false,
  scrollId,
  canWrite = false,
  onDeleted,
}: {
  release: Release;
  owner: string;
  repo: string;
  isDraft?: boolean;
  isLatest?: boolean;
  /** 左侧 Stepper 滚动锚点（published 用） */
  scrollId?: string;
  /** 写权限门控（编辑/删除按钮显隐） */
  canWrite?: boolean;
  /** 删除成功后回调（刷新列表） */
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const { token } = useAuth();
  const [copiedAsset, setCopiedAsset] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const detailHref = release.tag_name
    ? `/${owner}/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}`
    : null;

  /** 删除 release（危险操作，确认后回调父组件刷新） */
  const handleDelete = async () => {
    if (!token || deleting) return;
    setDeleting(true);
    try {
      await deleteReleaseSmart(owner, repo, { nodeId: release.nodeId, id: release.id }, token);
      toastSuccess(t("releases.deleted"));
      onDeleted?.();
    } catch (e) {
      toastError(apiErrorMessage(e, t("releases.saveFailed")));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  /** 复制资产 SHA256（完整 digest，含 sha256: 前缀，与官方一致） */
  const copySha = async (name: string, digest: string) => {
    try {
      await navigator.clipboard.writeText(digest);
      setCopiedAsset(name);
      setTimeout(() => setCopiedAsset(null), 1500);
    } catch {
      /* ignore */
    }
  };

  /** 下载资产：探针直连 → 原生下载；不可达按 RELEASE_PROXY_ENABLE 熔断代理 */
  const handleDownload = async (asset: { name: string; browser_download_url: string }) => {
    setDownloadError(null);
    try {
      await downloadReleaseAsset(
        owner,
        repo,
        release.tag_name,
        asset.name,
        asset.browser_download_url,
        token,
      );
    } catch {
      setDownloadError(t("releases.downloadUnavailable"));
    }
  };

  return (
    <Card id={scrollId} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {detailHref ? (
            <Link to={detailHref} className="hover:underline">
              {release.name ?? release.tag_name}
            </Link>
          ) : (
            <span>{release.name ?? t("releases.draft")}</span>
          )}
          {isDraft ? (
            <Badge variant="secondary">{t("releases.draft")}</Badge>
          ) : (
            isLatest && <Badge className="bg-green-600 text-white">{t("releases.latest")}</Badge>
          )}
          {release.prerelease && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300">
              {t("releases.prerelease")}
            </Badge>
          )}
          {/* 编辑/删除按钮：published + 草稿均支持（canWrite），标题最右侧 */}
          {canWrite && (
            <div className="ml-auto flex items-center gap-1.5">
              {detailHref ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={`/${owner}/${repo}/releases/edit/${encodeURIComponent(release.tag_name)}`}
                  >
                    <Pencil className="size-3.5" />
                    {t("common.edit")}
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`https://github.com/${owner}/${repo}/releases/edit/${release.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("releases.editInOfficial")}
                  </a>
                </Button>
              )}
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
        </CardTitle>
        {/* 发布者行：草稿无 published_at，改显示 tag（如有） */}
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <UserAvatar
              src={release.author.avatar_url}
              alt={release.author.login}
              className="size-4"
            />
            {release.author.login}
          </span>
          {!isDraft ? (
            <>
              <span>{t("releases.releasedThis")}</span>
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" />
                {fmt(release.published_at)}
              </span>
            </>
          ) : (
            release.tag_name && (
              <span className="flex items-center gap-1">
                <Tag className="size-3.5" />
                {release.tag_name}
              </span>
            )
          )}
        </CardDescription>
      </CardHeader>

      {/* Release notes 完整显示（草稿同样展示） */}
      {release.body && (
        <CardContent>
          <MarkdownView rawBase={repoRawBase(owner, repo)}>{release.body}</MarkdownView>
        </CardContent>
      )}

      {/* Assets 折叠 + 源码打包：仅 tag 存在时（无 tag 草稿无源码可打包） */}
      {release.tag_name && (
        <CardFooter className="flex-col items-start gap-2">
          <details className="group w-full">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              <span className="shrink-0">
                {t("releases.assets")} {release.assets.length}
              </span>
              {/* 源码打包（GitHub 自动生成，两种格式；与 summary 同一行最右侧） */}
              <span className="ml-auto flex shrink-0 items-center gap-x-4">
                <a
                  href={`https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(release.tag_name)}.zip`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Download className="size-3.5" />
                  {t("releases.sourceZip")}
                </a>
                <a
                  href={`https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(release.tag_name)}.tar.gz`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Download className="size-3.5" />
                  {t("releases.sourceTar")}
                </a>
              </span>
            </summary>
            {/* 资产表：自适应宽度 + 名称/SHA256/大小三列 */}
            {release.assets.length > 0 && (
              <div className="mt-2 w-full overflow-x-auto rounded-md border">
                {downloadError && (
                  <p className="border-b px-3 py-2 text-xs text-destructive">{downloadError}</p>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("releases.assetName")}</th>
                      <th className="px-3 py-2 font-medium">{t("releases.assetSha256")}</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t("releases.assetSize")}
                      </th>
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
                            <span className="ml-6 block text-xs text-muted-foreground">
                              {a.label}
                            </span>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </CardFooter>
      )}

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
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
