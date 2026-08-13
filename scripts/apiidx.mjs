/**
 * API / 页面对照查询 CLI（v0.0.1 工具基建 · v2 重写）
 *
 * 定位：综合性的「远端 + 本地」常驻 debug 辅助工具——REST 端点精确搜索 + GraphQL schema
 * 递进枚举，**双端点「graph→rest 熔断对等」关系交由人主观判断**（不再用启发式自动配对强制提示）。
 *
 * 数据源：
 * - REST：`scripts/data/rest-index.json`（rest-index.mjs 生成，零下载转录 @octokit/openapi）
 * - GraphQL：实时直连官方 `https://api.github.com/graphql`（GITHUB_TOKEN 鉴权）做 introspection，
 *   失败/无 token 降级本地 `@octokit/graphql-schema`（见 gql-schema.mjs）
 * - 页面：`scripts/data/pages-index.json`（page-index.mjs 生成）
 *
 * 子命令：
 *   rest <关键词...>        REST 端点搜索（operationId/tags/path/summary/description）
 *   rest-id <operationId>   REST 端点详情（含参数）
 *   gql roots [scope]       枚举 GraphQL 根字段（query|mutation|all，默认 all）
 *   gql search <关键词>     搜索 GraphQL 根字段（名字/描述）
 *   gql type <TypeName>     递进：类型字段枚举（含参数/返回类型；▶ 标记 Connection）
 *   gql field <Type.field>  递进：字段详情（完整参数 + 返回类型）
 *   page <关键词>           页面分类搜索
 *   pageapi <关键词>        页面 → 关联 API 闭环
 *   stats                   索引统计（REST 操作 / GraphQL 类型 / 页面）
 *   update                  重跑 rest-index + page-index 刷新索引
 *
 * 用法：`node scripts/apiidx.mjs <子命令> <参数...>`
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadSchema, typeStr } from "./gql-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "scripts", "data");
const REST_INDEX = join(DATA, "rest-index.json");
const PAGES_INDEX = join(DATA, "pages-index.json");

/* ── 数据加载 ── */

function load(file, label) {
  if (!existsSync(file)) {
    console.error(
      `[apiidx] 缺少数据文件 ${file}（${label}），请先运行 node scripts/${label} 或 apiidx update`,
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/* ── 展示 ── */

/** 简单表格输出（对齐列宽） */
function table(rows) {
  if (!rows.length) return;
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] || "").length)));
  for (const r of rows) {
    console.log(
      r
        .map((cell, c) => (cell || "").padEnd(widths[c]))
        .join("  ")
        .trimEnd(),
    );
  }
}

/** 中文 2-gram 展开：连续中文片段按相邻两字滑窗切分 */
function expandChinese(text) {
  const out = [];
  const m = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of m) {
    if (seg.length === 1) out.push(seg);
    else for (let i = 0; i + 2 <= seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

/** 查询分词：英文单词 + 中文 2-gram */
function tokenizeQuery(q) {
  const tokens = [];
  for (const part of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (const g of expandChinese(part)) tokens.push({ token: g, chinese: true });
    } else {
      tokens.push({ token: part, chinese: false });
    }
  }
  return tokens;
}

/** 匹配打分：OR 语义 + 命中 token 数排序（英文精确子串 / 中文 2-gram 子串） */
function scoreHit(hay, tokens) {
  let hit = 0;
  for (const { token, chinese } of tokens) {
    if (chinese) {
      if (expandChinese(hay).some((g) => g === token) || hay.includes(token)) hit++;
    } else if (hay.includes(token)) {
      hit++;
    }
  }
  return hit;
}

/* ── REST 子命令 ── */

function cmdRest(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const q = args.join(" ");
  const tokens = tokenizeQuery(q);
  const scored = rest.items
    .map((it) => {
      const hay = [it.id, (it.tags || []).join(" "), it.path, it.summary, it.description]
        .join(" ")
        .toLowerCase();
      return { it, score: scoreHit(hay, tokens) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    console.log(`[apiidx] 未找到匹配「${q}」的 REST 端点`);
    return;
  }
  console.log(`[apiidx] rest「${q}」→ ${scored.length} 条`);
  table([
    ["id", "method path", "tags", "summary"],
    ...scored
      .slice(0, 40)
      .map(({ it }) => [
        it.id,
        `${it.method} ${it.path}`.slice(0, 46),
        (it.tags || []).join(",").slice(0, 16),
        it.summary.slice(0, 48),
      ]),
  ]);
  if (scored.length > 40) console.log(`… 共 ${scored.length} 条，用 rest-id <id> 看详情`);
}

function cmdRestId(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const id = args[0];
  const it = rest.items.find((x) => x.id === id);
  if (!it) {
    console.log(`[apiidx] 未找到 REST operationId: ${id}（可用 rest <关键词> 搜索）`);
    return;
  }
  console.log(`id         : ${it.id}`);
  console.log(`endpoint   : ${it.method} ${it.path}`);
  console.log(`tags       : ${(it.tags || []).join(", ") || "—"}`);
  console.log(`summary    : ${it.summary || "—"}`);
  console.log(`desc       : ${it.description || "—"}`);
  if (it.parameters?.length) {
    console.log(`parameters :`);
    for (const p of it.parameters) {
      const req = p.required ? "必填" : "可选";
      console.log(`  ${p.name} (${p.in}, ${req}, ${p.type}) ${p.desc ? "— " + p.desc : ""}`);
    }
  }
}

/* ── GraphQL 子命令 ── */

/** 根字段（query/mutation）分组枚举 */
async function cmdGql(args) {
  const sub = args[0];
  if (!sub) return gqlUsage();
  const { __schema, source } = await loadSchema();
  console.log(
    `[apiidx] GraphQL schema 来源：${source === "remote" ? "官方实时" : source === "cache" ? "缓存(10min)" : "本地 @octokit/graphql-schema"}`,
  );

  const types = new Map(__schema.types.map((t) => [t.name, t]));
  const queryName = __schema.queryType?.name;
  const mutationName = __schema.mutationType?.name;
  const rootOf = (name) =>
    name === queryName ? "query" : name === mutationName ? "mutation" : null;

  if (sub === "roots") {
    const scope = args[1] || "all";
    const groups = [];
    if (scope === "all" || scope === "query") {
      groups.push([`Query 根字段（${queryName}）`, types.get(queryName)]);
    }
    if (scope === "all" || scope === "mutation") {
      groups.push([`Mutation 根字段（${mutationName}）`, types.get(mutationName)]);
    }
    for (const [label, t] of groups) {
      if (!t) continue;
      console.log(`\n${label}：`);
      table(
        t.fields.map((f) => [
          f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
          typeStr(f.type),
          (f.description || "").split("\n")[0].slice(0, 56),
        ]),
      );
    }
    return;
  }

  if (sub === "search") {
    const q = args.slice(1).join(" ");
    const tokens = tokenizeQuery(q);
    const allFields = [];
    for (const name of [queryName, mutationName]) {
      const t = types.get(name);
      for (const f of t?.fields || []) allFields.push({ f, kind: rootOf(name) });
    }
    const scored = allFields
      .map(({ f, kind }) => {
        const hay = `${f.name} ${f.description || ""}`.toLowerCase();
        return { f, kind, score: scoreHit(hay, tokens) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      console.log(`[apiidx] 未找到匹配「${q}」的 GraphQL 根字段`);
      return;
    }
    console.log(`[apiidx] gql 根字段「${q}」→ ${scored.length} 条`);
    table([
      ["kind", "field", "type", "desc"],
      ...scored.map(({ f, kind }) => [
        kind,
        f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
        typeStr(f.type),
        (f.description || "").split("\n")[0].slice(0, 48),
      ]),
    ]);
    return;
  }

  if (sub === "type") {
    const name = args[1];
    const t = types.get(name) || types.get(name?.toLowerCase());
    if (!t) {
      // 模糊匹配类型名（大小写不敏感包含）
      const hits = __schema.types.filter((x) => x.name.toLowerCase().includes(name?.toLowerCase()));
      if (hits.length) {
        console.log(`[apiidx] 未精确匹配类型「${name}」，相近类型：`);
        console.log(
          hits
            .slice(0, 20)
            .map((x) => `  ${x.name} (${x.kind})`)
            .join("\n"),
        );
      } else {
        console.log(`[apiidx] 未找到 GraphQL 类型: ${name}`);
      }
      return;
    }
    const isConn = t.name.endsWith("Connection");
    console.log(
      `\n类型 ${t.name}（${t.kind}${isConn ? " · ▶Connection" : ""}）${
        t.description ? " — " + t.description.split("\n")[0] : ""
      }`,
    );
    if (t.kind === "ENUM") {
      console.log(`枚举值：${(t.enumValues || []).map((e) => e.name).join(", ")}`);
      return;
    }
    if (t.kind === "INPUT_OBJECT") {
      console.log(`输入字段：`);
      for (const f of t.inputFields || []) {
        console.log(
          `  ${f.name}: ${typeStr(f.type)}${f.description ? " — " + f.description.split("\n")[0] : ""}`,
        );
      }
      return;
    }
    if (t.kind === "SCALAR") return;
    if (!t.fields?.length) {
      console.log(`（无字段；可能为 union/interface，用 gql type 查看 possibleTypes）`);
      if (t.possibleTypes?.length) {
        console.log(`possibleTypes：${t.possibleTypes.map((p) => p.name).join(", ")}`);
      }
      return;
    }
    console.log(`字段（${t.fields.length} 个）：`);
    table(
      t.fields.map((f) => [
        f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
        typeStr(f.type),
        (f.description || "").split("\n")[0].slice(0, 56),
      ]),
    );
    return;
  }

  if (sub === "field") {
    const ref = args[1];
    const dot = ref?.indexOf(".");
    if (!ref || dot <= 0) {
      console.log(`[apiidx] 用法：apiidx gql field <Type.field>（如 Repository.refs）`);
      return;
    }
    const typeName = ref.slice(0, dot);
    const fieldName = ref.slice(dot + 1);
    const t = types.get(typeName) || types.get(typeName.toLowerCase());
    const f = t?.fields?.find((x) => x.name === fieldName);
    if (!f) {
      console.log(`[apiidx] 未找到字段 ${ref}（先 gql type ${typeName} 枚举确认字段名）`);
      return;
    }
    console.log(`字段      : ${typeName}.${fieldName}`);
    console.log(`返回类型  : ${typeStr(f.type)}`);
    if (f.description) console.log(`描述      : ${f.description.split("\n")[0]}`);
    if (f.isDeprecated) console.log(`废弃      : ${f.deprecationReason || "是"}`);
    if (f.args?.length) {
      console.log(`参数      :`);
      for (const a of f.args) {
        console.log(
          `  ${a.name}: ${typeStr(a.type)} ${a.description ? "— " + a.description.split("\n")[0] : ""}`,
        );
      }
    } else {
      console.log(`参数      : 无`);
    }
    return;
  }

  gqlUsage();
}

function gqlUsage() {
  console.log(`用法:
  node scripts/apiidx.mjs gql roots [query|mutation|all]  枚举根字段
  node scripts/apiidx.mjs gql search <关键词>             搜索根字段
  node scripts/apiidx.mjs gql type <TypeName>             递进：类型字段枚举
  node scripts/apiidx.mjs gql field <Type.field>          递进：字段详情`);
}

/* ── 页面子命令 ── */

function cmdPage(args) {
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const q = args.join(" ");
  const tokens = tokenizeQuery(q);
  const scored = pages.items
    .map((p) => {
      const hay = [
        p.route,
        p.id,
        (p.keywords || []).join(" "),
        p.module,
        p.framework,
        (p.apiIds || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return { p, score: scoreHit(hay, tokens) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    console.log(`[apiidx] 未找到匹配「${q}」的页面`);
    return;
  }
  console.log(`[apiidx] page「${q}」→ ${scored.length} 条`);
  table([
    ["route", "module", "status", "apiIds"],
    ...scored
      .slice(0, 30)
      .map(({ p }) => [
        p.route,
        p.module.slice(0, 40),
        p.status,
        (p.apiIds || []).join(",").slice(0, 56),
      ]),
  ]);
}

function cmdPageApi(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const q = args.join(" ").toLowerCase();
  const page = pages.items.find(
    (p) =>
      p.route.toLowerCase().includes(q) || (p.keywords || []).join(" ").toLowerCase().includes(q),
  );
  if (!page) {
    console.log(`[apiidx] 未找到匹配「${q}」的页面`);
    return;
  }
  console.log(`页面: ${page.route} — ${page.module}`);
  console.log(`框架: ${page.framework || "—"}`);
  console.log(`状态: ${page.status}`);
  console.log(`关联 API（${(page.apiIds || []).length} 个）:`);
  for (const id of page.apiIds || []) {
    if (id === "*") {
      console.log(`  *  （全部端点，通配）`);
      continue;
    }
    const it = rest.items.find((x) => x.id === id);
    if (it) {
      console.log(`  ${it.id}  ${it.method} ${it.path}`);
    } else {
      console.log(
        `  ${id}  （gql: 前缀为 GraphQL 根字段，用 gql field 查；其余可能已改名，用 rest <关键词> 复核）`,
      );
    }
  }
}

/* ── stats / update ── */

async function cmdStats() {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const { __schema, source } = await loadSchema();
  const types = new Map(__schema.types.map((t) => [t.name, t]));
  const queryName = __schema.queryType?.name;
  const mutationName = __schema.mutationType?.name;
  console.log(`API 索引（${rest.meta.generatedAt} · ${rest.meta.version}）`);
  console.log(`  REST 操作：${rest.meta.counts.operations}`);
  console.log(`GraphQL schema（来源：${source === "local" ? "本地" : "官方"}）`);
  console.log(
    `  类型 ${__schema.types.length} 个；Query 根字段 ${types.get(queryName)?.fields.length ?? 0}；Mutation 根字段 ${types.get(mutationName)?.fields.length ?? 0}`,
  );
  console.log(`页面分类索引（${pages.meta.generatedAt}）`);
  const c = pages.meta.counts;
  console.log(`  共 ${c.pages} 页：done ${c.done} / partial ${c.partial} / todo ${c.todo}`);
}

function cmdUpdate() {
  console.log("[apiidx] 重新生成索引（rest-index + page-index）…");
  execSync("node scripts/rest-index.mjs", { cwd: root, stdio: "inherit" });
  execSync("node scripts/page-index.mjs", { cwd: root, stdio: "inherit" });
}

function cmdUsage() {
  console.log(`用法:
  node scripts/apiidx.mjs rest <关键词...>        搜索 REST 端点
  node scripts/apiidx.mjs rest-id <operationId>   REST 端点详情（含参数）
  node scripts/apiidx.mjs gql roots [scope]       枚举 GraphQL 根字段（query|mutation|all）
  node scripts/apiidx.mjs gql search <关键词>     搜索 GraphQL 根字段
  node scripts/apiidx.mjs gql type <TypeName>     递进：类型字段枚举
  node scripts/apiidx.mjs gql field <Type.field>  递进：字段详情
  node scripts/apiidx.mjs page <关键词>           搜索页面分类
  node scripts/apiidx.mjs pageapi <关键词>        页面 → 关联 API 闭环
  node scripts/apiidx.mjs stats                   索引统计
  node scripts/apiidx.mjs update                  重跑生成器刷新索引`);
}

/* ── 入口 ── */

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "rest":
    cmdRest(args);
    break;
  case "rest-id":
    cmdRestId(args);
    break;
  case "gql":
    await cmdGql(args);
    break;
  case "page":
    cmdPage(args);
    break;
  case "pageapi":
    cmdPageApi(args);
    break;
  case "stats":
    await cmdStats();
    break;
  case "update":
    cmdUpdate();
    break;
  default:
    cmdUsage();
}
