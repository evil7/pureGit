/**
 * Fork 引导守卫（非本人仓库的写操作入口拦截）
 *
 * 官方语义：编辑/新建/删除**他人仓库**文件前必须 fork（GitHub 官方对无权限用户
 * 直接引导 Create a fork 流程）。本组件在 `owner !== 当前登录用户` 时拦截写操作点击：
 * - 不触发原页面导航 / 确认框（去 AlertDialog——2026-08-14 用户要求）
 * - sonner toast 提示「请 Fork 项目或成为本管理者、协作者后进行操作」
 * - 登录聚光灯聚焦遮罩引导点击页面头部 Fork 按钮（ForkTargetMenu 目标选择）
 *
 * 用法：
 * <ForkGate owner={owner}><Link to={...}>编辑</Link></ForkGate>
 * <ForkGate owner={owner}><Button onClick={...}>删除</Button></ForkGate>
 *
 * 注：仅判断「仓库 owner = 登录用户」为本人管理（组织成员权限需额外 API，暂不纳入）；
 * 与 WriteGate（scope 权限）互补：WriteGate 管令牌写权限，ForkGate 管仓库归属。
 * fork 按钮定位 id 见 ForkTargetMenu（repo-fork-btn）。
 */
import { type ReactNode } from "react";
import { triggerRippleSpotlight } from "@/lib/ui/ripple-spotlight";
import { toastWarning } from "@/lib/ui/toast";
import { useAuth } from "@/hooks/useAuth";

export function ForkGate({
  owner,
  children,
  className,
}: {
  /** 仓库 owner（与当前登录用户比对；非本人 → 拦截） */
  owner: string;
  children: ReactNode;
  className?: string;
}) {
  const { user, token } = useAuth();
  // 本人仓库（含匿名——匿名走登录引导，不拦截）→ 直接放行
  const isOwn = !token || owner.toLowerCase() === user?.login?.toLowerCase();
  if (isOwn) return <>{children}</>;

  // 非本人仓库：点击拦截（不导航/不弹确认框）→ toast 提示 + 聚光灯引导点击头部 Fork 按钮。
  // **必须用捕获阶段（onClickCapture）**：Link 的 navigate 在子元素 a 的冒泡 handler 已执行，
  // 父级 span 冒泡 onClick 拦不住（导航先发生）——捕获阶段先于 target 冒泡，可阻止
  const block = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toastWarning(
      "请 Fork 项目或成为本管理者、协作者后进行操作",
      "Fork 后可在副本中编辑文件，经 Pull Request 提交回原仓库",
    );
    // 聚焦遮罩引导点击页面头部 Fork 按钮（StarForkButtons → ForkTargetMenu id）
    triggerRippleSpotlight("#repo-fork-btn", { duration: 2000 });
  };

  return (
    <span
      className={className}
      onClickCapture={block}
      role="button"
      tabIndex={0}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" || e.key === " ") block(e);
      }}
    >
      {children}
    </span>
  );
}
