/**
 * 账户设置 —— 凭据管理（权限分级 + 重构）
 * 凭据各模块按真实授予 scope 分级展示（SSH/GPG/会话）
 *
 * - 当前权限摘要（scope 徽章，只读展示；权限切换在左卡 tabs-switch）
 * - SSH keys（REST 完整 API：GET/POST /user/keys + DELETE /user/keys/{id}，
 *   需 read:public_key / admin:public_key scope）
 * - SSH keys 加载 404（旧会话缺 public_key scope）→ 友好提示重新登录；
 *   PAT 无管理 API → 移除页内跳转，统一走左栏底部「前往 GitHub 设置页面」
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, KeyRound, LogOut, MonitorSmartphone, Plus, X } from "lucide-react";
import { InlineError } from "@/components/InlineError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { PermissionGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { apiErrorMessage } from "@/lib/api";
import {
  fetchSessions,
  logoutSession,
  revokeApp,
  parseUaLabel,
  countryFlag,
  countryName,
  type SessionMeta,
} from "@/lib/auth/session";
import {
  ApiError,
  fetchGpgKeys,
  addGpgKey,
  deleteGpgKey,
  type SSHKey,
  type GpgKey,
} from "@/lib/restapi";
import { fetchSshKeysSmart, addSshKeySmart, deleteSshKeySmart } from "@/lib/api";
import { describeScopes } from "@/lib/auth/scopes";

/** 依据权限模式推导请求的 GitHub scope 列表（与 worker buildGitHubScope 一致）
 * 以下 3 个仅本文件使用（fast refresh：组件文件不导出非组件） */

/** 是否具备 SSH keys 读取能力（read/write/admin 任一 public_key scope 即可；旧会话缺失时信任请求模式） */
function canReadSSHKeys(grantedScopes: string[] | null): boolean {
  if (grantedScopes) {
    return grantedScopes.some((s) => /^(read|write|admin):public_key$/.test(s));
  }
  // 旧会话（无真实授予记录）：read 含 read:public_key、write 含 admin:public_key，两档均具备读能力
  return true;
}

/** 是否具备 GPG keys 读取能力（read/write/admin 任一 gpg_key scope 即可；旧会话缺失时信任请求模式） */
function canReadGpgKeys(grantedScopes: string[] | null): boolean {
  if (grantedScopes) {
    return grantedScopes.some((s) => /^(read|write|admin):gpg_key$/.test(s));
  }
  // 旧会话（无真实授予记录）：read 含 read:gpg_key、write 含 admin:gpg_key，两档均具备读能力
  return true;
}

export default function AccountSettings() {
  const { token, scopes, grantedScopes, canWrite, logout, logoutAll, login, missingScopes } =
    useAuth();
  const { t } = useI18n();
  const mode = scopes?.mode === "write" ? "write" : "read";
  // 竞态/卸载防护：load/loadGpg/loadSessions 由 effect 调用，也由增删后手动调用
  const mountedRef = useRef(true);

  // SSH keys
  const [keys, setKeys] = useState<SSHKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  // 添加表单展开（标题行右侧「新增」按钮 toggle；参照 EmailsSection）
  const [showAddKey, setShowAddKey] = useState(false);
  // 是否因缺权限导致无法读取（卡片内提示而非顶部红色错误）
  const [noScope, setNoScope] = useState(false);

  const load = () => {
    if (!token) return;
    // 依据 GitHub 真实授予 scope 预判——无 read:public_key 能力直接提示，不发注定失败的请求
    if (!canReadSSHKeys(grantedScopes)) {
      if (!mountedRef.current) return;
      setKeys(null);
      setNoScope(true);
      setError(null);
      return;
    }
    setNoScope(false);
    fetchSshKeysSmart(token)
      .then((list) => {
        if (!mountedRef.current) return;
        setKeys(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        // 兜底：真实授予缺失但请求仍 404（如 token 在 GitHub 端被改权）→ 卡片内友好提示
        if (e instanceof ApiError && e.status === 404) {
          setKeys(null);
          setNoScope(true);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, grantedScopes]);

  const add = async () => {
    if (!token || busy || !title.trim() || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addSshKeySmart(token, title.trim(), key.trim());
      setTitle("");
      setKey("");
      setShowAddKey(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("accountSettings.addFailed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSshKeySmart(token, id);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("accountSettings.removeFailed")));
    } finally {
      setBusy(false);
    }
  };

  // GPG keys（需 read:gpg_key / admin:gpg_key scope）
  const [gpgKeys, setGpgKeys] = useState<GpgKey[] | null>(null);
  const [gpgError, setGpgError] = useState<string | null>(null);
  const [gpgBusy, setGpgBusy] = useState(false);
  const [gpgBody, setGpgBody] = useState("");
  const [gpgNoScope, setGpgNoScope] = useState(false);
  // 添加表单展开（标题行右侧「新增」按钮 toggle；参照 EmailsSection）
  const [showAddGpg, setShowAddGpg] = useState(false);

  const loadGpg = () => {
    if (!token) return;
    // 依据真实授予 scope 预判——无 read:gpg_key 能力直接提示（同 SSH keys）
    if (!canReadGpgKeys(grantedScopes)) {
      if (!mountedRef.current) return;
      setGpgKeys(null);
      setGpgNoScope(true);
      setGpgError(null);
      return;
    }
    setGpgNoScope(false);
    fetchGpgKeys(token)
      .then((list) => {
        if (!mountedRef.current) return;
        setGpgKeys(list);
        setGpgError(null);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        if (e instanceof ApiError && e.status === 404) {
          setGpgKeys(null);
          setGpgNoScope(true);
          return;
        }
        setGpgError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    loadGpg();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, grantedScopes]);

  const addGpg = async () => {
    if (!token || gpgBusy || !gpgBody.trim()) return;
    setGpgBusy(true);
    setGpgError(null);
    try {
      await addGpgKey(token, gpgBody.trim());
      setGpgBody("");
      setShowAddGpg(false);
      loadGpg();
    } catch (e) {
      setGpgError(apiErrorMessage(e, t("accountSettings.gpgAddFailed")));
    } finally {
      setGpgBusy(false);
    }
  };

  const removeGpg = async (id: number) => {
    if (!token || gpgBusy) return;
    setGpgBusy(true);
    setGpgError(null);
    try {
      await deleteGpgKey(token, id);
      loadGpg();
    } catch (e) {
      setGpgError(apiErrorMessage(e, t("accountSettings.gpgRemoveFailed")));
    } finally {
      setGpgBusy(false);
    }
  };

  // 登录凭据（会话列表；Worker 经 cookie 鉴权，无需 token）
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<SessionMeta | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  /** 全部登出确认框开关（全部设备退出；当前设备也会退出） */
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [logoutAllBusy, setLogoutAllBusy] = useState(false);

  const loadSessions = () => {
    if (!mountedRef.current) return;
    setSessionsError(null);
    fetchSessions()
      .then((list) => {
        if (!mountedRef.current) return;
        setSessions(list);
        setSessionsError(null);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        setSessions(null);
        setSessionsError(apiErrorMessage(e, t("accountSettings.sessionsLoadFailed")));
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    loadSessions();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 本地登出指定设备（仅删 KV 会话；登出当前设备 = 本机登出） */
  const doLogout = async () => {
    if (!logoutTarget || logoutBusy) return;
    setLogoutBusy(true);
    setSessionsError(null);
    try {
      const target = logoutTarget;
      setLogoutTarget(null);
      await logoutSession(target.id);
      if (target.isCurrent) {
        // 登出的是当前设备 → 同步清理前端登录态
        await logout();
      } else {
        loadSessions();
      }
    } catch (e) {
      setSessionsError(apiErrorMessage(e, t("accountSettings.sessionsLogoutFailed")));
    } finally {
      setLogoutBusy(false);
    }
  };

  /** 登出全部设备（删当前用户全部 KV 会话；当前设备也退出） */
  const doLogoutAll = async () => {
    if (logoutAllBusy) return;
    setLogoutAllBusy(true);
    setSessionsError(null);
    try {
      setLogoutAllOpen(false);
      await logoutAll();
      // 全部会话已删 → 本地列表清空（前端登录态由 logoutAll 同步清理）
      setSessions([]);
    } catch (e) {
      setSessionsError(apiErrorMessage(e, t("accountSettings.sessionsLogoutFailed")));
    } finally {
      setLogoutAllBusy(false);
    }
  };

  // 危险区：撤销 PureGit OAuth App 授权（GitHub 端真撤销 + 退出所有设备）
  const [dangerOpen, setDangerOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const doRevoke = async () => {
    if (revokeBusy) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await revokeApp();
      setDangerOpen(false);
      await logout();
    } catch (e) {
      setRevokeError(apiErrorMessage(e, t("accountSettings.danger.revokeFailed")));
    } finally {
      setRevokeBusy(false);
    }
  };

  /** 时间格式化：模板中的 {time} 替换为本地化时间（统一走 useDateFormat） */
  const { fmt } = useDateFormat();
  const formatTime = (ts: number, template: string): string => {
    if (!ts) return "";
    return template.replace("{time}", fmt(new Date(ts).toISOString()));
  };

  /** 会话元信息行：IP · 国家 · 创建 · 最后活跃（空字段过滤，无尾随分隔符） */
  const sessionMetaLine = (s: SessionMeta): string => {
    const parts: string[] = [];
    if (s.ip) parts.push(`${t("accountSettings.sessionsIp")} ${s.ip}`);
    if (s.country && countryName(s.country)) {
      parts.push(`${countryFlag(s.country)} ${countryName(s.country)}`);
    }
    const created = formatTime(s.createdAt, t("accountSettings.sessionsCreated"));
    const seen = formatTime(s.lastSeenAt, t("accountSettings.sessionsLastSeen"));
    if (created) parts.push(created);
    if (seen) parts.push(seen);
    return parts.join(" · ");
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 查漏补缺：已授少于所需 → 缺失标红 + 补充授权（GitHub 增量授权自动合并） */}
      {missingScopes && missingScopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-400/40 dark:bg-amber-950/40">
          <span className="text-amber-700 dark:text-amber-300">
            {t("accountSettings.missingScopes")}:{" "}
            <span className="font-medium">{describeScopes(missingScopes)}</span>
          </span>
          <Button
            variant="outline"
            className="ml-auto border-amber-600/40 text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-900/50"
            onClick={() => login({ mode })}
          >
            {t("scopeWarning.reauthorize")}
          </Button>
        </div>
      )}

      {/* 已登录设备（持久会话 + 会话列表管理；第一位） */}
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {t("accountSettings.sessions")}
              {/* 会话计数徽章（加载完成才显示；对齐 SSH keys 计数） */}
              {sessions && (
                <Badge variant="secondary" className="ml-2 align-middle">
                  {sessions.length}
                </Badge>
              )}
            </h2>
          </div>
          {/* 全部登出：删除当前用户全部 KV 会话（所有设备退出） */}
          <Button
            variant="outline"
            disabled={logoutAllBusy || sessions === null}
            onClick={() => setLogoutAllOpen(true)}
          >
            <LogOut className="size-3.5" />
            {t("accountSettings.sessionsLogoutAll")}
          </Button>
        </div>
        {sessionsError ? (
          <InlineError message={sessionsError} className="py-6 text-center" />
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {sessions === null ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("accountSettings.sessionsEmpty")}
              </p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {parseUaLabel(s.ua) || t("accountSettings.sessionsUnknown")}
                      {s.authMethod === "pat" && (
                        <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                          PAT
                        </Badge>
                      )}
                      {s.isCurrent && (
                        <Badge className="ml-2 bg-amber-500 text-white text-xs">
                          {t("accountSettings.sessionsCurrent")}
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{sessionMetaLine(s)}</p>
                  </div>
                  {/* 非当前会话 → 本地登出；当前会话登出入口在导航栏用户菜单/登出（此处不重复） */}
                  {!s.isCurrent && (
                    <Button
                      variant="outline"
                      disabled={logoutBusy}
                      onClick={() => setLogoutTarget(s)}
                    >
                      <LogOut className="size-3.5" />
                      {t("accountSettings.sessionsLogout")}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* SSH keys（官方 SSH and GPG keys 页的 SSH 部分；完整 API 支持） */}
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {t("accountSettings.sshKeys")}
              {!noScope && keys && (
                <Badge variant="secondary" className="ml-2 align-middle">
                  {keys.length}
                </Badge>
              )}
            </h2>
            {(!keys || noScope) && (
              <p className="text-sm text-muted-foreground">
                {/* 权限缺失时头部不再显示「加载中…」（会永久挂起误导）；
                    加载中改为骨架条（h-4 匹配行高），防加载完成切换抖动 */}
                {noScope ? t("accountSettings.noScope") : <Skeleton className="h-4 w-24" />}
              </p>
            )}
          </div>
          {/* 新增 SSH key（仅完全控制；标题行右侧按钮展开表单，参照 EmailsSection） */}
          {canWrite && (
            <PermissionGate permission="editAccount">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setShowAddKey((v) => !v);
                  if (showAddKey) {
                    setTitle("");
                    setKey("");
                  }
                }}
              >
                <Plus className="size-4" />
                {t("common.add")}
              </Button>
            </PermissionGate>
          )}
        </div>
        {noScope ? (
          // 权限缺失：卡片内提示（替代顶部红色错误）
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("accountSettings.noScope")}
          </p>
        ) : error ? (
          // 其他错误（网络等）：卡片内提示
          <InlineError message={error} className="py-6 text-center" />
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {keys === null ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : keys.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("accountSettings.empty")}
              </p>
            ) : (
              keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{k.title}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {k.key.slice(0, 20)}…
                  </span>
                  {k.verified && (
                    <Badge className="bg-emerald-500 text-white text-xs">
                      {t("accountSettings.verified")}
                    </Badge>
                  )}
                  {/* 删除（仅完全控制） */}
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title={t("accountSettings.removeTitle")}
                      disabled={busy}
                      onClick={() => void remove(k.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 添加 SSH key（仅完全控制；标题行「新增」按钮展开，参照 EmailsSection） */}
        {showAddKey && canWrite && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("accountSettings.addNew")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="key-title" className="mb-1.5 block">
                  {t("accountSettings.keyName")}
                </Label>
                <Input
                  id="key-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("accountSettings.keyNamePlaceholder")}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="key-body" className="mb-1.5 block">
                  {t("accountSettings.keyBody")}
                </Label>
                <Textarea
                  id="key-body"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={t("accountSettings.keyBodyPlaceholder")}
                  className="font-mono"
                  rows={5}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PermissionGate permission="editAccount">
                <Button onClick={() => void add()} disabled={busy || !title.trim() || !key.trim()}>
                  <Plus className="size-4" />
                  {t("accountSettings.add")}
                </Button>
              </PermissionGate>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowAddKey(false);
                  setTitle("");
                  setKey("");
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* GPG keys（官方 SSH and GPG keys 页的 GPG 部分；需 read:gpg_key / admin:gpg_key） */}
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {t("accountSettings.gpgKeys")}
              {!gpgNoScope && gpgKeys && (
                <Badge variant="secondary" className="ml-2 align-middle">
                  {gpgKeys.length}
                </Badge>
              )}
            </h2>
            {(!gpgKeys || gpgNoScope) && (
              <p className="text-sm text-muted-foreground">
                {gpgNoScope ? t("accountSettings.gpgNoScope") : <Skeleton className="h-4 w-24" />}
              </p>
            )}
          </div>
          {/* 新增 GPG key（仅完全控制；标题行右侧按钮展开表单，参照 EmailsSection） */}
          {canWrite && (
            <PermissionGate permission="editAccount">
              <Button
                variant="outline"
                disabled={gpgBusy}
                onClick={() => {
                  setShowAddGpg((v) => !v);
                  if (showAddGpg) setGpgBody("");
                }}
              >
                <Plus className="size-4" />
                {t("common.add")}
              </Button>
            </PermissionGate>
          )}
        </div>
        {gpgNoScope ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("accountSettings.gpgNoScope")}
          </p>
        ) : gpgError ? (
          <InlineError message={gpgError} className="py-6 text-center" />
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {gpgKeys === null ? (
              <div className="flex flex-col gap-3 p-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : gpgKeys.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("accountSettings.gpgEmpty")}
              </p>
            ) : (
              gpgKeys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-mono">{k.key_id}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {k.emails?.[0]?.email ?? ""}
                  </span>
                  {k.can_sign && (
                    <Badge className="bg-sky-500 text-white text-xs">
                      {t("accountSettings.gpgSign")}
                    </Badge>
                  )}
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title={t("accountSettings.removeTitle")}
                      disabled={gpgBusy}
                      onClick={() => void removeGpg(k.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 添加 GPG key（仅完全控制；标题行「新增」按钮展开，参照 EmailsSection） */}
        {showAddGpg && canWrite && (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("accountSettings.gpgAddNew")}</p>
            <div>
              <Label htmlFor="gpg-body" className="mb-1.5 block">
                {t("accountSettings.gpgBody")}
              </Label>
              <Textarea
                id="gpg-body"
                value={gpgBody}
                onChange={(e) => setGpgBody(e.target.value)}
                placeholder={t("accountSettings.gpgBodyPlaceholder")}
                className="font-mono"
                rows={4}
              />
            </div>
            <div className="flex items-center gap-2">
              <PermissionGate permission="editAccount">
                <Button onClick={() => void addGpg()} disabled={gpgBusy || !gpgBody.trim()}>
                  <Plus className="size-4" />
                  {t("accountSettings.gpgAdd")}
                </Button>
              </PermissionGate>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowAddGpg(false);
                  setGpgBody("");
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 危险区（撤销 PureGit OAuth App 授权；与 repo 设置页 Danger Zone 统一样式：
          标题在卡片外、无描述） */}
      <section>
        <div>
          <h2 className="text-lg font-semibold text-destructive">{t("accountSettings.danger")}</h2>
        </div>
        <div className="mt-3 rounded-lg border border-destructive/40">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("accountSettings.danger.revoke")}</p>
            </div>
            <Button variant="destructive" disabled={revokeBusy} onClick={() => setDangerOpen(true)}>
              <AlertTriangle className="size-4" />
              {t("accountSettings.danger.revokeButton")}
            </Button>
          </div>
          {revokeError && <InlineError message={revokeError} size="sm" />}
        </div>
      </section>

      {/* 本地登出指定设备确认框 */}
      <AlertDialog open={Boolean(logoutTarget)} onOpenChange={(o) => !o && setLogoutTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountSettings.sessionsLogoutTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("accountSettings.sessionsLogoutDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={logoutBusy}
              onClick={(e) => {
                e.preventDefault();
                void doLogout();
              }}
            >
              {t("accountSettings.sessionsLogout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 全部登出确认框（所有设备退出，含当前设备） */}
      <AlertDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountSettings.sessionsLogoutAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("accountSettings.sessionsLogoutAllDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutAllBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={logoutAllBusy}
              onClick={(e) => {
                e.preventDefault();
                void doLogoutAll();
              }}
            >
              {t("accountSettings.sessionsLogoutAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 撤销 App 授权确认框（危险操作，必用 AlertDialog） */}
      <AlertDialog open={dangerOpen} onOpenChange={setDangerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountSettings.danger.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("accountSettings.danger.revokeDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeBusy}
              onClick={(e) => {
                e.preventDefault();
                void doRevoke();
              }}
            >
              {t("accountSettings.danger.revokeButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
