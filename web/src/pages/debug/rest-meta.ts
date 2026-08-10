/**
 * REST/GraphQL 调试页共享展示元数据（纯工具，无组件——Fast Refresh 友好）
 *
 * 左栏/请求编辑器/历史列表共用：方法彩色徽标映射、响应状态码配色、URL 规整。
 * REST 方法徽标与 GraphQL 方法共用同一语义色彩（GET/query 青、POST/mutation 橙等）。
 */
import type { BodyType } from "@/lib/debug-api";

/** REST 方法 → 彩色徽标类（Postman 语义；LeftPanel/RequestEditor/RestTree 共用） */
export const REST_METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-orange-600 dark:text-orange-400",
  PATCH: "text-purple-600 dark:text-purple-400",
  PUT: "text-sky-600 dark:text-sky-400",
  DELETE: "text-red-600 dark:text-red-400",
  HEAD: "text-teal-600 dark:text-teal-400",
  OPTIONS: "text-slate-600 dark:text-slate-400",
};

/** 方法彩色徽标类（含 GraphQL query/mutation；RequestEditor 方法下拉用） */
export const METHOD_COLOR: Record<string, string> = {
  ...REST_METHOD_COLOR,
  query: "text-sky-600 dark:text-sky-400",
  mutation: "text-orange-600 dark:text-orange-400",
};

/** 响应状态码 → 字体色彩：2xx 绿 / 3xx 蓝 / 4xx 琥珀 / 5xx 红 / 0 网络错误红 */
export function statusColorClass(status: number): string {
  if (status === 0) return "text-red-600 dark:text-red-400";
  if (status < 300) return "text-emerald-600 dark:text-emerald-400";
  if (status < 400) return "text-sky-600 dark:text-sky-400";
  if (status < 500) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** GitHub API REST 基地址（URL 输入框固定前缀 addon；RequestEditor 导出供展示） */
export const REST_API_BASE = "https://api.github.com";

/**
 * 规整 REST URL 为 path 形式（保留 query）：完整 URL（含基地址）→ `/path?query`；
 * 已是 path 则原样。切 REST 时若残留 GraphQL 完整 URL（https://api.github.com/graphql）
 * 会被规整为 `/graphql`（用户自行改）
 */
export function normalizeRestUrl(url: string): string {
  const t = url.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      // 仅当主机是 api.github.com 才规整；否则保留完整 URL（自定义端点直连仍可用）
      if (u.hostname === "api.github.com") {
        return u.pathname + u.search + u.hash;
      }
      return t;
    } catch {
      return t;
    }
  }
  return t;
}

/** bodyType → 自动 Content-Type（点选自动设置请求头）；Raw 不自动设 */
export const CT_BY_BODY: Partial<Record<BodyType, string>> = {
  json: "application/json",
  "form-urlencoded": "application/x-www-form-urlencoded",
  "form-data": "multipart/form-data",
};
