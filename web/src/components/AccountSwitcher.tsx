/**
 * 账号切换器
 *
 * 设置页左栏卡片右侧的切换控件：GitHub 官方 arrow-switch 图标触发下拉框，
 * 列出「个人账户 + 管理的组织」，点击跳转对应设置页。
 * - 个人账户 → /settings/preferences
 * - 管理中的组织（admin 角色）→ /organizations/{org}/settings
 *
 * 实体列表由调用方提供（useManageableEntities，仅含可进设置的 admin 组织）。
 * 当前上下文不高亮勾选（用户要求：选中不需要 √）。
 * 仅一个实体时隐藏（无可切换）。
 */
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** 切换实体：个人账户 或 组织 */
export interface SwitcherEntity {
  /** user（个人账户）| org（组织） */
  kind: "user" | "org";
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

function targetPath(e: SwitcherEntity): string {
  return e.kind === "org" ? `/organizations/${e.login}/settings/profile` : "/settings/profile";
}

/** GitHub 官方 octicon arrow-switch（16px，双向切换箭头） */
function ArrowSwitchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      className={cn("fill-current", className)}
    >
      <path d="M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3Zm5.56-6.5a.75.75 0 1 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.69L9.72 2.28a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3Z" />
    </svg>
  );
}

export function AccountSwitcher({
  entities,
  current: _current,
  className,
}: {
  /** 全部可切换实体（个人 + admin 组织，按序） */
  entities: SwitcherEntity[];
  /** 当前实体标识（login 匹配；个人账户用 user.login）； 起无 √/高亮，仅保留接口 */
  current: string;
  className?: string;
}) {
  const navigate = useNavigate();
  if (entities.length < 2) return null; // 无其他可切换实体 → 不渲染

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
        aria-label="切换账号/组织"
      >
        <ArrowSwitchIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>切换设置</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {entities.map((e) => (
          <DropdownMenuItem key={`${e.kind}:${e.login}`} onSelect={() => navigate(targetPath(e))}>
            <Avatar className="size-6">
              {e.avatarUrl && <AvatarImage src={e.avatarUrl} alt={e.login} />}
              <AvatarFallback>{e.login.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            {/* 左侧显示所设置的姓名（无则回退 login）；右侧才是 @account */}
            <span className="min-w-0 flex-1 truncate">{e.name || e.login}</span>
            <span className="shrink-0 text-xs text-muted-foreground">@{e.login}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
