/**
 * 权限门（仅读写二档权限分级）
 *
 * 已登录但缺少对应权限时：子元素**置灰 + 禁用 + tooltip**（pointer-events-none）；
 * 有权限或匿名（匿名走登录引导）时原样渲染。
 *
 * - permission="write"（默认）：写操作（新建仓库/文件编辑/删除/Star/Fork…），依据 canWrite
 * - permission="editAccount"：账户设置编辑（个人资料保存…），依据 canEditAccount
 * - permission="gist"：Gist 创建/编辑，依据 canGist
 * - permission="org"：组织管理（组织资料/成员设置与修改），依据 canManageOrg
 */
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function PermissionGate({
  children,
  className,
  permission = "write",
  hint,
}: {
  children: React.ReactNode;
  className?: string;
  permission?: "write" | "editAccount" | "gist" | "org";
  hint?: string;
}) {
  const { token, canWrite, canEditAccount, canGist, canManageOrg } = useAuth();
  const { t } = useI18n();
  const has =
    permission === "write"
      ? canWrite
      : permission === "editAccount"
        ? canEditAccount
        : permission === "gist"
          ? canGist
          : canManageOrg;
  const defaultHint =
    permission === "write" ? t("gate.needFullControl") : t("gate.needFullControlShort");
  // 匿名：保持原样（点击触发登录引导）；已登录但缺权限：置灰禁用
  if (!token || has) return <>{children}</>;
  return (
    <span
      title={hint ?? defaultHint}
      aria-disabled="true"
      className={cn("pointer-events-none inline-block cursor-not-allowed opacity-40", className)}
    >
      {children}
    </span>
  );
}

/** 写操作权限门（canWrite）——旧名保留兼容 */
export function WriteGate({
  children,
  className,
  hint,
}: {
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <PermissionGate className={className} hint={hint}>
      {children}
    </PermissionGate>
  );
}
