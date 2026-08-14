/**
 * 涟漪聚光灯动画的公共 API（通用 UI 组件，非登录专属——fork 引导等场景共用）
 *
 * 独立文件原因：RippleSpotlight.tsx 是组件文件，fast refresh 要求只导出组件；
 * triggerRippleSpotlight/类型/常量移到此处，LoginPrompt / ErrorPages / rest-core /
 * ForkGate / NeedFork / StarForkButtons / LoginScopeDialog 等跨文件引用。
 *
 * 2026-08-14 重命名：LoginSpotlight → RippleSpotlight（登录聚光灯 → 通用涟漪聚光灯）；
 * 并从 lib/auth/ 迁至 lib/ui/（不再局限于登录场景）。
 */
/** 默认聚焦目标：topbar 登录按钮（登录聚光灯落点；LoginScopeDialog 的登录按钮 id） */
export const LOGIN_TRIGGER_ID = "topbar-login-btn";

/** 全局触发事件名 */
export const RIPPLE_SPOTLIGHT_EVENT = "puregit:ripple-spotlight";

/** 目标元素类型：任意元素 / CSS 选择器 / 缺省（右上角登录按钮） */
export type RippleTarget = HTMLElement | string | null | undefined;

/** 涟漪聚光灯动画参数（均可选） */
export interface RippleOptions {
  /**
   * **仅影响外径收缩的启动时间**（0-1，默认 0.8）：变暗（阶段 1）进行到
   * restoreAt 完成度时，外径即开始收缩还原（追尾涟漪）；内径时间线不受影响。
   * 1 = 变暗全部完成后外径才开始收缩。
   */
  restoreAt?: number;
  /** 动画总时长 ms（默认 1600；含聚焦环 1s 匀速淡出） */
  duration?: number;
  /** 阶段 1（变暗聚拢）时长占比（默认 0.25） */
  phase1Ratio?: number;
  /** 阶段 2（收缩聚焦）结束占比（默认 0.375；剩余为阶段 3 聚焦环匀速淡出） */
  phase2Ratio?: number;
  /** 滚动到目标后再播放（默认 true：smooth 滚动使目标垂直居中，滚动结束后才开始涟漪动画） */
  scrollToTarget?: boolean;
}

/** 触发一次涟漪聚光灯动画（线程安全：单例挂载即可，事件广播） */
export function triggerRippleSpotlight(target?: RippleTarget, options?: RippleOptions): void {
  window.dispatchEvent(new CustomEvent(RIPPLE_SPOTLIGHT_EVENT, { detail: { target, options } }));
}

/** 解析目标元素（供组件内部复用）：HTMLElement 直接用 / string 当选择器 / 缺省 → 右上角登录按钮 */
export function resolveRippleTarget(target: RippleTarget): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (typeof target === "string" && target.trim()) {
    return document.querySelector(target);
  }
  return document.getElementById(LOGIN_TRIGGER_ID);
}
