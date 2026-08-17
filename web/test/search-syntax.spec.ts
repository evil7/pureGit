/**
 * ============================================================================
 * search-syntax.ts 单元测试 —— GitHub 搜索语法解析/构建/匹配 质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * 全站搜索（SearchPage）与 issue/PR/Discussion 列表页共用一套搜索语法处理：
 * - parseSearchSyntax：将用户输入的 GitHub 搜索查询串解析为结构化 SearchFilters
 * - buildSearchQuery：按页面限定（type/repo/defaultState）构建 API 查询串
 * - matchSearch：前端过滤（已加载数据场景）逐条件匹配
 * - qualifier 系列（parseQueryQualifiers/getQualifier/hasQualifier/addQualifier/
 *   removeQualifier/toggleQualifier）：搜索框下方 chips 的快捷增删
 *
 * 【关键语义基线】
 * 1. author/assignee/mentions 的 `me` 归一化为 `@me`（GitHub 语义 = 当前登录者）
 * 2. 引号值整体取值并去引号：`label:"good first issue"` → 单个 label，不拆词
 * 3. 未知限定词并入自由文本 query（原样保留，交由 API 处理）
 * 4. ranges（created:/updated:/comments:/reactions:）原样保留含比较符
 * 5. buildSearchQuery：type 与 is:pr/issue 等价不重复加；无状态词时补 defaultState；
 *    repo 页面参数兜底、显式 repo: 覆盖
 * 6. qualifier 系列仅识别 QUALIFIER_KEYS 已知 key（UI 层识别，不执行解析）
 */
import { describe, it, expect } from "vitest";
import {
  parseSearchSyntax,
  buildSearchQuery,
  matchSearch,
  tokenizeSearch,
  serializeSearch,
  parseQueryQualifiers,
  getQualifier,
  hasQualifier,
  addQualifier,
  removeQualifier,
  toggleQualifier,
} from "@/lib/api/search-syntax";

describe("parseSearchSyntax", () => {
  it("空串 → 空过滤器", () => {
    expect(parseSearchSyntax("")).toEqual({ is: [], labels: [], in: [], ranges: [], query: "" });
    expect(parseSearchSyntax("   ")).toEqual({ is: [], labels: [], in: [], ranges: [], query: "" });
  });

  it("基本限定词解析：is/label/author/assignee/mentions/milestone/repo/org/in/sort", () => {
    const f = parseSearchSyntax(
      "is:open label:bug author:alice assignee:bob mentions:carol milestone:v1 repo:owner/name org:acme in:title sort:created",
    );
    expect(f.is).toEqual(["open"]);
    expect(f.labels).toEqual(["bug"]);
    expect(f.author).toBe("alice");
    expect(f.assignee).toBe("bob");
    expect(f.mentions).toBe("carol");
    expect(f.milestone).toBe("v1");
    expect(f.repo).toBe("owner/name");
    expect(f.org).toBe("acme");
    expect(f.in).toEqual(["title"]);
    expect(f.sort).toBe("created");
    expect(f.query).toBe("");
  });

  it("author/assignee/mentions 的 me 归一化为 @me", () => {
    const f = parseSearchSyntax("author:me assignee:me mentions:me");
    expect(f.author).toBe("@me");
    expect(f.assignee).toBe("@me");
    expect(f.mentions).toBe("@me");
  });

  it("引号值整体取值并去引号（含空格不拆词）", () => {
    const f = parseSearchSyntax('label:"good first issue" author:"Jane Doe"');
    expect(f.labels).toEqual(["good first issue"]);
    expect(f.author).toBe("Jane Doe");
  });

  it("未知限定词并入 query 原文", () => {
    const f = parseSearchSyntax("is:open foo:bar baz");
    expect(f.is).toEqual(["open"]);
    expect(f.query).toBe("foo:bar baz");
  });

  it("自由文本合并、空白归一、trim", () => {
    const f = parseSearchSyntax("  hello   world  is:closed  ");
    expect(f.query).toBe("hello world");
    expect(f.is).toEqual(["closed"]);
  });

  it("ranges 原样保留（含比较符）", () => {
    const f = parseSearchSyntax(
      "created:>2024-01-01 updated:<2024-06-01 comments:>=5 reactions:>10",
    );
    expect(f.ranges).toEqual([
      "created:>2024-01-01",
      "updated:<2024-06-01",
      "comments:>=5",
      "reactions:>10",
    ]);
    expect(f.query).toBe("");
  });

  it("key 大小写不敏感", () => {
    const f = parseSearchSyntax("IS:open LABEL:bug");
    expect(f.is).toEqual(["open"]);
    expect(f.labels).toEqual(["bug"]);
  });

  it("多值 is/label/in 保序累积", () => {
    const f = parseSearchSyntax("is:open is:merged label:a label:b in:title in:body");
    expect(f.is).toEqual(["open", "merged"]);
    expect(f.labels).toEqual(["a", "b"]);
    expect(f.in).toEqual(["title", "body"]);
  });
});

describe("buildSearchQuery", () => {
  it("type 限定：无 is:pr/issue 时追加 type:", () => {
    expect(buildSearchQuery("", { type: "issue", repo: "o/r" })).toContain("type:issue");
    expect(buildSearchQuery("", { type: "pr", repo: "o/r" })).toContain("type:pr");
  });

  it("is:pr/is:issue 与 type 等价：不重复加 type:，且类型词保留输出（不丢失类型限定）", () => {
    const q = buildSearchQuery("is:pr", { type: "pr", repo: "o/r" });
    expect(q).not.toContain("type:pr");
    expect(q).toContain("is:pr");
    expect(buildSearchQuery("is:issue", { type: "issue", repo: "o/r" })).toContain("is:issue");
    expect(buildSearchQuery("is:issue", { type: "issue", repo: "o/r" })).not.toContain(
      "type:issue",
    );
  });

  it("defaultState：无状态词时补 is:<defaultState>；有状态词时不补", () => {
    expect(buildSearchQuery("", { repo: "o/r", defaultState: "open" })).toContain("is:open");
    expect(buildSearchQuery("is:closed", { repo: "o/r", defaultState: "open" })).not.toContain(
      "is:open",
    );
    expect(buildSearchQuery("is:closed", { repo: "o/r", defaultState: "open" })).toContain(
      "is:closed",
    );
  });

  it("repo：页面参数兜底，显式 repo: 覆盖", () => {
    expect(buildSearchQuery("", { repo: "o/r" })).toContain("repo:o/r");
    expect(buildSearchQuery("repo:x/y", { repo: "o/r" })).toContain("repo:x/y");
    expect(buildSearchQuery("repo:x/y", { repo: "o/r" })).not.toContain("repo:o/r");
  });

  it("label 含空格 → 引号包裹", () => {
    const q = buildSearchQuery('label:"good first issue"', { repo: "o/r" });
    expect(q).toContain('label:"good first issue"');
    expect(buildSearchQuery("label:bug", { repo: "o/r" })).toContain("label:bug");
  });

  it("全分段拼接顺序稳定：query → type → is → label → author → repo → in → ranges → sort", () => {
    const q = buildSearchQuery('bug label:"ui fix" author:me in:body created:>2024 sort:comments', {
      type: "issue",
      repo: "o/r",
      defaultState: "open",
    });
    const idx = (s: string) => q.indexOf(s);
    expect(idx("bug")).toBeLessThan(idx("type:issue"));
    expect(idx("type:issue")).toBeLessThan(idx("is:open"));
    expect(idx("is:open")).toBeLessThan(idx('label:"ui fix"'));
    expect(idx('label:"ui fix"')).toBeLessThan(idx("author:@me"));
    expect(idx("author:@me")).toBeLessThan(idx("repo:o/r"));
    expect(idx("repo:o/r")).toBeLessThan(idx("in:body"));
    expect(idx("in:body")).toBeLessThan(idx("created:"));
    expect(idx("created:")).toBeLessThan(idx("sort:comments"));
  });
});

describe("matchSearch", () => {
  const base = {
    title: "Fix the bug",
    body: "details here",
    repo: "owner/repo",
    author: "Alice",
    labels: ["bug", "ui"],
    state: "OPEN",
  };

  it("空 raw → 恒 true", () => {
    expect(matchSearch("", base)).toBe(true);
    expect(matchSearch("  ", base)).toBe(true);
  });

  it("自由文本匹配 title/body/repo 子串（大小写不敏感）", () => {
    expect(matchSearch("fix", base)).toBe(true);
    expect(matchSearch("FIX", base)).toBe(true);
    expect(matchSearch("details", base)).toBe(true);
    expect(matchSearch("owner/repo", base)).toBe(true);
    expect(matchSearch("notfound", base)).toBe(false);
  });

  it("is:open / is:closed 匹配 state", () => {
    expect(matchSearch("is:open", base)).toBe(true);
    expect(matchSearch("is:closed", base)).toBe(false);
    const closed = { ...base, state: "CLOSED" };
    expect(matchSearch("is:closed", closed)).toBe(true);
    expect(matchSearch("is:open", closed)).toBe(false);
  });

  it("is:answered / is:unanswered 匹配 isAnswered", () => {
    expect(matchSearch("is:answered", { ...base, isAnswered: true })).toBe(true);
    expect(matchSearch("is:answered", { ...base, isAnswered: false })).toBe(false);
    expect(matchSearch("is:unanswered", { ...base, isAnswered: false })).toBe(true);
    expect(matchSearch("is:unanswered", { ...base, isAnswered: true })).toBe(false);
  });

  it("labels 全部命中（AND，大小写不敏感）", () => {
    expect(matchSearch("label:bug", base)).toBe(true);
    expect(matchSearch("label:Bug label:ui", base)).toBe(true);
    expect(matchSearch("label:bug label:missing", base)).toBe(false);
  });

  it("author 匹配（大小写不敏感）", () => {
    expect(matchSearch("author:alice", base)).toBe(true);
    expect(matchSearch("author:ALICE", base)).toBe(true);
    expect(matchSearch("author:bob", base)).toBe(false);
  });

  it("repo 子串包含匹配", () => {
    expect(matchSearch("repo:owner", base)).toBe(true);
    expect(matchSearch("repo:other", base)).toBe(false);
  });
});

describe("parseQueryQualifiers / getQualifier / hasQualifier", () => {
  it("只识别 QUALIFIER_KEYS 已知 key，未知 key 跳过", () => {
    const tokens = parseQueryQualifiers("is:open foo:bar language:ts");
    expect(tokens.map((t) => t.key)).toEqual(["is", "language"]);
  });

  it("比较符 op 提取（> >= < <=），值剥离比较符", () => {
    const tokens = parseQueryQualifiers("stars:>100 forks:>=5 size:<100 pushed:<=2024-01-01");
    const byKey = Object.fromEntries(tokens.map((t) => [t.key, t]));
    expect(byKey.stars).toEqual({ key: "stars", negated: false, op: ">", value: "100" });
    expect(byKey.forks).toEqual({ key: "forks", negated: false, op: ">=", value: "5" });
    expect(byKey.size).toEqual({ key: "size", negated: false, op: "<", value: "100" });
    expect(byKey.pushed).toEqual({ key: "pushed", negated: false, op: "<=", value: "2024-01-01" });
  });

  it("引号值整体取值并去引号", () => {
    const tokens = parseQueryQualifiers('label:"good first issue"');
    expect(tokens).toEqual([{ key: "label", negated: false, op: "", value: "good first issue" }]);
  });

  it("getQualifier：返回 op+value，无则 null", () => {
    const q = "is:open stars:>100";
    expect(getQualifier(q, "stars")).toBe(">100");
    expect(getQualifier(q, "is")).toBe("open");
    expect(getQualifier(q, "missing")).toBeNull();
  });

  it("hasQualifier：指定 value 完整匹配；省略 value 只看 key", () => {
    const q = "is:open stars:>100";
    expect(hasQualifier(q, "is", "open")).toBe(true);
    expect(hasQualifier(q, "is", "closed")).toBe(false);
    expect(hasQualifier(q, "stars", ">100")).toBe(true);
    expect(hasQualifier(q, "is")).toBe(true);
    expect(hasQualifier(q, "missing")).toBe(false);
  });
});

describe("addQualifier / removeQualifier / toggleQualifier", () => {
  it("addQualifier：无则追加（空串直接 full）", () => {
    expect(addQualifier("", "language", "ts")).toBe("language:ts");
    expect(addQualifier("is:open", "language", "ts")).toBe("is:open language:ts");
  });

  it("addQualifier：同 key 已存在则原位替换", () => {
    expect(addQualifier("language:js is:open", "language", "ts")).toBe("language:ts is:open");
  });

  it("addQualifier：引号值整体匹配替换", () => {
    expect(addQualifier('label:"good first issue"', "label", "bug")).toBe("label:bug");
  });

  it("removeQualifier：删除同 key 全部，空白归一", () => {
    expect(removeQualifier("is:open language:js is:closed", "is")).toBe("language:js");
    expect(removeQualifier("language:js", "is")).toBe("language:js");
    expect(removeQualifier("", "is")).toBe("");
  });

  it("toggleQualifier：有指定值则移除，无则追加（追加前先清同 key 其他值）", () => {
    expect(toggleQualifier("is:open", "is", "open")).toBe("");
    expect(toggleQualifier("is:open", "is", "closed")).toBe("is:closed");
    expect(toggleQualifier("language:js is:open", "language", "ts")).toBe("is:open language:ts");
  });
});

describe("tokenizeSearch / serializeSearch（正反向解析核心）", () => {
  it("正向：自由文本 + token 列表分离", () => {
    const p = tokenizeSearch("hello is:open label:bug");
    expect(p.freeText).toBe("hello");
    expect(p.tokens.map((t) => `${t.key}=${t.value}`)).toEqual(["is=open", "label=bug"]);
  });

  it("正向：否定 -qualifier 标记 negated", () => {
    const p = tokenizeSearch("-label:bug -author:alice");
    expect(p.tokens).toEqual([
      { key: "label", negated: true, op: "", value: "bug", raw: "-label:bug" },
      { key: "author", negated: true, op: "", value: "alice", raw: "-author:alice" },
    ]);
  });

  it("正向：比较符 op 提取", () => {
    const p = tokenizeSearch("comments:>10 stars:>=5");
    expect(p.tokens.map((t) => [t.key, t.op, t.value])).toEqual([
      ["comments", ">", "10"],
      ["stars", ">=", "5"],
    ]);
  });

  it("反向：serializeSearch 保序重建", () => {
    const p = tokenizeSearch("bug -label:wontfix author:alice");
    expect(serializeSearch(p)).toBe("bug -label:wontfix author:alice");
  });

  it("反向：serializeSearch 注入隐含限定", () => {
    const p = tokenizeSearch("bug");
    expect(serializeSearch(p, { inject: ["repo:o/r", "is:pr", "is:open"] })).toBe(
      "bug repo:o/r is:pr is:open",
    );
  });

  it("往返一致性：parse → serialize 无注入时稳定", () => {
    const raw = 'fix label:"ui fix" -label:wontfix author:me comments:>3';
    expect(serializeSearch(tokenizeSearch(raw))).toBe(raw);
  });
});

describe("否定 -qualifier 与缺失元数据 no:", () => {
  it("parseSearchSyntax：-label:bug 进 negated，不污染 labels", () => {
    const f = parseSearchSyntax("label:bug -label:wontfix");
    expect(f.labels).toEqual(["bug"]);
    expect(f.negated).toEqual([{ key: "label", value: "wontfix" }]);
  });

  it("parseSearchSyntax：no:label 进 missing", () => {
    const f = parseSearchSyntax("no:label no:assignee");
    expect(f.missing).toEqual(["label", "assignee"]);
  });

  it("buildSearchQuery：否定与 no: 原样输出", () => {
    const q = buildSearchQuery("-label:wontfix no:assignee", { type: "issue", repo: "o/r" });
    expect(q).toContain("-label:wontfix");
    expect(q).toContain("no:assignee");
  });

  it("matchSearch：-label 排除语义", () => {
    const base = { title: "x", labels: ["bug", "ui"], state: "OPEN" };
    expect(matchSearch("-label:wontfix", base)).toBe(true);
    expect(matchSearch("-label:bug", base)).toBe(false);
  });

  it("matchSearch：no:label 排除有标签项", () => {
    expect(matchSearch("no:label", { title: "x", labels: [], state: "OPEN" })).toBe(true);
    expect(matchSearch("no:label", { title: "x", labels: ["bug"], state: "OPEN" })).toBe(false);
  });
});
