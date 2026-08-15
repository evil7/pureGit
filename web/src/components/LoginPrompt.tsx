/**
 * 登录引导统一模板
 *
 * 用于所有「因权限问题需登录操作」的页面/区块：
 * - 只提醒 + 指引右上角登录，**不做登录按钮**（登录入口统一在 topbar 右上角）
 * - 挂载时自动触发涟漪聚光灯动画（RippleSpotlight）：遮罩圆从大缩小移向目标元素，2s 淡出
 *
 * 用法：<LoginPrompt title={...} desc={...} />
 * 页面需登录分支统一替换为本组件（NewIssue/NewPR/NewRepo/设置页/我的维度列表等）。
 */
import { useEffect } from "react";
import { LogIn } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  triggerRippleSpotlight,
  type RippleTarget,
  type RippleOptions,
} from "@/lib/ui/ripple-spotlight";

export function LoginPrompt({
  title,
  desc,
  className,
  spotlightTarget,
  spotlightOptions,
}: {
  /** 主标题（如「新建 Issue」「该操作需要登录」） */
  title: string;
  /** 副描述（如「登录后可提交 issue，请求由你的 GitHub 账号发出」） */
  desc?: string;
  className?: string;
  /** 涟漪聚光灯目标（默认右上角登录按钮；可指定任意元素/选择器） */
  spotlightTarget?: RippleTarget;
  /** 涟漪聚光灯动画参数（restoreAt 提前还原 / duration / 阶段比例 / scrollToTarget 目标不可见时滚动） */
  spotlightOptions?: RippleOptions;
}) {
  const { t } = useI18n();

  // 挂载后稍延迟触发聚光灯（等待渲染稳定，动画从页面中心平滑过渡到右上角登录按钮）
  useEffect(() => {
    const timer = setTimeout(() => triggerRippleSpotlight(spotlightTarget, spotlightOptions), 350);
    return () => clearTimeout(timer);
  }, [spotlightTarget, spotlightOptions]);

  return (
    <div className={cn("flex flex-col items-center gap-4 py-16 text-center", className)}>
      <Logo className="size-14 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{title}</h1>
      {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      {/* 指引右上角登录（无按钮；聚光灯动画已指向该位置） */}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <LogIn className="size-4 shrink-0" />
        {t("login.prompt.toTopRight")}
      </p>
    </div>
  );
}
