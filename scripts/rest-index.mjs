/**
 * REST API 索引生成器（v0.0.1 工具基建 · v2 重写）
 *
 * 从项目已安装的 `@octokit/openapi`（api.github.com.deref）**零下载**转录 GitHub REST 端点：
 * 每条操作输出 `{ id(operationId), tags, summary, description, method, path, parameters }`。
 *
 * **不再聚拢 GraphQL**——本文件只负责 REST 一侧的权威转录。双端点「graph→rest 熔断对等」
 * 关系改由人主观判断：先用 `apiidx rest` 定位 REST 端点，再用 `apiidx gql type/field` 递进
 * GraphQL 类型树，确认有无嵌套 / Connection 等价；结论沉淀于 `docs/api-compat.md`（单一权威来源）。
 * 这替代了旧版「红黑树启发式自动配对」——不再强制返回可能不全面的对等兼容路径提示。
 *
 * 产出 `scripts/data/rest-index.json`，供 `scripts/apiidx.mjs` 查询。
 *
 * 用法：`node scripts/rest-index.mjs`（SDK 升级后重跑刷新）
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const OUT_FILE = join(root, "scripts", "data", "rest-index.json");

/** 单一参数 → 可读结构（path/query/header 参数；type 取 schema.type，可能缺省） */
function paramOf(p) {
  return {
    name: p.name,
    in: p.in,
    required: Boolean(p.required),
    type: p.schema?.type ?? (p.schema?.$ref ? "ref" : "?"),
    desc: (p.description || "").split("\n")[0].trim(),
  };
}

/** 转录 REST 操作（deref schema，参数/响应已展开 $ref） */
function transcribeRest() {
  const { schemas } = require("../node_modules/@octokit/openapi/index.js");
  const doc = schemas["api.github.com.deref"];
  if (!doc?.paths) throw new Error("@octokit/openapi 未提供 api.github.com.deref schema");
  const ops = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (!["get", "post", "patch", "put", "delete", "head"].includes(m)) continue;
      if (!op || typeof op !== "object") continue;
      ops.push({
        id: op.operationId,
        tags: op.tags || [],
        summary: op.summary || "",
        description: (op.description || "").split("\n")[0].trim(),
        method: m.toUpperCase(),
        path,
        parameters: (op.parameters || []).map(paramOf),
      });
    }
  }
  const version = require("../node_modules/@octokit/openapi/package.json").version;
  return { ops, version: `openapi@${version}` };
}

const { ops, version } = transcribeRest();
const index = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    version,
    counts: { operations: ops.length },
  },
  items: ops.sort((a, b) => a.id.localeCompare(b.id)),
};
writeFileSync(OUT_FILE, JSON.stringify(index, null, 2));
console.log(`[rest-index] 转录 REST ${ops.length} 操作（${version}）→ ${OUT_FILE}`);
