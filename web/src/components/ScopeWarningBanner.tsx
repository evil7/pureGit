/**
 * 全局权限提示条（查漏补缺）
 *
 * 场景：GitHub OAuth 用户可在授权页少授 scope（官方文档明示）→ 部分功能不可用。
 * 登录后若 detected 缺失（missingScopes 非空），在全局顶部（Nav 下）显示提示条，
 * 一键「补充授权」重新走 OAuth 流程（GitHub 增量授权自动合并新增 scope）。
 */
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { describeScopes } from "@/lib/auth/scopes";
import { Button } from "@/components/ui/button";

export default function ScopeWarningBanner() {
  const { missingScopes, login, scopes } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (!missingScopes || missingScopes.length === 0) return null;

  const mode = scopes?.mode === "write" ? "write" : "read";

  return (
    <div className="border-b bg-amber-50 px-4 py-2 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          {t("scopeWarning.title")}
        </span>
        <span className="text-amber-700/80 dark:text-amber-300/80">
          {t("scopeWarning.desc").replace("{scopes}", describeScopes(missingScopes))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1 border-amber-600/40 text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-900/50"
            onClick={() => login({ mode, redirect: `${location.pathname}${location.search}` })}
          >
            <ShieldCheck className="size-3.5" />
            {t("scopeWarning.reauthorize")}
          </Button>
        </span>
      </div>
    </div>
  );
}
