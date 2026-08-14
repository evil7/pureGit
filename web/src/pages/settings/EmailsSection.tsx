/**
 * 个人资料页 —— 邮箱管理区块（原独立页 EmailsSettings 提取，阶段 4 合并）
 *
 * 邮箱列表：REST /user/emails（GraphQL 无 User.emails 字段，见 api.ts）。
 * 主邮箱 / 公开 / 已验证状态徽章；添加/删除（完全控制）；Keep private switch。
 */
import { useEffect, useRef, useState } from "react";
import { Mail, Plus, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PermissionGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchUserEmailsSmart,
  addUserEmails,
  removeUserEmails,
  setEmailVisibility,
  apiErrorMessage,
  type UserEmailItem,
} from "@/lib/api";

export function EmailsSection() {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const [emails, setEmails] = useState<UserEmailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // 添加输入行（标题行右侧「添加」按钮展开）
  const [showAdd, setShowAdd] = useState(false);

  // 竞态/卸载防护：load 由 effect 调用，也由增删后手动调用
  const mountedRef = useRef(true);

  const load = () => {
    if (!token) return;
    fetchUserEmailsSmart(token)
      .then((list) => mountedRef.current && setEmails(list))
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

  const add = async () => {
    if (!token || busy || !newEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addUserEmails(token, [newEmail.trim()]);
      setNewEmail("");
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("emailsSettings.addFailed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (email: string) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeUserEmails(token, [email]);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("emailsSettings.removeFailed")));
    } finally {
      setBusy(false);
    }
  };

  const anyPrivate = emails?.some((e) => e.visibility === "private") ?? false;
  const toggleVisibility = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setEmailVisibility(token, anyPrivate ? "public" : "private");
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("emailsSettings.toggleFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      {error && <InlineError message={t("emailsSettings.opFailed").replace("{error}", error)} />}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {t("emailsSettings.title")}
          {emails !== null && <span className="text-muted-foreground"> ({emails.length})</span>}
        </h2>
        {canWrite && (
          <PermissionGate permission="editAccount">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setShowAdd((v) => !v);
                if (showAdd) setNewEmail("");
              }}
            >
              <Plus className="size-4" />
              {t("emailsSettings.add")}
            </Button>
          </PermissionGate>
        )}
      </div>
      {showAdd && canWrite && (
        <div className="flex items-center gap-2">
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@example.com"
            className="flex-1"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <PermissionGate permission="editAccount">
            <Button onClick={() => void add()} disabled={busy || !newEmail.trim()}>
              {t("common.add")}
            </Button>
          </PermissionGate>
          <Button
            variant="ghost"
            onClick={() => {
              setShowAdd(false);
              setNewEmail("");
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}
      <div className="flex flex-col divide-y rounded-lg border">
        {emails === null ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("emailsSettings.empty")}
          </p>
        ) : (
          emails.map((e) => (
            <div key={e.email} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{e.email}</span>
              {e.visibility === "private" && (
                <Badge variant="secondary" className="text-xs">
                  {t("emailsSettings.private")}
                </Badge>
              )}
              {e.verified ? (
                <Badge className="bg-emerald-500 text-white text-xs">
                  {t("emailsSettings.verified")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {t("emailsSettings.unverified")}
                </Badge>
              )}
              <span className="flex w-9 shrink-0 items-center justify-end">
                {e.primary ? (
                  <span
                    className="flex size-7 items-center justify-center"
                    title={t("emailsSettings.primary")}
                  >
                    <Star
                      className="size-4 fill-amber-400 text-amber-400"
                      aria-label={t("emailsSettings.primary")}
                    />
                  </span>
                ) : canWrite ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title={t("emailsSettings.removeTitle")}
                    disabled={busy}
                    onClick={() => void remove(e.email)}
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">{t("emailsSettings.keepPrivate")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("emailsSettings.keepPrivateDesc")}
          </p>
        </div>
        <PermissionGate permission="editAccount">
          <Switch
            checked={anyPrivate}
            onCheckedChange={() => void toggleVisibility()}
            disabled={busy || emails === null}
          />
        </PermissionGate>
      </div>
    </section>
  );
}
