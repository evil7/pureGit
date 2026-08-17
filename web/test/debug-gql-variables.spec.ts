/**
 * ============================================================================
 * debug-gql-variables.ts 单元测试 —— GraphQL 变量三件套质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * `/$debug` GraphQL Variables 面板的纯函数质量门：collectVariables（提取变量定义）、
 * buildVariablesJson（JSON 骨架）、parseVariablesJson（JSON 语法）、validateVariables
 * （双向校验：缺失/多余/类型/枚举/input 结构）。
 *
 * 【业务基线（2026-08-11 M2 定稿，勿改）】
 * 1. collectVariables：遍历全部 OperationDefinition（切 operation 不丢变量）；
 *    语法错误 → null；非输入类型跳过
 * 2. buildVariablesJson：标量/枚举 → ""；input → 递归字段骨架（schema 默认值优先）；
 *    列表 → []
 * 3. parseVariablesJson：空文本 → 合法空对象；非法 JSON → { ok:false }
 * 4. validateVariables：可选变量缺失不报错（GraphQL 规范允许省略）；
 *    必填缺失/多余/类型不匹配/枚举非法/input 缺必填字段/多余字段 均报错
 *
 * 【期望行为与用例对照】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                          │ 用例（it 标题）        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. collectVariables：                             │ 提取变量定义           │
 * │    - 提取 name/typeLabel/required/type            │ 必填标记 NON_NULL      │
 * │    - 遍历全部 operation（query+mutation）          │ 多 operation 全收集    │
 * │    - 语法错误 → null；空文本 → []                  │ 语法错误 / 空文本      │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. buildVariablesJson：                           │ 标量 → ""              │
 * │    - 标量/枚举 → ""；列表 → []                     │ 列表 → []              │
 * │    - input 递归字段骨架（含嵌套 input/默认值）      │ input 嵌套骨架         │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. parseVariablesJson：                           │ 合法 JSON              │
 * │    - 合法 → ok:true；非法 → ok:false              │ 非法 JSON              │
 * │    - 空文本 → 空对象                               │ 空文本                 │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. validateVariables：                            │ 全通过                 │
 * │    - 缺失：仅必填缺失报错；可选缺失不报             │ 缺失必填 / 可选豁免     │
 * │    - 多余：JSON 有 query 未声明 → extra            │ 多余变量               │
 * │    - 标量类型：String/Int/Boolean 不匹配           │ 标量类型不匹配         │
 * │    - 枚举非法值                                    │ 枚举非法值             │
 * │    - input：缺必填字段/多余字段/字段类型            │ input 结构校验         │
 * │    - 列表元素递归校验                              │ 列表元素校验           │
 * │    - 空 JSON 非对象 → 视为 {}                      │ 非对象 JSON 兜底       │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from "vitest";
import { buildClientSchema, type GraphQLSchema } from "graphql";
import {
  collectVariables,
  buildVariablesJson,
  parseVariablesJson,
  validateVariables,
  validateVariablesText,
} from "@/lib/debug/debug-gql-variables";

/* ── mini schema 夹具（标量 + 枚举 + input 嵌套） ── */

function miniIntrospection(): unknown {
  const S = (name: string) => ({ kind: "SCALAR", name });
  const NN = (ofType: unknown) => ({ kind: "NON_NULL", ofType });
  const L = (ofType: unknown) => ({ kind: "LIST", ofType });
  return {
    __schema: {
      queryType: { name: "Query" },
      mutationType: { name: "Mutation" },
      subscriptionType: null,
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            { name: "viewer", args: [], type: NN({ kind: "OBJECT", name: "User" }) },
            {
              name: "search",
              args: [
                { name: "query", type: NN(S("String")) },
                { name: "type", type: NN({ kind: "ENUM", name: "SearchType" }) },
                { name: "first", type: S("Int") },
              ],
              type: NN({ kind: "OBJECT", name: "SearchConnection" }),
            },
          ],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "User",
          fields: [
            { name: "id", args: [], type: NN(S("ID")) },
            { name: "login", args: [], type: NN(S("String")) },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
        },
        {
          kind: "OBJECT",
          name: "SearchConnection",
          fields: [
            { name: "totalCount", args: [], type: NN(S("Int")) },
            { name: "edges", args: [], type: NN(L({ kind: "OBJECT", name: "SearchEdge" })) },
          ],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "SearchEdge",
          fields: [{ name: "node", args: [], type: { kind: "OBJECT", name: "User" } }],
          interfaces: [],
        },
        {
          kind: "INTERFACE",
          name: "Node",
          fields: [{ name: "id", args: [], type: NN(S("ID")) }],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "Mutation",
          fields: [
            {
              name: "addReaction",
              args: [
                { name: "input", type: NN({ kind: "INPUT_OBJECT", name: "AddReactionInput" }) },
              ],
              type: { kind: "OBJECT", name: "AddReactionPayload" },
            },
          ],
          interfaces: [],
        },
        {
          kind: "INPUT_OBJECT",
          name: "AddReactionInput",
          inputFields: [
            { name: "subjectId", type: NN(S("ID")) },
            { name: "content", type: NN({ kind: "ENUM", name: "ReactionContent" }) },
            { name: "note", type: S("String") },
          ],
        },
        {
          kind: "OBJECT",
          name: "AddReactionPayload",
          fields: [{ name: "clientMutationId", args: [], type: S("String") }],
          interfaces: [],
        },
        {
          kind: "ENUM",
          name: "ReactionContent",
          enumValues: [
            { name: "THUMBS_UP", isDeprecated: false },
            { name: "THUMBS_DOWN", isDeprecated: false },
          ],
        },
        {
          kind: "ENUM",
          name: "SearchType",
          enumValues: [
            { name: "REPOSITORY", isDeprecated: false },
            { name: "CODE", isDeprecated: false },
            { name: "ISSUE", isDeprecated: false },
          ],
        },
        { kind: "SCALAR", name: "URI", specifiedByURL: null },
        { kind: "SCALAR", name: "String", specifiedByURL: null },
        { kind: "SCALAR", name: "Int", specifiedByURL: null },
        { kind: "SCALAR", name: "Float", specifiedByURL: null },
        { kind: "SCALAR", name: "Boolean", specifiedByURL: null },
        { kind: "SCALAR", name: "ID", specifiedByURL: null },
      ],
      directives: [],
    },
  };
}

let cachedSchema: GraphQLSchema | null = null;
function schema(): GraphQLSchema {
  if (!cachedSchema) cachedSchema = buildClientSchema(miniIntrospection() as never);
  return cachedSchema;
}

/* ═══ 1. collectVariables ═══ */

describe("collectVariables：提取变量定义", () => {
  it("提取 name/typeLabel/required/type（String!/SearchType!/Int）", () => {
    const defs = collectVariables(
      "query($query: String!, $type: SearchType!, $first: Int) { search(query: $query, type: $type, first: $first) { totalCount } }",
      schema(),
    );
    expect(defs).not.toBeNull();
    expect(
      defs!.map((d) => ({ name: d.name, typeLabel: d.typeLabel, required: d.required })),
    ).toEqual([
      { name: "query", typeLabel: "String!", required: true },
      { name: "type", typeLabel: "SearchType!", required: true },
      { name: "first", typeLabel: "Int", required: false },
    ]);
    // type 为解析后的输入类型（枚举/标量）
    expect(defs![1].type.toString()).toBe("SearchType!");
  });

  it("必填标记（NON_NULL）正确识别", () => {
    const defs = collectVariables(
      "query($a: String!, $b: String, $c: [Int!]!) { viewer { id } }",
      schema(),
    );
    expect(defs!.map((d) => d.required)).toEqual([true, false, true]);
    expect(defs![2].typeLabel).toBe("[Int!]!");
  });

  it("多 operation（query+mutation）全部收集", () => {
    const defs = collectVariables(
      "query($q: String!) { search(query: $q) { totalCount } } mutation($input: AddReactionInput!) { addReaction(input: $input) { clientMutationId } }",
      schema(),
    );
    expect(defs!.map((d) => d.name)).toEqual(["q", "input"]);
    expect(defs![1].typeLabel).toBe("AddReactionInput!");
  });

  it("语法错误 → null", () => {
    expect(collectVariables("query($a: String! { viewer {", schema())).toBeNull();
  });

  it("空文本 → []", () => {
    expect(collectVariables("", schema())).toEqual([]);
    expect(collectVariables("   ", schema())).toEqual([]);
  });

  it("无变量定义 → []", () => {
    expect(collectVariables("{ viewer { id } }", schema())).toEqual([]);
  });
});

/* ═══ 2. buildVariablesJson ═══ */

describe("buildVariablesJson：JSON 骨架生成", () => {
  it("标量 → 空字符串；列表 → 空数组", () => {
    const defs = collectVariables(
      "query($a: String!, $b: Int, $c: [String!]!) { viewer { id } }",
      schema(),
    )!;
    expect(buildVariablesJson(defs)).toEqual({ a: "", b: "", c: [] });
  });

  it("input 递归字段骨架（含嵌套 input 与默认值）", () => {
    const defs = collectVariables(
      "mutation($input: AddReactionInput!) { addReaction(input: $input) { clientMutationId } }",
      schema(),
    )!;
    // subjectId/content 必填无默认 → ""；note 可选 → ""
    expect(buildVariablesJson(defs)).toEqual({ input: { subjectId: "", content: "", note: "" } });
  });

  it("枚举变量 → 空字符串", () => {
    const defs = collectVariables(
      "query($type: SearchType!) { search(type: $type) { totalCount } }",
      schema(),
    )!;
    expect(buildVariablesJson(defs)).toEqual({ type: "" });
  });
});

/* ═══ 3. parseVariablesJson ═══ */

describe("parseVariablesJson：JSON 解析", () => {
  it("合法 JSON → ok:true + 值", () => {
    const r = parseVariablesJson('{ "a": "x", "b": 1 }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: "x", b: 1 });
  });

  it("非法 JSON → ok:false + 错误信息", () => {
    const r = parseVariablesJson('{ "a": ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("空文本 → 合法空对象", () => {
    const r = parseVariablesJson("  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
});

/* ═══ 4. validateVariables ═══ */

describe("validateVariables：双向校验", () => {
  const queryStr =
    "query($query: String!, $type: SearchType!, $first: Int, $input: AddReactionInput!) { search(query: $query, type: $type, first: $first) { totalCount } }";
  const defs = () => collectVariables(queryStr, schema())!;

  it("全通过：值类型正确 + input 结构完整 → 无错误", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "REPOSITORY",
      first: 10,
      input: { subjectId: "x", content: "THUMBS_UP" },
    });
    expect(errors).toEqual([]);
  });

  it("缺失：必填变量缺失报 missing（可选缺失豁免）", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "REPOSITORY",
      // first 可选缺省 → 不报；input 必填缺失 → 报
    });
    expect(errors).toEqual([
      { key: "input", kind: "missing", message: "缺少必填变量 $input (AddReactionInput!)" },
    ]);
  });

  it("多余：JSON 提供 query 未声明的变量 → extra", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "REPOSITORY",
      input: { subjectId: "x", content: "THUMBS_UP" },
      ghost: "extra",
    });
    expect(errors).toEqual([
      { key: "ghost", kind: "extra", message: "变量 $ghost 未在查询中声明" },
    ]);
  });

  it("标量类型不匹配：String 给数字 / Int 给字符串 / Boolean 给字符串", () => {
    const defs2 = collectVariables(
      "query($s: String!, $i: Int!, $b: Boolean!) { viewer { id } }",
      schema(),
    )!;
    const errors = validateVariables(defs2, { s: 123, i: "10", b: "yes" });
    expect(errors.map((e) => [e.key, e.kind])).toEqual([
      ["s", "type-mismatch"],
      ["i", "type-mismatch"],
      ["b", "type-mismatch"],
    ]);
  });

  it("枚举非法值 → type-mismatch（含合法值提示）", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "NOT_A_TYPE",
      input: { subjectId: "x", content: "THUMBS_UP" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe("type");
    expect(errors[0].message).toContain("REPOSITORY");
    expect(errors[0].message).toContain("CODE");
  });

  it("input 结构：缺必填字段 / 多余字段 / 字段类型不匹配", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "REPOSITORY",
      input: {
        // 缺 subjectId（必填）
        content: "THUMBS_UP",
        ghostField: "x", // 多余字段
        note: 123, // note 应为 String
      },
    });
    const byKey = Object.fromEntries(errors.map((e) => [e.key, e.kind]));
    expect(byKey["input.subjectId"]).toBe("missing");
    expect(byKey["input.ghostField"]).toBe("extra");
    expect(byKey["input.note"]).toBe("type-mismatch");
  });

  it("input 内容枚举非法 → type-mismatch", () => {
    const errors = validateVariables(defs(), {
      query: "react",
      type: "REPOSITORY",
      input: { subjectId: "x", content: "NOPE" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe("input.content");
    expect(errors[0].message).toContain("THUMBS_UP");
  });

  it("列表元素递归校验（[String!]! 元素非字符串报错）", () => {
    const defs2 = collectVariables("query($tags: [String!]!) { viewer { id } }", schema())!;
    const errors = validateVariables(defs2, { tags: ["a", 1, true] });
    expect(errors.map((e) => e.message)).toEqual([
      "$tags[1] 应为字符串（String）",
      "$tags[2] 应为字符串（String）",
    ]);
  });

  it("非对象 JSON（数组/标量）兜底为 {} → 必填全部报缺失", () => {
    const errors = validateVariables(defs(), [1, 2, 3]);
    expect(errors.filter((e) => e.kind === "missing").length).toBe(3); // query/type/input
    expect(errors.filter((e) => e.kind === "extra")).toEqual([]);
  });

  it("无变量（defs 空）→ 任意 JSON 视为多余全部报错", () => {
    const errors = validateVariables([], { a: 1 });
    expect(errors).toEqual([{ key: "a", kind: "extra", message: "变量 $a 未在查询中声明" }]);
  });
});

/* ═══ 5. validateVariablesText：文本级实时校验（tab 徽标数据源） ═══ */

describe("validateVariablesText：query+variables 文本 → 错误列表（tab 徽标实时计算）", () => {
  const queryStr =
    "query($query: String!, $type: SearchType!, $input: AddReactionInput!) { search(query: $query, type: $type) { totalCount } }";

  it("schema 未就绪 → null（不报数）", () => {
    expect(validateVariablesText(queryStr, "{}", null)).toBeNull();
  });

  it("query 语法错误 → null（不报数，UI 提示语法错误）", () => {
    expect(validateVariablesText("query { viewer {", "{}", schema())).toBeNull();
  });

  it("变量 JSON 语法错误 → 1 条错误（JSON 语法）", () => {
    const errors = validateVariablesText(queryStr, '{ "query": ', schema());
    expect(errors).toHaveLength(1);
    expect(errors![0].kind).toBe("type-mismatch");
  });

  it("缺必填变量 → 报 missing（与 validateVariables 同源）", () => {
    const errors = validateVariablesText(queryStr, "{}", schema());
    expect(errors?.map((e) => e.kind)).toContain("missing");
    expect(errors!.length).toBeGreaterThan(0);
  });

  it("全通过（含 input 结构完整）→ []", () => {
    const errors = validateVariablesText(
      queryStr,
      JSON.stringify({
        query: "react",
        type: "REPOSITORY",
        input: { subjectId: "x", content: "THUMBS_UP" },
      }),
      schema(),
    );
    expect(errors).toEqual([]);
  });

  it("空 variables 文本 → 按空对象校验（缺必填报错）", () => {
    const errors = validateVariablesText(queryStr, "", schema());
    expect(errors?.some((e) => e.kind === "missing")).toBe(true);
  });
});
