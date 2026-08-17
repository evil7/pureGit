/**
 * 会话管理 API（Worker /$auth/* 端点）
 *
 * - 鉴权走 httpOnly cookie（credentials: "include"），无需 Bearer token
 * - 会话列表接口只返回元数据（绝不含 token）——最小暴露
 * - 本地登出仅删 KV 会话；撤销 App 授权才触及 GitHub 端 token（危险区）
 */
import { WORKER_BASE } from "@/lib/auth/worker-base";

export interface SessionMeta {
  id: string;
  isCurrent: boolean;
  mode: "read" | "write";
  /** 登录方式：oauth（GitHub 授权页）/ pat（直接输入 PAT）。旧会话缺失 = oauth */
  authMethod?: "oauth" | "pat";
  deviceId: string;
  ua: string;
  ip: string;
  /** 请求来源国家（ISO 3166-1 alpha-2，如 CN/US；Cloudflare request.cf.country，本地 dev 缺失为空） */
  country?: string;
  createdAt: number;
  lastSeenAt: number;
}

/** GET /$auth/sessions — 当前用户全部会话元数据 */
export async function fetchSessions(): Promise<SessionMeta[]> {
  const res = await fetch(`${WORKER_BASE}/$auth/sessions`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { sessions?: SessionMeta[] };
  return data.sessions ?? [];
}

/** POST /$auth/sessions/:id/logout — 本地登出指定设备（仅删 KV 会话，GitHub 端授权保留） */
export async function logoutSession(id: string): Promise<void> {
  const res = await fetch(`${WORKER_BASE}/$auth/sessions/${encodeURIComponent(id)}/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** POST /$auth/logout/all — 登出全部设备（删当前用户全部 KV 会话，GitHub 端授权保留） */
export async function logoutAllSessions(): Promise<void> {
  const res = await fetch(`${WORKER_BASE}/$auth/logout/all`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** POST /$auth/revoke — 撤销 PureGit OAuth App 授权（GitHub 端真撤销 + 退出所有设备） */
export async function revokeApp(): Promise<void> {
  const res = await fetch(`${WORKER_BASE}/$auth/revoke`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** 设备标识键：匿名 UUID，非 token（红线 1 仅禁 token 明文），清除站点数据后视为新设备 */
const DEVICE_ID_KEY = "pg_device_id";

/** 读取/生成设备标识（localStorage；隐私模式等写入失败时内存兜底，仅影响展示） */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** 简易 UA 解析 → 设备标签（如「Chrome on Windows」）；未知返回空串 */
export function parseUaLabel(ua: string): string {
  if (!ua) return "";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return os ? `${browser} on ${os}` : browser;
}

/** ISO 3166-1 alpha-2 国家码 → emoji 国旗（A=0x1F1E6，如 CN → 🇨🇳）；非法码返回空 */
export function countryFlag(code: string): string {
  if (!code || code.length !== 2 || !/^[A-Za-z]{2}$/.test(code)) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(...Array.from(upper).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** ISO 3166-1 alpha-2 国家码 → 本地化国家名（如 zh-CN 下 CN → 「中国」）；未知/非法返回空 */
export function countryName(code: string): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  try {
    const name = new Intl.DisplayNames(undefined, {
      type: "region",
    }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : "";
  } catch {
    return "";
  }
}
