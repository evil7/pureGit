/**
 * 404 动态背景（animejs v4 驱动，弃用纯 CSS 原型）
 *
 * 双组件架构：
 * - `NotFoundBg`：**动态背景粒子层**（fixed inset-0 portal 到 body 铺满视口，z-index:-1）。
 *   粒子系统 = 纯随机位置 + 生命周期重生：淡入 → 停留 → 淡出 → 随机重生到新位置/新类型。
 *   生成算法保持简单高效（无排除计算）——中央内容区由主题色径向渐变遮罩盖住。
 * - `NotFoundScene`：中央场景（描边小猫 + 放大镜），animejs timeline 驱动
 *   骨骼联动：身体 rotateZ/translateX 歪头时，放大镜作为「手」带杠杆（位移 ×1.5）、
 *   惯性（慢 0.15s 到位）、手腕弹性回摆（outBack）——拟真物理态。
 * - `NotFoundSceneLayout`：可复用全屏布局——粒子背景 + PAGE_SHELL 单栏居中 children 插槽。
 *   内容层带 `.nf3d-content-mask`（主题色径向渐变遮罩）：中央不透明盖住粒子，
 *   向外渐变透明露出粒子 → 粒子与人物/子 DOM 永不视觉重叠。
 *
 * prefers-reduced-motion：背景粒子隐藏、timeline 不启动，静态展示。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createTimeline } from "animejs";
import {
  BookOpen,
  CircleHelp,
  Code,
  GitBranch,
  GitPullRequest,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { PAGE_SHELL } from "@/lib/ui/layout";

/** 随机浮点 [min, max) */
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
/** 随机整数 [min, max] */
function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

/** 背景符号类型（GitHub 相关符号） */
type SymbolKind = "q" | "pr" | "branch" | "repo" | "code" | "star";
const SYMBOL_ICONS: Record<SymbolKind, LucideIcon> = {
  q: CircleHelp,
  pr: GitPullRequest,
  branch: GitBranch,
  repo: BookOpen,
  code: Code,
  star: Star,
};
const SYMBOL_KINDS = Object.keys(SYMBOL_ICONS) as SymbolKind[];

/** 光点粒子（随机位置 + 生命周期参数；位置为视口百分比） */
type Dot = { id: number; left: number; top: number; size: number; delay: number; dur: number };
/** 符号粒子 */
type SymbolP = {
  id: number;
  kind: SymbolKind;
  left: number;
  top: number;
  size: number;
  delay: number;
  dur: number;
};

/**
 * 生成光点粒子（首次 delay 错峰；重生 delay=0 无缝衔接）。
 * 简单随机位置即可——中央内容区由「主题色径向渐变遮罩」盖住（.nf3d-content-mask），
 * 粒子即使落在中央也被遮罩隐去，无需排除计算。
 */
function spawnDot(initial: boolean): Dot {
  return {
    id: Math.floor(Math.random() * 1e9),
    left: rand(1, 99),
    top: rand(1, 98),
    size: rand(0.22, 0.42), // rem
    delay: initial ? rand(0, 2.5) : 0,
    dur: rand(1.6, 3.2),
  };
}

/** 生成符号粒子（首次 delay 错峰；重生 delay=0 无缝衔接） */
function spawnSymbol(initial: boolean): SymbolP {
  return {
    id: Math.floor(Math.random() * 1e9),
    kind: SYMBOL_KINDS[randInt(0, SYMBOL_KINDS.length - 1)],
    left: rand(1, 99),
    top: rand(1, 98),
    size: rand(0.85, 1.5), // rem
    delay: initial ? rand(0, 2.5) : 0,
    dur: rand(2.2, 3.8),
  };
}

/** 光点子组件：动画播完（淡出）→ onDone 触发重生 */
function Dot({ d, onDone }: { d: Dot; onDone: (id: number) => void }) {
  return (
    <span
      className="nf3d-dot"
      style={{
        left: `${d.left}%`,
        top: `${d.top}%`,
        width: `${d.size}rem`,
        height: `${d.size}rem`,
        animationDelay: `${d.delay}s`,
        animationDuration: `${d.dur}s`,
      }}
      onAnimationEnd={() => onDone(d.id)}
    />
  );
}

/** 符号子组件：动画播完（淡出）→ onDone 触发重生 */
function SymbolEl({ s, onDone }: { s: SymbolP; onDone: (id: number) => void }) {
  const Icon = SYMBOL_ICONS[s.kind];
  return (
    <span
      className="nf3d-symbol"
      style={{
        left: `${s.left}%`,
        top: `${s.top}%`,
        width: `${s.size}rem`,
        height: `${s.size}rem`,
        animationDelay: `${s.delay}s`,
        animationDuration: `${s.dur}s`,
      }}
      onAnimationEnd={() => onDone(s.id)}
    >
      <Icon className="size-full" strokeWidth={1.9} />
    </span>
  );
}

/** 动态背景粒子层：铺满视口（fixed inset-0 portal 到 body）。
 * 粒子纯随机位置——中央内容区由 .nf3d-content-mask 主题色渐变遮罩盖住，
 * 无需排除计算；重生排除已占用位置避免同点重叠。 */
export function NotFoundBg() {
  // 初始生成：循环累积已用位置（避免同点碰撞）
  const [dots, setDots] = useState<Dot[]>(() => {
    const used = new Set<string>();
    return Array.from({ length: 20 }, () => {
      const d = spawnDot(true);
      used.add(`${d.left.toFixed(0)},${d.top.toFixed(0)}`);
      return d;
    });
  });
  const [symbols, setSymbols] = useState<SymbolP[]>(() => {
    const used = new Set<string>();
    return Array.from({ length: 12 }, () => {
      const s = spawnSymbol(true);
      used.add(`${s.left.toFixed(0)},${s.top.toFixed(0)}`);
      return s;
    });
  });

  // 光点重生：随机新位置/新大小/新时长（delay=0 无缝衔接）
  const respawnDot = useMemo(
    () => (id: number) =>
      setDots((prev) => {
        const used = new Set(
          prev.filter((d) => d.id !== id).map((d) => `${d.left.toFixed(0)},${d.top.toFixed(0)}`),
        );
        let d = spawnDot(false);
        let tries = 0;
        while (used.has(`${d.left.toFixed(0)},${d.top.toFixed(0)}`) && tries++ < 10)
          d = spawnDot(false);
        return prev.map((p) => (p.id === id ? d : p));
      }),
    [],
  );
  // 符号重生：随机新位置/新类型/新大小
  const respawnSymbol = useMemo(
    () => (id: number) =>
      setSymbols((prev) => {
        const used = new Set(
          prev.filter((s) => s.id !== id).map((s) => `${s.left.toFixed(0)},${s.top.toFixed(0)}`),
        );
        let s = spawnSymbol(false);
        let tries = 0;
        while (used.has(`${s.left.toFixed(0)},${s.top.toFixed(0)}`) && tries++ < 10)
          s = spawnSymbol(false);
        return prev.map((p) => (p.id === id ? s : p));
      }),
    [],
  );

  // portal 到 document.body：避免被 main > * 的 page-enter 动画（transform）
  // 建立包含块导致 fixed 退化为相对容器定位（实测：body 无 transform 祖先，
  // fixed inset-0 才能真正铺满视口）
  return createPortal(
    <div aria-hidden className="nf3d-bg">
      {dots.map((d) => (
        <Dot key={d.id} d={d} onDone={respawnDot} />
      ))}
      {symbols.map((s) => (
        <SymbolEl key={s.id} s={s} onDone={respawnSymbol} />
      ))}
    </div>,
    document.body,
  );
}

/** 404 中央场景：描边小猫 + 放大镜（animejs 骨骼联动；reduced-motion 静态降级） */
export function NotFoundScene() {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // 无障碍降级：静态展示
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cat = stage.querySelector<HTMLElement>(".nf3d-cat");
    const mag = stage.querySelector<HTMLElement>(".nf3d-mag");
    if (!cat || !mag) return;

    const tl = createTimeline({
      loop: true,
      defaults: { ease: "inOutCubic" },
    });

    // —— 骨骼联动（物理态）——
    // 身体右歪（rotateZ 5° + translateX 14）：手在肩外侧，杠杆位移 ×1.6（22px）
    // 放大镜比身体慢 0.15s 到位（惯性），手腕带 outBack 弹性回摆
    tl.add(cat, { translateX: 14, rotateZ: 5, duration: 900 }, 0);
    tl.add(mag, { translateX: 22, translateY: -5, rotate: -9, duration: 1050, ease: "outBack" }, 0);

    // —— 0.9–1.5s：停顿扫视 2 次（身体静止，手腕自主摆动） ——
    tl.add(mag, { rotate: -3, duration: 260 }, 1050);
    tl.add(mag, { rotate: -9, duration: 260 }, 1330);

    // —— 1.5–2.3s：向左歪头（身体 rotateZ -5° + translateX -14） ——
    // 手随身体左移，杠杆 ×1.3（-18px），translateY 回落（身体左倾右手放低）
    tl.add(cat, { translateX: -14, rotateZ: -5, duration: 800 }, 1500);
    tl.add(
      mag,
      { translateX: -18, translateY: 2, rotate: 7, duration: 950, ease: "outBack" },
      1500,
    );

    // —— 2.3–2.9s：停顿扫视 2 次 ——
    tl.add(mag, { rotate: 15, duration: 260 }, 2450);
    tl.add(mag, { rotate: 7, duration: 260 }, 2730);

    // —— 2.9–3.6s：回正面（身体归中，放大镜带惯性回收） ——
    tl.add(cat, { translateX: 0, rotateZ: 0, duration: 700 }, 2900);
    tl.add(mag, { translateX: 0, translateY: 0, rotate: -5, duration: 830, ease: "outBack" }, 2900);

    // —— 3.6–4.0s：点头（身体 rotateZ ±2.5°，放大镜轻微衰减跟随——物理惯性） ——
    tl.add(cat, { rotateZ: 2.5, duration: 150 }, 3600);
    tl.add(cat, { rotateZ: -2.5, duration: 150 }, 3760);
    tl.add(cat, { rotateZ: 0, duration: 150 }, 3920);
    tl.add(mag, { rotate: -6.5, duration: 170 }, 3700);
    tl.add(mag, { rotate: -4, duration: 170 }, 3890);
    tl.add(mag, { rotate: -5, duration: 170 }, 4060);

    return () => {
      tl.pause();
    };
  }, []);

  return (
    <div aria-hidden className="nf3d-stage" ref={stageRef}>
      {/* 小猫层（animejs：rotateZ 歪头 + translateX 横移，纯 2D 不拉伸） */}
      <div className="nf3d-cat-pos">
        <div className="nf3d-cat">
          <Logo className="size-full text-muted-foreground" />
        </div>
      </div>
      {/* 放大镜层（animejs：translateX/Y + rotate 骨骼联动，lucide Search 图标） */}
      <div className="nf3d-mag-pos">
        <div className="nf3d-mag">
          <Search className="size-full text-muted-foreground" strokeWidth={2.25} />
        </div>
      </div>
    </div>
  );
}

/**
 * 404 全屏场景布局（可复用组件）
 *
 * 自动宽高：粒子背景 fixed inset-0 铺满整个视口（portal 到 body，z-index:-1），
 * 内容层 PAGE_SHELL 单栏居中（min-h-[60svh]）——任何页面可用本组件包裹
 * 自定义 children（标题/搜索框/链接等），即获得「全屏动态背景 + 居中内容」。
 *
 * 用法：
 * ```tsx
 * <NotFoundSceneLayout>
 *   <h1>页面不存在</h1>
 *   <form>搜索…</form>
 * </NotFoundSceneLayout>
 * ```
 *
 * @param children 内容层（z-10 盖在粒子之上）
 * @param scene    是否渲染中央场景（小猫 + 放大镜），默认 true
 */
export function NotFoundSceneLayout({
  children,
  scene = true,
}: {
  children?: React.ReactNode;
  scene?: boolean;
}) {
  return (
    <div className="relative">
      {/* 全屏动态背景（fixed inset-0 portal 到 body；纯随机位置） */}
      <NotFoundBg />
      {/* 内容层：PAGE_SHELL 单栏 + 居中 */}
      <div
        className={`${PAGE_SHELL} relative z-10 flex min-h-[60svh] flex-col items-center justify-center`}
      >
        {/* 遮罩 wrapper：自包裹内容（scene + children），尺寸 = 内容实际包围盒，
            自带主题色径向渐变遮罩（百分比相对 wrapper 自身）——
            无论 children 高宽如何变化，遮罩都自动贴合内容，父容器无需配置 */}
        <div className="nf3d-content-mask flex max-w-full flex-col items-center gap-6 text-center">
          {scene && <NotFoundScene />}
          {children}
        </div>
      </div>
    </div>
  );
}
