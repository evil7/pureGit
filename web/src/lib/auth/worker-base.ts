/**
 * Worker 基础地址（独立模块，供 useAuth 与 prefs-sync 共用，避免循环依赖）
 *
 * vite-plugin 单进程 dev 与生产部署（CF Pages 同域）均为**同源**，
 * 直接请求相对路径即可；如需跨域（独立 worker dev）用 VITE_WORKER_URL 覆盖。
 */
export const WORKER_BASE = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";
