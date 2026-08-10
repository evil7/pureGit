/**
 * GitHub REST API OpenAPI 压缩脚本
 *
 * 从官方 `github/rest-api-description` 的完整 OpenAPI（~12.9MB，docs/github-openapi.json
 * 快照，由 scripts/update-schemas.mjs 一键下载）生成 debug 面板集合树所需的精简版
 * （~0.32MB）：
 * - 保留：info + paths（每个 path 的 get/post/patch/put/delete/head：
 *   operationId / summary / description / tags / parameters（name,in,required,schema 精简）/
 *   requestBody（content 类型清单）/ responses（状态码清单））
 * - 丢弃：components（全部 schema 定义——体积大头，集合树用不到）
 *
 * 用法：`pnpm update:schemas`（下载 + 构建一步到位）或 `pnpm --filter web build:openapi`
 * （仅构建，需 docs/github-openapi.json 已存在）
 * 注意：octokit 运行时不带 OpenAPI（仅 TS 类型），故需官方文件；min.json 已入库。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "docs", "github-openapi.json");
const OUT = join(root, "web", "public", "github-openapi.min.json");

const raw = JSON.parse(readFileSync(SRC, "utf8"));

/** 精简 parameter：name/in/required/schema 类型 */
function compactParam(p) {
  const out = {
    name: p.name,
    in: p.in,
  };
  if (p.required) out.required = true;
  if (p.schema?.type) out.type = p.schema.type;
  else if (p.schema?.$ref) out.type = p.schema.$ref.split("/").pop();
  if (typeof p.description === "string" && p.description.length <= 120) out.desc = p.description;
  return out;
}

/** 精简 operation：只留集合树所需 */
function compactOperation(op) {
  const out = {};
  if (op.operationId) out.id = op.operationId;
  if (op.summary) out.summary = op.summary;
  if (op.description && op.description.length <= 200) out.desc = op.description;
  if (Array.isArray(op.tags) && op.tags.length) out.tags = op.tags;
  if (Array.isArray(op.parameters) && op.parameters.length)
    out.params = op.parameters.map(compactParam);
  if (op.requestBody) {
    const content = op.requestBody?.content ?? {};
    const types = Object.keys(content);
    if (types.length) out.bodyTypes = types;
  }
  if (op.responses) {
    out.responses = Object.keys(op.responses).sort();
  }
  return out;
}

const paths = {};
for (const [path, methods] of Object.entries(raw.paths ?? {})) {
  const ops = {};
  for (const [m, op] of Object.entries(methods)) {
    if (!["get", "post", "patch", "put", "delete", "head"].includes(m)) continue;
    if (!op || typeof op !== "object") continue;
    ops[m] = compactOperation(op);
  }
  if (Object.keys(ops).length) paths[path] = ops;
}

const min = {
  openapi: raw.openapi,
  info: {
    title: raw.info?.title,
    version: raw.info?.version,
    description: raw.info?.description?.slice(0, 200),
  },
  servers: raw.servers,
  paths,
};

writeFileSync(OUT, JSON.stringify(min));
const sizeMB = (Buffer.byteLength(JSON.stringify(min)) / 1024 / 1024).toFixed(2);
console.log(`精简完成：${Object.keys(paths).length} 条路径 → ${OUT}（${sizeMB}MB）`);
