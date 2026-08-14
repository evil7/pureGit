/**
 * Fork 目标选择菜单（统一 fork 到哪：个人 / 组织）
 *
 * 官方 GitHub fork 弹窗语义：选择 fork 目标（Owner：本人 + 可 fork 的组织）→ Fork 按钮。
 * 本项目以下拉菜单实现（官方弹窗的轻量版），StarForkButtons（仓库页头部）与
 * NeedFork（非本人仓库编辑占位页）共用——避免两处各自实现组织加载/执行逻辑。
 *
 * - 触发：按钮（StarForkButtons 的 Fork 按钮）或自定义 trigger
 * - 列表：本人（登录名）+ fetchUserOrgsSmart 拉取的组织（带头像）
 * - 选中目标 → forkRepositorySmart(token, owner, repo, organization) → onForked(fullName)
 * - busy：fork 执行中显示 spinner
 * - 未登录：点击直接弹登录引导（fork 需令牌）
 */
import { useState } from "react";
import { GitFork, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { triggerRippleSpotlight } from "@/lib/ui/ripple-spotlight";
import { forkRepositorySmart, fetchUserOrgsSmart, type UserOrgItem } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { toastSuccess, toastError } from "@/lib/ui/toast";

/** fork 目标选项（个人或组织） */
export interface ForkTarget {
  /** 目标 login（fork 归属；个人 = 登录名，组织 = 组织 login） */
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** 是否组织（false = 个人） */
  isOrg: boolean;
}

export function ForkTargetMenu({
  owner,
  repo,
  forks,
  onForked,
  id,
  variant = "outline",
  size = "sm",
}: {
  /** 源仓库 owner */
  owner: string;
  /** 源仓库名 */
  repo: string;
  /** fork 计数（按钮徽标显示） */
  forks?: number;
  /** fork 成功回调（父组件跳转/更新计数；返回 fork 后 full_name） */
  onForked?: (fullName: string) => void;
  /** 按钮 id（聚光灯引导定位：非本人仓库写操作拦截后引导点击 fork） */
  id?: string;
  variant?: "outline" | "default";
  size?: "sm" | "default";
}) {
  const { token, user } = useAuth();
  const [orgs, setOrgs] = useState<UserOrgItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  // 本人仓库（owner = 登录用户）→ 点击直接 fork 到本人，无下拉选择（2026-08-14 用户要求）；
  // 非本人仓库 → 下拉选择目标（本人/组织）
  const isOwnRepo = Boolean(token) && owner.toLowerCase() === user?.login?.toLowerCase();

  // 目标列表：本人 + 组织（懒加载，打开时拉取一次）
  const openMenu = (open: boolean) => {
    if (open && token && orgs === null) {
      void fetchUserOrgsSmart(token)
        .then(setOrgs)
        .catch(() => setOrgs([]));
    }
  };

  const doFork = async (targetOrg: string | undefined) => {
    if (!token) {
      // 未登录：聚光灯引导右上角登录按钮（与项目写操作一致）
      triggerRippleSpotlight();
      return;
    }
    setBusy(true);
    try {
      const fullName = await forkRepositorySmart(token, owner, repo, targetOrg);
      toastSuccess(`已 Fork 到 ${fullName}`);
      onForked?.(fullName);
    } catch {
      toastError("Fork 失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  // 目标列表构建：本人恒在首位
  const targets: ForkTarget[] = [
    ...(user?.login ? [{ login: user.login, name: null, avatarUrl: null, isOrg: false }] : []),
    ...(orgs ?? []).map((o) => ({
      login: o.login,
      name: o.name,
      avatarUrl: o.avatarUrl,
      isOrg: true,
    })),
  ];

  // 按钮（无下拉箭头，保持原样视觉：GitFork + Fork + 计数；非本人仓库点击仍弹目标选择菜单）
  const button = (
    <Button
      id={id}
      variant={variant}
      size={size}
      disabled={busy !== false}
      onClick={() => {
        if (isOwnRepo) void doFork(undefined); // 本人项目：直接 fork 本人
      }}
      aria-label="Fork 仓库"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
      Fork
      {typeof forks === "number" && (
        <span className="text-muted-foreground">{formatCount(forks)}</span>
      )}
    </Button>
  );

  // 本人仓库：直接 fork，无下拉
  if (isOwnRepo) return button;

  return (
    <DropdownMenu onOpenChange={openMenu}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">Fork 到</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {targets.map((tg) => (
          <DropdownMenuItem
            key={tg.login}
            onClick={() => void doFork(tg.isOrg ? tg.login : undefined)}
            className={cn("flex items-center gap-2")}
          >
            <Avatar className="size-5">
              {tg.avatarUrl && <AvatarImage src={tg.avatarUrl} alt={tg.login} />}
              <AvatarFallback className="text-[10px]">
                {tg.login.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate">
              {tg.login}
              {tg.isOrg && <span className="ml-1.5 text-xs text-muted-foreground">组织</span>}
            </span>
          </DropdownMenuItem>
        ))}
        {targets.length === 0 && (
          <DropdownMenuItem disabled className="text-sm text-muted-foreground">
            暂无可用目标
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
