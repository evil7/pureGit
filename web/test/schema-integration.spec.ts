/**
 * ============================================================================
 * 全量真实产物集成测试 —— Debug 页参数提取 / 填充 / 匹配质量门（最终防线）
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * 读取 web/public/debug/rest/ 全部转录产物（44 tag × req.json），遍历**每一个端点**
 * 验证全部需求规则——这是整个调试面板参数体系的**终极质量门**：任何改动
 * （解析 / 填充 / 匹配 / 排序 / 产物结构）都必须通过本测试。单元测试只能证明
 * 逻辑正确，本测试证明「对真实 GitHub API 全量端点也正确」。
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * 每个端点（1108 个）都执行以下 7 条断言：
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ # │ 期望行为（业务基线）                        │ 断言实现                    │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 1 │ path 参数 ↔ 模板占位双向一致：               │ op.params in:path 每个 name  │
 * │   │ 文档声明的每个 in:path 必须在模板有 {name}   │ → 模板必须有 {name}；        │
 * │   │ （否则 index 提取必然失败）；模板每个 {name}  │ 模板每个 {name} → 文档必须有 │
 * │   │ 文档必须有 in:path 同名（否则表格缺锁定行）   │ 同名 in:path                │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 2 │ endpointToRequest 提取正确：                │ r.url==模板；method 大写；   │
 * │   │ path 行 index == 模板 split('/') 位置；      │ path 行 index 断言；query 行 │
 * │   │ query 行数 == 文档 query 数（皆 explicit=    │ 数断言 + explicit=false     │
 * │   │ false 空值）；URL == 模板                    │                            │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 3 │ matchEndpoint round-trip：模板 URL 匹配自身  │ matchEndpoint(method, 模板, │
 * │   │ （静态段相等必然自身，杜绝跨端点误匹配）       │ 全量端点) 命中 path+method  │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 4 │ matchEndpoint 填值 round-trip：填实际值的    │ fillUrl(模板)（占位→demo/v1）│
 * │   │ URL 仍命中自身（用户真实输入场景；历史 bug：  │ 命中 path+method；          │
 * │   │ compare 复合占位被同分 {basehead} 抢）        │ 本断言逮住评分制缺陷         │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 5 │ endpointStillMatches 固化：模板占位填实际值  │ fillUrl(模板) → 判定 true    │
 * │   │ → true（微编辑不触发重新匹配）               │                            │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 6 │ buildUrlFromParams 正向不改 URL：            │ endpointToRequest 产物       │
 * │   │ 空值产物重建 URL == 模板（正向闭环稳定）      │ buildUrlFromParams == 模板   │
 * ├───┼────────────────────────────────────────────┼────────────────────────────┤
 * │ 7 │ syncParamsFromUrl 反向骨架稳定：            │ path 行集合 == 模板占位集；   │
 * │   │ path 行对齐模板、query 行对齐文档全集         │ query 行集合 == 文档 query 集│
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 【历史 bug 回归（本文件直接逮住的真实生产 bug，勿删/勿弱化对应用例）】
 * - compare 复合占位 `{base}...{head}`：index 提取失败（-1）/ matchEndpoint 误命
 *   {basehead} / buildUrlFromParams 整体覆盖互毁 —— 由本文件 1/2/3/6 号断言同时发现
 * - 根路径 `GET /`（meta tag）：matchEndpoint 原空段守卫永不匹配 —— 由 3 号断言发现
 * - 填值 URL 命中他端点：真实产物 `{basehead}` 排序在 `{base}...{head}` 前，评分制同分
 *   取首个 → 填值 round-trip 错命 —— 由 4 号断言发现（新增，评分制字面结构分修复）
 *
 * 【修改本文件的注意事项】
 * 1. **本文件是全项目最重要的质量门**：任何削弱断言（放宽 round-trip/改 fillUrl 为
 *    模板自身/减少端点遍历）都等于放弃对全部 1108 个真实端点的正确性保证
 * 2. fillUrl 占位替换必须覆盖模板全部占位（否则断言 4 永远过不了真实值）
 * 3. 新增需求 → 先在此文件加断言 → 再改业务代码（TDD）
 * 4. 单元级规则在 debug-params.spec.ts / debug-openapi.spec.ts（本文件是它们的全量投影）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OpenApiEndpoint, RestReqFile } from "@/lib/debug-openapi";
import { endpointToRequest, matchEndpoint, endpointStillMatches } from "@/lib/debug-openapi";
import { buildUrlFromParams, syncParamsFromUrl, type DocParams } from "@/lib/debug-params";

const REST_DIR = fileURLToPath(new URL("../public/debug/rest/", import.meta.url));

/** 读取产物文件（缺省返回 null） */
function loadJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(`${REST_DIR}${name}`, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 遍历全部 tag 构建全量端点索引（与 schema-loader.getAllEndpoints 同源同构） */
function loadAllEndpoints(): { endpoints: OpenApiEndpoint[]; tags: string[] } {
  const files = readdirSync(REST_DIR).filter((f) => f.endsWith(".req.json"));
  const tags = files.map((f) => f.replace(/\.req\.json$/, ""));
  const endpoints: OpenApiEndpoint[] = [];
  for (const f of files) {
    const req = loadJson<RestReqFile>(f);
    if (!req) continue;
    for (const [path, methods] of Object.entries(req.paths ?? {})) {
      for (const [m, op] of Object.entries(methods ?? {})) {
        if (!op) continue;
        endpoints.push({
          tag: req.tag,
          path,
          method: m as OpenApiEndpoint["method"],
          op,
          label: op.summary || op.id || `${m.toUpperCase()} ${path}`,
        });
      }
    }
  }
  return { endpoints, tags };
}

/** 模板 path 的占位段（`{name}` → index；兼容 `{base}...{head}` 复合占位共享 index） */
function tplPlaceholders(path: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  path.split("/").forEach((seg, i) => {
    const re = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) out.push({ name: m[1], index: i });
  });
  return out;
}

/** 模板占位替换为实际值（填值 URL 构造；数值/复杂值用 name 自身） */
function fillUrl(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    ["org", "owner", "repo", "username", "login", "gist_id"].includes(name) ? "demo" : "v1",
  );
}

const { endpoints, tags } = loadAllEndpoints();
const byPathMethod = new Map<string, OpenApiEndpoint>();
for (const e of endpoints) byPathMethod.set(`${e.method.toUpperCase()} ${e.path}`, e);

describe(`全量产物（${tags.length} tag / ${endpoints.length} 端点）`, () => {
  it("产物非空（index/req 均存在）", () => {
    expect(tags.length).toBeGreaterThan(30);
    expect(endpoints.length).toBeGreaterThan(1000);
  });

  for (const e of endpoints) {
    const id = `${e.method.toUpperCase()} ${e.path} [${e.tag}]`;
    const tpl = tplPlaceholders(e.path);
    const pathParams = (e.op.params ?? []).filter((p) => p.in === "path");
    const queryParams = (e.op.params ?? []).filter((p) => p.in === "query");

    describe(id, () => {
      it("path 参数 ↔ 模板占位双向一致", () => {
        // 文档声明了 in:path 但模板无 `{name}` → index 提取必然失败
        for (const p of pathParams) {
          expect(
            tpl.some((t) => t.name === p.name),
            `op.params in:path "${p.name}" 但模板无 {${p.name}}`,
          ).toBe(true);
        }
        // 模板有 `{name}` 但文档无 in:path 参数 → 表格缺锁定行（提取不完整）
        for (const t of tpl) {
          expect(
            pathParams.some((p) => p.name === t.name),
            `模板 {${t.name}} 但 op.params 缺 in:path 参数`,
          ).toBe(true);
        }
      });

      it("endpointToRequest：index/query 行/URL 提取正确", () => {
        const r = endpointToRequest(e);
        expect(r.url).toBe(e.path);
        expect(r.method).toBe(e.method.toUpperCase());
        // path 行 index == 模板 split('/') 位置
        for (const p of r.params.filter((x) => x.in === "path")) {
          const t = tpl.find((x) => x.name === p.name);
          expect(t, `path 行 ${p.name} 无模板占位`).toBeDefined();
          expect(p.index).toBe(t!.index);
        }
        // query 行数 == 文档 query 数；皆 explicit=false 空值
        expect(r.params.filter((x) => x.in === "query")).toHaveLength(queryParams.length);
        for (const q of r.params.filter((x) => x.in === "query")) {
          expect(q).toMatchObject({ value: "", explicit: false });
        }
      });

      it("matchEndpoint round-trip：模板 URL 匹配自身（不误匹配）", () => {
        const hit = matchEndpoint(e.method.toUpperCase(), e.path, endpoints);
        expect(hit, `matchEndpoint(${id}) 未命中自身`).not.toBeNull();
        expect(hit!.path, `matchEndpoint(${id}) 命中他端点 ${hit!.path}`).toBe(e.path);
        expect(hit!.method).toBe(e.method);
      });

      it("matchEndpoint 填值 URL 命中自身（用户输入实际值场景）", () => {
        // 占位替换为实际值（fillUrl）→ 仍须命中自身；历史 bug：compare 复合占位填值
        // 被同分 `{basehead}` 抢（真实产物两者共存且 `{basehead}` 排序在前）
        const filled = fillUrl(e.path);
        const hit = matchEndpoint(e.method.toUpperCase(), filled, endpoints);
        expect(hit, `matchEndpoint(${id}) 填值未命中自身`).not.toBeNull();
        expect(hit!.path, `matchEndpoint(${id}) 填值命中他端点 ${hit!.path}`).toBe(e.path);
      });

      it("endpointStillMatches：填值 URL 固化 true", () => {
        const filled = fillUrl(e.path);
        expect(endpointStillMatches(e, filled, e.method.toUpperCase())).toBe(true);
      });

      it("buildUrlFromParams 正向不改 URL（空值产物 → 模板；带 doc 贴近真实调用）", () => {
        const r = endpointToRequest(e);
        const doc: DocParams = {
          path: e.path,
          queryNames: queryParams.map((p) => p.name),
        };
        expect(buildUrlFromParams(r.url, r.params, doc)).toBe(e.path);
      });

      it("syncParamsFromUrl 反向骨架稳定（path/query 集合对齐模板 + 文档）", () => {
        const doc: DocParams = {
          path: e.path,
          queryNames: queryParams.map((p) => p.name),
        };
        const r = endpointToRequest(e);
        const out = syncParamsFromUrl(r.params, e.path, doc);
        // path 行集合 == 模板占位集
        const outPaths = out.filter((p) => p.in === "path");
        expect(outPaths.map((p) => p.name).sort()).toEqual(tpl.map((t) => t.name).sort());
        // query 行集合 == 文档 query 集（编辑中行保留）
        const outQueries = out.filter((p) => p.in === "query");
        expect(outQueries.map((p) => p.name).sort()).toEqual(queryParams.map((p) => p.name).sort());
      });
    });
  }
});
