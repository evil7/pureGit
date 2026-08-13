/**
 * 登录聚光灯动画的公共 API（独立文件：LoginSpotlight.tsx 是组件文件，
 * fast refresh 要求只导出组件；triggerLoginSpotlight/类型移到此处，
 * LoginPrompt / ErrorPages / rest-core 等跨文件引用）
 */
import { LOGIN_TRIGGER_ID } from "@/lib/auth/login-trigger";

/** 全局触发事件名 */
export const SPOTLIGHT_EVENT = "puregit:login-spotlight";

/** 目标元素类型：任意元素 / CSS 选择器 / 缺省（右上角登录按钮） */
export type SpotlightTarget = HTMLElement | string | null | undefined;

/** 聚光灯动画参数（均可选） */
export interface SpotlightOptions {
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
}

/** 触发一次登录聚光灯动画（线程安全：单例挂载即可，事件广播） */
export function triggerLoginSpotlight(target?: SpotlightTarget, options?: SpotlightOptions): void {
  window.dispatchEvent(new CustomEvent(SPOTLIGHT_EVENT, { detail: { target, options } }));
}

/** 解析目标元素（供组件内部复用）：HTMLElement 直接用 / string 当选择器 / 缺省 → 右上角登录按钮 */
export function resolveSpotlightTarget(target: SpotlightTarget): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (typeof target === "string" && target.trim()) {
    return document.querySelector(target);
  }
  return document.getElementById(LOGIN_TRIGGER_ID);
}
