/**
 * API 对照索引生成器（v0.0.1 工具基建）
 *
 * 从项目已安装的 octokit 包**零下载**转录两种 schema 并**聚拢为双端点对照**：
 * - REST：`@octokit/openapi` deref → 每条操作 { operationId, tags, summary/desc, method, path }
 * - GraphQL：`@octokit/graphql-schema` → Query(30) + Mutation(242) 根字段 { name, desc, args, type }
 *
 * 聚拢（converge）：
 * - **人工校正表优先**（`scripts/data/api-curations.json`，git 跟踪）——确定语义配对（如 repos/get ↔ repository）
 * - 启发式兜底：operationId 分词（camelCase/kebab/slash 切分 + 去停用词）与 GraphQL 字段名的
 *   Jaccard 相似度 ≥ 0.5 且至少 1 个词重叠 → 自动配对（converge=auto，供人工复核）
 * - 未配对的各自保留为 rest-only / graphql-only
 *
 * 产出 `scripts/data/api-index.json`：`{ meta, items[] }`，每条含
 * `id / tags(分类) / keywords(关键词) / desc(功能描述) / rest(方法+端口) / graphql(字段语法) / converge(聚拢状态)`。
 * **用途**：辅助 smart 冗余熔断——同一功能双端点（graphql+rest 都在）= smart 包装候选；
 * 新增 API / 新页面接入前用 `scripts/apiidx.mjs` 查询本索引。
 *
 * 用法：`node scripts/api-index.mjs`（转录已安装 SDK；SDK 升级后重跑即可刷新）
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const DATA_DIR = join(root, "scripts", "data");
const OUT_FILE = join(DATA_DIR, "api-index.json");
const CURATIONS_FILE = join(DATA_DIR, "api-curations.json");

/* ── 分词与相似度 ── */

/** 单词停用词（通用动词/介词/冠词——保留以参与匹配，但打分时不作核心语义词） */
const STOPWORDS = new Set([
  "get",
  "list",
  "for",
  "the",
  "a",
  "an",
  "in",
  "of",
  "to",
  "and",
  "or",
  "on",
  "by",
  "with",
  "using",
  "authenticated",
  "current",
  "your",
  "my",
  "all",
  "one",
  "two",
  "its",
  "this",
  "that",
  "is",
  "are",
  "was",
  "be",
  "as",
  "at",
  "from",
  "has",
  "have",
  "not",
  "no",
  "can",
  "may",
  "will",
  "would",
  "should",
  "do",
  "does",
  "did",
  "etc",
  "what",
  "when",
  "where",
  "how",
  "about",
  "into",
  "over",
  "under",
  "more",
  "most",
  "such",
  "than",
  "then",
  "so",
  "also",
  "per",
]);

/** 词干归一：复数 → 单数 + 常见同义词收敛（repos/repository → repo 等） */
function canon(word) {
  const w = word.toLowerCase();
  const map = {
    repos: "repo",
    repositories: "repo",
    repository: "repo",
    orgs: "org",
    organizations: "organization",
    pulls: "pull",
    prs: "pr",
    pullrequest: "pull",
    pullrequests: "pull",
    issues: "issue",
    followers: "follower",
    following: "follower",
    starred: "star",
    stars: "star",
    topics: "topic",
    labels: "label",
    branches: "branch",
    releases: "release",
    commits: "commit",
    members: "member",
    teams: "team",
    keys: "key",
    emails: "email",
    notifications: "notification",
    gists: "gist",
    comments: "comment",
    reviews: "review",
    webhooks: "webhook",
    packages: "package",
  };
  if (map[w]) return map[w];
  // 简单复数规则：词长 > 3 且以 s 结尾 → 去 s
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** 标识符 → 规范词集（camelCase / kebab / slash / 下划线切分，去停用词） */
function tokensOf(identifier) {
  const raw = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (const w of raw) {
    const c = canon(w);
    if (!STOPWORDS.has(c)) set.add(c);
  }
  return set;
}

/** Jaccard 相似度 */
function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/* ── REST 转录 ── */

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
        desc: op.summary || op.description || "",
        method: m.toUpperCase(),
        path,
      });
    }
  }
  const version = require("../node_modules/@octokit/openapi/package.json").version;
  return { ops, version: `openapi@${version}` };
}

/* ── GraphQL 转录 ── */

/** 类型引用 → 可读字符串（含 NON_NULL/LIST 嵌套） */
function typeStr(t, depth = 0) {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return `${typeStr(t.ofType, depth + 1)}!`;
  if (t.kind === "LIST") return `[${typeStr(t.ofType, depth + 1)}]`;
  return t.name || "?";
}

function transcribeGql() {
  const mod = require("../node_modules/@octokit/graphql-schema/index.js");
  const schema = mod.schema.json["__schema"];
  const roots = { query: schema.queryType.name, mutation: schema.mutationType.name };
  const fields = [];
  for (const [kind, rootName] of Object.entries(roots)) {
    const rootType = schema.types.find((t) => t.name === rootName);
    for (const f of rootType?.fields || []) {
      const requiredArgs = (f.args || []).filter((a) => a.type?.kind === "NON_NULL");
      const allArgs = f.args || [];
      const argsDesc = allArgs
        .map((a) => `${a.name}: ${typeStr(a.type)}${a.description ? ` // ${a.description}` : ""}`)
        .join("\n        ");
      fields.push({
        name: f.name,
        kind,
        desc: f.description || "",
        args: allArgs.map((a) => ({ name: a.name, type: typeStr(a.type) })),
        requiredArgs: requiredArgs.map((a) => ({ name: a.name, type: typeStr(a.type) })),
        syntax: `${f.name}(${requiredArgs.map((a) => `${a.name}: ${typeStr(a.type)}`).join(", ")}${allArgs.length > requiredArgs.length ? ", …" : ""})`,
        argsDesc,
      });
    }
  }
  const version = require("../node_modules/@octokit/graphql-schema/package.json").version;
  return { fields, version: `graphql-schema@${version}` };
}

/* ── 聚拢 ── */

/** GraphQL 字段按规范词集索引（供启发式匹配） */
function indexGqlFields(fields) {
  return fields.map((f) => ({ ...f, tokens: tokensOf(f.name) }));
}

/** 人工校正表加载（git 跟踪；rest→graphql 语义配对，graphql 可含点路径如 viewer.repositories 或参数语法如 search(REPOSITORY)） */
function loadCurations() {
  try {
    return JSON.parse(readFileSync(CURATIONS_FILE, "utf8")).pairs || [];
  } catch {
    return [];
  }
}

/** 解析校正表 graphql 语法 → { rootField, fullPath }（支持 search(REPOSITORY) / viewer.repositories 两种形态） */
function parseGqlRef(ref) {
  const m = ref.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
  if (m) return { rootField: m[1], fullPath: ref, hasArgs: true };
  return { rootField: ref.split(".")[0], fullPath: ref, hasArgs: false };
}

function buildIndex() {
  const rest = transcribeRest();
  const gql = transcribeGql();
  const gqlFields = indexGqlFields(gql.fields);
  const byName = new Map(gqlFields.map((f) => [f.name, f]));
  const curations = loadCurations();

  const items = [];
  const usedRest = new Set();
  const usedGql = new Set();

  // 1) 人工校正表：确定配对（converge=curated），graphql 字段可带点路径（根字段 + 子路径）或参数语法
  for (const c of curations) {
    const restOp = rest.ops.find((o) => o.id === c.rest);
    if (!restOp) continue;
    const { rootField, fullPath, hasArgs } = parseGqlRef(c.graphql);
    const g = byName.get(rootField);
    if (!g) continue;
    usedRest.add(c.rest);
    usedGql.add(fullPath);
    items.push({
      id: c.rest,
      tags: restOp.tags,
      keywords: keywordsOf(restOp, g),
      desc: restOp.desc,
      rest: { method: restOp.method, path: restOp.path },
      graphql: {
        field: fullPath,
        kind: g.kind,
        syntax: hasArgs
          ? fullPath
          : fullPath.includes(".")
            ? `${fullPath}${argsSuffix(g)}`
            : g.syntax,
        rootArgs: g.args,
      },
      converge: "curated",
      note: c.note || "",
    });
  }

  // 2) 启发式：REST 未配对 → 找 Jaccard ≥ 0.5 且 ≥1 词重叠的最佳 GraphQL 字段（converge=auto）
  for (const op of rest.ops) {
    if (usedRest.has(op.id)) continue;
    const opTokens = tokensOf(`${op.id} ${op.path}`);
    let best = null;
    let bestScore = 0;
    for (const g of gqlFields) {
      if (usedGql.has(g.name)) continue;
      const score = jaccard(opTokens, g.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best && bestScore >= 0.5 && [...opTokens].some((t) => best.tokens.has(t))) {
      usedGql.add(best.name);
      items.push({
        id: op.id,
        tags: op.tags,
        keywords: keywordsOf(op, best),
        desc: op.desc,
        rest: { method: op.method, path: op.path },
        graphql: { field: best.name, kind: best.kind, syntax: best.syntax, rootArgs: best.args },
        converge: "auto",
      });
    } else {
      items.push({
        id: op.id,
        tags: op.tags,
        keywords: keywordsOf(op, null),
        desc: op.desc,
        rest: { method: op.method, path: op.path },
        graphql: null,
        converge: null,
      });
    }
  }

  // 3) GraphQL 未配对字段 → graphql-only（id 前缀 gql:）
  for (const g of gqlFields) {
    if (usedGql.has(g.name)) continue;
    items.push({
      id: `gql:${g.name}`,
      tags: [g.kind === "query" ? "graphql-query" : "graphql-mutation"],
      keywords: keywordsOf(null, g),
      desc: g.desc,
      rest: null,
      graphql: { field: g.name, kind: g.kind, syntax: g.syntax, rootArgs: g.args },
      converge: null,
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));

  const counts = {
    rest: rest.ops.length,
    graphql: gql.fields.length,
    items: items.length,
    converged: items.filter((i) => i.converge).length,
    curated: items.filter((i) => i.converge === "curated").length,
    auto: items.filter((i) => i.converge === "auto").length,
    dual: items.filter((i) => i.rest && i.graphql).length,
  };

  return {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      restVersion: rest.version,
      graphqlVersion: gql.version,
      counts,
    },
    items,
  };
}

/** GraphQL 根字段带点路径时的参数后缀（如 viewer.repositories 的根 viewer 无必填参数） */
function argsSuffix(g) {
  return g.requiredArgs.length
    ? `(${g.requiredArgs.map((a) => `${a.name}: ${a.type}`).join(", ")})`
    : "";
}

/** 关键词：REST tags + 两端标识符分词 + 描述高频词（去停用词，≤10 个） */
function keywordsOf(restOp, gqlField) {
  const set = new Set();
  if (restOp) {
    for (const t of restOp.tags) {
      for (const w of tokensOf(t)) set.add(w);
    }
    for (const w of tokensOf(restOp.id)) set.add(w);
    // 描述中的有意义词（≤4 个）
    const descWords = restOp.desc
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^https?/.test(w))
      .slice(0, 4);
    for (const w of descWords) set.add(w);
  }
  if (gqlField) {
    for (const w of tokensOf(gqlField.name)) set.add(w);
  }
  return [...set].slice(0, 10);
}

/* ── 输出 ── */

const index = buildIndex();
writeFileSync(OUT_FILE, JSON.stringify(index, null, 2));
const c = index.meta.counts;
console.log(
  `[api-index] REST ${c.rest} 操作 × GraphQL ${c.graphql} 字段 → 聚拢 ${c.items} 条 ` +
    `（双端点 ${c.dual}：人工校正 ${c.curated} + 启发式 ${c.auto}）→ ${OUT_FILE}`,
);
