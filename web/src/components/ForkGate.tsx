/**
 * Fork 引导守卫（无仓库写权限时的写操作入口拦截）
 *
 * 官方语义：编辑/新建/删除**无写权限仓库**文件前必须 fork（GitHub 官方对无权限用户
 * 直接引导 Create a fork 流程）。本组件依据**仓库级写权限**（viewer_permission ∈ WRITE+）判断：
 * - 有写权限（owner / 协作者 / 组织成员）→ 放行直接编辑
 * - 无写权限的登录用户 → 拦截写操作点击：sonner toast 提示 + 登录聚光灯聚焦头部 Fork 按钮
 * - 匿名 → 放行（走登录引导，不拦截）
 *
 * 用法：
 * <ForkGate><Link to={...}>编辑</Link></ForkGate>
 * <ForkGate><Button onClick={...}>删除</Button></ForkGate>
 *
 * 与 WriteGate（scope 权限）互补：WriteGate 管令牌写 scope，ForkGate 管仓库级写权限。
 * fork 按钮定位 id 见 StarForkButtons（repo-fork-btn，点击跳官方 fork 复刻页 /fork）。
 */
import { type ReactNode } from "react";
import { triggerRippleSpotlight } from "@/lib/ui/ripple-spotlight";
import { toastWarning } from "@/lib/ui/toast";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";

export function ForkGate({ children, className }: { children: ReactNode; className?: string }) {
  const { token } = useAuth();
  const { canWrite } = useRepoPermission();
  // 匿名（无 token）→ 放行走登录引导；有仓库写权限（WRITE+）→ 放行直接编辑
  if (!token || canWrite) return <>{children}</>;

  // 无仓库写权限：点击拦截（不导航/不弹确认框）→ toast 提示 + 聚光灯引导点击头部 Fork 按钮。
  // **必须用捕获阶段（onClickCapture）**：Link 的 navigate 在子元素 a 的冒泡 handler 已执行，
  // 父级 span 冒泡 onClick 拦不住（导航先发生）——捕获阶段先于 target 冒泡，可阻止
  const block = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toastWarning(
      "请 Fork 项目或成为本管理者、协作者后进行操作",
      "Fork 后可在副本中编辑文件，经 Pull Request 提交回原仓库",
    );
    // 聚焦遮罩引导点击页面头部 Fork 按钮（StarForkButtons → 跳 /fork 页）
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
