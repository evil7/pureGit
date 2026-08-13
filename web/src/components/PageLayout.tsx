/**
 * PageLayout —— 全站统一三栏布局（布局体系重构，替代散落 GRID_2COL_* 常量与手写 grid）
 *
 * 设计依据：GitHub 官方 PageLayout 分型（docs/research/32 + 三份实测审计）——
 * 官方全部页面 ≤ 三栏：左栏（可选）+ 主内容 + 右栏（可选），任一栏不传即不渲染。
 *
 * 用法：
 *   <PageLayout
 *     left={{ node: <nav/>, width: 280, sticky: "nav" }}      // 左栏：导航型 sticky
 *     right={{ node: <aside/>, width: 296, sticky: "nav", breakpoint: "md" }}  // 右栏
 *     gap="sm" | "md" | "lg"
 *     contentClassName="max-w-230"                            // 可选内容限宽
 *   >
 *     <main>…</main>
 *   </PageLayout>
 *
 * 关键能力：
 *   1. 静态选择：不传 left/right → 单列 A 型（不渲染该栏 DOM）
 *   2. 动态显隐：传 left.hidden=true → 该栏 hidden 保留 DOM（blob 折叠树场景，
 *      防重挂载重复请求）+ grid 模板自动收敛为单列
 *   3. sticky 两态（官方实测）：nav=纯吸附 / tool=限高内滚 / none=随内容滚动
 *      （简化：SIDEBAR_FILL 通底版并入 tool，blob 树底部留 32px 余量）
 *   4. 断点三档：md(768) / lg(1024) / xl(1280)（官方：D 导航 md；B 树/About lg~1100；Dashboard xl）
 *   5. 宽度参数化（官方实测：200/220/240/260/280/296/300/320/336/344）
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SIDEBAR_STICKY, SIDEBAR_STICKY_SCROLL, CONTENT_FILL } from "@/lib/ui/layout";

export type SideSticky = "nav" | "tool" | "none";
export type SideBreakpoint = "md" | "lg" | "xl";

export interface PageLayoutSide {
  /** 侧栏内容（传 null/undefined 整栏不渲染） */
  node: ReactNode;
  /** 侧栏宽度（官方实测值：200/220/240/260/280/296/300/320/336/344） */
  width: number;
  /** 可选：lg 断点加宽（blob 文件树 md 240 → lg 320 场景） */
  lgWidth?: number;
  /** sticky 策略：nav=导航型纯吸附 / tool=工具型限高内滚 / none=随内容滚动 */
  sticky?: SideSticky;
  /** 侧栏生效断点（默认 md） */
  breakpoint?: SideBreakpoint;
  /** 动态显隐（保留 DOM，仅隐藏 + grid 模板收敛；blob 折叠树场景） */
  hidden?: boolean;
  /** 侧栏容器额外类名 */
  className?: string;
}

interface PageLayoutProps {
  left?: PageLayoutSide;
  right?: PageLayoutSide;
  /** 列间距：sm=gap-3 / md=gap-6 / lg=gap-8（官方 280 系 gap-3，其余 gap-6/8） */
  gap?: "sm" | "md" | "lg";
  /** 内容区额外类名（如 max-w-230 限宽；min-w-0 已内置） */
  contentClassName?: string;
  className?: string;
  children: ReactNode;
}

/* ── grid 模板静态映射 ─────────────────────────────────────────────
 * ⚠️ Tailwind 4 JIT 只扫描源码静态类名字符串，运行时拼串不会生成样式。
 * 故把全站实际用到的列组合预写为静态映射（来自官方实测宽度），
 * 新增组合需在此补充并重建。 */
const GRID_TEMPLATES = {
  // 单列
  single: "grid-cols-1",
  // 左栏 + 内容（md 起）
  "md-left-200": "md:grid-cols-[200px_minmax(0,1fr)]",
  "md-left-220": "md:grid-cols-[220px_minmax(0,1fr)]",
  "md-left-240": "md:grid-cols-[240px_minmax(0,1fr)]",
  "md-left-260": "md:grid-cols-[260px_minmax(0,1fr)]",
  "md-left-280": "md:grid-cols-[280px_minmax(0,1fr)]",
  "md-left-296": "md:grid-cols-[296px_minmax(0,1fr)]",
  // 左栏 + 内容（lg 起）
  "lg-left-300": "lg:grid-cols-[300px_minmax(0,1fr)]",
  "lg-left-320": "lg:grid-cols-[320px_minmax(0,1fr)]",
  "lg-left-336": "lg:grid-cols-[336px_minmax(0,1fr)]",
  // blob 文件树：md 240 → lg 320（官方 B 型树宽渐进）
  "md-left-240-lg-320": "md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]",
  // 内容 + 右栏（md 起）
  "md-right-280": "md:grid-cols-[minmax(0,1fr)_280px]",
  "md-right-296": "md:grid-cols-[minmax(0,1fr)_296px]",
  "md-right-320": "md:grid-cols-[minmax(0,1fr)_320px]",
  // 内容 + 右栏（lg 起，官方 About 320px pane）
  "lg-right-320": "lg:grid-cols-[minmax(0,1fr)_320px]",
  // 三栏（lg 起）
  "lg-both-320-300": "lg:grid-cols-[320px_minmax(0,1fr)_300px]",
  "lg-both-320-344": "lg:grid-cols-[320px_minmax(0,1fr)_344px]",
  // 三栏（xl 起，Dashboard）
  "xl-both-336-312": "xl:grid-cols-[336px_minmax(0,1fr)_312px]",
} as const;

type TemplateKey = keyof typeof GRID_TEMPLATES;

/** 计算当前列组合的模板 key（left/right 均按 hidden 过滤——hidden 栏不占列） */
function templateKey(
  left: PageLayoutSide | undefined,
  right: PageLayoutSide | undefined,
): TemplateKey {
  const l = left && !left.hidden ? left : undefined;
  const r = right && !right.hidden ? right : undefined;
  if (l && r) {
    const bp = l.breakpoint ?? "lg";
    const key = `${bp}-both-${l.width}-${r.width}` as TemplateKey;
    return GRID_TEMPLATES[key] ? key : "lg-both-320-300";
  }
  if (l) {
    // blob 双断点树宽（md 240 → lg 320；PageLayoutSide 传 lgWidth 触发）
    if (l.breakpoint === "md" && "lgWidth" in l) {
      const lgKey = `md-left-${l.width}-lg-${(l as { lgWidth: number }).lgWidth}` as TemplateKey;
      if (GRID_TEMPLATES[lgKey]) return lgKey;
    }
    const bp = l.breakpoint ?? "md";
    const key = `${bp}-left-${l.width}` as TemplateKey;
    return GRID_TEMPLATES[key] ? key : "md-left-280";
  }
  if (r) {
    const bp = r.breakpoint ?? "md";
    const key = `${bp}-right-${r.width}` as TemplateKey;
    return GRID_TEMPLATES[key] ? key : "md-right-280";
  }
  return "single";
}

/** sticky 策略 → 布局常量（官方两态；none = 不 sticky 随内容滚动） */
function stickyCls(s: SideSticky | undefined): string {
  switch (s) {
    case "nav":
      return SIDEBAR_STICKY;
    case "tool":
      return SIDEBAR_STICKY_SCROLL;
    default:
      return "";
  }
}

const GAP: Record<NonNullable<PageLayoutProps["gap"]>, string> = {
  sm: "gap-3",
  md: "gap-6",
  lg: "gap-8",
};

export default function PageLayout({
  left,
  right,
  gap = "md",
  contentClassName,
  className,
  children,
}: PageLayoutProps) {
  const template = templateKey(left, right);
  return (
    <div className={cn("grid items-start", GAP[gap], GRID_TEMPLATES[template], className)}>
      {/* 左栏：hidden 时保留 DOM（防重挂载重复请求），仅视觉隐藏 */}
      {left && (
        <div
          className={cn("min-w-0", stickyCls(left.sticky), left.className, left.hidden && "hidden")}
        >
          {left.node}
        </div>
      )}
      {/* 主内容：min-w-0 防溢出 + 有侧栏时 CONTENT_FILL 撑满 + 可选限宽 */}
      <main className={cn("min-w-0", template !== "single" && CONTENT_FILL, contentClassName)}>
        {children}
      </main>
      {/* 右栏：同上 */}
      {right && (
        <div
          className={cn(
            "min-w-0",
            stickyCls(right.sticky),
            right.className,
            right.hidden && "hidden",
          )}
        >
          {right.node}
        </div>
      )}
    </div>
  );
}
