/**
 * 仓库 Stargazers / Watchers 列表页（官方 /stargazers 与 /watchers 复刻）
 *
 * 官方结构：H1 标题 → 用户列表（头像 + 登录名 + 姓名）→ 加载更多。
 * 数据源：fetchStargazersSmart / fetchWatchersSmart（GraphQL 连接首选 + REST 降级）。
 * 公开仓库匿名可读；私有仓库需 token。两页共用 RepoUserList，仅标题/空态文案/数据源不同。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { fetchStargazersSmart, fetchWatchersSmart, apiErrorMessage } from "@/lib/api";
import type { GitHubUser } from "@/lib/restapi";

type UserListKind = "stargazers" | "watchers";

/** 页面配置（标题/空态 i18n 键） */
const KIND_CONFIG: Record<UserListKind, { title: I18nKey; empty: I18nKey }> = {
  stargazers: { title: "stargazers.title", empty: "stargazers.empty" },
  watchers: { title: "watchers.title", empty: "watchers.empty" },
};

function RepoUserList({ kind }: { kind: UserListKind }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<GitHubUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = (after?: string) =>
    kind === "stargazers"
      ? fetchStargazersSmart(owner, repo, token, after)
      : fetchWatchersSmart(owner, repo, token, after);

  useEffect(() => {
    let cancelled = false;
    setUsers(null);
    setError(null);
    setCursor(null);
    setHasNextPage(false);
    fetchPage(undefined)
      .then((p) => {
        if (cancelled) return;
        setUsers(p.users);
        setCursor(p.endCursor);
        setHasNextPage(p.hasNextPage);
      })
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("stargazers.loadFailed"))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token, kind]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = await fetchPage(cursor);
      setUsers((prev) => [...(prev ?? []), ...p.users]);
      setCursor(p.endCursor);
      setHasNextPage(p.hasNextPage);
    } catch (e) {
      setError(apiErrorMessage(e, t("stargazers.loadFailed")));
    } finally {
      setLoadingMore(false);
    }
  };

  if (error) return <InlineError message={error} />;

  const cfg = KIND_CONFIG[kind];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t(cfg.title)}</h1>

      {users === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t(cfg.empty)}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {users.map((u) => (
            <li key={u.login}>
              <Link
                to={`/${u.login}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <UserAvatar src={u.avatar_url} alt={u.login} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.login}</p>
                  {u.name && <p className="truncate text-xs text-muted-foreground">{u.name}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t("common.loading") : t("stargazers.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function StargazersPage() {
  return <RepoUserList kind="stargazers" />;
}

export function WatchersPage() {
  return <RepoUserList kind="watchers" />;
}
