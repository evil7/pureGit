/**
 * 分段控件（Segmented Control）——公共组件
 *
 * 统一项目内多处重复的「选项组」实现（曾散落 8 处相同 JSX）：
 * LoginScopeDialog 权限模式、SettingsLayout 权限切换、PreferencesSettings 语言/日期/主题、
 * HomePage 周期、编辑器 Write/Preview 切换。
 *
 * 两种变体：
 * - box（默认）：容器式（rounded-lg border bg-muted/40 p-1），激活项 bg-background + shadow
 *   —— 设置页/权限选择等正式场景
 * - tab：轻量式（无容器），激活项 bg-accent —— Write/Preview、周期切换等紧凑场景
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  variant = "box",
  size = "sm",
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (v: T) => void;
  /** box=容器式（默认）；tab=轻量式（无容器） */
  variant?: "box" | "tab";
  /** sm=text-sm + size-4 图标（默认）；xs=text-xs + size-3.5 图标 */
  size?: "sm" | "xs";
  /** 容器附加类（如 sm:flex-row、lg:w-1/3） */
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex gap-1",
        variant === "box" && "rounded-lg border bg-muted/40 p-1",
        variant === "tab" && "gap-0.5",
        className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onValueChange(v)}
          className={cn(
            "flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-1.5 text-sm" : "px-2 py-1 text-xs",
            variant === "box" && "flex-1",
            value === v
              ? variant === "box"
                ? "bg-background text-foreground shadow-sm"
                : "bg-accent text-foreground"
              : variant === "box"
                ? "text-muted-foreground hover:text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {Icon && <Icon className={size === "sm" ? "size-4 shrink-0" : "size-3.5 shrink-0"} />}
          {label}
        </button>
      ))}
    </div>
  );
}
