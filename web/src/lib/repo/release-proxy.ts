/**
 * Release 资产下载解析（探针直连优先 + 熔断 worker 代理）
 *
 * 背景：release 资产 browser_download_url = github.com/{o}/{r}/releases/download/{tag}/{asset}，
 * 会 302 到签名 CDN（objects/release-assets.githubusercontent.com，Azure 背书）。受限网络下
 * 该跳转可能被墙/超时。本模块：先探针直连可达性，可达则原生下载；不可达则按
 * RELEASE_PROXY_ENABLE 熔断到 /$release 代理（流式透传，不缓存）。
 *
 * 无 jsDelivr 等价公开 CDN（jsDelivr /gh/ 只镜像源码不镜像 release 二进制）——release 只有
 * 「直连」或「worker 反代」两条路，与 raw 的三层省流（jsDelivr@sha → REST → 直连 → 代理）不同。
 */
import { WORKER_BASE } from "@/lib/auth/worker-base";
import { probeUrlReachable, triggerNativeDownload } from "@/lib/net/download";
import { getReleaseProxyMode } from "@/lib/net/proxy-mode";
import { reportChannel } from "@/lib/net/channel-status";
import { ApiError } from "@/lib/restapi";

/** 构造 Worker /$release 代理 URL（tag 与 asset 整体编码，斜杠→%2F 保持单段） */
export function buildReleaseProxyUrl(
  owner: string,
  repo: string,
  tag: string,
  asset: string,
): string {
  return `${WORKER_BASE}/$release/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

export type ReleaseDownloadResult = {
  /** 最终下载 URL（直连或代理） */
  url: string;
  /** 命中通道：direct = 直连签名 CDN；proxy = worker /$release 代理 */
  via: "direct" | "proxy";
};

/**
 * 解析 release 资产最终下载 URL。
 * ① 探针直连 browser_download_url（Range 0-0，带 token）；可达 → 直连。
 * ② 不可达 → 按 RELEASE_PROXY_ENABLE 熔断：on 全部代理；login 仅登录代理；off 不代理（抛错）。
 * 匿名且代理不可用（mode != on）抛错——调用方提示登录/报错。
 */
export async function resolveReleaseDownloadUrl(
  owner: string,
  repo: string,
  tag: string,
  asset: string,
  browserDownloadUrl: string,
  token: string | null | undefined,
): Promise<ReleaseDownloadResult> {
  if (await probeUrlReachable(browserDownloadUrl, token)) {
    return { url: browserDownloadUrl, via: "direct" };
  }
  const mode = await getReleaseProxyMode();
  if (mode === "on" || (mode === "login" && token)) {
    reportChannel("worker");
    return { url: buildReleaseProxyUrl(owner, repo, tag, asset), via: "proxy" };
  }
  throw new Error("release_proxy_unavailable");
}

/**
 * 下载 release 资产：解析直连/代理 URL → 触发浏览器原生下载。
 * 直连不可达且代理不可用（匿名 + mode != on）时抛错，调用方提示登录/报错。
 */
export async function downloadReleaseAsset(
  owner: string,
  repo: string,
  tag: string,
  asset: string,
  browserDownloadUrl: string,
  token: string | null | undefined,
): Promise<void> {
  const { url } = await resolveReleaseDownloadUrl(
    owner,
    repo,
    tag,
    asset,
    browserDownloadUrl,
    token,
  );
  triggerNativeDownload(url, asset);
}

/** 构造 Worker /$release 上传代理 URL（releaseId 为数字 id） */
export function buildReleaseUploadProxyUrl(owner: string, repo: string, releaseId: number): string {
  return `${WORKER_BASE}/$release/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/upload/${releaseId}`;
}

/**
 * 经 Worker /$release/upload 代理上传资产（登录态；body 流式透传）。
 * 上游 4xx/5xx → 抛 ApiError（解析 message/error 字段）；网络错误/超时原样抛。
 */
export async function uploadReleaseAssetViaProxy(
  owner: string,
  repo: string,
  releaseId: number,
  name: string,
  data: string | ArrayBuffer,
  token: string,
): Promise<void> {
  void token;
  const q = new URLSearchParams({ name });
  const res = await fetch(`${buildReleaseUploadProxyUrl(owner, repo, releaseId)}?${q.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      detail = parsed.message ?? parsed.error ?? text;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  reportChannel("worker");
}
