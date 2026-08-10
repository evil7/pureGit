/**
 * REST 请求参数（Params tab）与 URL 的双向联动
 *
 * - **正向（参数 → URL）**：`buildUrlFromParams`——path 参数按 `index` 段位置直接覆盖
 *   URL 对应段（值空/占位/段缺失则保留）；query 参数（enabled 且值非空）拼接 query string
 * - **反向（URL → 参数）**：`syncParamsFromUrl`——解析 URL 的 query string 同步同名
 *   query 行（值变化、新增 key、保留未出现在 URL 中的行）；path 参数：URL 中存在 `{name}`
 *   占位 → 值同步为占位（用户手写实际值时不强制回写，避免破坏编辑中路径）
 *
 * 用途：从端点选择 → 参数表自动填充（path 占位 + query 空值，对照响应面板文档）；
 * 用户填参数 → URL 自动补全；直接改 URL → 参数表联动。path 参数在参数表显示 `path[n]`
 * 段位置（来自端点模板 index，即 URL 中该行的权威位置——正向构建按 index 覆盖段，
 * 不依赖 `{name}` 占位符，占位符被替换后仍能正确联动），误删占位后可快速定位取值位置。
 *
 * 事件驱动防循环：参数编辑（ParamsTable onChange）与 URL 编辑（URL 输入框 onChange）
 * 各自在事件处理器内同步对方，不经过 useEffect，天然无循环回写。
 */
import type { DebugParam } from "./debug-api";

/** 解析 URL query string → [key, value][]（手动解码，兼容 `+` 为空格之外的原样） */
export function parseQuery(qs: string): [string, string][] {
  if (!qs) return [];
  return qs
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return [decodeURIComponent(pair), ""];
      return [decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1))];
    });
}

/**
 * 正向：参数表 → URL
 * path 参数按段位置 `index` 直接覆盖 URL 对应段（index 来自端点模板 split('/')，
 * 不依赖 `{name}` 占位符——占位符一旦被替换就不再存在，按名匹配会失效）；
 * 值空（输入框已由 ParamsTable 自动补回占位符，防御保留）或段缺失（URL 被改短/
 * 改路径）→ 保留当前段不动；值为 `{name}` 占位符 → 段覆盖回占位符（URL 回到
 * 占位状态，与「删空自动补回」联动一致）；
 * query 参数（enabled 且值非空）拼接到 query string（先清原 query 再重建）
 */
export function buildUrlFromParams(url: string, params: DebugParam[]): string {
  const pathPart = url.split("?")[0];
  const segments = pathPart.split("/");
  for (const p of params) {
    if (p.in !== "path" || !p.enabled || typeof p.index !== "number") continue;
    const v = p.value?.trim() ?? "";
    if (!v) continue; // 空值 → 保留当前段
    const seg = segments[p.index];
    if (seg === undefined || seg === "") continue; // 段缺失（URL 被改短/改路径）→ 不动
    segments[p.index] = v; // 实际值或 {name} 占位符都直接覆盖段
  }
  const path = segments.join("/");
  const queryParams = params.filter((p) => p.in === "query" && p.enabled && p.value?.trim() !== "");
  const qs = queryParams
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value.trim())}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

/**
 * 反向：URL → 参数表
 * - query：解析 query string 同步同名行 value；URL 新增的 key 补新行（enabled）；未出现的行保留原值
 * - path：按模板段位置 index 取 URL 对应段——仍为 `{name}` 占位 → 值同步为占位；
 *   实际值（用户手写 / 参数编辑生成）→ 同步回参数表；段缺失（URL 被改短）→ 保持
 */
export function syncParamsFromUrl(params: DebugParam[], url: string): DebugParam[] {
  const urlPath = url.split("?")[0];
  const segments = urlPath.split("/");
  const entries = parseQuery(url.split("?")[1] ?? "");
  const next: DebugParam[] = params.map((p) => {
    if (p.in === "query") {
      const hit = entries.find(([k]) => k === p.name);
      if (hit) return { ...p, value: hit[1] };
      return p;
    }
    if (p.in === "path" && typeof p.index === "number") {
      const placeholder = `{${p.name}}`;
      const seg = segments[p.index];
      if (seg === undefined || seg === "") return p; // 段缺失/为空 → 保持
      if (seg === placeholder) return { ...p, value: placeholder };
      // 实际值（可能 URL 编码）→ 同步回参数表
      try {
        return { ...p, value: decodeURIComponent(seg) };
      } catch {
        return { ...p, value: seg };
      }
    }
    return p;
  });
  // URL 中出现的 query key 但参数表缺失 → 补新行（enabled）
  for (const [k, v] of entries) {
    if (!next.some((p) => p.in === "query" && p.name === k)) {
      next.push({ name: k, in: "query", value: v, enabled: true });
    }
  }
  return next;
}
