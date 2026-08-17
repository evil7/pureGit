/**
 * Worker 反代能力探测（/$healthz → proxies.{raw,release}）。
 *
 * 用途：前端据此收敛 raw/release 反代通道（RAW/RELEASE_PROXY_ENABLE 三段式）——
 * mode=off/login 时匿名不提供 worker 反代，避免明知关闭还去等超时。
 *
 * 探测结果存内存（非敏感数据），lazy 首次需要时读取，之后复用；
 * 读取失败（worker 不可达）默认按 "login" 兜底（保守：匿名不尝试 worker，失败自然降级）。
 */
import { WORKER_BASE } from "@/lib/auth/worker-base";

export type ProxyMode = "off" | "login" | "on";

/** raw 与 release 各自独立的模式（healthz 下发） */
export interface ProxyModes {
  raw: ProxyMode;
  release: ProxyMode;
}

let cachedModes: ProxyModes | null = null;

/** 归一化模式值（非法/缺省按 "login" 兜底，与 worker 端默认一致） */
function normalize(mode: string | undefined): ProxyMode {
  return mode === "off" || mode === "login" || mode === "on" ? mode : "login";
}

/** 读取反代模式矩阵（缓存；仅首次或缓存失效时请求 $healthz） */
export async function getProxyModes(): Promise<ProxyModes> {
  if (cachedModes) return cachedModes;
  try {
    const res = await fetch(`${WORKER_BASE}/$healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`healthz ${res.status}`);
    const data = (await res.json()) as {
      proxies?: { raw?: string; release?: string };
    };
    cachedModes = {
      raw: normalize(data.proxies?.raw),
      release: normalize(data.proxies?.release),
    };
  } catch {
    cachedModes = { raw: "login", release: "login" };
  }
  return cachedModes;
}

/** 读取 release 反代模式（release 下载熔断用） */
export async function getReleaseProxyMode(): Promise<ProxyMode> {
  return (await getProxyModes()).release;
}

/** 读取 raw 反代模式（$raw 通道分流用） */
export async function getRawProxyMode(): Promise<ProxyMode> {
  return (await getProxyModes()).raw;
}

/** 测试用：重置缓存 */
export function resetProxyModeCache(): void {
  cachedModes = null;
}
