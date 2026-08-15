/**
 * Raw 内容智能获取（统一重构）：直连 raw.githubusercontent.com，
 * 失败自动降级 /$raw 代理——**下载/Raw 按钮/二进制资源统一入口**。
 *
 * 背景：raw.githubusercontent.com 在受限网络被墙/不可达（CORS/超时）——本项目核心痛点。
 * 方案：先直连（快、无中转），失败（网络/CORS/非 2xx/超时）→ Worker /$raw 代理重试。
 * 代理端点：GET /$raw/{owner}/{repo}/{ref}/{path...} → 服务端 fetch raw 并透传 Content-Type。
 * 前缀约定：`$raw` 以 `$` 符号标识内部高优先级功能性路由（GitHub 用户名不含 `$`，不冲突）。
 *
 * jsDelivr 公开 CDN 另见 fetchJsdelivrContent（需 commit sha 才能绕墙，由上层 API 层调用）。
 *
 * 文件大小上限：RAW_MAX_BYTES = 100MB（直连与代理一致；worker 侧 413 超限拒绝）。
 */
import { WORKER_BASE } from "../auth/worker-base";
import { reportChannel } from "@/lib/net/channel-status";

/**
 * raw 通道（前端直连 + Worker /$raw 代理）文件大小上限（10MB → 100MB，
 * 与 REST contents 100MB 通道对齐——保底通道必须能兜住 API 能读的最大文件）。
 * 超限返回 null（调用方降级/交页面提示）。
 * 常量统一放在本文件（raw 通道唯一入口），repo-raw 单向依赖本文件。
 */
export const RAW_MAX_BYTES = 100 * 1024 * 1024;

const RAW_HOST = "raw.githubusercontent.com";

/** 直连 raw 的 5s 快速失败（被墙/超时立即切后续通道，不拖慢体验） */
const DIRECT_TIMEOUT_MS = 5000;

/** jsDelivr 公开 CDN base（/gh/ 通道镜像 GitHub 公开仓库静态文件，免费零配额） */
const JSDELIVR_BASE = "https://cdn.jsdelivr.net";
/** jsDelivr 兜底超时（与 raw 直连一致，快速失败不拖慢降级） */
const JSDELIVR_TIMEOUT_MS = 5000;

/**
 * 将 raw 直连 URL 转为 /$raw 代理 URL（同 owner/repo/ref/path 结构）。
 * 仅处理 raw.githubusercontent.com/{o}/{r}/{ref}/{path...}；其他 URL 原样返回。
 */
export function rawUrlToProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== RAW_HOST) return url;
    const [, owner, repo, ref, ...pathParts] = u.pathname.split("/");
    if (!owner || !repo || !ref || pathParts.length === 0) return url;
    const enc = (s: string) => encodeURIComponent(s);
    return `${WORKER_BASE}/$raw/${enc(owner)}/${enc(repo)}/${enc(ref)}/${pathParts
      .map((p) => enc(p))
      .join("/")}${u.search}`;
  } catch {
    return url;
  }
}

/** 构造 raw 直连 URL（owner/repo/ref/path 逐段编码） */
export function buildRawDirectUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(
    owner,
  )}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/** 构造 Worker /$raw 代理 URL（同 owner/repo/ref/path 结构） */
export function buildRawProxyUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${WORKER_BASE}/$raw/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/** 构造 jsDelivr /gh/ 公开 CDN URL（owner/repo@ref/path；ref 需为 tag/commit sha，branch 名不绕墙） */
export function buildJsdelivrUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${JSDELIVR_BASE}/gh/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}@${encodeURIComponent(ref)}/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/** jsDelivr /gh/ 通道单文件 20MB 上限（官方限制；>20MB 404 快速失败） */
export const JSDELIVR_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 用 commit sha 从 jsDelivr /gh/ 公开 CDN 取文件文本（内容寻址，精确绕墙）。
 * 仅固定版本（sha/tag）由 jsDelivr 服务器缓存绕墙；branch 名会 301 回 raw 不绕墙，
 * 故调用方必须传 sha。失败 / 超 20MB / 网络错误返回 null（调用方降级）。
 */
export async function fetchJsdelivrContent(
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await fetch(buildJsdelivrUrl(owner, repo, sha, path), {
      signal: AbortSignal.timeout(JSDELIVR_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > JSDELIVR_MAX_BYTES) return null;
    reportChannel("jsdelivr");
    return text;
  } catch {
    return null;
  }
}

/**
 * 智能获取 raw 文件文本（通道：raw 直连 →（可选）/$raw 代理）。
 * - directFirst=true（默认）：先直连（CORS 可用时最快路径）；失败转代理
 * - directFirst=false：跳过直连，直接代理（登录保底——受限网络直连超时浪费 5s）
 * - allowProxy=false：直连失败直接返回 null，不转代理
 * 文件 >100MB / 404 / 网络错误 / 超时返回 null（调用方降级）。
 * 注意：本函数读文本（.text()）；二进制资源（图片等）直接用 URL（img src / <a download>）。
 * jsDelivr 不在本层（需 sha，见 fetchJsdelivrContent），由上层 API 层拿 sha 后调用。
 */
export async function fetchRawContentSmart(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  directFirst = true,
  allowProxy = true,
): Promise<string | null> {
  // ① 直连 raw（CORS 可用时最快路径；directFirst=false 跳过——如受限网络/登录保底）
  if (directFirst) {
    try {
      const res = await fetch(buildRawDirectUrl(owner, repo, ref, path), {
        signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length <= RAW_MAX_BYTES) {
          reportChannel("raw");
          return text;
        }
      }
    } catch {
      /* 直连失败 */
    }
  }
  // ② /$raw 代理（同源 worker，无 CORS；服务端绕墙）——allowProxy=false 时不转 worker 代理
  if (!allowProxy) return null;
  try {
    const res = await fetch(buildRawProxyUrl(owner, repo, ref, path));
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > RAW_MAX_BYTES) return null;
    reportChannel("worker");
    return text;
  } catch {
    return null;
  }
}

/** 供 markdown 图片降级：raw src 直连失败 → 替换为 /$raw 代理 URL（onError 重试一次） */
export function rawImgFallbackSrc(src: string): string {
  return rawUrlToProxy(src);
}
