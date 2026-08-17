/**
 * GitHub REST API OpenAPI 解析（调试工具用）
 *
 * 数据源：`/debug/rest/*`（scripts/build-schemas-octokit.mjs 从 @octokit/openapi deref
 * 转录，按 tag 拆三层：req / res-min / res-full + index.json）。完整 OpenAPI 的
 * body schema（requestBody）全量保留——字段级 JSON 补全数据源（REST 缺补全的根因修复）。
 *
 * 消费方式（由 schema-loader.ts 统一加载 + 缓存，页面组件不直接 fetch）：
 * - RestIndex（index.json）：tag 骨架（首屏）
 * - RestReqFile + RestResMinFile（tag 懒加载）→ buildGroupFromTag → OpenApiGroup（集合树）
 * - RestResFullFile（文档 drawer 按需）
 *
 * OpenApiGroup/OpenApiEndpoint 是集合树 UI 的消费类型（method/path/op/label + resMin）。
 */
import type { DebugParam, DebugRequest } from "./debug-api";
import { parsePathSeg } from "./debug-params";

/** OpenAPI parameter 精简（name/in/required/type/desc） */
export interface OpenApiParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  type?: string;
  desc?: string;
}

/** 请求部分 operation（req 文件内单条） */
export interface ReqOperation {
  id?: string;
  summary?: string;
  desc?: string;
  tags?: string[];
  params?: OpenApiParam[];
  /** requestBody content-type 列表（POST/PUT/PATCH 等） */
  bodyTypes?: string[];
  /** content-type → schema 全量（字段级补全数据源） */
  body?: Record<string, unknown>;
}

export type OpenApiMethod = "get" | "post" | "patch" | "put" | "delete" | "head";

/** 响应状态码精简（res-min 文件内单条） */
export interface ResMinItem {
  s: string;
  desc?: string;
}

/* ── 转录产物文件结构（web/public/debug/rest/） ───────────── */

export interface RestTagInfo {
  tag: string;
  ops: number;
  reqKB: number;
  resMinKB: number;
  resFullKB: number;
}

export interface RestIndex {
  version: string;
  tags: RestTagInfo[];
}

/** <tag>.req.json */
export interface RestReqFile {
  tag: string;
  paths: Record<string, Partial<Record<OpenApiMethod, ReqOperation>>>;
}

/** <tag>.res-min.json */
export interface RestResMinFile {
  tag: string;
  paths: Record<string, Partial<Record<OpenApiMethod, ResMinItem[]>>>;
}

/** <tag>.res-full.json（responses 完整 schema，文档 drawer 浏览） */
export interface RestResFullFile {
  tag: string;
  paths: Record<string, Partial<Record<OpenApiMethod, Record<string, unknown>>>>;
}

/* ── 集合树 UI 消费类型 ───────────────────────────────────── */

export interface OpenApiGroup {
  tag: string;
  items: OpenApiEndpoint[];
}

export interface OpenApiEndpoint {
  /** 分组 key */
  tag: string;
  path: string;
  method: OpenApiMethod;
  op: ReqOperation;
  /** 人类可读名：summary 或 operationId */
  label: string;
  /** 响应状态码列表（res-min；集合树状态码展示） */
  resMin?: ResMinItem[];
}

/** 将 req + res-min 两个 tag 文件合并为集合树分组 */
export function buildGroupFromTag(
  reqFile: RestReqFile,
  resMinFile: RestResMinFile | null,
): OpenApiGroup {
  const items: OpenApiEndpoint[] = [];
  const paths = Object.entries(reqFile.paths ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [path, methods] of paths) {
    for (const [m, op] of Object.entries(methods ?? {})) {
      const method = m as OpenApiMethod;
      if (!op) continue;
      const resMin = resMinFile?.paths?.[path]?.[method] ?? undefined;
      items.push({
        tag: reqFile.tag,
        path,
        method,
        op,
        label: op.summary || op.id || `${method.toUpperCase()} ${path}`,
        resMin,
      });
    }
  }
  return { tag: reqFile.tag, items };
}

/** 段是否为模板占位段（含 `{name}` 标记；兼容 `{base}...{head}` 复合占位） */
function isPlaceholderSeg(seg: string): boolean {
  return /\{[^}]+\}/.test(seg);
}

/** 占位段中的字面片段（非 `{name}` 部分；如 `{base}...{head}` → `["..."]`，`{basehead}` → []） */
function literalPartsOf(seg: string): string[] {
  return seg.split(/\{[^}]+\}/).filter((s) => s.length > 0);
}

/** 将 OpenAPI 端点转为 DebugRequest（方法 + 路径 + 路径参数占位 + Params 表） */
export function endpointToRequest(ep: OpenApiEndpoint): DebugRequest {
  const pathParams = ep.op.params?.filter((p) => p.in === "path") ?? [];
  const queryParams = ep.op.params?.filter((p) => p.in === "query") ?? [];
  // Params 表：path 行带模板段位置 index（path[n] 徽章显示，误删占位可定位）；
  // **value 恒空（必填未填状态）**——placeholder 提示 `{name}`/1 + 警告样式；
  // URL 模板保持占位符，填值后 buildUrlFromParams 覆盖段、删空恢复占位。
  // index 取「段包含 `{name}`」的位置——兼容 compare 类 `{base}...{head}` 复合占位
  // （两个 path 参数共享同一段 index）；同时填段内模型（segPos/segCount/segSeparators）
  // ——复合段识别与渲染（单行合并多 input + 真实分隔符）的权威来源
  const params: DebugParam[] = pathParams.map((p) => {
    const name = p.name;
    const segments = ep.path.split("/");
    const idx = segments.findIndex((seg) => seg.includes(`{${name}}`));
    const { names, seps } = parsePathSeg(segments[idx]);
    const pos = names.indexOf(name);
    return {
      name,
      in: "path" as const,
      value: "",
      enabled: true,
      index: idx,
      segPos: pos,
      segCount: names.length,
      segSeparators: seps,
      required: true,
      type: p.type,
    };
  });
  for (const p of queryParams) {
    // 仅 **required query** 自动填充行（必填必须设定）——explicit=false：编辑中行，
    // 空值不输出 URL，反向解析保留；**非必填 query 不自动列出**（由 ParamsTable
    // docQueryNames badge 呈现，用户点击添加）
    if (!p.required) continue;
    params.push({
      name: p.name,
      in: "query" as const,
      value: "",
      enabled: true,
      explicit: false,
      required: true,
      type: p.type,
    });
  }
  const method = ep.method.toUpperCase() as DebugRequest["method"];
  return {
    protocol: "rest",
    method,
    url: ep.path, // 模板占位路径（path 参数 value 空 + placeholder 提示；填值覆盖段）
    query: "",
    operationName: "",
    variables: "",
    headers: [],
    body: "",
    bodyType: method === "GET" || method === "DELETE" || method === "HEAD" ? "none" : "json",
    formRows: [],
    params,
  };
}

/**
 * URL + 方法 → 匹配文档端点（段级模板匹配）
 * - 段数必须相同；模板占位段（含 `{name}`，兼容 `{base}...{head}` 复合）通配任意值；
 *   其余段精确相等
 * - 方法大小写不敏感（GET ↔ get）
 * - **最具体端点优先**（评分制）：① 非占位段（静态段）越多的越具体；② 静态段数相同
 *   时，占位段与 URL 段的「结构相似度」高的优先——模板自身（`t === u`）最高分，
 *   其次段内字面片段（如 `{base}...{head}` 的 `...`）出现在 URL 段中 → 结构分。
 *   解决两类误匹配：`/orgs/{org}/rulesets/rule-suites` 不被 `{ruleset_id}` 占位端点抢；
 *   `compare/{base}...{head}` 不被 `compare/{basehead}` 抢（真实产物两者共存且
 *   localeCompare 排序 `{basehead}` 在前，**不依赖数组顺序**）——填值 URL
 *   `main...dev` 含 `...` → 命中复合占位；无 `...` 的 `abc123` → 命中 `{basehead}`
 * - 用于需求 5：无论端点点选还是手写 URL，只要条件匹配即加载对应端点文档
 */
export function matchEndpoint(
  method: string,
  url: string,
  endpoints: OpenApiEndpoint[],
): OpenApiEndpoint | null {
  const urlPath = url.split("?")[0];
  const urlSegs = urlPath.split("/").filter(Boolean);
  if (url.trim() === "") return null; // 真正空 URL（`/` 根路径段数 0 仍可匹配）
  const m = method.toUpperCase();
  let best: OpenApiEndpoint | null = null;
  let bestStatic = -1;
  let bestPlaceholder = -1;
  for (const ep of endpoints) {
    if (ep.method.toUpperCase() !== m) continue;
    const tplSegs = ep.path.split("/").filter(Boolean);
    if (tplSegs.length !== urlSegs.length) continue;
    let ok = true;
    let staticCount = 0;
    let placeholderScore = 0;
    for (let i = 0; i < tplSegs.length; i++) {
      const t = tplSegs[i];
      if (isPlaceholderSeg(t)) {
        if (t === urlSegs[i]) {
          placeholderScore += 2; // 模板自身 round-trip（最高分）
        } else {
          // 字面片段结构分：`{base}...{head}` 的 `...` 在 `main...dev` 中出现 → 命中
          for (const part of literalPartsOf(t)) {
            if (urlSegs[i].includes(part)) placeholderScore++;
          }
        }
        continue;
      }
      staticCount++;
      if (t !== urlSegs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // 最具体优先：静态段数 → 占位段结构相似度（同分保留第一个，稳定）
    if (
      staticCount > bestStatic ||
      (staticCount === bestStatic && placeholderScore > bestPlaceholder)
    ) {
      bestStatic = staticCount;
      bestPlaceholder = placeholderScore;
      best = ep;
    }
  }
  return best;
}

/**
 * 当前端点是否仍匹配 URL + 方法（端点固化判定）
 * - 方法必须一致；段数相同；模板静态段（非占位段）位置值必须相等；占位段任意值
 * - 全占位端点（无静态段）→ 仅方法 + 段数校验（其匹配依赖方法，无法从静态段判断结构变化）
 * - 用途：端点确定后 URL 微编辑（填值/改值）不触发重新匹配——同结构只同步参数值；
 *   URL 结构变化（静态段不同/段数不同）或方法切换 → 判定失败 → 重新匹配换端点/清空
 */
export function endpointStillMatches(ep: OpenApiEndpoint, url: string, method: string): boolean {
  if (ep.method.toUpperCase() !== method.toUpperCase()) return false;
  const urlSegs = url.split("?")[0].split("/").filter(Boolean);
  const tplSegs = ep.path.split("/").filter(Boolean);
  if (tplSegs.length !== urlSegs.length) return false;
  for (let i = 0; i < tplSegs.length; i++) {
    const t = tplSegs[i];
    if (isPlaceholderSeg(t)) continue; // 占位段任意（含复合占位）
    if (t !== urlSegs[i]) return false;
  }
  return true;
}

/**
 * R1：端点搜索过滤（纯函数，可测）——REST 集合树搜索数据源
 * 匹配字段：tag / method / path / label（summary 或 operationId）——**只搜顶层**
 * （端点平铺即顶层；不搜 desc/summary 长文本——命中噪音大，label 已含 summary）。
 * query 空 → 原样返回（调用方保证非搜索模式不调用）；大小写不敏感包含匹配。
 * 供 RestTree 搜索模式平铺命中端点（getAllEndpoints 全量索引 + 虚拟滚动）。
 */
export function filterRestEndpoints(eps: OpenApiEndpoint[], query: string): OpenApiEndpoint[] {
  const q = query.trim().toLowerCase();
  if (!q) return eps;
  const hit = (ep: OpenApiEndpoint): boolean =>
    ep.tag.toLowerCase().includes(q) ||
    ep.method.toLowerCase().includes(q) ||
    ep.path.toLowerCase().includes(q) ||
    ep.label.toLowerCase().includes(q);
  return eps.filter(hit);
}
