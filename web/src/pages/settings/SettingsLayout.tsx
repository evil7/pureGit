/**
 * 账户与组织中心 —— 设置布局（复刻 GitHub /settings）
 *
 * 官方排版（实测）：
 * - 左栏顶部卡片：头像 + `name (login) settings` + 「Your personal account」
 * - 卡片底部：权限 tabs-switch（只读访问 / 完全控制），切换需确认框，重新授权后回原页
 * - 左导航（用户定稿）：个人资料/凭据管理/仓库管理/屏蔽用户/组织管理
 *   （组织管理独立板块，非并入个人资料）→ 分割线 → 偏好设置（最后一项）；无 GitHub 外链
 * - 右侧内容区：扁平 region（无卡片包裹）
 * 未登录时整体显示登录引导（偏好页除外）。
 */
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { Contact, KeyRound, Settings2, FolderGit2, Ban, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, tStatic } from "@/i18n";
import { LoginPrompt } from "@/components/LoginPrompt";
import { AccountSwitcherCard } from "@/components/AccountSwitcherCard";
import { useManageableEntities } from "@/hooks/useAdminOrgs";
import { cn } from "@/lib/utils";
import { PAGE_SHELL } from "@/lib/layout";
import PageLayout from "@/components/PageLayout";

/** GitHub 对照设置（用户定稿顺序：个人资料/凭据/仓库/组织/屏蔽 → 偏好设置最后） */
const GITHUB_ITEMS: { to: string; label: string; icon: typeof Contact }[] = [
  // 名片 icon（用户要求：个人资料/组织资料用类似名片的图标）
  { to: "/settings/profile", label: tStatic("settings.profile"), icon: Contact },
  { to: "/settings/account", label: tStatic("settings.account"), icon: KeyRound },
  { to: "/settings/repositories", label: tStatic("settings.repos"), icon: FolderGit2 },
  // 组织管理独立板块（其他用户可能不止 1 个组织）
  { to: "/settings/organizations", label: tStatic("settings.organizations"), icon: Building2 },
  { to: "/settings/blocked_users", label: tStatic("settings.blockedUsers"), icon: Ban },
];

/** 偏好设置（本项目，导航最后一项； 用户要求） */
const PREF_ITEMS: { to: string; label: string; icon: typeof Settings2 }[] = [
  { to: "/settings/preferences", label: tStatic("settings.preferences"), icon: Settings2 },
];

function LoginGate() {
  const { t } = useI18n();
  // 统一登录引导模板：只提醒 + 聚光灯指引右上角登录，不做按钮
  return (
    <LoginPrompt
      title={t("settings.loginGateTitle")}
      desc={t("settings.loginGateDesc")}
      className="py-24"
    />
  );
}

/** 权限 tabs-switch（只读访问 / 完全控制）；点击切换 → 确认框 → 重新授权并回原页
 * （自左栏卡片底部移入偏好设置页「接口状态」板块，本文件不再使用） */

export default function SettingsLayout() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  // 可管理实体（个人 + admin 组织），账号切换器用
  const { entities } = useManageableEntities(user?.login, user?.avatarUrl);
  // 外观主题为本地偏好，未登录也可访问
  const isAppearance = pathname.startsWith("/settings/appearance");

  if (loading) return null;

  return (
    // 布局规范：PAGE_SHELL 仅顶部 padding（底部 padding 滚动到底会推 sticky）+
    // PageLayout D 型（左导航 sticky + 右内容 max-w-230 收编 GRID_2COL_240）
    <div className={PAGE_SHELL}>
      {!user && !isAppearance ? (
        <LoginGate />
      ) : (
        <PageLayout
          gap="lg"
          contentClassName="max-w-230"
          left={{
            node: (
              <nav className="flex flex-col gap-4">
                {/* 账号切换卡片（用户要求：替换原「用户卡片 + arrow-switch」，沿用首页精简卡片） */}
                {user && (
                  <div className="rounded-lg border bg-card p-1">
                    <AccountSwitcherCard
                      current={{
                        kind: "user",
                        login: user.login,
                        name: entities.find((e) => e.login === user.login)?.name ?? user.login,
                        avatarUrl: user.avatarUrl ?? null,
                      }}
                      items={entities}
                      getTarget={(e) =>
                        e.kind === "org"
                          ? `/organizations/${e.login}/settings/profile`
                          : "/settings/profile"
                      }
                    />
                  </div>
                )}

                {/* GitHub 对照设置（排序：个人资料/凭据/仓库/屏蔽/组织；名片 icon） */}
                {GITHUB_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
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

                {/* 分割线（GitHub 设置与偏好设置分界） */}
                <div className="my-1 h-px bg-border" />

                {/* 偏好设置（用户要求：放最后一项） */}
                {PREF_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
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
              </nav>
            ),
            width: 240,
            sticky: "nav",
          }}
        >
          {/* 内容区（官方：扁平 region，无顶部用户块——已移入左卡）；PageLayout 自动 CONTENT_FILL */}
          <Outlet />
        </PageLayout>
      )}
    </div>
  );
}

/** /settings 根路径重定向到 profile（用户要求：与组织设置默认行为一致） */
export function SettingsIndexRedirect() {
  return <Navigate to="/settings/profile" replace />;
}
