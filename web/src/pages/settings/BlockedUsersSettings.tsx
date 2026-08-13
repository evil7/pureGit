/**
 * 账户设置 —— Blocked users（复刻官方 /settings/blocked_users）
 *
 * - 读取：GET /user/blocks（免费）
 * - 屏蔽 / 解除：PUT /user/blocks/{username}、DELETE /user/blocks/{username}（需完全控制）
 * - 只读模式：仅展示列表，操作按钮隐藏（PermissionGate）
 */
import { useEffect, useRef, useState } from "react";
import { Ban, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/WriteGate";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchBlockedUsers,
  blockUser,
  unblockUser,
  apiErrorMessage,
  type BlockedUser,
} from "@/lib/restapi";

export default function BlockedUsersSettings() {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const [items, setItems] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  // 竞态/卸载防护：load 由 effect 调用，也由屏蔽/解除后手动调用
  const mountedRef = useRef(true);

  const load = () => {
    if (!token) return;
    fetchBlockedUsers(token)
      .then((list) => mountedRef.current && setItems(list))
      .catch((e: unknown) => {
        if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const doBlock = async () => {
    if (!token || busy || !username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await blockUser(token, username.trim());
      setUsername("");
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("blockedUsers.blockFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doUnblock = async (u: BlockedUser) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unblockUser(token, u.login);
      setItems((prev) => prev?.filter((x) => x.login !== u.login) ?? prev);
    } catch (e) {
      setError(apiErrorMessage(e, t("blockedUsers.unblockFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {error && <InlineError message={error} />}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("blockedUsers.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("blockedUsers.desc")}</p>
        </div>

        {/* 屏蔽新用户（仅完全控制） */}
        {canWrite && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("blockedUsers.blockNew")}</p>
            <div className="flex gap-2">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("blockedUsers.placeholder")}
                className="max-w-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doBlock();
                  }
                }}
              />
              <Button onClick={() => void doBlock()} disabled={busy || !username.trim()}>
                <Ban className="size-4" />
                {t("blockedUsers.block")}
              </Button>
            </div>
          </div>
        )}

        {/* 列表 */}
        <div className="flex flex-col divide-y rounded-lg border">
          {items === null ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("blockedUsers.empty")}
            </p>
          ) : (
            items.map((u) => (
              <div key={u.login} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <UserAvatar src={u.avatar_url} alt={u.login} className="size-6" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.login}</span>
                <PermissionGate permission="write" className="w-fit">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void doUnblock(u)}
                  >
                    <UserX className="size-3.5" />
                    {t("blockedUsers.unblock")}
                  </Button>
                </PermissionGate>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
