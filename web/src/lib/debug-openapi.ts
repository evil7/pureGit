/**
 * GitHub REST API OpenAPI 解析（调试工具用）
 *
 * 数据源：`/github-openapi.min.json`（scripts/build-openapi.mjs 从官方
 * `github/rest-api-description` 压缩生成，0.32MB / 808 路径）。octokit SDK 仅带
 * TS 类型（@octokit/openapi-types）**不带运行时 OpenAPI**，故下载官方描述文件。
 *
 * 用途：debug 面板「集合」自动构建 REST API 树（按 tag 分组）——点按端点自动
 * 填充方法 / 路径 / 参数。按需 fetch（仅 debug 页访问时加载），不增加首屏 bundle。
 */
import type { DebugRequest } from "./debug-api";

/** 精简版 OpenAPI 结构（与 scripts/build-openapi.mjs 输出对应） */
export interface OpenApiParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  type?: string;
  desc?: string;
}

export interface OpenApiOperation {
  id?: string;
  summary?: string;
  desc?: string;
  tags?: string[];
  params?: OpenApiParam[];
  bodyTypes?: string[];
  responses?: string[];
}

export type OpenApiMethod = "get" | "post" | "patch" | "put" | "delete" | "head";

export interface OpenApiDoc {
  info?: { title?: string; version?: string };
  paths: Record<string, Partial<Record<OpenApiMethod, OpenApiOperation>>>;
}

/** 分组后的集合节点（tag → 端点列表） */
export interface OpenApiGroup {
  tag: string;
  items: OpenApiEndpoint[];
}

export interface OpenApiEndpoint {
  /** 分组 key（无 tag 时用首段路径） */
  tag: string;
  path: string;
  method: OpenApiMethod;
  op: OpenApiOperation;
  /** 人类可读名：summary 或 operationId */
  label: string;
}

let cached: OpenApiDoc | null = null;
let loadPromise: Promise<OpenApiDoc | null> | null = null;

/** 加载精简 OpenAPI（按需 fetch + 缓存；失败返回 null） */
export function loadOpenApi(): Promise<OpenApiDoc | null> {
  if (cached) return Promise.resolve(cached);
  if (loadPromise) return loadPromise;
  loadPromise = fetch("/github-openapi.min.json")
    .then((r) => {
      if (!r.ok) throw new Error(`openapi ${r.status}`);
      return r.json();
    })
    .then((doc) => {
      cached = doc as OpenApiDoc;
      return cached;
    })
    .catch(() => {
      loadPromise = null; // 失败允许重试
      return null;
    });
  return loadPromise;
}

/** 端点分组 key：operation.tags[0] 或路径首段（/repos/... → repos） */
function tagOf(path: string, op: OpenApiOperation): string {
  if (op.tags?.[0]) return op.tags[0];
  const seg = path.split("/").filter(Boolean)[0];
  return seg || "misc";
}

/** 构建按 tag 分组的 REST 端点集合（按路径排序） */
export function buildOpenApiGroups(doc: OpenApiDoc): OpenApiGroup[] {
  const map = new Map<string, OpenApiEndpoint[]>();
  const paths = Object.entries(doc.paths ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [path, methods] of paths) {
    for (const [m, op] of Object.entries(methods ?? {})) {
      const method = m as OpenApiMethod;
      if (!op) continue;
      const tag = tagOf(path, op);
      const ep: OpenApiEndpoint = {
        tag,
        path,
        method,
        op,
        label: op.summary || op.id || `${method.toUpperCase()} ${path}`,
      };
      const list = map.get(tag) ?? [];
      list.push(ep);
      map.set(tag, list);
    }
  }
  return [...map.entries()]
    .map(([tag, items]) => ({ tag, items }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** 将 OpenAPI 端点转为 DebugRequest（方法 + 路径 + 路径参数占位） */
export function endpointToRequest(ep: OpenApiEndpoint): DebugRequest {
  const pathParams =
    ep.op.params
      ?.filter((p) => p.in === "path")
      .map((p) => p.name)
      .filter((n) => n) ?? [];
  let url = ep.path;
  for (const p of pathParams) {
    url = url.replace(`{${p}}`, `{${p}}`); // 保留占位符，用户自行替换
  }
  // 常用参数默认值（repository/owner 常用占位）
  const defaults: Record<string, string> = {
    owner: "{owner}",
    repo: "{repo}",
    org: "{org}",
  };
  for (const p of pathParams) {
    url = url.replace(`{${p}}`, defaults[p] ?? `{${p}}`);
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
  };
}
