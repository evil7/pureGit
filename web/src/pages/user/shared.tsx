/**
 * 用户级导航页共享骨架（自 UserNavPages.tsx 拆出）
 *
 * 供 /issues /pulls /repositories /gist /notifications 五处列表页共用：
 * - NavPageShell：单列「标题 + 说明 + 右上操作」骨架，未登录 → 登录引导
 * - LoadingList：列表加载态骨架
 */
import type { ReactNode } from "react";
import { LoginPrompt } from "@/components/LoginPrompt";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { PAGE_SHELL } from "@/lib/ui/layout";

/** 共享页骨架：标题 + 说明 + 可选右上角操作 + 内容（未登录 → 登录引导） */
export function NavPageShell({
  title,
  desc,
  icon,
  action,
  children,
}: {
  title: string;
  desc: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  return (
    <div className={PAGE_SHELL}>
      <header className="mb-6 flex items-center gap-3">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>
        {action && token && <div className="shrink-0">{action}</div>}
      </header>
      {token ? (
        children
      ) : (
        <div className="mx-auto max-w-sm">
          {/* 统一登录引导模板：只提醒 + 聚光灯指引右上角，不做按钮 */}
          <LoginPrompt title={title} desc={`${title} ${t("common.loginRequired")}`} />
        </div>
      )}
    </div>
  );
}

/** 列表加载态骨架（5 条占位） */
export function LoadingList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
