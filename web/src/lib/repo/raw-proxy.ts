/**
 * Raw 内容通道（前端）——文本内容按 proxy 模式分流，媒体/下载直接取 URL。
 *
 * 中心思想（架构纠正）：`$raw` 仅代表 worker 纯反代（受 RAW_PROXY_ENABLE 门控）；
 * 获取文件内容由前端直发 API（登录带 token / 匿名不带）。
 * - proxy 可用（on / login+登录）→ 走 /$raw 透传（私有仓库可读）
 * - 否则 → 前端直发 api contents（fetchFileContent，登录带 token）
 * - 媒体/下载 URL：buildRawProxyUrl（$raw）或 buildRawDirectUrl（raw 直连）
 */
import { WORKER_BASE } from "../auth/worker-base";
import { reportChannel } from "@/lib/net/channel-status";
import { getRawProxyMode } from "@/lib/net/proxy-mode";
import { fetchFileContent } from "@/lib/restapi";

/** 构造 /$raw 统一入口 URL（owner/repo/ref/path 逐段编码） */
export function buildRawProxyUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${WORKER_BASE}/$raw/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/** 构造 raw.githubusercontent.com 直连 URL（owner/repo/ref/path 逐段编码） */
export function buildRawDirectUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/**
 * 拉取 raw 文件文本（DiffView Expand 上下文对比用）——按 proxy 模式分流：
 * proxy 可用 → /$raw；否则 → 前端直发 api contents（登录带 token）。
 * 404 / 网络错误 / 非 2xx 返回 null（调用方降级）。
 */
export async function fetchRawContentSmart(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  token?: string | null,
): Promise<string | null> {
  const mode = await getRawProxyMode();
  const canProxy = token ? mode === "on" || mode === "login" : mode === "on";
  if (canProxy) {
    try {
      const res = await fetch(buildRawProxyUrl(owner, repo, ref, path), {
        credentials: "include",
      });
      if (!res.ok) return null;
      const text = await res.text();
      reportChannel("worker");
      return text;
    } catch {
      return null;
    }
  }
  try {
    return await fetchFileContent(owner, repo, path, token, ref);
  } catch {
    return null;
  }
}
