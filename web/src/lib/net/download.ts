/**
 * 下载辅助工具（探针可达性 + 原生下载触发）
 *
 * 用途：raw / release 下载统一入口——「先探针判断可达性，可达则原生下载，不可达则熔断代理」。
 * - 探针（probeUrlReachable）：用 `Range: bytes=0-0` 只取 0 字节，低成本判断 URL 是否可达
 *   （被墙 / 超时 / 非 2xx 视为不可达）。相比隐藏 iframe，fetch 能拿到明确的状态码与超时。
 * - 原生下载（triggerNativeDownload）：临时 <a download> 点击触发浏览器原生下载（自带进度条），
 *   不 fetch 大文件到内存（避免大文件占满 JS 堆）。
 */

/** 探针超时（快速失败，不拖慢下载决策） */
const PROBE_TIMEOUT_MS = 5000;

/**
 * 探测 URL 是否可达（Range 只取 0 字节，低成本）。
 * 登录态透传 token（私有 release / raw 可读）；匿名 token 传 null。
 * 返回 true = 可达（2xx/206），false = 被墙 / 超时 / 非 2xx / CORS 拦截。
 */
export async function probeUrlReachable(
  url: string,
  token: string | null | undefined,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * 触发浏览器原生下载（临时 <a download> 点击）。
 * 同源 URL（worker 代理）download 属性生效；跨域 URL 由服务器 Content-Disposition 兜底。
 */
export function triggerNativeDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
