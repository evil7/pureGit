/**
 * GitHub API Schema 从 octokit 依赖转录脚本（debug 面板数据源，零下载）
 *
 * 从项目已安装的 octokit 包直接提取两种 schema 数据（与当前实际使用的 SDK 版本
 * 完全同步，无需访问网络），输出到 web/public/debug/ 目录（三层 + 索引）：
 * - REST：`@octokit/openapi`（deref 变体，已展开全部 $ref）→ 按 operation 拆三类：
 *   - `<tag>.req.json`：请求部分——operationId/summary/desc/tags + parameters + requestBody
 *     content-type 列表 + **body schema 全量**（字段级补全数据，不砍）
 *   - `<tag>.res-min.json`：响应状态码精简——responses 只留 {status, desc}（集合树展示）
 *   - `<tag>.res-full.json`：响应完整 schema——responses 全量（文档 drawer 按需浏览）
 *   - `index.json`：tag 清单（tag 名 / 操作数 / 各文件体积 / 转录版本）
 * - GraphQL：`@octokit/graphql-schema` 的 `schema.json`（官方完整 introspection 原数据，
 *   含全部 description——不转义不精简，直接输出；gzip 204KB / brotli 117KB）
 *
 * 与官方下载版差异：REST 733 路径（octokit/openapi 22.x）vs 官方最新 808 条
 * （约 9% 缺口，新端点未入包）；GraphQL 1606 vs 1819 类型（无 preview 门控）。
 * 体积依据：req 全部 97KB / res-min 13KB / res-full 277KB（brotli，2026-08-10 实测）。
 * 前端 schema-loader.ts 消费本目录结构（缓存/TTL/SWR/预热）。
 *
 * 用法：`pnpm build:schemas`（根目录）或 `pnpm --filter web build:octoschema`
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const OUT_DIR = join(root, "web", "public", "debug");
const REST_DIR = join(OUT_DIR, "rest");
const GQL_DIR = join(OUT_DIR, "gql");

/* ── REST：@octokit/openapi deref → req / res-min / res-full ── */

/** 精简 parameter：name/in/required/schema 类型 + 短 desc（参数表展示用） */
function compactParam(p) {
  const out = { name: p.name, in: p.in };
  if (p.required) out.required = true;
  if (p.schema?.type) out.type = p.schema.type;
  else if (p.schema?.$ref) out.type = p.schema.$ref.split("/").pop();
  if (typeof p.description === "string" && p.description.length <= 150) out.desc = p.description;
  return out;
}

/** 请求部分：operation 元数据 + 参数 + requestBody（body schema 全量保留——补全数据） */
function buildReq(op) {
  const out = {};
  if (op.operationId) out.id = op.operationId;
  if (op.summary) out.summary = op.summary;
  if (op.description && op.description.length <= 400) out.desc = op.description;
  if (Array.isArray(op.tags) && op.tags.length) out.tags = op.tags;
  if (Array.isArray(op.parameters) && op.parameters.length)
    out.params = op.parameters.map(compactParam);
  if (op.requestBody?.content) {
    out.bodyTypes = Object.keys(op.requestBody.content);
    // body 补全关键：content-type → schema 全量（字段级 JSON 补全数据源）
    out.body = Object.fromEntries(
      Object.entries(op.requestBody.content).map(([ct, c]) => [ct, c.schema || null]),
    );
  }
  return out;
}

/** 响应状态码精简：只留 {status, desc}（集合树状态码展示；响应结构浏览走 res-full） */
function buildResMin(op) {
  if (!op.responses) return null;
  return Object.entries(op.responses)
    .map(([s, r]) => ({
      s,
      desc: typeof r?.description === "string" ? r.description.slice(0, 120) : "",
    }))
    .sort((a, b) => a.s.localeCompare(b.s, undefined, { numeric: true }));
}

/** 响应完整：responses 原样（文档 drawer 浏览响应结构） */
function buildResFull(op) {
  return op.responses || null;
}

/** 按 tag 分组收集（fn 返回 null 则该 operation 跳过） */
function groupByTag(doc, fn) {
  const map = new Map();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (!["get", "post", "patch", "put", "delete", "head"].includes(m)) continue;
      if (!op || typeof op !== "object") continue;
      const tag = (op.tags && op.tags[0]) || path.split("/").filter(Boolean)[0] || "misc";
      const v = fn(op);
      if (v == null) continue;
      const list = map.get(tag) ?? [];
      list.push({ method: m, path, v });
      map.set(tag, list);
    }
  }
  return map;
}

/** 输出到目录：{ tag: { method: {path: v} } } 结构 → 文件 */
function writeTagFiles(map, dir, ext) {
  for (const [tag, items] of map) {
    const obj = { tag, paths: {} };
    for (const { method, path, v } of items) {
      obj.paths[path] = obj.paths[path] ?? {};
      obj.paths[path][method] = v;
    }
    writeFileSync(join(dir, `${tag}.${ext}.json`), JSON.stringify(obj));
  }
}

function transcribeRest() {
  const { schemas } = require("../node_modules/@octokit/openapi/index.js");
  const doc = schemas["api.github.com.deref"];
  if (!doc?.paths) throw new Error("@octokit/openapi 未提供 api.github.com.deref schema");

  const reqMap = groupByTag(doc, buildReq);
  const resMinMap = groupByTag(doc, buildResMin);
  const resFullMap = groupByTag(doc, buildResFull);
  const tags = [...new Set([...reqMap.keys(), ...resMinMap.keys(), ...resFullMap.keys()])].sort();

  writeTagFiles(reqMap, REST_DIR, "req");
  writeTagFiles(resMinMap, REST_DIR, "res-min");
  writeTagFiles(resFullMap, REST_DIR, "res-full");

  // 索引：tag 清单 + 操作数 + 各文件体积（前端懒加载骨架 + 预热遍历依据）
  const tagInfo = tags.map((tag) => {
    const size = (f) => {
      const p = join(REST_DIR, `${tag}.${f}.json`);
      return existsSync(p)
        ? Math.max(1, Math.round(require("node:fs").statSync(p).size / 1024))
        : 0;
    };
    return {
      tag,
      ops: reqMap.get(tag)?.length ?? 0,
      reqKB: size("req"),
      resMinKB: size("res-min"),
      resFullKB: size("res-full"),
    };
  });
  const version = require("../node_modules/@octokit/openapi/package.json").version;
  writeFileSync(
    join(REST_DIR, "index.json"),
    JSON.stringify({ version: `openapi@${version}`, tags: tagInfo }),
  );
  const totalOps = tagInfo.reduce((a, t) => a + t.ops, 0);
  console.log(
    `[REST] 转录 ${tags.length} tag / ${totalOps} 操作 → web/public/debug/rest/（req/res-min/res-full 三层）`,
  );
}

/* ── GraphQL：@octokit/graphql-schema → 原数据 schema.json ──── */

function transcribeGql() {
  const mod = require("../web/node_modules/@octokit/graphql-schema/index.js");
  // 官方完整 introspection 原数据（含全部 description），不转义不精简直接输出；
  // 前端 buildClientSchema 消费（体积 brotli 117KB，见 docs/debug-page.md §5）
  writeFileSync(join(GQL_DIR, "schema.json"), JSON.stringify(mod.schema.json));
  const raw = Buffer.byteLength(JSON.stringify(mod.schema.json));
  const gz = require("node:zlib").gzipSync(Buffer.from(JSON.stringify(mod.schema.json))).length;
  console.log(
    // eslint-disable-next-line no-underscore-dangle -- __schema 为 GraphQL 内省协议强制字段名，非代码命名
    `[GraphQL] 转录 ${mod.schema.json.__schema.types.length} 类型（原数据含 description）→ web/public/debug/gql/schema.json（${(raw / 1024).toFixed(0)}KB raw / ${(gz / 1024).toFixed(0)}KB gzip）`,
  );
}

/* ── 执行 ─────────────────────────────────────────────────── */

mkdirSync(REST_DIR, { recursive: true });
mkdirSync(GQL_DIR, { recursive: true });
transcribeRest();
transcribeGql();
console.log("完成：octokit 转录 → web/public/debug/（零下载）");
