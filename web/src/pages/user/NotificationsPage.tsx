/**
 * 通知中心（/notifications）
 *
 * topbar「通知」入口（需登录）。数据源 GET /notifications + GET /user/repository_invitations；
 * 左栏 Folders（Inbox/Done）+ Filters（assign/participating/mention）由 URL ?query= 驱动，
 * 前端按 reason 过滤（REST /notifications 无 reason 过滤参数）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, Calendar, Check, CheckCheck, Inbox, BellOff, UserPlus, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InlineError } from "@/components/InlineError";
import { ThrowError } from "@/components/ErrorPages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WriteGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n, tStatic } from "@/i18n";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markRepoNotificationsAsRead,
  markNotificationThreadRead,
  markThreadAsDone,
  deleteThreadSubscription,
  fetchRepoInvitations,
  acceptRepoInvitation,
  declineRepoInvitation,
  apiErrorMessage,
  normalizeApiError,
  ApiError,
  type Notification,
  type RepositoryInvitation,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { cn } from "@/lib/utils";
import { LoadingList } from "./shared";

export default function NotificationsPage() {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  // 左栏 Folders/Filters 由 URL query 驱动（官方 ?query= 风格，可分享；导航用 Link 的 to 参数）
  const [searchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // 协作邀请（通知联动）
  const [invites, setInvites] = useState<RepositoryInvitation[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // 通知已读（需 notifications scope；无权限时静默失败并提示）
  const [marking, setMarking] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  // 标记 done / 退订（需 notifications scope）
  const [actingId, setActingId] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  // 按仓库标记已读（需 notifications scope）
  const [markingRepo, setMarkingRepo] = useState<string | null>(null);
  // 加载更多：page 追加（REST 无总数，按「批次是否拉满」判断 hasMore）
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setPage(1);
    setHasMore(true);
    fetchNotifications(token, 20)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setHasMore(list.length >= 20);
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    // 协作邀请（repo scope 可读；404/403 静默忽略——无权限或已过期）
    fetchRepoInvitations(token, 20)
      .then((list) => !cancelled && setInvites(list))
      .catch(() => !cancelled && setInvites([]));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** 加载更多：追加下一页并去重 */
  const loadMore = async () => {
    if (!token || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotifications(token, 20, page + 1);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id));
        return [...(prev ?? []), ...next.filter((n) => !seen.has(n.id))];
      });
      setPage((p) => p + 1);
      setHasMore(next.length >= 20);
    } catch {
      /* 失败保持原列表 */
    } finally {
      setLoadingMore(false);
    }
  };

  // 全部标记已读（PUT /notifications，需 notifications scope）
  const markAll = async () => {
    if (!token || marking) return;
    setMarking(true);
    setMarkError(null);
    try {
      await markAllNotificationsRead(token);
      setItems((prev) => prev?.map((n) => ({ ...n, unread: false })) ?? null);
    } catch (e) {
      setMarkError(apiErrorMessage(e, t("notifications.markFailed")));
    } finally {
      setMarking(false);
    }
  };

  // 单条线程标记已读（PATCH /notifications/threads/{id}，需 notifications scope）
  const markOne = async (n: Notification) => {
    if (!token || markingId !== null) return;
    setMarkingId(n.id);
    setMarkError(null);
    try {
      await markNotificationThreadRead(n.id, token);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, unread: false } : x)) ?? null);
    } catch (e) {
      setMarkError(apiErrorMessage(e, t("notifications.markFailed")));
    } finally {
      setMarkingId(null);
    }
  };

  // 按仓库标记已读（PUT /repos/{owner}/{repo}/notifications；需 notifications scope）
  const markRepoRead = async (fullName: string) => {
    if (!token || markingRepo !== null) return;
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) return;
    setMarkingRepo(fullName);
    setMarkError(null);
    try {
      await markRepoNotificationsAsRead(owner, repo, token);
      setItems(
        (prev) =>
          prev?.map((n) => (n.repository.full_name === fullName ? { ...n, unread: false } : n)) ??
          null,
      );
    } catch (e) {
      setMarkError(apiErrorMessage(e, t("notifications.markRepoReadFailed")));
    } finally {
      setMarkingRepo(null);
    }
  };

  // 标记 done（DELETE /notifications/threads/{id}；从列表移除）
  const doneOne = async (n: Notification) => {
    if (!token || actingId !== null) return;
    setActingId(n.id);
    setActError(null);
    try {
      await markThreadAsDone(n.id, token);
      setItems((prev) => prev?.filter((x) => x.id !== n.id) ?? null);
    } catch (e) {
      setActError(apiErrorMessage(e, t("notifications.doneFailed")));
    } finally {
      setActingId(null);
    }
  };

  // 退订（DELETE /notifications/threads/{id}/subscription；从列表移除）
  const unsubscribeOne = async (n: Notification) => {
    if (!token || actingId !== null) return;
    setActingId(n.id);
    setActError(null);
    try {
      await deleteThreadSubscription(n.id, token);
      setItems((prev) => prev?.filter((x) => x.id !== n.id) ?? null);
    } catch (e) {
      setActError(apiErrorMessage(e, t("notifications.unsubscribeFailed")));
    } finally {
      setActingId(null);
    }
  };

  const actOnInvite = async (inv: RepositoryInvitation, accept: boolean) => {
    if (!token || busyId !== null) return;
    setBusyId(inv.id);
    setInviteError(null);
    try {
      if (accept) {
        await acceptRepoInvitation(inv.id, token);
      } else {
        await declineRepoInvitation(inv.id, token);
      }
      setInvites((prev) => prev?.filter((i) => i.id !== inv.id) ?? null);
    } catch (e) {
      setInviteError(
        apiErrorMessage(e, accept ? t("invite.acceptFailed") : t("invite.declineFailed")),
      );
    } finally {
      setBusyId(null);
    }
  };

  const permissionLabel: Record<string, string> = {
    read: t("invite.permission.read"),
    write: t("invite.permission.write"),
    admin: t("invite.permission.admin"),
  };

  const reasonLabel: Record<string, string> = {
    mention: t("notifications.reason.mention"),
    author: t("notifications.reason.author"),
    comment: t("notifications.reason.comment"),
    review_requested: t("notifications.reason.review_requested"),
    assign: t("notifications.reason.assign"),
    state_change: t("notifications.reason.state_change"),
    security_alert: t("notifications.reason.security_alert"),
    participating: t("notifications.reason.participating"),
  };

  /** 左栏 Folders/Filters 前端过滤（REST /notifications 无 reason 过滤参数，故前端按 reason 过滤已加载批次） */
  const filteredItems = useMemo(() => {
    if (!items) return null;
    if (query === "is:done") return items.filter((n) => !n.unread);
    if (query === "reason:assign") return items.filter((n) => n.reason === "assign");
    if (query === "reason:mention") return items.filter((n) => n.reason === "mention");
    if (query === "reason:participating") return items.filter((n) => n.reason !== "security_alert");
    return items; // Inbox（query 空）= 全部
  }, [items, query]);

  /** 按仓库分组（保持首次出现顺序；每组标题旁提供「该仓库全部已读」） */
  const groupedItems = useMemo(() => {
    if (!filteredItems) return null;
    const order: string[] = [];
    const map = new Map<string, Notification[]>();
    for (const n of filteredItems) {
      const key = n.repository.full_name;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(n);
    }
    return order.map((fullName) => ({ fullName, items: map.get(fullName)! }));
  }, [filteredItems]);

  return (
    /* 官方 C 型：左 Folders/Filters 导航 + 右通知列表（单栏→两栏对齐） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={{
          node: (
            <nav className="rounded-lg border bg-card p-2">
              <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("notifications.folders")}
              </h3>
              <ul className="space-y-0.5">
                <li>
                  <Link
                    to="/notifications"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      query === ""
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Inbox className="size-4 shrink-0" />
                    {t("notifications.inbox")}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/notifications?query=is%3Adone"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      query === "is:done"
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Check className="size-4 shrink-0" />
                    {t("notifications.done")}
                  </Link>
                </li>
              </ul>
              <h3 className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("notifications.filters")}
              </h3>
              <ul className="space-y-0.5">
                {(["assign", "participating", "mention"] as const).map((r) => (
                  <li key={r}>
                    <Link
                      to={`/notifications?query=reason%3A${r}`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        query === `reason:${r}`
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <span className="size-4 shrink-0" />
                      {reasonLabel[r] ?? r}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ),
          width: 240,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          {/* 标题 + Mark all（官方通知中心头部） */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Bell className="size-6 text-muted-foreground" />
              <div>
                <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
                <p className="text-sm text-muted-foreground">{t("navpage.notifications.desc")}</p>
              </div>
            </div>
            <WriteGate>
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={marking || !canWrite}
                onClick={() => void markAll()}
              >
                <Check className="size-3.5" />
                {marking ? t("notifications.markAllBusy") : t("notifications.markAll")}
              </Button>
            </WriteGate>
          </header>

          {markError && <InlineError message={markError} />}
          {actError && <InlineError message={actError} />}
          {/* 协作邀请（官方：邀请出现在通知中心；接受后成为协作者） */}
          {invites && invites.length > 0 && (
            <div className="mb-6 space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <UserPlus className="size-5 text-primary" />
                {t("invite.title")}
                <Badge variant="outline" className="text-xs">
                  {invites.length}
                </Badge>
              </h2>
              {inviteError && <InlineError message={inviteError} />}
              {invites.map((inv) => (
                <Card key={inv.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/${inv.repository.full_name}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {inv.repository.full_name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserPlus className="size-3.5" />
                          {inv.inviter?.login ?? t("common.unknownUser")} {t("invite.invitedYou")}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {permissionLabel[inv.permissions] ?? inv.permissions}
                        </Badge>
                        {inv.repository.private && (
                          <Badge variant="outline" className="text-xs">
                            {t("common.repoPrivate")}
                          </Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3.5" />
                          {fmt(inv.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <WriteGate>
                        <Button
                          className="gap-1"
                          disabled={!canWrite || busyId !== null}
                          onClick={() => void actOnInvite(inv, true)}
                        >
                          {busyId === inv.id ? (
                            t("invite.processing")
                          ) : (
                            <>
                              <Check className="size-3.5" />
                              {t("invite.accept")}
                            </>
                          )}
                        </Button>
                      </WriteGate>
                      <WriteGate>
                        <Button
                          variant="outline"
                          className="gap-1"
                          disabled={!canWrite || busyId !== null}
                          onClick={() => void actOnInvite(inv, false)}
                        >
                          {busyId === inv.id ? (
                            t("invite.processing")
                          ) : (
                            <>
                              <X className="size-3.5" />
                              {t("invite.decline")}
                            </>
                          )}
                        </Button>
                      </WriteGate>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {error ? (
            <ThrowError err={error} />
          ) : filteredItems === null ? (
            <LoadingList />
          ) : filteredItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("empty.notifications")}
            </p>
          ) : (
            <div className="space-y-6">
              {groupedItems!.map(({ fullName, items: repoItems }) => (
                <div key={fullName} className="space-y-3">
                  {/* 仓库分组标题 + 该仓库全部已读 */}
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/${fullName}`} className="text-sm font-semibold hover:underline">
                      {fullName}
                    </Link>
                    {repoItems.some((n) => n.unread) && canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-muted-foreground"
                        disabled={markingRepo !== null}
                        onClick={() => void markRepoRead(fullName)}
                      >
                        <CheckCheck className="size-3.5" />
                        {markingRepo === fullName
                          ? t("notifications.markAllBusy")
                          : t("notifications.markRepoRead")}
                      </Button>
                    )}
                  </div>
                  {repoItems.map((n) => {
                    // subject.url 形如 https://api.github.com/repos/o/r/issues/123
                    const m = n.subject.url?.match(
                      /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/,
                    );
                    const owner = m?.[1] ?? "";
                    const repo = m?.[2] ?? "";
                    const kind = m?.[3] ?? "";
                    const num = m?.[4] ?? "";
                    const to =
                      owner && repo
                        ? `/${owner}/${repo}/${kind === "pulls" ? "pulls" : "issues"}/${num}`
                        : `/${n.repository.full_name}`;
                    return (
                      <Card key={n.id} className="hover:bg-accent/50 transition-colors">
                        <CardContent className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <Link
                              to={to}
                              className="min-w-0 text-primary hover:underline line-clamp-2"
                            >
                              {n.subject.title}
                            </Link>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {n.unread && (
                                <Badge className="shrink-0 text-xs">
                                  {t("notifications.unread")}
                                </Badge>
                              )}
                              {/* 单条标记已读（未读 + 完全控制时显示） */}
                              {n.unread && canWrite && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-primary"
                                  title={t("notifications.markRead")}
                                  disabled={markingId !== null}
                                  onClick={() => void markOne(n)}
                                >
                                  {markingId === n.id ? (
                                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  ) : (
                                    <Check className="size-3.5" />
                                  )}
                                </Button>
                              )}
                              {/* 标记 done（归档） */}
                              {canWrite && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-primary"
                                  title={t("notifications.markDone")}
                                  disabled={actingId !== null}
                                  onClick={() => void doneOne(n)}
                                >
                                  {actingId === n.id ? (
                                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  ) : (
                                    <CheckCheck className="size-3.5" />
                                  )}
                                </Button>
                              )}
                              {/* 退订 */}
                              {canWrite && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive"
                                  title={t("notifications.unsubscribe")}
                                  disabled={actingId !== null}
                                  onClick={() => void unsubscribeOne(n)}
                                >
                                  <BellOff className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-xs">
                              {reasonLabel[n.reason] ?? n.reason}
                            </Badge>
                            <span className="font-mono">{n.repository.full_name}</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3.5" />
                              {fmt(n.updated_at)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ))}
              {/* 加载更多 */}
              {hasMore && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? t("common.loading") : tStatic("home.showMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      </PageLayout>
    </div>
  );
}
