/**
 * GitHub GraphQL Schema 精简压缩脚本（调试工具用）
 *
 * 从已入库的官方 schema 快照 `docs/github-schema.graphql`（1.47MB，docs.github.com
 * 官方 SDL 源，离线、无需 token）生成 debug 面板所需的精简 introspection JSON
 * `web/public/github-graphql.min.json`（1.5MB 原始 / gzip 87KB）：
 * - 保留：__schema（queryType/mutationType + 全部非 __ 前缀类型的 kind/name +
 *   fields(args/type 链/isDeprecated)/inputFields/interfaces/enumValues/possibleTypes +
 *   directives(locations/args)）——与前端 INTROSPECTION_QUERY 返回结构完全同构，
 *   前端 `buildClientSchema` 直接复用，无需区分数据源
 * - 丢弃：description / specifiedByURL / isOneOf 等体积大头
 * - docs 快照不含 preview 门控类型（1819 类型 vs runtime introspection ~4000），
 *   「分清有哪些端点可用」的浏览场景足够；schema 版本落后时由 debug 面板
 *   「在线刷新」按钮带 token introspection 兜底（仅内存缓存）
 *
 * 用法：`pnpm update:schemas`（下载 + 构建一步到位）或 `pnpm --filter web build:gqlschema`
 * （仅构建，需 docs/github-schema.graphql 已存在；源文件由 scripts/update-schemas.mjs 下载）
 * 注意：graphql-js 从 web/node_modules 解析（脚本在根 scripts/ 下运行）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "docs", "github-schema.graphql");
const OUT = join(root, "web", "public", "github-graphql.min.json");

// web 的 node_modules 里有 graphql（构建脚本在根目录无独立依赖）
const require = createRequire(import.meta.url);
const gql = require("../web/node_modules/graphql/index.js");

const src = readFileSync(SRC, "utf8");
const schema = gql.buildSchema(src, { assumeValid: true, assumeValidSDL: true });

/** TypeRef 递归链（kind/name/ofType，与前端 INTROSPECTION_QUERY fragment TypeRef 同构） */
function typeRef(t) {
  if (gql.isNonNullType(t)) return { kind: "NON_NULL", ofType: typeRef(t.ofType) };
  if (gql.isListType(t)) return { kind: "LIST", ofType: typeRef(t.ofType) };
  return { kind: typeKind(t), name: t.name };
}

/** graphql-js 类型 → introspection TypeKind 枚举（注意不是 SDL astNode.kind！） */
function typeKind(t) {
  if (gql.isObjectType(t)) return "OBJECT";
  if (gql.isInterfaceType(t)) return "INTERFACE";
  if (gql.isUnionType(t)) return "UNION";
  if (gql.isEnumType(t)) return "ENUM";
  if (gql.isInputObjectType(t)) return "INPUT_OBJECT";
  return "SCALAR";
}

/** 精简单个类型（字段/入参/枚举/联合，保留 buildClientSchema 必需字段） */
function compactType(t) {
  const out = { kind: typeKind(t), name: t.name };
  if (gql.isObjectType(t) || gql.isInterfaceType(t)) {
    out.fields = Object.values(t.getFields()).map((f) => ({
      name: f.name,
      args: f.args.map((a) => ({
        name: a.name,
        type: typeRef(a.type),
        defaultValue: a.defaultValue?.toString(),
      })),
      type: typeRef(f.type),
      isDeprecated: f.deprecationReason != null,
      deprecationReason: f.deprecationReason,
    }));
    out.interfaces = t.getInterfaces().map((i) => typeRef(i));
  }
  if (gql.isInputObjectType(t)) {
    out.inputFields = Object.values(t.getFields()).map((f) => ({
      name: f.name,
      type: typeRef(f.type),
      defaultValue: f.defaultValue?.toString(),
    }));
  }
  if (gql.isEnumType(t)) {
    out.enumValues = t.getValues().map((v) => ({
      name: v.name,
      isDeprecated: v.deprecationReason != null,
      deprecationReason: v.deprecationReason,
    }));
  }
  if (gql.isUnionType(t)) {
    out.possibleTypes = t.getTypes().map((x) => typeRef(x));
  }
  return out;
}

const min = {
  __schema: {
    queryType: { name: schema.getQueryType()?.name },
    mutationType: { name: schema.getMutationType()?.name },
    // 标准 introspection：无 subscription 时为 null（不是 {name: null}，buildClientSchema 会 getType 报错）
    subscriptionType: schema.getSubscriptionType()
      ? { name: schema.getSubscriptionType()?.name }
      : null,
    types: Object.values(schema.getTypeMap())
      .filter((t) => !t.name.startsWith("__"))
      .map(compactType),
    directives: schema.getDirectives().map((d) => ({
      name: d.name,
      isRepeatable: d.isRepeatable,
      locations: d.locations,
      args: d.args.map((a) => ({ name: a.name, type: typeRef(a.type) })),
    })),
  },
};

writeFileSync(OUT, JSON.stringify(min));
const rawKB = (Buffer.byteLength(JSON.stringify(min)) / 1024).toFixed(0);
const gzKB = (
  require("node:zlib").gzipSync(Buffer.from(JSON.stringify(min))).length / 1024
).toFixed(0);
console.log(
  `精简完成：${schema.getTypeMap() ? Object.keys(schema.getTypeMap()).length : 0} 类型 → ${OUT}（${rawKB}KB raw / ${gzKB}KB gzip）`,
);
