import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 通用悬停提示封装（shadcn Tooltip）。
 * 替代散落的原生 `title="..."` 属性，统一交互风格与延迟。
 * 自带 TooltipProvider（delayDuration=300 标准延迟），任意挂载点可用。
 */
export function Tip({
  label,
  children,
  side = "bottom",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className={className}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
