/**
 * 登录态管理 hook
 *
 * 架构红线：
 * - access token 仅存内存变量，不写 localStorage 明文
 * - 刷新页面后经 Worker /$auth/session 恢复 token 到内存
 * - 登出调用 Worker /$auth/logout 清除 KV 会话与 cookie
 *
 * session 前端缓存：
 * - worker /$auth/session 返回 expiresAt；前端 sessionStorage 缓存会话
 *   {token, user, scopes, expiresAt}（标签页级，关闭即清，非持久 localStorage）
 * - 缓存未过期 → 直接恢复，不再请求 worker（避免每次刷新读 KV）
 * - 过期/失效/登出 → 清除缓存；缓存缺失才请求 /$auth/session
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentUserSmart } from "@/lib/api";
import { getDeviceId } from "@/lib/session";
import { WORKER_BASE } from "@/lib/worker-base";
import { setPrefsAuth, syncPrefsFromCloud } from "@/lib/prefs-sync";
import { computeMissingScopes } from "@/lib/scopes";

/** session 缓存键（sessionStorage，标签页级） */
const SESSION_CACHE_KEY = "puregit_session_cache";
/** 缓存提前失效余量（ms）：接近过期即视为失效，避免边界竞态 */
const CACHE_SKEW = 60_000;

interface AuthUser {
  login: string;
  avatarUrl?: string;
  /** GitHub 用户数字 ID（worker /$auth/session 返回；偏好云同步等稳定定位用） */
  userId?: number;
}

/** session 缓存结构（与 worker /$auth/session 返回对齐） */
interface SessionCache {
  token: string;
  user?: AuthUser;
  scopes?: LoginScopes;
  /** GitHub 实际授予的 scope（重新授权后为准；旧缓存可能缺失） */
  grantedScopes?: string[];
  expiresAt: number;
}

function readCache(): SessionCache | null {
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

function writeCache(c: SessionCache) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式等写入失败时忽略，回退为每次请求 worker */
  }
}

function clearCache() {
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** 登录权限选择（与 worker/src/auth.ts LoginScopes 同构） */
export type ScopeMode = "read" | "write";

/** 登录权限（默认涵盖账户相关 private 库 + 组织信息 + 资料 + 邮箱，仅读写切分） */
export interface LoginScopes {
  /** 只读模式（read）/ 完全控制（write） */
  mode: ScopeMode;
}

/** 登录参数：权限选择 + 登录成功后的回跳路径（站内路径，如 /settings/emails） */
export interface LoginOptions extends Partial<LoginScopes> {
  /** 登录成功回调回原页（默认 "/"） */
  redirect?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** 登录时申请的权限；未登录为 null */
  scopes: LoginScopes | null;
  /** GitHub 实际授予的 scope 列表（用户可能少授；旧会话为 null） */
  grantedScopes: string[] | null;
  /** 是否有读写权限（只读模式为 false，写操作 UI 置灰） */
  canWrite: boolean;
  /** 是否能访问私有仓库（默认涵盖，仅登录即可） */
  canAccessPrivate: boolean;
  /** 是否能管理组织（完全控制 admin:org：组织资料/成员设置与修改） */
  canManageOrg: boolean;
  /** 是否能编辑账户设置（完全控制 user scope：个人资料/邮箱等） */
  canEditAccount: boolean;
  /** 是否能创建/编辑 Gist（完全控制 gist scope） */
  canGist: boolean;
  /** 查漏补缺：已授 scope 相对当前模式所需集合的缺失列表（空 = 权限齐全；null 仅当未登录） */
  missingScopes: string[] | null;
  loading: boolean;
  /** 跳转 Worker /$auth/login（GitHub OAuth 授权）；可传权限选择 */
  login: (options?: LoginOptions) => void;
  /** PAT 直接登录（Worker /$auth/pat）：true=成功 / false=PAT 无效 / 异常=网络等错误 */
  loginWithPat: (pat: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [scopes, setScopes] = useState<LoginScopes | null>(null);
  const [grantedScopes, setGrantedScopes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  // 规范化 scopes（旧会话含勾选字段 → 仅取 mode）
  const normalizeScopes = (s?: LoginScopes): LoginScopes | null =>
    s && typeof s.mode === "string" ? { mode: s.mode } : null;

  /** 应用会话数据到状态 + 回填 sessionStorage 缓存（标签页级，关闭即清） */
  const applySession = (data: {
    token: string;
    user?: AuthUser;
    scopes?: LoginScopes;
    grantedScopes?: string[];
    expiresAt?: number;
  }) => {
    setToken(data.token);
    setUser(data.user && data.user.login ? data.user : null);
    setScopes(normalizeScopes(data.scopes));
    setGrantedScopes(Array.isArray(data.grantedScopes) ? data.grantedScopes : null);
    if (data.token) {
      writeCache({
        token: data.token,
        user: data.user,
        scopes: normalizeScopes(data.scopes) ?? undefined,
        grantedScopes: Array.isArray(data.grantedScopes) ? data.grantedScopes : undefined,
        expiresAt: data.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
    }
  };

  // 应用启动：sessionStorage 缓存未过期 → 直接恢复；否则经 Worker /$auth/session 恢复
  useEffect(() => {
    let cancelled = false;

    const apply = (data: {
      token: string;
      user?: AuthUser;
      scopes?: LoginScopes;
      grantedScopes?: string[];
      expiresAt?: number;
    }) => {
      if (cancelled) return;
      applySession(data);
    };

    (async () => {
      // 1. 缓存命中且未过期 → 直接恢复（不请求 worker / KV）
      const cached = readCache();
      if (cached && cached.expiresAt > Date.now() + CACHE_SKEW) {
        apply(cached);
        setLoading(false);
        return;
      }
      clearCache();

      // 2. 缓存缺失/过期 → 请求 worker 恢复并回填缓存
      try {
        const res = await fetch(`${WORKER_BASE}/$auth/session`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as {
            token: string;
            user?: AuthUser;
            scopes?: LoginScopes;
            grantedScopes?: string[];
            expiresAt?: number;
          };
          apply(data);
          // Worker 在 api.github.com 受限时无法取用户信息（/user 降级）：
          // 已拿到 token，前端自行补齐 login/头像
          if (data.token && (!data.user || !data.user.login)) {
            fetchCurrentUserSmart(data.token)
              .then((u) => {
                if (cancelled) return;
                const nu = {
                  login: u.login,
                  avatarUrl: u.avatar_url,
                  // REST /user 返回数字 id（类型为 number | undefined）
                  userId: typeof u.id === "number" ? u.id : undefined,
                };
                setUser(nu);
                // 同步更新缓存中的 user
                const c = readCache();
                if (c) writeCache({ ...c, user: nu });
                // 回写 KV session（POST /$auth/session）：worker 侧 debug 白名单
                // （按 userId）与偏好键 prefs:{userId} 依赖会话 userId——仅内存补全
                // 无法持久，必须写回（会话元数据补全）。
                // 幂等：worker 仅补缺省字段；失败静默（下次刷新仍会补全）。
                fetch(`${WORKER_BASE}/$auth/session`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    login: nu.login,
                    userId: nu.userId,
                    avatarUrl: nu.avatarUrl,
                  }),
                }).catch(() => {});
              })
              .catch(() => {
                /* api.github.com 不可达时保持未登录展示，网络恢复后自动补齐 */
              });
          }
        } else {
          clearCache();
        }
      } catch {
        // Worker 不可达 → 视为未登录
        clearCache();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = (options?: LoginOptions) => {
    // 关键：整页跳转重新授权前**先清除本地缓存**，
    // 否则 OAuth 回调回来后恢复逻辑命中未过期旧缓存 → 新模式不生效
    clearCache();
    // 整页跳转 Worker，由 Worker 302 到 GitHub 授权页（携带模式参数 + redirect 回原页）
    // deviceId：匿名设备标识（localStorage pg_device_id），Worker 记录到会话供「登录凭据」列表展示
    const params = new URLSearchParams();
    params.set("mode", options?.mode ?? "read");
    if (options?.redirect) params.set("redirect", options.redirect);
    params.set("deviceId", getDeviceId());
    window.location.href = `${WORKER_BASE}/$auth/login?${params}`;
  };

  /**
   * PAT 直接登录：GitHub 主站受限时跳过 OAuth 授权页，
   * 直接粘贴 Personal Access Token 经 Worker /$auth/pat 验证并建立会话。
   *
   * 安全：PAT 只发给 Worker（HTTPS），验证后存 KV 会话 + httpOnly cookie，
   * 前端照旧仅持内存 token；不写 localStorage 明文（标签页级缓存沿用既有约定）。
   *
   * @returns true=登录成功；false=PAT 无效（401/400）；其他错误抛出（网络受限等）
   */
  const loginWithPat = async (pat: string): Promise<boolean> => {
    clearCache();
    const res = await fetch(`${WORKER_BASE}/$auth/pat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pat, deviceId: getDeviceId() }),
    });
    if (res.status === 401 || res.status === 400) return false; // PAT 无效/缺失
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // 502 网络受限等
    const data = (await res.json()) as {
      token: string;
      user?: AuthUser;
      scopes?: LoginScopes;
      grantedScopes?: string[];
      expiresAt?: number;
    };
    applySession(data);
    return true;
  };

  const logout = async () => {
    try {
      await fetch(`${WORKER_BASE}/$auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      clearCache();
      setToken(null);
      setUser(null);
      setScopes(null);
      setGrantedScopes(null);
    }
  };

  // 偏好云同步：token 就绪 → 注册 auth 供 prefs push，并拉取云端偏好覆盖本地；
  // 登出 → 注销 push 能力（本地偏好保留，登录后再次同步）
  useEffect(() => {
    if (token) {
      setPrefsAuth(token, user?.login ?? "", user?.userId);
      void syncPrefsFromCloud();
    } else {
      setPrefsAuth(null);
    }
  }, [token, user?.login, user?.userId]);

  // 完全控制 → 全部写权限；只读模式 → 应用强制只读（仅浏览，UI 灰化）
  // 默认涵盖 private 库 + 组织信息（登录即含 repo/read:org），故 canAccessPrivate 恒真
  // 以 GitHub 真实授予为准（用户可能少授）；旧会话（grantedScopes=null）回退到请求的 mode
  const granted = grantedScopes;
  const writeGranted = Boolean(
    granted &&
    (granted.includes("admin:org") ||
      granted.includes("user") ||
      granted.includes("gist") ||
      granted.includes("admin:public_key") ||
      granted.includes("delete_repo") ||
      granted.includes("workflow") ||
      granted.includes("notifications") ||
      granted.includes("admin:gpg_key")),
  );
  const canWrite = Boolean(token && (granted ? writeGranted : scopes?.mode === "write"));
  const canAccessPrivate = Boolean(token);
  const canManageOrg = canWrite;
  const canEditAccount = canWrite;
  const canGist = canWrite;

  // 查漏补缺：按当前模式所需集合比对已授 scope（隐含等价），
  // 缺失项用于全局提示条 / 设置页对照表（用户可能少授，官方文档明示）
  const missingScopes = useMemo<string[] | null>(() => {
    if (!token) return null;
    const mode = scopes?.mode === "write" ? "write" : "read";
    return computeMissingScopes(grantedScopes, mode);
  }, [token, scopes, grantedScopes]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        scopes,
        grantedScopes,
        canWrite,
        canAccessPrivate,
        canManageOrg,
        canEditAccount,
        canGist,
        missingScopes,
        loading,
        login,
        loginWithPat,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
