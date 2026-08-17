/**
 * 仓库设置布局（D 型左导航 + 子路由，对齐 GitHub /:owner/:repo/settings）
 *
 * 官方左导航（github.com/:owner/:repo/settings 实测）分组：General → Access → Code and
 * automation → Security → Integrations。本项目精简为核心 6 项子路由（均有完整 API 能力）：
 * - /settings/general        → 通用（General 表单 / Features / Merge button / Pull Requests / Danger Zone）
 * - /settings/collaborators  → 协作者（列表 + 添加/移除 + 权限级别）
 * - /settings/moderation     → 内容审核（临时交互限制 interaction limits）
 * - /settings/environments   → Environments（环境列表 + 新建/删除）
 * - /settings/keys           → Deploy keys（读写公钥列表 + 添加/删除）
 * - /settings/security       → Code security and analysis（安全分析开关）
 *
 * 路由级权限：仅仓库管理员（ADMIN）可访问（与 RepoHeader 的 Settings tab 显隐一致）；
 * 非 admin 直接输入 URL 也拦截，避免呈现无权限表单。
 */
import { NavLink, Outlet, useParams } from "react-router-dom";
import {
  Settings,
  Users,
  Shield,
  ShieldCheck,
  KeyRound,
  LockKeyhole,
  Server,
  LayoutGrid,
  Webhook,
  Globe,
  GitBranch,
  Sparkles,
  Laptop,
  ListTodo,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, tStatic } from "@/i18n";
import { InlineError } from "@/components/InlineError";
import { useRepoData } from "@/lib/repo/repo-context";
import { cn } from "@/lib/utils";
import PageLayout from "@/components/PageLayout";

/** 仓库设置左导航（14 项：通用 / 协作者 / 内容审核 / 分支保护 / Webhooks / Environments / Pages / Deploy keys / Secrets and variables / 安全分析 / GitHub Apps / Copilot / Codespaces / Planning） */
const NAV_ITEMS: { to: string; label: string; icon: typeof Settings }[] = [
  { to: "general", label: tStatic("repoNav.general"), icon: Settings },
  { to: "collaborators", label: tStatic("repoNav.collaborators"), icon: Users },
  { to: "moderation", label: tStatic("repoNav.moderation"), icon: Shield },
  { to: "branches", label: tStatic("repoNav.branches"), icon: GitBranch },
  { to: "webhooks", label: tStatic("repoNav.webhooks"), icon: Webhook },
  { to: "environments", label: tStatic("repoNav.environments"), icon: Server },
  { to: "pages", label: tStatic("repoNav.pages"), icon: Globe },
  { to: "keys", label: tStatic("repoNav.keys"), icon: KeyRound },
  { to: "secrets", label: tStatic("repoNav.secrets"), icon: LockKeyhole },
  { to: "security", label: tStatic("repoNav.security"), icon: ShieldCheck },
  { to: "installations", label: tStatic("repoNav.apps"), icon: LayoutGrid },
  { to: "copilot", label: tStatic("repoNav.copilot"), icon: Sparkles },
  { to: "codespaces", label: tStatic("repoNav.codespaces"), icon: Laptop },
  { to: "planning", label: tStatic("repoNav.planning"), icon: ListTodo },
];

export default function RepoSettingsLayout() {
  const { owner = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const repoData = useRepoData();
  const isOwner = repoData?.viewer_permission === "ADMIN";

  if (!token || !owner) {
    return <p className="text-sm text-muted-foreground">{t("repoSettings.loginFirst")}</p>;
  }

  // 非仓库管理员（直接输入 URL 访问）→ 无权限提示（与 RepoSettingsPage 原逻辑一致）
  if (!isOwner) {
    return <InlineError message={t("repoSettings.noAccess")} />;
  }

  return (
    // D 型：左导航 sticky + 右内容 max-w-230（复用 PageLayout 左栏 240 模板）
    <PageLayout
      gap="lg"
      contentClassName="max-w-230"
      left={{
        node: (
          <nav className="flex flex-col gap-4">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
      <Outlet />
    </PageLayout>
  );
}
