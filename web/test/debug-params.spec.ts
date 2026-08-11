/**
 * ============================================================================
 * debug-params.ts 单元测试 —— REST Params（参数表）↔ URL 双向联动质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * `/$debug` 调试客户端 REST 类型的「参数」tab：参数表格与 URL 必须**全量实时双向联动**
 * ——改表格立即反映到 URL，改 URL 立即反映到表格，且任意输入序列循环不抖动、不丢数据。
 * 这是 2026-08-11 定稿的 5 点需求（URL→表格全量解析 / 删除转 badge / 空值 query 不丢 /
 * 表格→URL 对照映射 / 匹配即加载文档）的纯函数核心。
 *
 * 【权威原则（业务基线，勿改）】
 * - URL 是 query 参数的权威源；端点文档是 path 参数与可选参数的权威源
 * - DebugParam.explicit 区分行来源：
 *   - explicit=true（显式行）：已在 URL 出现 —— 反向同步值/移除，空值也输出裸名
 *   - explicit=false（编辑中行）：文档填充 / 手动添加 —— 空值不输出，反向保留
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                        │ 用例（it 标题）            │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. parseQuery 解析 query string                │ 空值 query 输出裸名        │
 * │    `?aa&bb=2` → [["aa",""],[ "bb","2"]]（保序） │ 空串返回空数组              │
 * │    + 之外原样、%20 解码                         │ URL 编码解码                │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. 正向 buildUrlFromParams（参数 → URL）：       │ path 按 index 覆盖段        │
 * │    - path 按 index 段位覆盖（不依赖 {name}，     │ path 空值保留/占位覆盖回/   │
 * │      占位被替换后仍联动）                        │   段缺失不动                │
 * │    - query：enabled 即输出（值非空 name=value、  │ query 值非空→name=value     │
 * │      空值显式→裸名 name、disabled/空值非显式     │ disabled 或空值非显式不输出  │
 * │      不输出）；值 encodeURIComponent             │ query 编码                  │
 * │    - **复合占位段**（{base}...{head} 共享 index）│ 复合占位：只替换各自子串    │
 * │      → 只替换该参数子串，其余部分保留            │ （互不破坏 / 空值保留 / 回占位）│
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. 反向 syncParamsFromUrl（URL → 参数）：        │ URL 出现的 key → 显式同步   │
 * │    - URL 出现的 key → 显式同步（value/enabled/   │ 显式行被 URL 移除 → 表格移除│
 * │      explicit）；URL 新 key 补显式行             │ disabled 行保留             │
 * │    - 显式行被移除 → 表格移除（文档参数转 badge）  │ 编辑中行 doc 外移除         │
 * │    - disabled 行保留（用户意图）                 │ 编辑中行 doc 内保留待填     │
 * │    - 编辑中行（explicit=false）：doc 提供时       │ doc 未提供 → 编辑中行保留   │
 * │      不在文档 query 集 → 移除（切端点清残留）；   │ path：按 index 同步段值     │
 * │      在集内 → 保留待填；doc 未提供 → 保留        │ path：doc 补缺失/移多余     │
 * │    - path：按 index 同步段值（decode 回写）；     │ 重复 key query 补行去重     │
 * │      doc 模板补缺失行/移多余行；URL 重复 key      │ percent-encoding 回写      │
 * │      （?a=1&a=2）只补首个                        │ 复合占位反向：子串切分      │
 * │    - **复合占位段**（共享 index）→ 按模板段字面   │                           │
 * │      分隔符切分各自子串（main...dev →            │                           │
 * │      base="main"/head="dev"）                    │                           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. 展示排序：path 恒在前按 index 升序；query 按   │ 表格展示排序               │
 * │    URL 出现顺序；不在 URL 的行排末尾              │                           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 5. 循环稳定：正向构建输出顺序 = 表格序 = URL 序    │ 循环稳定（双向不抖动）      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 【历史 bug 回归（勿删对应用例）】
 * - 占位符依赖 bug：buildUrlFromParams 原按 `{name}` 替换，占位被替换后失效 → 改按 index 段位
 * - 复合占位整体覆盖互毁：{base}...{head} 两参数共享 index，整体覆盖段互毁（head 覆盖 base
 *   结果）→ 段内子占位只替换子串
 * - 反向复合占位整段赋值：syncParamsFromUrl 对共享 index 行赋整段（main...dev）而非子串
 *   → 按模板段字面分隔符切分
 * - 重复 key 补行重复：`?a=1&a=2` 补两个 a 行 → 补行循环按 key 去重
 *
 * 【修改本文件的注意事项】
 * 1. 任何修改不得削弱上述 5 组基线的断言（尤其复合占位/显式语义/循环稳定）
 * 2. 新增行为先补用例再改业务代码（TDD），用例须能证明「改前失败、改后通过」
 * 3. 修改前先读 debug-params.ts 顶部权威原则注释，理解 explicit 语义
 * 4. 涉及端点匹配/提取的用例在 debug-openapi.spec.ts；全量产物验证在
 *    schema-integration.spec.ts（1108 端点 × 7 断言）
 */
import { describe, it, expect } from "vitest";
import {
  parseQuery,
  buildUrlFromParams,
  syncParamsFromUrl,
  type DocParams,
} from "@/lib/debug-params";
import type { DebugParam } from "@/lib/debug-api";

const ORGS_REPOS_DOC: DocParams = {
  path: "/orgs/{org}/repos",
  queryNames: ["type", "sort", "direction", "per_page", "page"],
};

/** 端点模板填充的初始参数（endpointToRequest 产物语义） */
function docRows(): DebugParam[] {
  return [
    { name: "org", in: "path", value: "{org}", enabled: true, index: 2 },
    { name: "type", in: "query", value: "", enabled: true, explicit: false },
    { name: "sort", in: "query", value: "", enabled: true, explicit: false },
    { name: "direction", in: "query", value: "", enabled: true, explicit: false },
    { name: "per_page", in: "query", value: "", enabled: true, explicit: false },
    { name: "page", in: "query", value: "", enabled: true, explicit: false },
  ];
}

describe("parseQuery", () => {
  it("空值 query 输出裸名 [name, '']（?aa&bb 语义）", () => {
    expect(parseQuery("aa&bb=2")).toEqual([
      ["aa", ""],
      ["bb", "2"],
    ]);
  });
  it("空串返回空数组", () => {
    expect(parseQuery("")).toEqual([]);
    expect(parseQuery(undefined as unknown as string)).toEqual([]);
  });
  it("URL 编码解码（+ 之外原样）", () => {
    expect(parseQuery("q=react%20native&lang=TypeScript")).toEqual([
      ["q", "react native"],
      ["lang", "TypeScript"],
    ]);
  });
});

describe("buildUrlFromParams（正向：参数 → URL）", () => {
  it("path 按 index 覆盖段（不依赖占位符——占位符被替换后仍联动）", () => {
    const rows: DebugParam[] = [
      { name: "org", in: "path", value: "evil7", enabled: true, index: 2 },
    ];
    // URL 中占位符已被替换成 evil7 → 再改成 microsoft 仍应覆盖段
    expect(buildUrlFromParams("/orgs/evil7/repos", rows)).toBe("/orgs/evil7/repos");
    const changed: DebugParam[] = [
      { name: "org", in: "path", value: "microsoft", enabled: true, index: 2 },
    ];
    expect(buildUrlFromParams("/orgs/evil7/repos", changed)).toBe("/orgs/microsoft/repos");
  });
  it("path 空值保留当前段；占位符覆盖回占位；段缺失不动", () => {
    const empty: DebugParam[] = [{ name: "org", in: "path", value: "", enabled: true, index: 2 }];
    expect(buildUrlFromParams("/orgs/evil7/repos", empty)).toBe("/orgs/evil7/repos");
    const placeholder: DebugParam[] = [
      { name: "org", in: "path", value: "{org}", enabled: true, index: 2 },
    ];
    // 占位符覆盖段 → URL 回到占位状态（与「删空自动补回」联动一致）
    expect(buildUrlFromParams("/orgs/evil7/repos", placeholder)).toBe("/orgs/{org}/repos");
    const missing: DebugParam[] = [
      { name: "org", in: "path", value: "x", enabled: true, index: 9 },
    ];
    expect(buildUrlFromParams("/orgs/evil7/repos", missing)).toBe("/orgs/evil7/repos");
  });
  it("query 值非空 → name=value；空值显式 → 裸名 name（?aa&bb 循环不丢）", () => {
    const rows: DebugParam[] = [
      { name: "aa", in: "query", value: "", enabled: true, explicit: true },
      { name: "bb", in: "query", value: "2", enabled: true, explicit: true },
    ];
    expect(buildUrlFromParams("/users/evil7/repos", rows)).toBe("/users/evil7/repos?aa&bb=2");
  });
  it("disabled 或空值非显式 query 不输出", () => {
    const rows: DebugParam[] = [
      { name: "a", in: "query", value: "1", enabled: false },
      { name: "b", in: "query", value: "", enabled: true, explicit: false },
      { name: "c", in: "query", value: "3", enabled: true, explicit: true },
    ];
    expect(buildUrlFromParams("/users/evil7/repos", rows)).toBe("/users/evil7/repos?c=3");
  });
  it("query 编码（encodeURIComponent）", () => {
    const rows: DebugParam[] = [{ name: "q", in: "query", value: "react native", enabled: true }];
    expect(buildUrlFromParams("/search/repositories", rows)).toBe(
      "/search/repositories?q=react%20native",
    );
  });
  it("复合占位 `{base}...{head}`：共享 index 只替换各自子串（历史 bug：整体覆盖互毁）", () => {
    // 模板 `/repos/{owner}/{repo}/compare/{base}...{head}` split('/')：owner=2、repo=3、
    // compare=4、`{base}...{head}`=5（复合占位段共享 index 5）
    const rows: DebugParam[] = [
      { name: "owner", in: "path", value: "evil7", enabled: true, index: 2 },
      { name: "repo", in: "path", value: "pureGit", enabled: true, index: 3 },
      { name: "base", in: "path", value: "main", enabled: true, index: 5 },
      { name: "head", in: "path", value: "dev", enabled: true, index: 5 },
    ];
    expect(buildUrlFromParams("/repos/{owner}/{repo}/compare/{base}...{head}", rows)).toBe(
      "/repos/evil7/pureGit/compare/main...dev",
    );
    // 只填 base，head 空 → head 子占位保留
    const onlyBase: DebugParam[] = [
      { name: "base", in: "path", value: "main", enabled: true, index: 5 },
      { name: "head", in: "path", value: "", enabled: true, index: 5 },
    ];
    expect(buildUrlFromParams("/repos/{owner}/{repo}/compare/{base}...{head}", onlyBase)).toBe(
      "/repos/{owner}/{repo}/compare/main...{head}",
    );
    // base 值回归占位符（URL 仍为占位态）→ 段保持 {base}...{head}（子串替换不破坏结构）
    const backToPlaceholder: DebugParam[] = [
      { name: "base", in: "path", value: "{base}", enabled: true, index: 5 },
      { name: "head", in: "path", value: "{head}", enabled: true, index: 5 },
    ];
    expect(
      buildUrlFromParams("/repos/{owner}/{repo}/compare/{base}...{head}", backToPlaceholder),
    ).toBe("/repos/{owner}/{repo}/compare/{base}...{head}");
  });
  it("复合占位分次编辑（doc 提供）：先填 base 再填 head 不毁段（历史 bug：整体覆盖互毁）", () => {
    const doc: DocParams = {
      path: "/repos/{owner}/{repo}/compare/{base}...{head}",
      queryNames: [],
    };
    // 第一次编辑：只填 base（head 仍占位）→ URL 段变 main...{head}
    const step1: DebugParam[] = [
      { name: "base", in: "path", value: "main", enabled: true, index: 5 },
      { name: "head", in: "path", value: "{head}", enabled: true, index: 5 },
    ];
    const url1 = buildUrlFromParams("/repos/{owner}/{repo}/compare/{base}...{head}", step1, doc);
    expect(url1).toBe("/repos/{owner}/{repo}/compare/main...{head}");
    // 第二次编辑：段已变 main...{head}（不含 {base} 子串）——doc 从模板重建 → main...dev
    const step2: DebugParam[] = [
      { name: "base", in: "path", value: "main", enabled: true, index: 5 },
      { name: "head", in: "path", value: "dev", enabled: true, index: 5 },
    ];
    const url2 = buildUrlFromParams(url1, step2, doc);
    expect(url2).toBe("/repos/{owner}/{repo}/compare/main...dev");
    // head 值回归占位（从模板重建）→ main...{head}
    const step3: DebugParam[] = [
      { name: "base", in: "path", value: "main", enabled: true, index: 5 },
      { name: "head", in: "path", value: "{head}", enabled: true, index: 5 },
    ];
    expect(buildUrlFromParams(url2, step3, doc)).toBe(
      "/repos/{owner}/{repo}/compare/main...{head}",
    );
  });
});

describe("syncParamsFromUrl（反向：URL → 参数）", () => {
  it("URL 出现的 key → 显式同步 value；URL 新 key 补显式行", () => {
    const out = syncParamsFromUrl(docRows(), "/orgs/evil7/repos?type=all&custom=9", ORGS_REPOS_DOC);
    const type = out.find((p) => p.name === "type");
    expect(type).toMatchObject({ value: "all", enabled: true, explicit: true });
    const custom = out.find((p) => p.name === "custom");
    expect(custom).toMatchObject({ value: "9", enabled: true, explicit: true });
  });
  it("显式行被 URL 移除 → 表格移除（文档参数转 badge 由 ParamsTable 推导）", () => {
    const withExplicit: DebugParam[] = [
      ...docRows(),
      { name: "custom", in: "query", value: "9", enabled: true, explicit: true },
    ];
    const out = syncParamsFromUrl(withExplicit, "/orgs/evil7/repos?type=all", ORGS_REPOS_DOC);
    expect(out.some((p) => p.name === "custom")).toBe(false);
  });
  it("disabled 行保留（用户主动关闭，不在 URL 也不移除）", () => {
    const withDisabled: DebugParam[] = [
      { name: "org", in: "path", value: "evil7", enabled: true, index: 2 },
      { name: "per_page", in: "query", value: "", enabled: false },
    ];
    const out = syncParamsFromUrl(withDisabled, "/orgs/evil7/repos?type=all", ORGS_REPOS_DOC);
    expect(out.some((p) => p.name === "per_page" && p.enabled === false)).toBe(true);
  });
  it("编辑中行（explicit=false）：doc 提供时不在文档 query 集 → 移除（切换端点清残留）", () => {
    // 旧端点残留行 repository_name 不属于 ORGS_REPOS_DOC
    const withResidual: DebugParam[] = [
      ...docRows(),
      { name: "repository_name", in: "query", value: "", enabled: true, explicit: false },
    ];
    const out = syncParamsFromUrl(withResidual, "/orgs/evil7/repos?type=all", ORGS_REPOS_DOC);
    expect(out.some((p) => p.name === "repository_name")).toBe(false);
  });
  it("编辑中行在文档 query 集内 → 保留待填（即使不在 URL）", () => {
    const out = syncParamsFromUrl(docRows(), "/orgs/evil7/repos", ORGS_REPOS_DOC);
    for (const n of ["type", "sort", "direction", "per_page", "page"]) {
      expect(out.some((p) => p.in === "query" && p.name === n)).toBe(true);
    }
  });
  it("doc 未提供（自定义 URL）→ 编辑中行保留；显式行语义仍生效；URL 中 key 排前", () => {
    const rows: DebugParam[] = [
      { name: "aa", in: "query", value: "", enabled: true, explicit: true },
      { name: "manual", in: "query", value: "1", enabled: true, explicit: false },
    ];
    const out = syncParamsFromUrl(rows, "/custom/path?bb=2");
    // aa 不在 URL → 显式行移除；manual 编辑中行保留；bb 补显式行；
    // 排序：URL 中的 bb 在前，manual 排末尾
    expect(out.map((p) => p.name)).toEqual(["bb", "manual"]);
  });
  it("path：按 index 同步 URL 段值（占位段 → 占位符；实际值 → decode 回写）", () => {
    const out = syncParamsFromUrl(docRows(), "/orgs/evil7/repos?type=all", ORGS_REPOS_DOC);
    const org = out.find((p) => p.name === "org");
    expect(org).toMatchObject({ value: "evil7", index: 2 });
    // 占位段
    const out2 = syncParamsFromUrl(docRows(), "/orgs/{org}/repos", ORGS_REPOS_DOC);
    expect(out2.find((p) => p.name === "org")).toMatchObject({ value: "{org}" });
  });
  it("path：doc 模板补缺失行 / 移多余行（path 行只能来自端点）", () => {
    // 多余 path 行（不属于模板）→ 移除
    const withExtra: DebugParam[] = [
      ...docRows(),
      { name: "extra", in: "path", value: "x", enabled: true, index: 5 },
    ];
    const out = syncParamsFromUrl(withExtra, "/orgs/evil7/repos", ORGS_REPOS_DOC);
    expect(out.some((p) => p.name === "extra")).toBe(false);
    // 缺失 path 行（手写 URL 匹配端点）→ 补齐
    const out2 = syncParamsFromUrl([], "/orgs/microsoft/repos", ORGS_REPOS_DOC);
    expect(out2.find((p) => p.name === "org")).toMatchObject({
      value: "microsoft",
      index: 2,
      enabled: true,
    });
  });
  it("表格展示排序：path 在前按 index 升序；query 按 URL 出现顺序；不在 URL 排末尾", () => {
    const rows: DebugParam[] = [
      { name: "repo", in: "path", value: "pureGit", enabled: true, index: 3 },
      { name: "sort", in: "query", value: "created", enabled: true, explicit: true },
      { name: "owner", in: "path", value: "evil7", enabled: true, index: 2 },
      { name: "per_page", in: "query", value: "10", enabled: true, explicit: true },
      { name: "manual", in: "query", value: "", enabled: true, explicit: false },
    ];
    // URL query 顺序：per_page → sort（乱序输入验证按 URL 序）
    const out = syncParamsFromUrl(rows, "/repos/evil7/pureGit?per_page=10&sort=created");
    expect(out.map((p) => p.name)).toEqual(["owner", "repo", "per_page", "sort", "manual"]);
    expect(out.map((p) => p.index)).toEqual([2, 3, undefined, undefined, undefined]);
  });
  it("循环稳定：正向构建输出顺序 = 表格序 = URL 序（双向不抖动）", () => {
    const out = syncParamsFromUrl(docRows(), "/orgs/evil7/repos?page=2&sort=created");
    const url = buildUrlFromParams("/orgs/evil7/repos?page=2&sort=created", out);
    expect(url).toBe("/orgs/evil7/repos?page=2&sort=created");
  });
  it("重复 key query（?a=1&a=2）：补行去重只补首个（表格单 key 模型，行为与已有行同步一致）", () => {
    const out = syncParamsFromUrl([], "/custom/path?a=1&a=2&b=3");
    const aRows = out.filter((p) => p.in === "query" && p.name === "a");
    expect(aRows).toHaveLength(1);
    expect(aRows[0]).toMatchObject({ value: "1", explicit: true });
    expect(out.map((p) => p.name)).toEqual(["a", "b"]);
  });
  it("percent-encoding 反向回写：URL 段 %20 → 空格；% 非法序列兜底保留原样", () => {
    const rows: DebugParam[] = [
      { name: "org", in: "path", value: "{org}", enabled: true, index: 2 },
    ];
    const out = syncParamsFromUrl(rows, "/orgs/evil%207/repos", ORGS_REPOS_DOC);
    expect(out.find((p) => p.name === "org")).toMatchObject({ value: "evil 7" });
    const bad = syncParamsFromUrl(rows, "/orgs/%zz/repos", ORGS_REPOS_DOC);
    expect(bad.find((p) => p.name === "org")).toMatchObject({ value: "%zz" });
  });
  it("复合占位反向：`{base}...{head}` 填值段 → base/head 行同步各自子串值", () => {
    const doc: DocParams = {
      path: "/repos/{owner}/{repo}/compare/{base}...{head}",
      queryNames: [],
    };
    const rows: DebugParam[] = [
      { name: "owner", in: "path", value: "{owner}", enabled: true, index: 2 },
      { name: "repo", in: "path", value: "{repo}", enabled: true, index: 3 },
      { name: "base", in: "path", value: "{base}", enabled: true, index: 5 },
      { name: "head", in: "path", value: "{head}", enabled: true, index: 5 },
    ];
    const out = syncParamsFromUrl(rows, "/repos/evil7/pureGit/compare/main...dev", doc);
    const byName = Object.fromEntries(out.map((p) => [p.name, p]));
    expect(byName.base).toMatchObject({ value: "main", index: 5 });
    expect(byName.head).toMatchObject({ value: "dev", index: 5 });
    // 反向再正向 → 稳定（base/head 填值覆盖各自子串不互毁）
    const url = buildUrlFromParams("/repos/{owner}/{repo}/compare/{base}...{head}", out);
    expect(url).toBe("/repos/evil7/pureGit/compare/main...dev");
  });
});
