/**
 * API / 页面对照索引查询 CLI（v0.0.1 工具基建）
 *
 * 查询 `scripts/data/api-index.json`（API 对照：REST↔GraphQL 聚拢）与
 * `scripts/data/pages-index.json`（官方页面分类）——**新增 API / 新页面动手前先查索引**：
 *
 * 用法（子命令）：
 *   node scripts/apiidx.mjs search <关键词...>   按关键词/描述/端口搜索 API（多词 AND）
 *   node scripts/apiidx.mjs api <id>             查看单个 API 详情（REST operationId 或 gql: 前缀）
 *   node scripts/apiidx.mjs page <关键词...>     搜索页面分类（路由/模块/关键词）
 *   node scripts/apiidx.mjs pageapi <关键词>     页面 → 关联 API 闭环查询（从页面找接口）
 *   node scripts/apiidx.mjs dual [关键词]        列出全部/过滤双端点（smart 冗余熔断候选）
 *   node scripts/apiidx.mjs stats                索引统计
 *   node scripts/apiidx.mjs update               重跑两个生成器刷新索引（api-index + page-index）
 *
 * 输出：终端表格（无第三方依赖，Node 内置）。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "scripts", "data");

const API_INDEX = join(DATA, "api-index.json");
const PAGES_INDEX = join(DATA, "pages-index.json");

/* ── 数据加载 ── */

function load(file) {
  if (!existsSync(file)) {
    console.error(
      `[apiidx] 缺少数据文件 ${file}，请先运行 node scripts/api-index.mjs / page-index.mjs`,
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

/** 中文 2-gram 展开：连续中文片段按相邻两字滑窗切分（"仓库首页" → 仓库,库首,首页） */
function expandChinese(text) {
  const out = [];
  const m = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of m) {
    if (seg.length === 1) out.push(seg);
    else for (let i = 0; i + 2 <= seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

/** 查询分词：英文单词 + 中文 2-gram；返回 { token, chinese } 列表 */
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

/** API 条目一行展示 */
function apiRow(it) {
  const rest = it.rest ? `${it.rest.method} ${it.rest.path}` : "—";
  const gql = it.graphql ? it.graphql.field : "—";
  const dual = it.converge ? "🔀" : "  ";
  return [
    it.id,
    it.tags.join(","),
    rest.slice(0, 42),
    gql.slice(0, 34),
    dual,
    it.desc.slice(0, 44),
  ];
}

/* ── 子命令 ── */

function cmdSearch(api, args) {
  const q = args.join(" ");
  const tokens = tokenizeQuery(q);
  const scored = api.items
    .map((it) => {
      const hay = [
        it.id,
        (it.tags || []).join(" "),
        (it.keywords || []).join(" "),
        it.desc,
        it.rest ? it.rest.method + " " + it.rest.path : "",
        it.graphql ? it.graphql.field + " " + it.graphql.syntax : "",
      ]
        .join(" ")
        .toLowerCase();
      return { it, score: scoreHit(hay, tokens) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    console.log(`[apiidx] 未找到匹配「${q}」的 API`);
    return;
  }
  console.log(`[apiidx] search「${q}」→ ${scored.length} 条（🔀=双端点 smart 候选）`);
  table([
    ["id", "tags", "rest", "graphql", "", "desc"],
    ...scored.slice(0, 30).map((x) => apiRow(x.it)),
  ]);
  if (scored.length > 30) console.log(`… 共 ${scored.length} 条，用 api <id> 看详情`);
}

function cmdApi(api, args) {
  const id = args[0];
  if (!id) return cmdUsage();
  const it = api.items.find((x) => x.id === id);
  if (!it) {
    console.log(`[apiidx] 未找到 API id: ${id}`);
    return;
  }
  console.log(`id        : ${it.id}`);
  console.log(`tags      : ${(it.tags || []).join(", ") || "—"}`);
  console.log(`keywords  : ${(it.keywords || []).join(", ") || "—"}`);
  console.log(`desc      : ${it.desc || "—"}`);
  if (it.rest) console.log(`rest      : ${it.rest.method} ${it.rest.path}`);
  else console.log(`rest      : —（无 REST 端点）`);
  if (it.graphql) {
    console.log(`graphql   : ${it.graphql.field} (${it.graphql.kind})`);
    console.log(`  syntax  : ${it.graphql.syntax || "—"}`);
    if (it.graphql.rootArgs?.length) {
      console.log(
        `  args    : ${it.graphql.rootArgs.map((a) => `${a.name}: ${a.type}`).join(", ")}`,
      );
    }
  } else {
    console.log(`graphql   : —（无 GraphQL 端点）`);
  }
  console.log(
    `converge  : ${it.converge || "无"}${it.note ? "（" + it.note + "）" : ""}${it.converge === "curated" ? "【人工校正，双端点=smart 候选】" : it.converge === "auto" ? "【启发式配对，建议人工复核】" : it.rest && it.graphql ? "" : it.graphql ? "【GraphQL-only】" : "【REST-only】"}`,
  );
}

function cmdPage(pages, args) {
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
        (p.components || []).join(" "),
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
        (p.apiIds || []).join(",").slice(0, 60),
      ]),
  ]);
  if (scored.length > 30) console.log(`… 共 ${scored.length} 条`);
}

function cmdPageApi(api, pages, args) {
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
    const it = api.items.find((x) => x.id === id);
    if (!it) {
      console.log(`  ${id}  （索引中不存在！）`);
      continue;
    }
    console.log(
      `  ${it.id}${it.converge === "curated" ? " 🔀" : ""}  ${it.rest ? it.rest.method + " " + it.rest.path : ""}${it.graphql ? "  |  " + it.graphql.field : ""}`,
    );
  }
}

function cmdDual(api, args) {
  const q = args.join(" ").toLowerCase();
  let hits = api.items.filter((it) => it.rest && it.graphql && it.converge);
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    hits = hits.filter((it) => {
      const hay = (it.id + " " + it.desc + " " + (it.tags || []).join(" ")).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }
  console.log(
    `[apiidx] 双端点（smart 冗余熔断候选）${q ? "匹配「" + q + "」" : ""}：${hits.length} 条`,
  );
  table([
    ["id", "rest", "graphql", "converge"],
    ...hits
      .slice(0, 40)
      .map((it) => [
        it.id,
        `${it.rest.method} ${it.rest.path}`.slice(0, 40),
        it.graphql.field.slice(0, 30),
        it.converge,
      ]),
  ]);
  if (hits.length > 40) console.log(`… 共 ${hits.length} 条`);
}

function cmdStats(api, pages) {
  const c = api.meta.counts;
  const p = pages.meta.counts;
  console.log(`API 对照索引（${api.meta.generatedAt}）`);
  console.log(
    `  REST ${c.rest} 操作（${api.meta.restVersion}）× GraphQL ${c.graphql} 字段（${api.meta.graphqlVersion}）`,
  );
  console.log(`  聚拢 ${c.items} 条：双端点 ${c.dual}（人工校正 ${c.curated} + 启发式 ${c.auto}）`);
  console.log(
    `  单端点：REST-only ${c.items - c.dual - (c.graphql - c.dual)} / GraphQL-only ${c.graphql - c.dual}`,
  );
  console.log(`页面分类索引（${pages.meta.generatedAt}）`);
  console.log(
    `  共 ${p.pages} 页：done ${p.done} / partial ${p.partial} / todo ${p.todo}（校正 ${p.covered} / 自动 ${p.autoOnly}）`,
  );
}

function cmdUpdate() {
  console.log("[apiidx] 重新生成索引（api-index + page-index）…");
  execSync("node scripts/api-index.mjs", { cwd: root, stdio: "inherit" });
  execSync("node scripts/page-index.mjs", { cwd: root, stdio: "inherit" });
}

function cmdUsage() {
  console.log(`用法:
  node scripts/apiidx.mjs search <关键词...>    按关键词/描述/端口搜索 API
  node scripts/apiidx.mjs api <id>              查看单个 API 详情（operationId 或 gql: 前缀）
  node scripts/apiidx.mjs page <关键词...>       搜索页面分类（路由/模块/关键词）
  node scripts/apiidx.mjs pageapi <关键词>       页面 → 关联 API 闭环查询
  node scripts/apiidx.mjs dual [关键词]          列出双端点（smart 冗余熔断候选）
  node scripts/apiidx.mjs stats                 索引统计
  node scripts/apiidx.mjs update                重跑两个生成器刷新索引`);
}

/* ── 入口 ── */

const [cmd, ...args] = process.argv.slice(2);
const api = load(API_INDEX);
const pages = load(PAGES_INDEX);

switch (cmd) {
  case "search":
    cmdSearch(api, args);
    break;
  case "api":
    cmdApi(api, args);
    break;
  case "page":
    cmdPage(pages, args);
    break;
  case "pageapi":
    cmdPageApi(api, pages, args);
    break;
  case "dual":
    cmdDual(api, args);
    break;
  case "stats":
    cmdStats(api, pages);
    break;
  case "update":
    cmdUpdate();
    break;
  default:
    cmdUsage();
}
