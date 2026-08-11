/**
 * Schema 数据源版本更新检测（左栏第二行「红色向上箭头」更新预警数据源）
 *
 * 启动时后台查询 npm registry 的 latest 版本，与本地产物版本（转录脚本写入的
 * 包版本）比较——发现 npm 有更新版本 → 返回 true（SchemaHeader 显示红色向上箭头，
 * hover 提示可刷新产物）。失败静默（网络受限/registry 不可达 → 无预警，不打扰）。
 *
 * 仅探测 latest（semver 比较同 major 内的更新也预警——产物转录落后即提醒）；
 * 请求用默认 JSON（registry 对 install-v1 简化 Accept 可能返回 406，兼容性兜底）。
 */
import { useEffect, useState } from "react";

const REGISTRY = "https://registry.npmjs.org";

/** npm 包 latest 版本查询（失败 → null；成功 → 最新版本字符串） */
async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    // 标准 Accept：registry 对 install-v1 简化响应可能返回 406（兼容性），用默认 JSON
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg)}/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** 版本号 → 数字数组（"22.0.0" → [22, 0, 0]；pre-release 后缀忽略） */
function parseVersion(v: string): number[] {
  const nums = v
    .replace(/[+-].*$/, "")
    .split(".")
    .map((s) => Number(s));
  return nums.filter((n) => !Number.isNaN(n));
}

/** 当前 < npm latest（semver 数组比较） */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * 版本更新检测 hook：npm 包名 + 当前版本 → 是否有更新。
 * 内存缓存（同包名只查一次，会话内复用）；启动后台异步，失败静默。
 */
const cache = new Map<string, boolean>();
export function usePkgUpdateAvailable(pkg: string, currentVersion: string | null): boolean {
  const [available, setAvailable] = useState<boolean>(() => cache.get(pkg) ?? false);
  useEffect(() => {
    if (!currentVersion || cache.has(pkg)) {
      setAvailable(cache.get(pkg) ?? false);
      return;
    }
    let cancelled = false;
    void fetchLatestVersion(pkg).then((latest) => {
      if (cancelled || !latest) return;
      const hasUpdate = isNewer(latest, currentVersion);
      cache.set(pkg, hasUpdate);
      if (!cancelled) setAvailable(hasUpdate);
    });
    return () => {
      cancelled = true;
    };
  }, [pkg, currentVersion]);
  return available;
}
