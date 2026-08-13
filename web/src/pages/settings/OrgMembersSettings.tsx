/**
 * 组织设置 —— 成员（People 精简版； 拆分自旧 OrgSettingsPage）
 *
 * 路径：/organizations/:org/settings/people（官方 /orgs/:org/people 精简）
 * - 成员列表（角色 Owner/Member + 2FA 徽章；fetchOrgMembersWithRolesSmart GraphQL 主通道）
 * - 角色切换（PUT /orgs/{org}/memberships/{username}，admin:org；不可改自己）
 * - 邀请（用户名 → GET /users/{login} 查 id → POST invitations）+ 待处理邀请列表/取消
 * - 移除成员（DELETE /orgs/{org}/members/{username}，确认框；不可移除自己）
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { UserPlus, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useI18n } from "@/i18n";
import {
  fetchOrgMembersWithRolesSmart,
  setOrgMemberRole,
  removeOrgMember,
  fetchOrgInvitations,
  createOrgInvitation,
  cancelOrgInvitation,
  apiErrorMessage,
} from "@/lib/api";
import type { OrgMemberWithRole, OrgInvitation } from "@/lib/rest";

export default function OrgMembersSettings() {
  const { org = "" } = useParams();
  const { token, user, canWrite } = useAuth();
  const { t } = useI18n();
  const login = user?.login;

  const [members, setMembers] = useState<OrgMemberWithRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  // 邀请
  const [invitations, setInvitations] = useState<OrgInvitation[] | null>(null);
  const [inviteLogin, setInviteLogin] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  // 移除确认框
  const [removeTarget, setRemoveTarget] = useState<OrgMemberWithRole | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOrgMembersWithRolesSmart(org, token)
      .then((m) => !cancelled && setMembers(m))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    fetchOrgInvitations(org, token)
      .then((inv) => !cancelled && setInvitations(inv))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [org, token]);

  /** 成员列表派生排序：自己（当前登录）排第一，其余保持 API 顺序 */
  const sortedMembers = useMemo(() => {
    if (!members) return null;
    if (!login) return members;
    return [...members].sort((a, b) => {
      if (a.login === login) return -1;
      if (b.login === login) return 1;
      return 0;
    });
  }, [members, login]);

  /** 调整角色（不可改自己；最后一个 owner 由 API 校验） */
  const changeRole = async (m: OrgMemberWithRole, role: "admin" | "member") => {
    if (!token || roleBusy || m.login === login || m.role === role) return;
    setRoleBusy(m.login);
    setError(null);
    try {
      await setOrgMemberRole(org, m.login, token, role);
      setMembers((prev) => prev?.map((x) => (x.login === m.login ? { ...x, role } : x)) ?? prev);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgMembers.roleFailed")));
    } finally {
      setRoleBusy(null);
    }
  };

  /** 邀请成员：用户名 → 用户 id → POST invitations */
  const inviteMember = async () => {
    if (!token || inviteBusy || !inviteLogin.trim()) return;
    setInviteBusy(true);
    setError(null);
    try {
      const u = await import("@/lib/rest").then((m) =>
        m.fetchUserWithId(inviteLogin.trim(), token),
      );
      await createOrgInvitation(org, token, { invitee_id: u.id });
      setInviteLogin("");
      const inv = await fetchOrgInvitations(org, token);
      setInvitations(inv);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgSettings.inviteFailed")));
    } finally {
      setInviteBusy(false);
    }
  };

  const cancelInvite = async (id: number) => {
    if (!token || inviteBusy) return;
    setInviteBusy(true);
    setError(null);
    try {
      await cancelOrgInvitation(org, id, token);
      setInvitations((prev) => prev?.filter((i) => i.id !== id) ?? prev);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgSettings.cancelInviteFailed")));
    } finally {
      setInviteBusy(false);
    }
  };

  const removeMember = async () => {
    if (!token || removeBusy || !removeTarget) return;
    setRemoveBusy(true);
    setError(null);
    try {
      await removeOrgMember(org, removeTarget.login, token);
      setMembers((prev) => prev?.filter((m) => m.login !== removeTarget.login) ?? prev);
      setRemoveTarget(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgSettings.removeMemberFailed")));
    } finally {
      setRemoveBusy(false);
    }
  };

  if (!token) return null;

  return (
    // 内容区扁平 region
    <div className="flex flex-col gap-6">
      {error && <InlineError message={error} />}

      {/* 标题行 + 邀请（官方：搜索 + Invite member；无副标题 去冗余） */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {t("orgNav.members")}
          {members !== null && (
            <Badge variant="secondary" className="ml-2 align-middle">
              {members.length}
            </Badge>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <Input
            value={inviteLogin}
            onChange={(e) => setInviteLogin(e.target.value)}
            placeholder={t("orgSettings.invitePlaceholder")}
            className="max-w-56"
            onKeyDown={(e) => e.key === "Enter" && void inviteMember()}
          />
          <PermissionGate permission="org">
            <Button
              size="sm"
              disabled={inviteBusy || !inviteLogin.trim()}
              onClick={() => void inviteMember()}
            >
              <UserPlus className="size-4" />
              {t("orgSettings.inviteButton")}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* 待处理邀请 */}
      {invitations !== null && invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("orgSettings.invite")}</h2>
          <div className="flex flex-col divide-y rounded-lg border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {inv.login ? `@${inv.login}` : (inv.email ?? inv.id)}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {inv.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  title={t("orgSettings.cancelInvite")}
                  disabled={inviteBusy}
                  onClick={() => void cancelInvite(inv.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 成员列表（官方 People 表格精简：头像/登录名 + 2FA + 角色 + 移除；自己排第一） */}
      <div className="flex flex-col rounded-lg border p-2">
        {sortedMembers === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : sortedMembers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("orgMembers.empty")}</p>
        ) : (
          sortedMembers.map((m) => (
            <div
              key={m.login}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
            >
              <Link to={`/${m.login}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar className="size-8">
                  <AvatarImage src={m.avatar_url} alt={m.login} />
                  <AvatarFallback>{m.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-medium">@{m.login}</span>
              </Link>
              {/* 2FA 徽章（REST 认证请求返回） */}
              {m.two_factor_authentication && (
                <Badge
                  variant="outline"
                  className="shrink-0 text-xs"
                  title={t("orgMembers.twoFactor")}
                >
                  {t("orgMembers.twoFactor")}
                </Badge>
              )}
              {/* 角色切换（不可改自己；admin:org） */}
              {canWrite && m.login !== login && (
                <PermissionGate permission="org">
                  <Select
                    value={m.role}
                    onValueChange={(v) => void changeRole(m, v === "admin" ? "admin" : "member")}
                    disabled={roleBusy === m.login}
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={m.login}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t("orgMembers.roleOwner")}</SelectItem>
                      <SelectItem value="member">{t("orgMembers.roleMember")}</SelectItem>
                    </SelectContent>
                  </Select>
                </PermissionGate>
              )}
              {/* 移除成员（不可移除自己） */}
              {canWrite && m.login !== login && (
                <PermissionGate permission="org">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    title={t("orgSettings.removeMember")}
                    onClick={() => setRemoveTarget(m)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </PermissionGate>
              )}
            </div>
          ))
        )}
      </div>

      {/* 移除成员确认框 */}
      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orgSettings.removeMemberTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("orgSettings.removeMemberDesc").replace("{name}", removeTarget?.login ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeBusy}
              onClick={(e) => {
                e.preventDefault();
                void removeMember();
              }}
            >
              {t("orgSettings.removeMemberConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
