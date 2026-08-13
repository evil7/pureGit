/**
 * GraphQL Schema 加载器（v0.0.1 工具基建 · v2）
 *
 * 为 `scripts/apiidx.mjs` 的 gql 递进查询提供 schema 数据源，**实时优先、本地兜底**：
 *  1. 缓存命中（`scripts/data/graphql-live.json`，TTL 内）→ 直接复用（source=cache）；
 *  2. 否则读系统变量 `GITHUB_TOKEN`，直连官方 `https://api.github.com/graphql` 做 introspection：
 *     - 成功 → 写缓存并返回（source=remote）；
 *     - 401/403 → 提示「现有 GITHUB_TOKEN 权限不足」→ 降级本地（source=local）；
 *     - 其他网络错误 → 提示「网络受限」→ 降级本地（source=local）；
 *  3. 未设置 GITHUB_TOKEN → 提示「需设置系统变量 GITHUB_TOKEN」→ 降级本地（source=local）；
 *  4. 本地兜底 = 已安装的 `@octokit/graphql-schema` 零下载 introspection JSON。
 *
 * 远程与本地均归一化为同一 GraphQL introspection `__schema` 结构，下游查询逻辑单一。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
const CACHE_FILE = join(DATA_DIR, "graphql-live.json");
const GQL_ENDPOINT = "https://api.github.com/graphql";
const TTL_MS = 10 * 60 * 1000; // 缓存 10 分钟（introspection 消耗 GraphQL 额度，避免高频重拉）

/** 完整 introspection 查询（含字段/参数/输入值/枚举/接口/possibleTypes；不含 directives，减小体积） */
const INTROSPECTION_QUERY = /* GraphQL */ `
  query IntrospectionQuery {
    __schema {
      queryType {
        name
      }
      mutationType {
        name
      }
      types {
        ...FullType
      }
    }
  }
  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }
  fragment InputValue on __InputValue {
    name
    description
    type {
      ...TypeRef
    }
    defaultValue
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** 类型引用 → 可读字符串（NON_NULL/LIST 嵌套展开） */
export function typeStr(t) {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return `${typeStr(t.ofType)}!`;
  if (t.kind === "LIST") return `[${typeStr(t.ofType)}]`;
  return t.name || "?";
}

/** 读取本地 `@octokit/graphql-schema` 的 introspection JSON（零下载兜底） */
function loadLocal() {
  const mod = require("../node_modules/@octokit/graphql-schema/index.js");
  return mod.schema.json.__schema;
}

/** 读缓存（TTL 内才有效） */
function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - c.fetchedAt > TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(__schema) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), __schema }, null, 2));
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

/**
 * 加载 schema：实时远程（GITHUB_TOKEN）优先，失败/无 token 降级本地。
 * @param {object} [opts] { refresh?: boolean } refresh=true 强制忽略缓存重拉
 * @returns {Promise<{ __schema: object, source: "remote"|"cache"|"local" }>}
 */
export async function loadSchema(opts = {}) {
  if (!opts.refresh) {
    const cached = readCache();
    if (cached) return { __schema: cached.__schema, source: "cache" };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "[apiidx] ⚠ 未设置系统变量 GITHUB_TOKEN → 降级本地 @octokit/graphql-schema（可能落后于线上 schema）",
    );
    return { __schema: loadLocal(), source: "local" };
  }

  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "puregit-apiidx",
      },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    });
    if (res.status === 401 || res.status === 403) {
      console.warn(
        "[apiidx] ⚠ 现有 GITHUB_TOKEN 权限不足（HTTP " +
          res.status +
          "）→ 降级本地 @octokit/graphql-schema",
      );
      return { __schema: loadLocal(), source: "local" };
    }
    if (!res.ok) {
      console.warn(
        "[apiidx] ⚠ 远程 introspection 失败（HTTP " +
          res.status +
          "）→ 降级本地 @octokit/graphql-schema",
      );
      return { __schema: loadLocal(), source: "local" };
    }
    const json = await res.json();
    const __schema = json?.data?.__schema;
    if (!__schema) {
      console.warn("[apiidx] ⚠ 远程 introspection 返回异常 → 降级本地 @octokit/graphql-schema");
      return { __schema: loadLocal(), source: "local" };
    }
    writeCache(__schema);
    return { __schema, source: "remote" };
  } catch {
    console.warn("[apiidx] ⚠ 网络受限，无法请求官方 GraphQL → 降级本地 @octokit/graphql-schema");
    return { __schema: loadLocal(), source: "local" };
  }
}
