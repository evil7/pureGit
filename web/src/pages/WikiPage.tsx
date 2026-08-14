/**
 * Wiki 页面（用户决策：加 tab + 实现页面功能）
 *
 * 官方结构：左侧 Pages 列表（_Sidebar 解析）+ 右侧 markdown 内容。
 * 数据源：Worker /$wiki 代理（无官方 API，raw 通道被墙）。
 * 首页 Home（/wiki）+ 子页（/wiki/{page}，支持多级目录）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { ApiError, normalizeApiError } from "@/lib/restapi";
import { fetchWikiPage, parseWikiSidebar, type WikiPage } from "@/lib/repo/wiki";
import { useRepoData } from "@/lib/repo/repo-context";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export default function WikiPage() {
  const { owner = "", repo = "" } = useParams<{ owner: string; repo: string }>();
  // 通配符路由 wiki/*：page = 剩余路径（空 = 首页 Home）
  const wildcard = useParams()["*"] ?? "";
  const page = wildcard || "Home";
  const { t } = useI18n();
  // 仓库数据（RepoLayout 注入）：has_wiki=false → 未启用空态短路，不发请求（修复）
  const repoData = useRepoData();
  const wikiDisabled = repoData?.has_wiki === false;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [homeExists, setHomeExists] = useState(true);

  // 当前页面内容
  useEffect(() => {
    if (wikiDisabled) {
      setLoading(false);
      setContent(null);
      setPages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    const ctrl = new AbortController();
    fetchWikiPage(owner, repo, page, ctrl.signal)
      .then((md) => {
        if (cancelled) return;
        // 404（md=null）不是致命错误：Home 缺失走 disabled 空态、其他页走 pageNotFound，
        // 不再 throw 到全局错误页（修复：仓库未启用 wiki 时误报整页 404）
        setContent(md);
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError"))
          setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [owner, repo, page, wikiDisabled]);

  // 页面列表（_Sidebar）——首次加载一次；wiki 未启用短路
  useEffect(() => {
    if (wikiDisabled) {
      setPages([]);
      setHomeExists(false);
      return;
    }
    let cancelled = false;
    fetchWikiPage(owner, repo, "_Sidebar")
      .then((md) => {
        if (cancelled) return;
        setPages(md ? parseWikiSidebar(md) : []);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    // Home 是否存在（wiki 未启用时 404）
    fetchWikiPage(owner, repo, "Home")
      .then((md) => {
        if (!cancelled) setHomeExists(md !== null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, wikiDisabled]);

  // 整页级致命错误（仅真实网络/代理错误）→ 路由 errorElement 全局错误页
  if (error) throw error;

  return (
    <PageLayout
      gap="sm"
      left={{
        node: (
          <nav aria-label={t("wiki.pages")}>
            <h2 className="mb-2 text-sm font-semibold">{t("wiki.pages")}</h2>
            {pages.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">{t("wiki.noPages")}</p>
            ) : (
              <ul className="space-y-0.5">
                {pages.map((p) => (
                  <li key={p.name}>
                    <Link
                      to={`/${owner}/${repo}/wiki/${p.name}`}
                      className={cn(
                        "flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm transition-colors",
                        p.name === page
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">{p.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      {/* 右主区：页面内容 */}
      <div className="min-w-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : wikiDisabled || (!homeExists && page === "Home") ? (
          /* 未启用 wiki（has_wiki=false 或 Home 404）→ 官方空态 */
          <div className="space-y-4">
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("wiki.disabled")}
            </p>
          </div>
        ) : content !== null ? (
          <article className="">
            <MarkdownView rawBase={repoRawBase(owner, repo)}>{content}</MarkdownView>
          </article>
        ) : (
          /* 非 Home 页不存在 → 友好 404（不再整页报错） */
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("wiki.pageNotFound")}</p>
            <Link to={`/${owner}/${repo}/wiki`} className="text-sm text-primary hover:underline">
              {t("wiki.backToHome")}
            </Link>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
