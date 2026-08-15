/**
 * Worker 反代能力探测（/$healthz → proxies.mode）。
 *
 * 用途：前端据此收敛 $raw/$wiki 反代通道——mode=off/login 时匿名不提供反代，
 * 匿名省流链不尝试 worker $raw（避免明知关闭还去等超时）。
 *
 * 探测结果存内存（非敏感数据），lazy 首次需要时读取，之后复用；
 * 读取失败（worker 不可达）默认按 "login" 兜底（保守：匿名不尝试 worker，失败自然降级）。
 */
import { WORKER_BASE } from "@/lib/auth/worker-base";

export type ProxyMode = "off" | "login" | "on";

let cachedMode: ProxyMode | null = null;

/** 读取反代模式（缓存；仅首次或缓存失效时请求 $healthz） */
export async function getProxyMode(): Promise<ProxyMode> {
  if (cachedMode) return cachedMode;
  try {
    const res = await fetch(`${WORKER_BASE}/$healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`healthz ${res.status}`);
    const data = (await res.json()) as { proxies?: { mode?: string } };
    const mode = data.proxies?.mode;
    cachedMode = mode === "off" || mode === "login" ? mode : "on";
  } catch {
    cachedMode = "login";
  }
  return cachedMode;
}

/** 匿名是否可用 worker 反代（仅 mode=on 时匿名放行） */
export function anonymousProxyAllowed(mode: ProxyMode): boolean {
  return mode === "on";
}

/** 测试用：重置缓存 */
export function resetProxyModeCache(): void {
  cachedMode = null;
}
