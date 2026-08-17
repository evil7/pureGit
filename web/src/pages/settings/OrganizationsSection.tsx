/**
 * 个人资料页 —— 组织管理区块（原独立页 OrganizationsSettings 提取，阶段 4 合并）
 *
 * 我的组织：GraphQL viewer.organizations 首选 + REST 降级（fetchUserOrgsSmart）；
 * 角色徽章（Owner/Member）：REST /user/memberships/orgs。
 * 点击组织跳组织主页；「设置」进组织设置页；New organization 官方链接。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Settings, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { fetchUserOrgsSmart, type UserOrgItem } from "@/lib/api";
import { fetchOrgMemberships } from "@/lib/restapi";

export function OrganizationsSection() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [orgs, setOrgs] = useState<UserOrgItem[] | null>(null);
  const [roles, setRoles] = useState<Record<string, "admin" | "member">>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchUserOrgsSmart(token)
      .then((list) => !cancelled && setOrgs(list))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    fetchOrgMemberships(token)
      .then(
        (ms) =>
          !cancelled &&
          setRoles(
            Object.fromEntries(
              ms
                .filter((m) => m.state === "active")
                .map((m) => [m.organization.login, m.role === "admin" ? "admin" : "member"]),
            ),
          ),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="flex flex-col gap-3">
      {error && <InlineError message={t("common.loadFailed").replace("{error}", error)} />}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {t("orgsSettings.title")}
          {orgs !== null && <span className="text-muted-foreground"> ({orgs.length})</span>}
        </h2>
        <Button variant="outline" asChild>
          <a href="https://github.com/account/organizations/new" target="_blank" rel="noreferrer">
            <Plus className="size-4" />
            {t("orgsSettings.new")}
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border p-2">
        {orgs === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : orgs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("orgsSettings.empty")}
          </p>
        ) : (
          orgs.map((o) => (
            <div
              key={o.login}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
            >
              {/* 头像 + 名称（点击进组织页）；设置按钮独立避免嵌套 <a>（修复） */}
              <Link to={`/orgs/${o.login}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar className="size-8">
                  <AvatarImage src={o.avatarUrl ?? undefined} alt={o.login} />
                  <AvatarFallback>{o.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.name || o.login}</p>
                  {o.description && (
                    <p className="truncate text-sm text-muted-foreground">{o.description}</p>
                  )}
                </div>
              </Link>
              <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                <Building2 className="size-4" />@{o.login}
              </span>
              {roles[o.login] && (
                <Badge
                  variant={roles[o.login] === "admin" ? "default" : "secondary"}
                  className="shrink-0 text-xs"
                >
                  {roles[o.login] === "admin"
                    ? t("orgsSettings.role.owner")
                    : t("orgsSettings.role.member")}
                </Badge>
              )}
              {/* 组织设置入口（组织 admin 才进设置页；非 admin 隐藏；官方 /settings/profile 主路由） */}
              {roles[o.login] === "admin" && (
                <Button variant="ghost" size="icon" asChild>
                  <Link
                    to={`/organizations/${o.login}/settings/profile`}
                    title={t("orgsSettings.settings")}
                  >
                    <Settings className="size-4" />
                  </Link>
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
