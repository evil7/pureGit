/**
 * 涟漪聚光灯动画（参数化 + 聚焦强调 + 阻尼感）
 *
 * 2026-08-14 重命名：LoginSpotlight → RippleSpotlight（登录聚光灯 → 通用涟漪聚光灯，
 * 现也用于 fork 引导等非登录场景）。**可见性自适应**：目标已在视口内则**直接**取位置
 * 播放动画（跳过滚动等待，避免可见时的延迟）；不可见才 smooth 滚动到垂直居中（参考
 * `↑ Top` 按钮行为），**待滚动结束**再播放涟漪聚拢动画——画面先顺滑到位再聚焦。
 *
 * 触发（跨文件统一 API，见 ripple-spotlight.ts）：
 *   `triggerRippleSpotlight(target?, options?)` —— target 可为：
 *     - HTMLElement：直接定位
 *     - string：CSS 选择器（如 "#repo-fork-btn"）
 *     - null/省略：右上角登录按钮（LOGIN_TRIGGER_ID）
 *   `LoginPrompt` 可传 `spotlightTarget` prop 指定其他目标。
 */
import { useEffect, useRef, useState } from "react";
import {
  RIPPLE_SPOTLIGHT_EVENT,
  type RippleTarget,
  type RippleOptions,
  resolveRippleTarget,
} from "@/lib/ui/ripple-spotlight";

/** 默认参数（可被 RippleOptions 覆盖）
 * 时长 1600ms：变暗聚拢 0-25%（400ms）→ 收缩聚焦 25-37.5%（200ms）→ 聚焦环淡出 37.5-100%（1s） */
const DEFAULT_OPTIONS: Required<RippleOptions> = {
  restoreAt: 0.8,
  duration: 1600,
  phase1Ratio: 0.25,
  phase2Ratio: 0.375,
  scrollToTarget: true,
};

/** 缓动函数（三次方缓出：快速起步 + 缓慢收尾，涟漪收敛阻尼感） */
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** 聚焦环尺寸系数（相对目标元素半径） */
const FOCUS_INNER_MULT = 2.2;
const FOCUS_OUTER_MULT = 3.5;
/** 遮罩羽化宽度（px）：内径→暗环、暗环→外径的软边过渡 */
const FEATHER = 32;
/** 目标组件摇头抖动时长（ms） */
const SHAKE_MS = 450;

/** 等待 smooth 滚动结束（三态 rAF 轮询：等开始 → 等静止 → resolve）
 * - 滚动未开始（scrollIntoView 异步启动，首帧位置未变）→ 不误判静止，继续等元素移动
 * - 滚动进行中（元素位置持续变化）→ 继续 poll
 * - 连续 3 帧位置变化 <0.5px（smooth 滚动结束，位置稳定）→ resolve
 * 兜底超时 3s 防挂起（长距离 smooth 滚动可达 2s+）。 */
function waitForScrollEnd(el: HTMLElement, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    let lastTop = el.getBoundingClientRect().top;
    let hasMoved = false; // 是否已观察到滚动开始（避免启动瞬间误判静止）
    let stillFrames = 0; // 连续静止帧数
    const poll = () => {
      const top = el.getBoundingClientRect().top;
      const moved = Math.abs(top - lastTop);
      lastTop = top;
      // 超时兜底
      if (performance.now() - start > timeoutMs) {
        resolve();
        return;
      }
      if (!hasMoved) {
        // 滚动尚未开始：等待元素位置变化（scrollIntoView smooth 异步启动）
        if (moved > 0.5) hasMoved = true;
        else {
          requestAnimationFrame(poll);
          return;
        }
      }
      if (moved < 0.5) {
        stillFrames += 1;
        // 连续 3 帧静止 → 滚动结束
        if (stillFrames >= 3) {
          resolve();
          return;
        }
      } else {
        stillFrames = 0;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

/** 判断目标元素是否完整落在视口内（无需滚动即可完整看到）
 * getBoundingClientRect 相对视口：top/left ≥ 0 且 bottom/right ≤ 视口宽高即完整可见。 */
function isElementInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
  );
}

export function RippleSpotlight() {
  const [show, setShow] = useState(false);
  const [target, setTarget] = useState<{
    x: number;
    y: number;
    /** 目标元素半径（max(w,h)/2；聚焦环尺寸基准） */
    radius: number;
    /** 目标元素引用（聚焦环形成时摇头抖动用） */
    el: HTMLElement | null;
  } | null>(null);
  const [options, setOptions] = useState<Required<RippleOptions>>(DEFAULT_OPTIONS);
  const timers = useRef<number[]>([]);
  // 触发序号：多次触发竞态防护——只有最新一次滚动/动画生效
  const seqRef = useRef(0);

  useEffect(() => {
    const onTrigger = (e: Event) => {
      // 兼容旧 detail 直传 target；新格式 { target, options }
      const d = (e as CustomEvent).detail as
        | RippleTarget
        | { target?: RippleTarget; options?: RippleOptions };
      const rawTarget =
        d && typeof d === "object" && !(d instanceof HTMLElement) && "target" in d
          ? (d as { target?: RippleTarget }).target
          : (d as RippleTarget);
      const rawOptions =
        d && typeof d === "object" && "options" in d
          ? (d as { options?: RippleOptions }).options
          : undefined;
      const merged = { ...DEFAULT_OPTIONS, ...rawOptions };
      const el = resolveRippleTarget(rawTarget);
      const seq = ++seqRef.current;
      // async：目标可见则直接取位置播；不可见则先 smooth 滚动到位再取位置播（详见下方分支）
      void (async () => {
        let x: number;
        let y: number;
        let radius: number;
        if (el) {
          // 可见性自适应：目标已在视口内直接取位置播（跳过滚动等待，避免可见时的延迟）；
          // 不可见才 smooth 滚动到垂直居中（scrollToTarget=false 强制不滚动）。
          const inView = isElementInViewport(el);
          if (!inView && merged.scrollToTarget) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await waitForScrollEnd(el);
            if (seq !== seqRef.current) return; // 已被更新的触发取代
            // 滚动到位后再延迟一帧取位置：长滚动后 sticky 头/布局可能 settle，立即取
            // getBoundingClientRect 会偏移（2026-08-14 实测修复——滚动结束位置 ≠ 动画聚焦位置）
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
          if (seq !== seqRef.current) return;
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
        if (seq !== seqRef.current) return;
        setTarget({ x, y, radius, el });
        setOptions(merged);
        setShow(true);
      })();
    };
    window.addEventListener(RIPPLE_SPOTLIGHT_EVENT, onTrigger);
    // cleanup 用局部引用（ref.current 在 cleanup 时可能已变化，exhaustive-deps 提示）
    const timersSnapshot = timers.current;
    return () => {
      window.removeEventListener(RIPPLE_SPOTLIGHT_EVENT, onTrigger);
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
    <RippleLayer target={target} options={options} key={`${target.x}-${target.y}-${Date.now()}`} />
  );
}

/** 参数化环形涟漪动画层（每次 key 重建）。
 * mask radial-gradient 环形：`transparent 内径 / #000 内径→外径（暗色环） / transparent 外径外`。
 * **内外径独立时间线**（restoreAt 只影响外径启动）：
 *   内径：t∈[0,P1] R_OUTER→0（变暗聚拢）→ [P1,P2] 0→R_INNER（挖目标洞）→ 恒 R_INNER
 *   外径：t∈[0,T2] 恒 R_OUTER → [T2,P2] R_OUTER→R_FOCUS（T2=P1·restoreAt，追尾）→ 恒 R_FOCUS
 *   opacity：t∈[0,P2] 1 → [P2,1] **线性 1→0**（聚焦环匀速淡出 1s，无振荡跳帧）
 * 目标组件摇头抖动由 RippleSpotlight 触发（spotlight-shake）。 */
function RippleLayer({
  target,
  options,
}: {
  target: { x: number; y: number; radius: number; el: HTMLElement | null };
  options: Required<RippleOptions>;
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
