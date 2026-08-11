/**
 * ============================================================================
 * debug-openapi.ts 单元测试 —— 端点解析 / 匹配 / 固化质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * 端点文档（OpenAPI 产物）→ DebugRequest 的提取、URL+方法 → 端点文档的匹配、
 * 以及端点确定后的固化判定。这是「文档权威 + 端点固化」架构的纯函数核心：
 * 无论端点点选还是手写 URL，只要条件匹配即加载对应端点文档（需求 5）。
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                        │ 用例（it 标题）            │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. buildGroupFromTag：req+res-min 合并分组、路径  │ 合并 req + res-min 为分组   │
 * │    排序、label 取 summary（无 → method+path）     │                           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. endpointToRequest 提取：                      │ path 参数 → 行带 index     │
 * │    - path 行：index = 模板 split('/') 位置        │ POST → bodyType json       │
 * │      （含 {name} 的段），值默认占位符              │ compare 复合占位共享 index  │
 * │    - query 行：explicit=false 空值                │ 无参数端点（根路径 /）      │
 * │    - URL = 模板；method 大写；bodyType             │                           │
 * │      （GET/DELETE/HEAD → none，其余 → json）       │                           │
 * │    - **复合占位**（{base}...{head}）：两参数共享   │                           │
 * │      段 index（历史 bug：正则提取失败 index=-1）   │                           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. matchEndpoint（段级模板匹配 + 最具体优先）：    │ 静态段优先（历史 bug 回归） │
 * │    - 段数相同 + 模板占位段通配任意值 + 其余精确     │ 填实际值同样命中静态端点    │
 * │    - **评分制**：① 静态段数越多越具体              │ 多段路径命中含占位具体端点  │
 * │      （rule-suites 不被 {ruleset_id} 抢）          │ 方法不匹配 → null          │
 * │      ② 同静态段数：占位段字面结构分               │ 段数不同 → null             │
 * │      （模板自身最高分，其次字面片段 `...`          │ 空 URL → null；根路径 / 命中 │
 * │      出现在 URL 段 → {base}...{head} 不被          │ compare 真实排序下仍正确命中│
 * │      {basehead} 抢）——不依赖数组顺序               │ 空端点数组 → null（防御）   │
 * │    - 空 URL 守卫 url.trim()===""（根路径 / 段数 0  │ 方法大小写不敏感            │
 * │      仍可匹配）；query string 不影响匹配           │ URL 尾随斜杠与根路径等价    │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. endpointStillMatches（端点固化）：              │ 占位段填实际值 → 固化 true  │
 * │    - 方法一致 + 段数相同 + 模板静态段位置值相等     │ 静态段变化 → false          │
 * │    - 占位段任意值（微编辑填值/改值不重匹配）        │ 段数变化 → false            │
 * │    - query string 不影响判定                      │ 方法变化 → false            │
 * │    - **复合占位段填值任意值 → 固化 true**           │ 复合占位填值固化 true       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 【历史 bug 回归（勿删对应用例）】
 * - matchEndpoint 返回首个匹配：`/orgs/{org}/rulesets/rule-suites` 被 localeCompare 排前的
 *   `{ruleset_id}` 占位端点抢 → 静态段数优先（评分制）
 * - compare 复合占位 vs {basehead}：真实产物两者共存且 `{basehead}` 排序在前，原评分制同分
 *   取首个 → 填值/round-trip 都错命 → 占位段字面结构分（`...` 片段）
 * - 根路径 `GET /`（meta tag）：原 urlSegs.length===0 守卫永不匹配 → url.trim()==="" 守卫
 * - endpointToRequest 复合占位：原 `^\{([^}]+)\}$` 正则匹配不了 `{base}...{head}` → index=-1
 *
 * 【修改本文件的注意事项】
 * 1. 任何修改不得削弱上述 4 组基线；评分制用例必须用「{basehead} 在前」的真实排序验证
 * 2. 全量产物验证在 schema-integration.spec.ts（1108 端点 × 7 断言，含填值 round-trip）
 * 3. 涉及参数 ↔ URL 联动的用例在 debug-params.spec.ts
 */
import { describe, it, expect } from "vitest";
import {
  buildGroupFromTag,
  endpointToRequest,
  matchEndpoint,
  endpointStillMatches,
  type OpenApiEndpoint,
  type RestReqFile,
  type RestResMinFile,
} from "@/lib/debug-openapi";

/** 构造测试端点（method/path/op.params） */
function ep(
  method: "get" | "post" | "delete",
  path: string,
  params: OpenApiEndpoint["op"]["params"] = [],
): OpenApiEndpoint {
  return { tag: "orgs", path, method, op: { params }, label: path };
}

describe("buildGroupFromTag", () => {
  it("合并 req + res-min 为分组，路径排序，label 取 summary", () => {
    const req: RestReqFile = {
      tag: "orgs",
      paths: {
        "/orgs/{org}/repos": {
          get: { summary: "List repos", params: [] },
          post: { params: [] },
        },
        "/orgs/{org}": { get: { params: [] } },
      },
    };
    const resMin: RestResMinFile = {
      tag: "orgs",
      paths: { "/orgs/{org}": { get: [{ s: "200" }] } },
    };
    const g = buildGroupFromTag(req, resMin);
    expect(g.tag).toBe("orgs");
    expect(g.items.map((i) => `${i.method.toUpperCase()} ${i.path}`)).toEqual([
      "GET /orgs/{org}",
      "GET /orgs/{org}/repos",
      "POST /orgs/{org}/repos",
    ]);
    const org = g.items.find((i) => i.path === "/orgs/{org}")!;
    expect(org.method).toBe("get");
    expect(org.label).toBe("GET /orgs/{org}"); // 无 summary → method + path 兜底
    const repos = g.items.find((i) => i.path === "/orgs/{org}/repos" && i.method === "get")!;
    expect(repos.label).toBe("List repos"); // 有 summary
    expect(org.resMin).toEqual([{ s: "200" }]);
  });
});

describe("endpointToRequest", () => {
  it("path 参数 → 行带 index（模板 split('/') 位置）；query → 行 explicit=false 空值", () => {
    const e = ep("get", "/orgs/{org}/repos", [
      { name: "org", in: "path", required: true, type: "string" },
      { name: "type", in: "query", type: "string" },
      { name: "per_page", in: "query", type: "integer" },
    ]);
    const r = endpointToRequest(e);
    expect(r.method).toBe("GET");
    expect(r.protocol).toBe("rest");
    expect(r.url).toBe("/orgs/{org}/repos");
    expect(r.bodyType).toBe("none"); // GET
    expect(r.params).toEqual([
      { name: "org", in: "path", value: "{org}", enabled: true, index: 2 },
      { name: "type", in: "query", value: "", enabled: true, explicit: false },
      { name: "per_page", in: "query", value: "", enabled: true, explicit: false },
    ]);
  });
  it("POST → bodyType json；常用 owner/repo 占位保持", () => {
    const e = ep("post", "/repos/{owner}/{repo}/issues", [
      { name: "owner", in: "path", required: true },
      { name: "repo", in: "path", required: true },
    ]);
    const r = endpointToRequest(e);
    expect(r.bodyType).toBe("json");
    expect(r.url).toBe("/repos/{owner}/{repo}/issues");
    expect(r.params[0]).toMatchObject({ name: "owner", value: "{owner}", index: 2 });
    expect(r.params[1]).toMatchObject({ name: "repo", value: "{repo}", index: 3 });
  });
  it("compare 复合占位 `{base}...{head}`：两参数共享段 index（历史 bug：正则提取失败 index=-1）", () => {
    const e = ep("get", "/repos/{owner}/{repo}/compare/{base}...{head}", [
      { name: "owner", in: "path", required: true },
      { name: "repo", in: "path", required: true },
      { name: "base", in: "path", required: true },
      { name: "head", in: "path", required: true },
    ]);
    const r = endpointToRequest(e);
    expect(r.url).toBe("/repos/{owner}/{repo}/compare/{base}...{head}");
    const byName = Object.fromEntries(r.params.map((p) => [p.name, p]));
    // split('/')：owner=2、repo=3、compare=4、`{base}...{head}`=5 → base/head 共享 index 5
    expect(byName.base).toMatchObject({ value: "{base}", index: 5 });
    expect(byName.head).toMatchObject({ value: "{head}", index: 5 });
  });
  it("无参数端点（根路径 /）→ params 空 + URL / + GET bodyType none", () => {
    const r = endpointToRequest(ep("get", "/"));
    expect(r.url).toBe("/");
    expect(r.params).toEqual([]);
    expect(r.bodyType).toBe("none");
  });
});

describe("matchEndpoint（段级模板匹配 + 静态优先）", () => {
  const endpoints: OpenApiEndpoint[] = [
    ep("get", "/orgs/{org}/rulesets/{ruleset_id}"),
    ep("get", "/orgs/{org}/rulesets/rule-suites"),
    ep("get", "/orgs/{org}/rulesets/rule-suites/{rule_suite_id}"),
    ep("post", "/orgs/{org}/attestations/bulk-list"),
    ep("get", "/repos/{owner}/{repo}"),
  ];

  it("静态段优先：rule-suites 不被 {ruleset_id} 占位端点抢（历史 bug 回归）", () => {
    const hit = matchEndpoint("GET", "/orgs/{org}/rulesets/rule-suites", endpoints);
    expect(hit?.path).toBe("/orgs/{org}/rulesets/rule-suites");
  });
  it("填实际值同样命中静态端点", () => {
    const hit = matchEndpoint("get", "/orgs/evil7/rulesets/rule-suites", endpoints);
    expect(hit?.path).toBe("/orgs/{org}/rulesets/rule-suites");
  });
  it("多段路径命中含占位的具体端点", () => {
    const hit = matchEndpoint("GET", "/orgs/evil7/rulesets/rule-suites/123", endpoints);
    expect(hit?.path).toBe("/orgs/{org}/rulesets/rule-suites/{rule_suite_id}");
  });
  it("方法不匹配 → null", () => {
    expect(matchEndpoint("POST", "/orgs/{org}/rulesets/rule-suites", endpoints)).toBeNull();
    expect(matchEndpoint("DELETE", "/orgs/{org}/rulesets/rule-suites", endpoints)).toBeNull();
  });
  it("段数不同 → null", () => {
    expect(matchEndpoint("GET", "/orgs/{org}/rulesets", endpoints)).toBeNull();
    expect(matchEndpoint("GET", "/orgs/{org}", endpoints)).toBeNull();
  });
  it("空 URL → null；根路径 / → 命中", () => {
    expect(matchEndpoint("GET", "", endpoints)).toBeNull();
    const root = matchEndpoint("GET", "/", [ep("get", "/"), ep("get", "/orgs/{org}")]);
    expect(root?.path).toBe("/");
  });
  it("compare 复合占位 `{base}...{head}`：真实排序（{basehead} 在前）下仍正确命中", () => {
    // localeCompare 排序 `{basehead}` 在 `{base}...{head}` 前（`}`(125) > `h`(104)）
    // ——历史 bug：填值 URL 与模板自身都会被 {basehead} 抢；评分制用字面片段结构分解决
    const cmp: OpenApiEndpoint[] = [
      ep("get", "/repos/{owner}/{repo}/compare/{basehead}"),
      ep("get", "/repos/{owner}/{repo}/compare/{base}...{head}"),
    ];
    // 模板自身 round-trip
    const hit = matchEndpoint("GET", "/repos/{owner}/{repo}/compare/{base}...{head}", cmp);
    expect(hit?.path).toBe("/repos/{owner}/{repo}/compare/{base}...{head}");
    // 填值 URL 含 `...` → 结构分命中复合占位（不依赖数组顺序）
    const filled = matchEndpoint("GET", "/repos/evil7/pureGit/compare/main...dev", cmp);
    expect(filled?.path).toBe("/repos/{owner}/{repo}/compare/{base}...{head}");
    // 无 `...` 的单值 URL → 命中 {basehead}（复合占位格式要求 `...` 分隔）
    const single = matchEndpoint("GET", "/repos/evil7/pureGit/compare/abc123", cmp);
    expect(single?.path).toBe("/repos/{owner}/{repo}/compare/{basehead}");
  });
  it("空端点数组 → null（防御）", () => {
    expect(matchEndpoint("GET", "/orgs/evil7", [])).toBeNull();
  });
  it("方法大小写不敏感（get/GET/Get）", () => {
    for (const m of ["get", "GET", "Get"]) {
      const hit = matchEndpoint(m, "/orgs/{org}/rulesets/rule-suites", endpoints);
      expect(hit?.path).toBe("/orgs/{org}/rulesets/rule-suites");
    }
  });
  it("URL 尾随斜杠与根路径等价（段数 0 可匹配）", () => {
    const root: OpenApiEndpoint[] = [ep("get", "/")];
    expect(matchEndpoint("GET", "/", root)?.path).toBe("/");
    // `/` 与 `/orgs/{org}` 段数不同 → 不匹配
    expect(matchEndpoint("GET", "/", [ep("get", "/orgs/{org}")])).toBeNull();
  });
  it("query string 不影响匹配", () => {
    const hit = matchEndpoint("GET", "/repos/evil7/pureGit?per_page=10", endpoints);
    expect(hit?.path).toBe("/repos/{owner}/{repo}");
  });
  it("同静态段数 → 保留第一个（稳定）", () => {
    const dup: OpenApiEndpoint[] = [ep("get", "/orgs/{org}/teams"), ep("get", "/orgs/{org}/teams")];
    const hit = matchEndpoint("GET", "/orgs/evil7/teams", dup);
    expect(hit).toBe(dup[0]);
  });
});

describe("endpointStillMatches（端点固化）", () => {
  const e = ep("get", "/orgs/{org}/rulesets/rule-suites");

  it("占位段填实际值 → 固化 true（微编辑不重匹配）", () => {
    expect(endpointStillMatches(e, "/orgs/evil7/rulesets/rule-suites?ref=main", "GET")).toBe(true);
    expect(endpointStillMatches(e, "/orgs/{org}/rulesets/rule-suites", "get")).toBe(true);
  });
  it("静态段变化 → false（结构变化触发重匹配）", () => {
    expect(endpointStillMatches(e, "/orgs/evil7/rulesets/12345", "GET")).toBe(false);
  });
  it("段数变化 → false", () => {
    expect(endpointStillMatches(e, "/orgs/evil7/rulesets", "GET")).toBe(false);
  });
  it("方法变化 → false（方法切换重匹配）", () => {
    expect(endpointStillMatches(e, "/orgs/evil7/rulesets/rule-suites", "POST")).toBe(false);
  });
  it("query string 不影响固化判定", () => {
    expect(
      endpointStillMatches(e, "/orgs/evil7/rulesets/rule-suites?page=2&sort=created", "GET"),
    ).toBe(true);
  });
  it("复合占位 `{base}...{head}` 填值固化 true（任意值含分隔符）", () => {
    const cmp = ep("get", "/repos/{owner}/{repo}/compare/{base}...{head}");
    expect(endpointStillMatches(cmp, "/repos/evil7/pureGit/compare/main...dev", "GET")).toBe(true);
    expect(endpointStillMatches(cmp, "/repos/{owner}/{repo}/compare/{base}...{head}", "get")).toBe(
      true,
    );
  });
});
