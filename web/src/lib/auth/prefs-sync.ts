/**
 * 用户偏好云同步（创建 / 键改为 GitHub 用户数字 ID）
 *
 * 架构（与 Worker /$auth/prefs 对应）：
 * - 云端：Worker KV `prefs:{userId}`（用户级，不过期；数字 ID 永不变——
 *   登录名可改名/换用，userId 稳定定位 用户确认）
 * - 本地：仍是各模块既有 localStorage 键（pg-theme/pg_lang/pg-code-theme/puregit_api_mode/pg-date-format），
 *   本模块只做「打包上传 / 拆包写回 + 事件通知」，各偏好模块零侵入
 * - 事件 `puregit:prefs-synced`：云端偏好写回本地后派发，各偏好 hook/模块监听并重读
 * - 写入防抖：本地改偏好 → requestPrefsPush()（3s 合并），避免快速切换刷 KV
 * - 拉取时机：登录成功/恢复后 syncPrefsFromCloud() 一次；云端无偏好 → 上传本地（首次同步）
 *
 * 安全：prefs 仅 UI 偏好（theme/lang/codeTheme/apiMode/dateFormat），绝不含 token/密钥；
 * Worker 端白名单校验，未知键丢弃。
 */

/** 偏好同步完成事件名（各偏好模块监听此事件重读 localStorage） */
export const PREFS_SYNC_EVENT = "puregit:prefs-synced";

// 与 useAuth 同源（独立模块避免循环依赖）
const WORKER_BASE = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";

/** 本地偏好键（与各模块常量一致） */
const THEME_KEY = "pg-theme";
const LANG_KEY = "pg_lang";
const CODE_THEME_KEY = "pg-code-theme";
const API_MODE_KEY = "puregit_api_mode";
const DATE_FORMAT_KEY = "pg-date-format";
const FEED_FILTER_KEY = "pg-feed-filter";

/** 当前登录 token（由 AuthProvider 注册；登出置 null） */
let authToken: string | null = null;
/** 当前登录用户 GitHub 数字 ID（由 AuthProvider 注册；定位 prefs:{userId} 键） */
let authUserId: number | null = null;
/** 当前登录用户 login（由 AuthProvider 注册；遗留会话/兼容回退） */
let authLogin = "";

export function setPrefsAuth(token: string | null, login?: string, userId?: number): void {
  authToken = token;
  authLogin = login ?? "";
  authUserId = typeof userId === "number" ? userId : null;
}

/** 读取当前登录 token（lib 层同步判断登录态用；AuthProvider 注册，登出置 null） */
export function getPrefsToken(): string | null {
  return authToken;
}

/** 收集本地全部偏好（打包为可上传对象；非法值忽略、localStorage 不可用 → 空对象） */
export function collectLocalPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark" || t === "system") out.theme = t;
    const l = localStorage.getItem(LANG_KEY);
    if (l === "system" || l === "zh-CN" || l === "en-US") out.lang = l;
    const c = localStorage.getItem(CODE_THEME_KEY);
    if (c) out.codeTheme = c;
    const m = localStorage.getItem(API_MODE_KEY);
    if (m === "graphql" || m === "rest") out.apiMode = m;
    const df = localStorage.getItem(DATE_FORMAT_KEY);
    if (df === "absolute" || df === "iso" || df === "relative") out.dateFormat = df;
    const ff = localStorage.getItem(FEED_FILTER_KEY);
    // feedFilter 合法值：逗号分隔类型子集（白名单在 useFeedFilter parseFeedTypes 校验；此处仅长度/字符粗校验）
    if (ff && ff.length <= 64 && /^[a-z,]*$/.test(ff)) out.feedFilter = ff;
  } catch {
    /* localStorage 不可用 → 空 */
  }
  return out;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** 本地偏好变化 → 请求云同步（防抖 3s；未登录跳过） */
export function requestPrefsPush(): void {
  if (!authToken) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void doPush(), 3000);
}

async function doPush(): Promise<void> {
  if (!authToken) return;
  const prefs = collectLocalPrefs();
  if (Object.keys(prefs).length === 0) return;
  try {
    await fetch(`${WORKER_BASE}/$auth/prefs`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // userId/login：遗留会话（OAuth 回调网络受限 userId/login 为空）时 Worker 用它定位偏好键
      body: JSON.stringify({
        prefs,
        ...(authUserId != null ? { userId: String(authUserId) } : {}),
        ...(authLogin ? { login: authLogin } : {}),
      }),
    });
  } catch {
    /* 网络失败静默：下次改偏好再推（本地已生效，云同步尽力而为） */
  }
}

/**
 * 登录后拉取云端偏好并应用到本地（换设备自动同步）。
 * 云端有偏好 → 覆盖本地 + 派发事件；云端无 → 上传本地（首次同步）。
 */
export async function syncPrefsFromCloud(): Promise<void> {
  if (!authToken) return;
  let prefs: Record<string, string> | null = null;
  try {
    // userId/login：遗留会话（OAuth 回调网络受限 userId/login 为空）时 Worker 用它定位偏好键
    const q = new URLSearchParams();
    if (authUserId != null) q.set("userId", String(authUserId));
    else if (authLogin) q.set("login", authLogin);
    const res = await fetch(`${WORKER_BASE}/$auth/prefs${q.toString() ? `?${q}` : ""}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { prefs?: Record<string, string> | null };
    prefs = data.prefs && typeof data.prefs === "object" ? data.prefs : null;
  } catch {
    return; // Worker 不可达：保持本地
  }

  if (!prefs || Object.keys(prefs).length === 0) {
    void doPush(); // 首次同步：上传本地
    return;
  }
  applyCloudPrefs(prefs);
}

/** 云端偏好拆包写回 localStorage + 派发事件（各偏好模块监听重读） */
function applyCloudPrefs(p: Record<string, string>): void {
  let changed = false;
  try {
    if (p.theme === "light" || p.theme === "dark" || p.theme === "system") {
      localStorage.setItem(THEME_KEY, p.theme);
      changed = true;
    }
    if (p.lang === "system" || p.lang === "zh-CN" || p.lang === "en-US") {
      localStorage.setItem(LANG_KEY, p.lang);
      changed = true;
    }
    if (typeof p.codeTheme === "string" && p.codeTheme) {
      localStorage.setItem(CODE_THEME_KEY, p.codeTheme);
      changed = true;
    }
    if (p.apiMode === "graphql" || p.apiMode === "rest") {
      localStorage.setItem(API_MODE_KEY, p.apiMode);
      changed = true;
    }
    if (p.dateFormat === "absolute" || p.dateFormat === "iso" || p.dateFormat === "relative") {
      localStorage.setItem(DATE_FORMAT_KEY, p.dateFormat);
      changed = true;
    }
    if (typeof p.feedFilter === "string" && p.feedFilter.length > 0 && p.feedFilter.length <= 64) {
      localStorage.setItem(FEED_FILTER_KEY, p.feedFilter);
      changed = true;
    }
  } catch {
    /* ignore */
  }
  if (changed) {
    window.dispatchEvent(new CustomEvent(PREFS_SYNC_EVENT));
  }
}
