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

/** 将 OpenAPI 端点转为 DebugRequest（方法 + 路径 + 路径参数占位 + Params 表） */
export function endpointToRequest(ep: OpenApiEndpoint): DebugRequest {
  const pathParams = ep.op.params?.filter((p) => p.in === "path") ?? [];
  const queryParams = ep.op.params?.filter((p) => p.in === "query") ?? [];
  let url = ep.path;
  // 常用参数默认值（repository/owner 常用占位）
  const defaults: Record<string, string> = {
    owner: "{owner}",
    repo: "{repo}",
    org: "{org}",
  };
  // Params 表：path 行带模板段位置 index（path[n] 徽章显示，误删占位可定位）；
  // 值默认占位符 `{name}`（或常用占位）→ buildUrlFromParams 替换
  const params: DebugParam[] = pathParams.map((p) => {
    const name = p.name;
    const segments = ep.path.split("/");
    const idx = segments.findIndex((seg) => seg === `{${name}}`);
    const placeholder = defaults[name] ?? `{${name}}`;
    url = url.replace(`{${name}}`, placeholder);
    return { name, in: "path" as const, value: placeholder, enabled: true, index: idx };
  });
  for (const p of queryParams) {
    params.push({ name: p.name, in: "query" as const, value: "", enabled: true });
  }
  const method = ep.method.toUpperCase() as DebugRequest["method"];
  return {
    protocol: "rest",
    method,
    url,
    query: "",
    variables: "",
    headers: [],
    body: "",
    bodyType: method === "GET" || method === "DELETE" || method === "HEAD" ? "none" : "json",
    formRows: [],
    params,
  };
}
