/**
 * 官方页面分类索引生成器（v0.0.1 工具基建）
 *
 * 两步合成：
 * 1. **自动提取**：解析 `web/src/App.tsx` 路由树（createBrowserRouter）→ 每个路由的
 *    绝对路径、组件名（element 中的页面组件）、嵌套层级（子路由拼接父路径）
 * 2. **人工校正合并**：`scripts/data/page-curations.json`（git 跟踪）补充语义字段——
 *    keywords 关键词 / module 页面·模块·组件 / framework 框架及关联描述 / apiIds 关联接口 / status 状态
 *
 * 交叉校验：apiIds 逐一对照 `scripts/data/rest-index.json`（REST operationId）与本地
 * `@octokit/graphql-schema` 根字段（gql: 前缀），不存在的 id 输出警告（防手误/防接口已改名）。
 *
 * 产出 `scripts/data/pages-index.json`：`{ meta, items[] }`，每条含
 * `id / route / keywords / module / framework / apiIds / components / status / auto(是否自动提取) / covered(是否有校正)`。
 * **用途**：新增页面/新功能前用 `scripts/apiidx.mjs page <关键词>` 查页面 → 关联接口 → 再递进查双端点。
 *
 * 用法：`node scripts/page-index.mjs`（App.tsx 路由变更或校正表更新后重跑）
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(root, "scripts", "data");
const APP_TSX = join(root, "web", "src", "App.tsx");
const CURATIONS_FILE = join(DATA_DIR, "page-curations.json");
const OUT_FILE = join(DATA_DIR, "pages-index.json");
const REST_INDEX_FILE = join(DATA_DIR, "rest-index.json");

/* ── 1) App.tsx 路由树解析 ── */

/** 相对路径拼接父绝对路径（子路由 path 不以 / 开头 → 拼父；含 ../ 前缀处理） */
function resolvePath(parentAbs, childPath) {
  if (childPath.startsWith("/")) return childPath;
  if (childPath === "." || childPath === "..") return parentAbs;
  const base = parentAbs.endsWith("/") ? parentAbs.slice(0, -1) : parentAbs;
  if (childPath.startsWith("../")) {
    const up = childPath.split("/").filter((s) => s === "..").length;
    const parts = base.split("/").filter(Boolean);
    parts.splice(parts.length - up, up);
    return "/" + parts.join("/");
  }
  return `${base}/${childPath}`;
}

/** 从 element 行提取页面组件名（大写开头的 JSX 组件，含 <X /> 与 <X><Y /></X> 包裹形态） */
function extractComponents(line) {
  const comps = [];
  const re = /<([A-Z][A-Za-z0-9]*)\b/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (!comps.includes(m[1])) comps.push(m[1]);
  }
  return comps;
}

/** 解析整个路由区 → 绝对路径列表（含组件名）
 *  算法：字符级大括号栈——每行先压入 open 个 null 占位，path 出现时把栈顶 null 命名为该路由的
 *  abs（父 = 栈中向下第一个已命名路由）；行末弹出 close 个。正确处理「{ 独立成行」「单行对象」
 *  「多行父对象 + children」三种形态。 */
function parseRoutes(src) {
  const start = src.indexOf("createBrowserRouter([");
  const end = src.indexOf("]);", start);
  const body = src.slice(start, end);
  const routes = [];
  const stack = []; // 对象路径栈：null=未命名（刚压入的 {），字符串=已命名路由 abs
  for (const line of body.split("\n")) {
    const open = (line.match(/\{/g) || []).length;
    const close = (line.match(/\}/g) || []).length;
    for (let i = 0; i < open; i++) stack.push(null);
    const pm = line.match(/\bpath:\s*"([^"]+)"/);
    if (pm) {
      // 父 = 栈中向下第一个已命名路由
      let parentAbs = "";
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] !== null) {
          parentAbs = stack[i];
          break;
        }
      }
      const abs = resolvePath(parentAbs || "/", pm[1]);
      // 栈顶 null（本行/上一行 { 打开的对象）→ 命名为本路由
      if (stack.length && stack[stack.length - 1] === null) stack[stack.length - 1] = abs;
      let comps = extractComponents(line);
      if (!comps.length) comps = extractComponents(linesAfter(body, line));
      routes.push({ path: pm[1], abs, components: comps });
    } else if (line.includes("index: true")) {
      let parentAbs = "";
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] !== null) {
          parentAbs = stack[i];
          break;
        }
      }
      routes.push({ path: "(index)", abs: parentAbs || "/", components: [] });
    }
    for (let i = 0; i < close; i++) stack.pop();
  }
  return routes;
}

/** path 行之后紧邻的 element 块文本（父路由常见：path 独占一行、element 在下一行；跨行 JSX 包裹取至 `),` 或 `},` 闭合） */
function linesAfter(body, line) {
  const lines = body.split("\n");
  const idx = lines.indexOf(line);
  if (idx < 0 || idx + 1 >= lines.length) return "";
  const chunk = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    chunk.push(l);
    // element 块结束：单行 `element: <X />` 后直接 `},`；跨行 `element: (` 后遇到 `),`
    if (l.includes("element:") && !l.includes("(") && /,\s*$/.test(l)) break;
    if (l.trim().startsWith("),")) break;
    if (/^\s*},\s*$/.test(l)) break;
  }
  return chunk.join("\n");
}

/** 路由模式匹配：pattern 与 actual 按 / 分段；pattern 中 `*` 匹配任意剩余段、`:param` 匹配任意真实段
 *  （允许 actual 参数占位符 :xxx，但排除 `$` 系统前缀——防 /:owner/:repo 误吞 /$debug/:proto） */
function routeMatches(pattern, actual) {
  const p = pattern.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  let i = 0;
  for (let j = 0; j < p.length; j++) {
    const seg = p[j];
    if (seg === "*") return true; // 通配剩余全部
    if (i >= a.length) return false;
    if (seg.startsWith(":")) {
      if (a[i].startsWith("$")) return false;
      i++;
      continue;
    }
    if (seg !== a[i]) return false;
    i++;
  }
  // pattern 耗尽后：actual 仅剩尾部 * 段（splat）视为匹配
  while (i < a.length) {
    if (a[i] !== "*") return false;
    i++;
  }
  return true;
}

/** 校正条目具体度（字面段数优先，其次总段数）——find 时具体条目先匹配，防 /:owner/:repo 抢 /gist/:id 等 */
function curationSpecificity(c) {
  const segs = c.route.split("/").filter(Boolean);
  return segs.filter((s) => !s.startsWith(":") && s !== "*").length * 100 + segs.length;
}

/** 绝对路径 → 可读 id（去参数/通配，斜杠转连字符） */
function idOf(abs) {
  let id = abs
    .replace(/\/\*/g, "")
    .replace(/:[^/]+/g, "*")
    .replace(/[/]+/g, "-")
    .replace(/^-/, "")
    .replace(/-+$/, "");
  if (!id) id = "root";
  // 特殊字符（$ / 星号）清理
  id = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return id || "root";
}

/* ── 2) 合并人工校正 + 交叉校验 ── */

function loadJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

/** 本地 GraphQL schema 根字段名集合（零下载，供 apiIds 的 gql: 前缀校验；仅对照根字段，不深入类型树） */
function localGqlRootNames() {
  const { schema } = require("../node_modules/@octokit/graphql-schema/index.js");
  const __schema = schema.json.__schema;
  const names = new Set();
  for (const name of [__schema.queryType?.name, __schema.mutationType?.name]) {
    const t = __schema.types.find((x) => x.name === name);
    for (const f of t?.fields || []) names.add(f.name);
  }
  return names;
}

function buildPages() {
  const src = readFileSync(APP_TSX, "utf8");
  const routes = parseRoutes(src);
  const curations = loadJson(CURATIONS_FILE, { pages: [] }).pages || [];
  const restIndex = loadJson(REST_INDEX_FILE, { items: [] }).items || [];
  const restIds = new Set(restIndex.map((i) => i.id));
  const gqlRoots = localGqlRootNames();
  const isValidApiId = (a) => (a.startsWith("gql:") ? gqlRoots.has(a.slice(4)) : restIds.has(a));

  // 校正表 → 按 route 索引（route 支持 * 前缀通配）
  const curByRoute = new Map();
  for (const c of curations) {
    if (!curByRoute.has(c.route)) curByRoute.set(c.route, c);
  }

  const items = [];
  const seen = new Set();
  let autoOnly = 0;

  for (const r of routes) {
    // 跳过纯重定向/内部跳转（Navigate 无组件）
    if (!r.components.length) continue;
    // 合并校正（精确匹配 → 具体度降序通配匹配；防 :param 泛匹配抢具体条目）
    let cur = curByRoute.get(r.abs);
    if (!cur) {
      const candidates = [...curations]
        .filter((c) => routeMatches(c.route, r.abs))
        .sort((a, b) => curationSpecificity(b) - curationSpecificity(a));
      cur = candidates[0];
    }
    if (cur) curByRoute.delete(cur.route);
    const id = idOf(r.abs);
    const dedupe = `${id}|${r.abs}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    // 交叉校验 apiIds（* 通配引用跳过）
    const bad = (cur?.apiIds || []).filter((a) => !a.includes("*") && !isValidApiId(a));
    if (bad.length) {
      console.warn(
        `[page-index] ⚠ ${cur.route} 引用了 rest-index/gql 根字段中不存在的 id: ${bad.join(", ")}`,
      );
    }

    items.push({
      id,
      route: r.abs,
      keywords: cur?.keywords || [],
      module: cur?.module || r.components.join(" + ") + "（未校正，待补语义）",
      framework: cur?.framework || "",
      apiIds: cur?.apiIds || [],
      components: r.components,
      status: cur?.status || "todo",
      covered: !!cur,
    });
    if (!cur) autoOnly++;
  }

  // 校正表中存在但 App.tsx 未匹配到的路由（提示可能已删除/改名）
  for (const route of curByRoute.keys()) {
    console.warn(`[page-index] ⚠ 校正表路由未在 App.tsx 找到（可能已删除/改名）: ${route}`);
  }

  items.sort((a, b) => a.route.localeCompare(b.route));

  return {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      counts: {
        pages: items.length,
        covered: items.filter((i) => i.covered).length,
        autoOnly,
        todo: items.filter((i) => i.status === "todo").length,
        done: items.filter((i) => i.status === "done").length,
        partial: items.filter((i) => i.status === "partial").length,
      },
    },
    items,
  };
}

const pages = buildPages();
writeFileSync(OUT_FILE, JSON.stringify(pages, null, 2));
const c = pages.meta.counts;
console.log(
  `[page-index] 提取 ${c.pages} 页（校正 ${c.covered} / 自动 ${c.autoOnly}）` +
    `：done ${c.done} / partial ${c.partial} / todo ${c.todo} → ${OUT_FILE}`,
);
