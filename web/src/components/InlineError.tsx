/**
 * 统一内联错误/警告提示组件（引入，全站错误展示统一）
 *
 * 背景：此前错误展示有 4 种散落样式（红卡片 / 红字 / 琥珀条 / 虚线框），
 * 现统一为本组件。与 toast（右下角全局提醒）构成双通道：
 * - InlineError：上下文内的错误展示（列表区、表单内、页面主区）
 * - toast：全局操作结果/限流提醒（toast.ts）
 *
 * 视觉规则：
 * - 默认 error 变体：红卡片 + ⚠️ 图标 + role="alert"（可访问性）
 * - 自动识别限流消息（apiErrorMessage 限流文案）→ 自动切 warning 变体（琥珀警告卡）
 * - 显式 variant="warning" 可强制琥珀（如文件树截断提示等可恢复警告）
 * - size="sm"：表单/弹窗内紧凑模式（缩小内边距）
 */
import { AlertCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** 限流消息识别标记（与 apiErrorMessage 限流文案对齐；含中英文兜底） */
const RATE_LIMIT_MARKERS = ["限流", "rate limit", "过于频繁"];

/** 判断错误消息是否为限流（供自动切 warning 变体） */
function isRateLimitMessage(message: string): boolean {
  const m = message.toLowerCase();
  return RATE_LIMIT_MARKERS.some((k) => m.includes(k.toLowerCase()));
}

export interface InlineErrorProps {
  message: string;
  /** 显式指定变体；缺省时自动检测限流 → warning */
  variant?: "error" | "warning";
  /** 紧凑模式（表单/弹窗内） */
  size?: "md" | "sm";
  className?: string;
}

export function InlineError({ message, variant, size = "md", className }: InlineErrorProps) {
  const warning = variant === "warning" || (variant === undefined && isRateLimitMessage(message));
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border text-sm",
        // 警告（限流/可恢复）：琥珀；错误（致命）：红
        warning
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-destructive/30 bg-destructive/10 text-destructive",
        size === "md" ? "px-4 py-3" : "px-2.5 py-2",
        className,
      )}
    >
      {warning ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="min-w-0">{message}</span>
    </p>
  );
}
