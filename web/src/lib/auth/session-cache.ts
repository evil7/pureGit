/**
 * session 前端缓存（标签页级 sessionStorage，关闭即清，非持久 localStorage）
 *
 * 架构：access token 仅存内存变量（红线 1）；刷新经 Worker /$auth/session 恢复。
 * sessionStorage 缓存是 CN 网络受限下「安全性 × 操作顺畅度」的折中点——
 * 避免每次刷新读 KV；缓存未过期直接恢复，过期/失效/登出清除。
 * 本模块为纯逻辑（无 React），供 useAuth 与测试复用（组件文件只导出组件，
 * 保证 Fast Refresh 生效）。
 */

/** session 缓存键（sessionStorage，标签页级） */
export const SESSION_CACHE_KEY = "puregit_session_cache";

/** session 缓存结构（与 worker /$auth/session 返回对齐；user 结构兼容 AuthUser） */
export interface SessionCache {
  token: string;
  user?: { login: string; avatarUrl?: string; userId?: number };
  scopes?: { mode: "read" | "write" };
  /** GitHub 实际授予的 scope（重新授权后为准；旧缓存可能缺失） */
  grantedScopes?: string[];
  expiresAt: number;
}

/** 读取 session 缓存（损坏 JSON/缺 token/expiresAt 非数字 → null，容错回退 worker 恢复） */
export function readCache(): SessionCache | null {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SessionCache;
    if (!c.token || typeof c.expiresAt !== "number") return null;
    return c;
  } catch {
    return null;
  }
}

/** 写入 session 缓存（隐私模式等写入失败时忽略，回退为每次请求 worker） */
export function writeCache(c: SessionCache) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式等写入失败时忽略，回退为每次请求 worker */
  }
}

/** 清除 session 缓存（过期/失效/登出） */
export function clearCache() {
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
