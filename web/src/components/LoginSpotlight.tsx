/**
 * 登录聚光灯动画（参数化 + 聚焦强调 + 阻尼感）
 *
 * 将遮罩视为**有内外径的环形（donut/pie）**，圆心固定在目标元素中心：
 *   阶段 1（变暗聚拢）：外径固定 = 安全覆盖屏幕，内径 外径→0（easeOut）
 *       → 暗色环形从屏幕四周向圆心聚拢填充，逐步覆盖整个屏幕（变暗）
 *   阶段 2（变亮收缩聚焦）：内径 0→目标半径（挖出目标「洞」），
 *       外径 覆盖屏幕→目标半径×2.4（收缩）→ 停在目标元素处，形成
 *       「目标亮、四周暗」的聚焦环（变亮恢复但聚焦到目标）
 *   阶段 3（阻尼脉冲强调）：聚焦环半径做**指数衰减阻尼振荡**（3 次跳动），
 *       同时整体淡出——对目标元素「跳动/明显提示」
 * 全程曲线 easeOutCubic（从快到慢，阻尼感）；rAF 驱动，等圆（radial-gradient 天然正圆）。
 *
 * 参数化：
 *   `triggerLoginSpotlight(target?)` —— target 可为：
 *     - HTMLElement：任意元素（自动 getBoundingClientRect 算中心与半径）
 *     - string：CSS 选择器（如 "#my-btn"）
 *     - 省略/undefined/null：默认右上角登录按钮（#topbar-login-btn）
 *   `LoginPrompt` 可传 `spotlightTarget` prop 指定其他目标。
 */
import { useEffect, useRef, useState } from "react";
import {
  SPOTLIGHT_EVENT,
  type SpotlightTarget,
  type SpotlightOptions,
  resolveSpotlightTarget,
} from "@/lib/login-spotlight";

/** 默认参数（可被 SpotlightOptions 覆盖）
 * duration 1600 = 变暗 400ms + 收缩 200ms + 聚焦环淡出 1000ms */
const DEFAULT_OPTIONS: Required<SpotlightOptions> = {
  restoreAt: 0.8,
  duration: 1600,
  phase1Ratio: 0.25,
  phase2Ratio: 0.375,
};
/** 目标组件摇头抖动时长（ms，聚焦环形成时触发一次） */
const SHAKE_MS = 450;
/** 聚焦环外径倍数（目标半径 × 倍数 = 暗环外圈） */
const FOCUS_OUTER_MULT = 2.4;
/** 聚焦环内径倍数（目标半径 × 倍数 = 目标「洞」） */
const FOCUS_INNER_MULT = 1.2;
/** 边缘羽化宽度（px）：内径/外径各加一段渐变过渡带，圆边虚化不生硬 */
const FEATHER = 24;

/** easeOutCubic：从快到慢（阻尼感） */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function LoginSpotlight() {
  const [show, setShow] = useState(false);
  const [target, setTarget] = useState<{
    x: number;
    y: number;
    /** 目标元素半径（max(w,h)/2；聚焦环尺寸基准） */
    radius: number;
    /** 目标元素引用（聚焦环形成时摇头抖动用） */
    el: HTMLElement | null;
  } | null>(null);
  const [options, setOptions] = useState<Required<SpotlightOptions>>(DEFAULT_OPTIONS);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const onTrigger = (e: Event) => {
      // 兼容旧 detail 直传 target；新格式 { target, options }
      const d = (e as CustomEvent).detail as
        | SpotlightTarget
        | { target?: SpotlightTarget; options?: SpotlightOptions };
      const rawTarget =
        d && typeof d === "object" && !(d instanceof HTMLElement) && "target" in d
          ? (d as { target?: SpotlightTarget }).target
          : (d as SpotlightTarget);
      const rawOptions =
        d && typeof d === "object" && "options" in d
          ? (d as { options?: SpotlightOptions }).options
          : undefined;
      const el = resolveSpotlightTarget(rawTarget);
      let x: number, y: number, radius: number;
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
        radius = Math.max(r.width, r.height) / 2;
      } else {
        // 回退：视口右上角（距顶 40px），半径 20px
        x = window.innerWidth - 60;
        y = 40;
        radius = 20;
      }
      setTarget({ x, y, radius, el });
      setOptions({ ...DEFAULT_OPTIONS, ...rawOptions });
      setShow(true);
    };
    window.addEventListener(SPOTLIGHT_EVENT, onTrigger);
    // cleanup 用局部引用（ref.current 在 cleanup 时可能已变化，exhaustive-deps 提示）
    const timersSnapshot = timers.current;
    return () => {
      window.removeEventListener(SPOTLIGHT_EVENT, onTrigger);
      timersSnapshot.forEach(clearTimeout);
    };
  }, []);

  // 播放结束（options.duration）后卸载
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => {
      setShow(false);
      setTarget(null);
    }, options.duration + 50);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [show, options.duration]);

  // 聚焦环形成时：目标组件轻微摇头抖动一下
  useEffect(() => {
    const el = target?.el;
    if (!show || !el) return;
    const t = window.setTimeout(() => {
      el.classList.add("spotlight-shake");
      const rm = window.setTimeout(() => el.classList.remove("spotlight-shake"), SHAKE_MS + 100);
      timers.current.push(rm);
    }, options.duration * options.phase2Ratio);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [show, target, options]);

  if (!show || !target) return null;
  return (
    <SpotlightLayer
      target={target}
      options={options}
      key={`${target.x}-${target.y}-${Date.now()}`}
    />
  );
}

/** 参数化环形涟漪动画层（每次 key 重建）。
 * mask radial-gradient 环形：`transparent 内径 / #000 内径→外径（暗色环） / transparent 外径外`。
 * **内外径独立时间线**（restoreAt 只影响外径启动）：
 *   内径：t∈[0,P1] R_OUTER→0（变暗聚拢）→ [P1,P2] 0→R_INNER（挖目标洞）→ 恒 R_INNER
 *   外径：t∈[0,T2] 恒 R_OUTER → [T2,P2] R_OUTER→R_FOCUS（T2=P1·restoreAt，追尾）→ 恒 R_FOCUS
 *   opacity：t∈[0,P2] 1 → [P2,1] **线性 1→0**（聚焦环匀速淡出 1s，无振荡跳帧）
 * 目标组件摇头抖动由 LoginSpotlight 触发（spotlight-shake）。 */
function SpotlightLayer({
  target,
  options,
}: {
  target: { x: number; y: number; radius: number; el: HTMLElement | null };
  options: Required<SpotlightOptions>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const CX = target.x;
    const CY = target.y;
    // 外径 = 圆心到屏幕**最远角**的距离 × 1.1（安全覆盖整个屏幕，勿用对角线/2）
    const R_OUTER = Math.hypot(Math.max(CX, W - CX), Math.max(CY, H - CY)) * 1.1;
    // 聚焦环尺寸（基于目标元素半径）
    const R_INNER = Math.max(target.radius, 12) * FOCUS_INNER_MULT;
    const R_FOCUS = Math.max(target.radius, 12) * FOCUS_OUTER_MULT;
    const DURATION = options.duration;
    const P1 = options.phase1Ratio;
    const P2 = options.phase2Ratio;
    // 外径收缩启动时刻（restoreAt 只影响外径；内径时间线不受影响）
    const T2 = P1 * Math.min(Math.max(options.restoreAt, 0.01), 1);
    const start = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      // 内径（独立时间线，不受 restoreAt 影响）
      let rInner: number;
      if (t < P1) {
        rInner = R_OUTER * (1 - easeOutCubic(t / P1)); // R_OUTER → 0
      } else if (t < P2) {
        rInner = R_INNER * easeOutCubic((t - P1) / (P2 - P1)); // 0 → R_INNER（挖洞）
      } else {
        rInner = R_INNER; // 恒定聚焦环内径
      }
      // 外径（restoreAt 只影响收缩启动时间）
      let rOuter: number;
      if (t < T2) {
        rOuter = R_OUTER; // 覆盖全屏不动
      } else if (t < P2) {
        rOuter = R_OUTER + (R_FOCUS - R_OUTER) * easeOutCubic((t - T2) / (P2 - T2));
      } else {
        rOuter = R_FOCUS; // 恒定聚焦环外径
      }
      // 聚焦环匀速淡出（P2 之后线性 1→0，1s）
      let opacity = 1;
      if (t >= P2) {
        opacity = Math.max(1 - (t - P2) / (1 - P2), 0);
      }
      // 环形遮罩（羽化软边）：内径内透明（目标亮）→ 渐变过渡到暗色环 → 渐变过渡到外径外透明。
      const feather = Math.min(FEATHER, (rOuter - rInner) / 2);
      const mask = `radial-gradient(circle at ${CX}px ${CY}px, transparent 0px, transparent ${rInner}px, rgba(0,0,0,1) ${rInner + feather}px, rgba(0,0,0,1) ${rOuter - feather}px, transparent ${rOuter}px)`;
      el.style.webkitMaskImage = mask;
      el.style.maskImage = mask;
      el.style.opacity = String(opacity);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, options]);

  return <div ref={ref} className="login-spotlight" aria-hidden="true" />;
}
