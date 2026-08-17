/**
 * 统一操作提醒（sonner toast 引入）
 *
 * 目的：全站操作消息（保存/创建/删除/限流/额度切换等）统一经本模块，
 * 右下角弹出；按消息类型区分颜色（richColors）：
 * - success（绿）：操作成功
 * - error（红）：操作失败
 * - warning（黄）：限流 / 警告类
 * - info（蓝）：额度自动切换 / 普通提示
 *
 * 防刷：全局性高频触发（限流、额度切换）用模块级时间戳节流，
 * 避免并发请求弹出一连串重复提示。
 */
import { toast } from "sonner";

/** 全局防刷窗口（ms）：同 key 在该窗口内只提示一次 */
const THROTTLE_MS = 30_000;
const lastShown: Record<string, number> = {};

function throttled(key: string): boolean {
  const now = Date.now();
  if (lastShown[key] && now - lastShown[key] < THROTTLE_MS) return true;
  lastShown[key] = now;
  return false;
}

/** 操作成功（绿） */
export function toastSuccess(message: string, description?: string): void {
  toast.success(message, { description });
}

/** 操作失败（红） */
export function toastError(message: string, description?: string): void {
  toast.error(message, { description });
}

/** 警告（黄）：限流等 */
export function toastWarning(message: string, description?: string): void {
  toast.warning(message, { description });
}

/** 普通提示（蓝）：额度自动切换等 */
export function toastInfo(message: string, description?: string): void {
  toast(message, { description });
}

/** 限流统一提示（防刷：30s 内只弹一次） */
export function notifyRateLimit(description?: string): void {
  if (throttled("ratelimit")) return;
  toast.warning("GitHub API 请求过于频繁或超出官方限制", {
    description: description ?? "登录后可获得更高配额（5000 次/小时）；或稍后刷新重试",
  });
}

/**
 * 主模式额度耗尽/熔断 → 自动切换提示（防刷）。
 * @param fallbackMode 自动切换到的模式（rest / graphql）
 */
export function notifyModeFallback(fallbackMode: "graphql" | "rest"): void {
  if (throttled(`fallback:${fallbackMode}`)) return;
  const primary = fallbackMode === "rest" ? "GraphQL" : "REST";
  const target = fallbackMode === "rest" ? "REST" : "GraphQL";
  toast.info(`${primary} 额度已耗尽或不可用，本次请求已自动切换到 ${target}`, {
    description: "可在偏好设置中查看双额度用量；设置项保持不变",
  });
}
