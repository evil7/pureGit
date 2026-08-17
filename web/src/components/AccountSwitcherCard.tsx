/**
 * 账号切换卡片（自首页 SidebarContent 提炼，用户要求替换设置页切换器）
 *
 * 精简卡片样式：整行按钮（当前账号头像 + 姓名/login + ChevronsUpDown），
 * 点击展开下拉列出全部可切换实体（个人 + 组织），点击跳转对应目标。
 * 比设置页原 arrow-switch 小图标更精简直观（用户「较为精简好看」）。
 *
 * 用法差异：
 * - 首页：items = 个人 + 全部所属组织；getTarget = /{login} 或 /orgs/{org}
 * - 设置页：items = 个人 + admin 组织（useManageableEntities）；getTarget = 对应设置页
 */
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useI18n } from "@/i18n";
import type { SwitcherEntity } from "@/components/AccountSwitcher";

export function AccountSwitcherCard({
  current,
  items,
  getTarget,
  className,
}: {
  /** 当前账号（卡片显示：头像 + 姓名/login） */
  current: SwitcherEntity;
  /** 全部可切换实体（含当前，个人在前） */
  items: SwitcherEntity[];
  /** 实体 → 跳转路径（首页 /{login}、/orgs/{org}；设置页对应 settings） */
  getTarget: (e: SwitcherEntity) => string;
  className?: string;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const label = current.name ?? current.login;

  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild className="cursor-pointer outline-none">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded p-1.5 hover:bg-accent/60"
          >
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={current.avatarUrl ?? undefined} alt={current.login} />
              <AvatarFallback>{current.login.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs">{t("account.switchAccount")}</DropdownMenuLabel>
          {items.map((e) => (
            <DropdownMenuItem key={`${e.kind}:${e.login}`} onClick={() => navigate(getTarget(e))}>
              <Avatar className="size-5">
                <AvatarImage src={e.avatarUrl ?? undefined} alt={e.login} />
                <AvatarFallback>{e.login.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate">{e.name ?? e.login}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 可切换实体（re-export 便于单点引用） */
export type { SwitcherEntity } from "@/components/AccountSwitcher";
