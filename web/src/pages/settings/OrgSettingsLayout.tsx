/**
 * 组织设置布局（重构：向个人设置页 SettingsLayout 靠拢）
 *
 * 官方结构（github.com/organizations/:org/settings 实测）：
 * - 左卡：头像 + `org settings` + Organization + Switch settings context（账号切换器）
 * - 左导航：General + 分组（Access/Code/Security…，本项目精简为核心 3 项）
 * - 右内容：路由切换扁平 region
 *
 * 子路由（对齐官方 /settings/profile）：
 * - /organizations/:org/settings          → 302 → profile（官方同款重定向）
 * - /organizations/:org/settings/profile → 组织资料（General，含成员权限 + 危险区）
 * - /organizations/:org/settings/people      → 成员管理（角色/2FA/邀请/移除）
 * - /organizations/:org/settings/teams       → 团队管理（CRUD + 成员）
 * - /organizations/:org/settings/repositories → 仓库管理（组织全部仓库 用户要求）
 * - /organizations/:org/settings/preferences → 偏好设置（组织内直访，不跳回个人）
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { Contact, UserRound, Users, FolderGit2, Settings2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, tStatic } from "@/i18n";
import { LoginPrompt } from "@/components/LoginPrompt";
import { AccountSwitcherCard } from "@/components/AccountSwitcherCard";
import { useManageableEntities } from "@/hooks/useAdminOrgs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PAGE_SHELL } from "@/lib/layout";
import PageLayout from "@/components/PageLayout";
import { fetchOrgDetailSmart, type OrgDetail } from "@/lib/api";

/** 组织管理左导航（用户定稿：组织资料/成员/团队/仓库；组织资料用名片 icon） */
const NAV_ITEMS: {
  to: (org: string) => string;
  end?: boolean;
  label: string;
  icon: typeof Contact;
}[] = [
  {
    to: (org) => `/organizations/${org}/settings/profile`,
    end: true,
    label: tStatic("orgNav.general"),
    icon: Contact,
  },
  {
    to: (org) => `/organizations/${org}/settings/people`,
    label: tStatic("orgNav.members"),
    icon: UserRound,
  },
  {
    to: (org) => `/organizations/${org}/settings/teams`,
    label: tStatic("orgNav.teams"),
    icon: Users,
  },
  {
    to: (org) => `/organizations/${org}/settings/repositories`,
    label: tStatic("orgNav.repos"),
    icon: FolderGit2,
  },
];

/** 偏好设置（组织内子路由直访，系统级偏好与组织设置同布局；不跳回个人） */
const PREF_ITEM: { to: (org: string) => string; label: string; icon: typeof Settings2 } = {
  to: (org) => `/organizations/${org}/settings/preferences`,
  label: tStatic("settings.preferences"),
  icon: Settings2,
};

export default function OrgSettingsLayout() {
  const { org = "" } = useParams();
  const { token, user } = useAuth();
  const { t } = useI18n();
  // 账号切换器实体（个人 + admin 组织）
  const { entities } = useManageableEntities(user?.login, user?.avatarUrl);
  const [detail, setDetail] = useState<OrgDetail | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOrgDetailSmart(org, token)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [org, token]);

  if (!token) {
    return <LoginPrompt title={t("orgSettings.loginFirst")} desc="" className="py-24" />;
  }

  return (
    // 布局规范：PAGE_SHELL 仅顶部 padding + PageLayout D 型（左导航 sticky + 右内容 max-w-230）
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        contentClassName="max-w-230"
        left={{
          node: (
            <nav className="flex flex-col gap-4">
              {/* 左卡：账号切换卡片（与个人设置页一致：AccountSwitcherCard 精简卡片） */}
              {detail ? (
                <div className="rounded-lg border bg-card p-1">
                  <AccountSwitcherCard
                    current={{
                      kind: "org",
                      login: detail.login,
                      name: detail.name ?? detail.login,
                      avatarUrl: detail.avatar_url ?? null,
                    }}
                    items={entities}
                    getTarget={(e) =>
                      e.kind === "org"
                        ? `/organizations/${e.login}/settings/profile`
                        : "/settings/profile"
                    }
                  />
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-1">
                  <div className="flex items-center gap-2 p-1.5">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                </div>
              )}

              {/* 左导航（个人设置同构：border-l-2 active 高亮） */}
              {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
                <NavLink
                  key={label}
                  to={to(org)}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 border-l-2 px-3 py-1.5 text-sm transition-colors",
                      isActive
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </NavLink>
              ))}

              {/* 分割线（组织管理与偏好设置分界） */}
              <div className="my-1 h-px bg-border" />

              {/* 偏好设置（组织内直访 /organizations/:org/settings/preferences） */}
              <NavLink
                key={PREF_ITEM.label}
                to={PREF_ITEM.to(org)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 border-l-2 px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <PREF_ITEM.icon className="size-4 shrink-0" />
                {PREF_ITEM.label}
              </NavLink>
            </nav>
          ),
          width: 240,
          sticky: "nav",
        }}
      >
        {/* 右内容区（官方：扁平 region，无卡片包裹；PageLayout 自动 CONTENT_FILL） */}
        <Outlet />
      </PageLayout>
    </div>
  );
}
