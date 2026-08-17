/**
 * 仓库 Forks 列表页（官方 github.com/:owner/:repo/forks）
 *
 * 官方结构：H1 标题「Forks」→ fork 仓库卡片列表（owner 头像 + 仓库名 + 描述 + 语言 + stars）
 * → 加载更多。数据源：fetchForksSmart（GraphQL forks 连接首选 + REST 降级）。
 * 公开仓库匿名可读；私有仓库需 token。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Star } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { fetchForksSmart, apiErrorMessage } from "@/lib/api";
import type { RepoFork } from "@/lib/restapi";
import InsightsShell from "@/pages/insights/InsightsShell";

/** 语言色点（无 palette 映射，统一 primary 色） */
const LANG_COLORS: Record<string, string> = {};

export default function ForksPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [forks, setForks] = useState<RepoFork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setForks(null);
    setError(null);
    setCursor(null);
    setHasNextPage(false);
    fetchForksSmart(owner, repo, token)
      .then((p) => {
        if (cancelled) return;
        setForks(p.forks);
        setCursor(p.endCursor);
        setHasNextPage(p.hasNextPage);
      })
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("forks.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = await fetchForksSmart(owner, repo, token, cursor);
      setForks((prev) => [...(prev ?? []), ...p.forks]);
      setCursor(p.endCursor);
      setHasNextPage(p.hasNextPage);
    } catch (e) {
      setError(apiErrorMessage(e, t("forks.loadFailed")));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <InsightsShell title={t("forks.title")} desc={t("forks.desc")}>
      {error ? (
        <InlineError message={error} />
      ) : forks === null ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : forks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("forks.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {forks.map((f) => (
            <li key={f.full_name} className="rounded-lg border bg-card p-4">
              <Link
                to={`/${f.owner.login}/${f.name}`}
                className="flex items-center gap-3 transition-colors hover:opacity-80"
              >
                <UserAvatar src={f.owner.avatar_url} alt={f.owner.login} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span className="text-muted-foreground">{f.owner.login} / </span>
                    {f.name}
                  </p>
                  {f.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{f.description}</p>
                  )}
                </div>
              </Link>
              {(f.language || f.stargazers_count > 0) && (
                <div className="mt-2 flex items-center gap-4 pl-11 text-xs text-muted-foreground">
                  {f.language && (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: LANG_COLORS[f.language] ?? "var(--primary)" }}
                      />
                      {f.language}
                    </span>
                  )}
                  {f.stargazers_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Star className="size-3.5" />
                      {f.stargazers_count}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t("common.loading") : t("forks.loadMore")}
          </Button>
        </div>
      )}
    </InsightsShell>
  );
}
