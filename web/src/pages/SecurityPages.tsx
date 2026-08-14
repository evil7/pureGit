/**
 * 仓库 Security 页（阶段 D1；方案 B：仅 Security 核心）
 *
 * 官方 /security 结构：
 * - SECURITY.md 渲染区（仓库根 SECURITY.md，MarkdownView）
 * - 安全公告列表（Published advisories：标题 + GHSA id + published 日期 + severity 徽标）
 * 详情 /security/advisories/GHSA-{id}：
 * - H1 标题 + severity 徽标 + 发布者/日期
 * - 左列元数据（Package/Affected versions/Patched versions/CWEs）+ 右列 markdown（Description/Patches/Workarounds/References）
 *
 * 数据通道：REST only（GraphQL 无 security advisory 通道）；
 * Dependabot / Code scanning / Secret scanning tab 去杂项（scope 不可抗力）。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShieldAlert, Megaphone, Package, GitCommitHorizontal, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  apiErrorMessage,
  normalizeApiError,
  ApiError,
  fetchSecurityAdvisoriesSmart,
  fetchSecurityAdvisorySmart,
  fetchSecurityMdSmart,
} from "@/lib/api";
import PageLayout from "@/components/PageLayout";
import type { SecurityAdvisory, ReadmeInfo } from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { cn } from "@/lib/utils";

/** severity → 徽标配色（官方语义：critical/high 红、moderate 黄、low 灰）
 * 注意：REST API enum 是 medium，但 GitHub 官方 UI 显示 Moderate（不翻译）
 * 仅本文件使用（fast refresh：组件文件不导出非组件） */
function severityBadgeClass(sev: SecurityAdvisory["severity"]): string {
  switch (sev) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-red-500 text-white";
    case "medium":
      return "bg-amber-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** 列表页：SECURITY.md 渲染 + 公告列表 */
export default function SecurityPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [secMd, setSecMd] = useState<ReadmeInfo | null | undefined>(undefined);
  const [advisories, setAdvisories] = useState<SecurityAdvisory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 公告分页：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPage(1);
    // SECURITY.md：不存在 → null（不报错）
    fetchSecurityMdSmart(owner!, repo!, token)
      .then((md) => !cancelled && setSecMd(md))
      .catch(() => !cancelled && setSecMd(null));
    // 公告列表（published）
    fetchSecurityAdvisoriesSmart(owner!, repo!, token, 30, 1)
      .then((list) => {
        if (cancelled) return;
        setAdvisories(list);
        setHasMore(list.length >= 30);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorMessage(e, t("security.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  /** 加载更多：page 追加公告 */
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const next = await fetchSecurityAdvisoriesSmart(owner!, repo!, token, 30, nextPage);
      setAdvisories((prev) => [...(prev ?? []), ...next]);
      setHasMore(next.length >= 30);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* SECURITY.md 渲染区（官方无大标题；Edit 按钮在卡片右上） */}
      <section className="flex flex-col gap-3">
        {secMd && (
          <div className="flex justify-end">
            <Button variant="outline" asChild>
              {/* 官方：Fork this repository and edit the file → 仓库 blob 编辑路径 */}
              <Link to={`/${owner}/${repo}/edit/${"HEAD"}/SECURITY.md`}>
                {t("security.editPolicy")}
              </Link>
            </Button>
          </div>
        )}
        {secMd === undefined ? (
          <div className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : secMd ? (
          <div className="rounded-lg border bg-card">
            <div className="p-4">
              <MarkdownView rawBase={secMd.rawBase}>{secMd.content}</MarkdownView>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {t("security.noPolicy")}
          </p>
        )}
      </section>

      {/* 安全公告列表（Published advisories） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("security.advisories")}</h2>
          {advisories === null ? (
            /* 计数加载中：骨架条匹配 label 行高（h-4），防加载完成切换抖动 */
            <Skeleton className="mt-1 h-4 w-24" />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("security.advisoriesCount").replace("{count}", String(advisories.length))}
            </p>
          )}
        </div>
        {error ? (
          <InlineError message={error} className="py-6 text-center" />
        ) : advisories === null ? (
          <div className="flex flex-col divide-y rounded-lg border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : advisories.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {t("security.noAdvisories")}
          </p>
        ) : (
          <>
            <div className="flex flex-col divide-y rounded-lg border">
              {advisories.map((a) => (
                <Link
                  key={a.ghsa_id}
                  to={`/${owner}/${repo}/security/advisories/${a.ghsa_id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <Megaphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.summary}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {a.ghsa_id}
                      {a.published_at && (
                        <>
                          {" · "}
                          {t("security.published").replace("{time}", fmt(a.published_at))}
                          {a.publisher?.login ? ` by ${a.publisher.login}` : ""}
                        </>
                      )}
                    </p>
                  </div>
                  {a.severity && (
                    <Badge className={cn("shrink-0 text-xs", severityBadgeClass(a.severity))}>
                      {t(`security.severity.${a.severity}` as I18nKey)}
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
            {hasMore && (
              <div className="text-center">
                <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? t("common.loading") : t("home.showMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** 公告详情页（/security/advisories/GHSA-{id}） */
export function SecurityAdvisoryDetailPage() {
  const { owner, repo, ghsaId } = useParams<{
    owner: string;
    repo: string;
    ghsaId: string;
  }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [advisory, setAdvisory] = useState<SecurityAdvisory | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setAdvisory(null);
    setError(null);
    fetchSecurityAdvisorySmart(owner!, repo!, ghsaId!, token)
      .then((a) => mountedRef.current && setAdvisory(a))
      .catch((e: unknown) => {
        if (mountedRef.current) setError(normalizeApiError(e));
      });
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, ghsaId, token]);

  // 整页级致命错误（advisory 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !advisory) throw error ?? new ApiError(404);

  const firstVuln = advisory.vulnerabilities?.[0] ?? null;
  const cweList = advisory.cwes ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* 面包屑 + 标题 */}
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to={`/${owner}/${repo}/security`} className="hover:text-foreground">
            {t("security.title")}
          </Link>
          <span>/</span>
          <span>Advisories</span>
          <span>/</span>
          <span className="font-mono">{advisory.ghsa_id}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold">{advisory.summary}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {advisory.severity && (
            <Badge className={cn("text-xs", severityBadgeClass(advisory.severity))}>
              {t(`security.severity.${advisory.severity}` as I18nKey)}
            </Badge>
          )}
          <span>
            {advisory.publisher?.login ?? ""}
            {" published "}
            <span className="font-mono">{advisory.ghsa_id}</span>
            {advisory.published_at && <> {fmt(advisory.published_at)}</>}
          </span>
        </div>
      </div>

      <PageLayout
        gap="lg"
        left={{
          node: (
            <aside className="flex flex-col gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Package className="size-3.5" />
                  {t("security.advisory.package")}
                </p>
                <p className="mt-1 text-sm">
                  {firstVuln?.package?.name ?? t("security.advisory.noPackage")}
                </p>
              </div>
              {firstVuln?.vulnerable_version_range && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("security.advisory.affected")}
                  </p>
                  <p className="mt-1 font-mono text-sm">{firstVuln.vulnerable_version_range}</p>
                </div>
              )}
              {firstVuln?.patched_versions && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("security.advisory.patched")}
                  </p>
                  <p className="mt-1 font-mono text-sm">{firstVuln.patched_versions}</p>
                </div>
              )}
              {cweList.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">CWEs</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {cweList.map((c) => (
                      <Badge key={c.cwe_id} variant="outline" className="font-mono text-xs">
                        {c.cwe_id}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {advisory.cve_id && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">CVE</p>
                  <p className="mt-1 font-mono text-sm">{advisory.cve_id}</p>
                </div>
              )}
            </aside>
          ),
          width: 220,
          sticky: "nav",
        }}
      >
        {/* 右列：markdown 描述 */}
        <div className="min-w-0">
          {advisory.description ? (
            <div className="rounded-lg border bg-card">
              <div className="p-4">
                <MarkdownView>{advisory.description}</MarkdownView>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
              {t("security.advisory.noDescription")}
            </p>
          )}

          {/* 受影响仓库链接（官方 References 语义简化） */}
          <div className="mt-4 flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
            <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <Link to={`/${owner}/${repo}`} className="min-w-0 truncate font-medium hover:underline">
              {owner}/{repo}
            </Link>
          </div>

          {/* Credits（贡献者） */}
          {advisory.credits && advisory.credits.length > 0 && (
            <div className="mt-4 rounded-lg border bg-card px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t("security.advisory.credits")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {advisory.credits.map((c, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {c.login}
                    <span className="ml-1 font-normal text-muted-foreground">· {c.type}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* 官方外链 */}
          <div className="mt-4">
            <Button variant="outline" asChild>
              <a href={advisory.html_url} target="_blank" rel="noreferrer">
                <ShieldAlert className="size-3.5" />
                {t("security.advisory.viewOnGithub")}
              </a>
            </Button>
          </div>
        </div>
      </PageLayout>
    </div>
  );
}

/** 空态兜底：Security 数据不可用时（非 404）展示原因（如私有仓库无权限） */
export function SecurityUnavailable() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-4 py-10 text-center">
      <Info className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("security.unavailable")}</p>
    </div>
  );
}
