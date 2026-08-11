/**
 * ============================================================================
 * debug-gql-structured.ts 单元测试 —— M5.5 StructuredTable 结构模型/序列化质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * M5.5：StructuredTable 复合数组编辑器（debug-graphql-redesign.md §0.3 自研方案，
 * 仅服务 GraphQL variables）——input/列表变量由「JSON 字面量手写」改为
 * **结构驱动递归表格**。本文件覆盖 lib/debug-gql-structured.ts 三个纯函数：
 * - `inputTypeToStructured`：GraphQLInputType → StructuredField 递归模型
 * - `buildStructuredValue`：字段 → 骨架值
 * - `structuredRowsToJson` / `structuredRowToJson` / `jsonToStructuredRows`：双向递归序列化
 *
 * 【业务基线（2026-08-11 M5.5 定稿，勿改）】
 * 1. **kind 五分类**：scalar / enum / boolean（Boolean 标量单独 kind，UI 下拉）/
 *    input / list——NON_NULL 剥壳 → required；input 展开 fields、list 收 element
 * 2. **骨架值**：scalar/enum → ""、boolean → false、input → 递归对象（schema 默认值优先）、
 *    list → []（对齐 buildVariablesJson 语义）
 * 3. **序列化**：空值跳过（undefined 不输出）、Int/Float 转 Number、boolean 转 true/false、
 *    input 递归对象、list 逐项；转换失败（非数字）→ { ok: false }（UI 红框）
 * 4. **反向**：input 缺字段补骨架行、多余字段保留自定义行；list 逐项重建（元素 input →
 *    children 子表格、标量 → 单项行）；number/boolean → 文本（String()）
 * 5. **行模型**：value 文本 + enabled；input → children 嵌套行；list → items 数组项
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                            │ 用例（it 标题）        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. inputTypeToStructured：                          │ 标量/必填剥壳         │
 * │    - NON_NULL 剥壳 → required=true                  │ enum → 枚举值         │
 * │    - scalar/enum/boolean 分类                        │ Boolean 单独 kind     │
 * │    - input 递归展开 fields（含嵌套/默认值）          │ input 递归字段        │
 * │    - list 收 element（含 list of input / 嵌套 list） │ list 元素 / 嵌套      │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. buildStructuredValue：                            │ input 递归骨架        │
 * │    - scalar/enum → ""、boolean → false、list → []    │ 标量/布尔/列表        │
 * │    - input → 递归对象；schema 默认值优先             │ 默认值优先            │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. structuredRowToJson / structuredRowsToJson：      │ 标量行 → JSON        │
 * │    - enabled 关 / 空值跳过                           │ 关闭/空值跳过         │
 * │    - Int/Float 转 Number（非数字 → ok:false）        │ 数字转换/错误         │
 * │    - boolean 按文本转 true/false                     │ 布尔转换              │
 * │    - input 递归对象                                  │ input 嵌套对象        │
 * │    - list 逐项（标量元素 / input 元素）              │ 列表序列化            │
 * │    - 顶层空名跳过                                    │ 顶层 rowsToJson       │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. jsonToStructuredRows（反向）：                    │ input 缺字段补行      │
 * │    - input 缺字段补骨架行 / 多余字段自定义行         │ 多余字段保留          │
 * │    - 标量值 → 文本（number/boolean → String()）      │ 标量反序列化          │
 * │    - list 逐项重建（input 元素 → children）          │ 列表反序列化          │
 * │    - 非对象值 → 空行（防御）                         │ 防御                  │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 5. 端到端收敛（正反循环稳定）：                      │ 标量 + input + list   │
 * │    JSON → jsonToStructuredRows → structuredRowsToJson│ 默认值/嵌套/空值      │
 * │    = 原 JSON（非空字段保真）                         │ 全字段收敛            │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from "vitest";
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
} from "graphql";
import {
  buildStructuredValue,
  inputTypeToStructured,
  jsonToStructuredRows,
  structuredRowToJson,
  structuredRowsToJson,
  type StructuredField,
  type StructuredRow,
} from "@/lib/debug-gql-structured";

/* ── 类型夹具：用 graphql-js 运行时类型直接构造（嵌套 input / 枚举 / 列表全覆盖） ── */

const ReactionContent = new GraphQLEnumType({
  name: "ReactionContent",
  values: { THUMBS_UP: {}, THUMBS_DOWN: {} },
});

/** 嵌套 input：labels 列表（元素为 input）+ 内部嵌套 input */
const LabelInput = new GraphQLInputObjectType({
  name: "LabelInput",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    color: { type: GraphQLString, defaultValue: "#ffffff" },
  },
});

/** 顶层 input：标量/枚举/布尔/列表/嵌套 input 全覆盖 */
const CreateIssueInput = new GraphQLInputObjectType({
  name: "CreateIssueInput",
  fields: {
    title: { type: new GraphQLNonNull(GraphQLString) },
    body: { type: GraphQLString },
    count: { type: GraphQLInt },
    flag: { type: GraphQLBoolean },
    reaction: { type: ReactionContent },
    labels: { type: new GraphQLList(new GraphQLNonNull(LabelInput)) },
    meta: { type: LabelInput },
  },
});

/** 便捷：顶层 input 类型 → 带 name 的 StructuredField */
function topField(name: string, type: unknown): StructuredField {
  return { ...inputTypeToStructured(type as never), name };
}

/** 便捷：构造 input 行（children 已填充） */
function inputRow(field: StructuredField, children: StructuredRow[]): StructuredRow {
  return { field, value: "", enabled: true, children, items: [] };
}

describe("inputTypeToStructured", () => {
  it("标量：NON_NULL 剥壳 → required=true；scalarName=String", () => {
    const f = inputTypeToStructured(new GraphQLNonNull(GraphQLString));
    expect(f.kind).toBe("scalar");
    expect(f.required).toBe(true);
    expect(f.scalarName).toBe("String");
    expect(f.typeLabel).toBe("String!");
  });

  it("可选标量 → required=false", () => {
    const f = inputTypeToStructured(GraphQLString);
    expect(f.kind).toBe("scalar");
    expect(f.required).toBe(false);
    expect(f.typeLabel).toBe("String");
  });

  it("enum → enumValues 列表", () => {
    const f = inputTypeToStructured(new GraphQLNonNull(ReactionContent));
    expect(f.kind).toBe("enum");
    expect(f.required).toBe(true);
    expect(f.enumValues).toEqual(["THUMBS_UP", "THUMBS_DOWN"]);
  });

  it("Boolean 标量 → kind=boolean（UI 下拉语义）", () => {
    const f = inputTypeToStructured(GraphQLBoolean);
    expect(f.kind).toBe("boolean");
    expect(f.typeLabel).toBe("Boolean");
  });

  it("input → fields 递归展开（含默认值/枚举/标量）", () => {
    const f = inputTypeToStructured(new GraphQLNonNull(CreateIssueInput));
    expect(f.kind).toBe("input");
    expect(f.required).toBe(true);
    expect(f.typeLabel).toBe("CreateIssueInput!");
    const names = f.fields.map((x) => x.name);
    expect(names).toEqual(["title", "body", "count", "flag", "reaction", "labels", "meta"]);
    // 默认值保留
    const label = f.fields.find((x) => x.name === "meta")!;
    expect(label.kind).toBe("input");
    expect(label.fields.find((x) => x.name === "color")?.defaultValue).toBe("#ffffff");
    // 枚举字段
    const reaction = f.fields.find((x) => x.name === "reaction")!;
    expect(reaction.kind).toBe("enum");
    // 列表字段
    const labels = f.fields.find((x) => x.name === "labels")!;
    expect(labels.kind).toBe("list");
  });

  it("input 必填字段排最上（稳定排序：必填前、可选后保持 schema 顺序）", () => {
    // 混合夹具：a/b 必填 + c 可选 + d 必填 + e 可选（schema 定义序）
    const MixedInput = new GraphQLInputObjectType({
      name: "MixedInput",
      fields: {
        a: { type: new GraphQLNonNull(GraphQLString) },
        b: { type: new GraphQLNonNull(GraphQLString) },
        c: { type: GraphQLString },
        d: { type: new GraphQLNonNull(GraphQLString) },
        e: { type: GraphQLString },
      },
    });
    const f = inputTypeToStructured(MixedInput);
    const names = f.fields.map((x) => x.name);
    // 必填 a/b/d 在前（相对序保持），可选 c/e 在后
    expect(names).toEqual(["a", "b", "d", "c", "e"]);
    // 必填标记正确
    expect(f.fields.map((x) => x.required)).toEqual([true, true, true, false, false]);
  });

  it("list → element 收元素（list of input 展开 element.fields）", () => {
    const f = inputTypeToStructured(new GraphQLList(new GraphQLNonNull(LabelInput)));
    expect(f.kind).toBe("list");
    expect(f.element?.kind).toBe("input");
    expect(f.element?.required).toBe(true);
    expect(f.element?.fields.map((x) => x.name)).toEqual(["name", "color"]);
  });

  it("嵌套 list（list of list of scalar）→ element 递归", () => {
    const f = inputTypeToStructured(new GraphQLList(new GraphQLList(GraphQLString)));
    expect(f.kind).toBe("list");
    expect(f.element?.kind).toBe("list");
    expect(f.element?.element?.kind).toBe("scalar");
    expect(f.element?.element?.scalarName).toBe("String");
  });
});

describe("buildStructuredValue", () => {
  it("标量/枚举 → ''、boolean → false、list → []", () => {
    expect(buildStructuredValue(inputTypeToStructured(GraphQLString))).toBe("");
    expect(buildStructuredValue(inputTypeToStructured(ReactionContent))).toBe("");
    expect(buildStructuredValue(inputTypeToStructured(GraphQLBoolean))).toBe(false);
    expect(buildStructuredValue(inputTypeToStructured(new GraphQLList(GraphQLString)))).toEqual([]);
  });

  it("input → 递归骨架对象（默认值优先）", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const v = buildStructuredValue(f) as Record<string, unknown>;
    expect(v.title).toBe("");
    expect(v.count).toBe("");
    expect(v.flag).toBe(false);
    expect(v.labels).toEqual([]);
    // meta 是 input → 嵌套对象；color 有默认值 #ffffff
    expect(v.meta).toEqual({ name: "", color: "#ffffff" });
  });
});

describe("structuredRowToJson / structuredRowsToJson", () => {
  it("标量行 → JSON 值（空值 → undefined 跳过）", () => {
    const f = topField("title", new GraphQLNonNull(GraphQLString));
    const row: StructuredRow = { field: f, value: "hello", enabled: true, children: [], items: [] };
    expect(structuredRowToJson(row)).toEqual({ ok: true, value: "hello" });
    const empty: StructuredRow = { field: f, value: "  ", enabled: true, children: [], items: [] };
    expect(structuredRowToJson(empty)).toEqual({ ok: true, value: undefined });
  });

  it("enabled=false / 空名 → 顶层跳过", () => {
    const f = topField("title", GraphQLString);
    const off: StructuredRow = { field: f, value: "x", enabled: false, children: [], items: [] };
    const noName: StructuredRow = {
      field: { ...f, name: " " },
      value: "x",
      enabled: true,
      children: [],
      items: [],
    };
    expect(structuredRowsToJson([off, noName])).toEqual({});
  });

  it("Int/Float 转 Number；非数字 → ok:false", () => {
    const f = topField("count", GraphQLInt);
    const ok: StructuredRow = { field: f, value: "42", enabled: true, children: [], items: [] };
    expect(structuredRowToJson(ok)).toEqual({ ok: true, value: 42 });
    const bad: StructuredRow = { field: f, value: "abc", enabled: true, children: [], items: [] };
    expect(structuredRowToJson(bad)).toEqual({ ok: false });
  });

  it("boolean 按文本转 true/false", () => {
    const f = topField("flag", GraphQLBoolean);
    const t: StructuredRow = { field: f, value: "true", enabled: true, children: [], items: [] };
    const fl: StructuredRow = { field: f, value: "false", enabled: true, children: [], items: [] };
    expect(structuredRowToJson(t)).toEqual({ ok: true, value: true });
    expect(structuredRowToJson(fl)).toEqual({ ok: true, value: false });
  });

  it("input → 递归嵌套对象（子行空值跳过）", () => {
    const f = topField("meta", LabelInput);
    const row = inputRow(f, [
      {
        field: topField("name", new GraphQLNonNull(GraphQLString)),
        value: "bug",
        enabled: true,
        children: [],
        items: [],
      },
      {
        field: topField("color", GraphQLString),
        value: "",
        enabled: true,
        children: [],
        items: [],
      },
    ]);
    expect(structuredRowToJson(row)).toEqual({ ok: true, value: { name: "bug" } });
  });

  it("list 标量元素 → 数组（逐项值）", () => {
    const f = topField("tags", new GraphQLList(GraphQLString));
    const row: StructuredRow = {
      field: f,
      value: "",
      enabled: true,
      children: [],
      items: [
        [{ field: f.element!, value: "a", enabled: true, children: [], items: [] }],
        [{ field: f.element!, value: "b", enabled: true, children: [], items: [] }],
      ],
    };
    expect(structuredRowToJson(row)).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("list input 元素 → 数组对象（每项用 children 子表格）", () => {
    const f = topField("labels", new GraphQLList(new GraphQLNonNull(LabelInput)));
    const row: StructuredRow = {
      field: f,
      value: "",
      enabled: true,
      children: [],
      items: [
        inputRow(f.element!, [
          {
            field: topField("name", new GraphQLNonNull(GraphQLString)),
            value: "bug",
            enabled: true,
            children: [],
            items: [],
          },
        ]).children,
      ],
    };
    expect(structuredRowToJson(row)).toEqual({ ok: true, value: [{ name: "bug" }] });
  });

  it("顶层 rowsToJson：混合多行组装", () => {
    const rows: StructuredRow[] = [
      {
        field: topField("title", new GraphQLNonNull(GraphQLString)),
        value: "t",
        enabled: true,
        children: [],
        items: [],
      },
      { field: topField("count", GraphQLInt), value: "3", enabled: true, children: [], items: [] },
      {
        field: topField("flag", GraphQLBoolean),
        value: "true",
        enabled: true,
        children: [],
        items: [],
      },
      {
        field: topField("skip", GraphQLString),
        value: "x",
        enabled: false,
        children: [],
        items: [],
      },
    ];
    expect(structuredRowsToJson(rows)).toEqual({ title: "t", count: 3, flag: true });
  });
});

describe("jsonToStructuredRows（反向）", () => {
  it("input 缺字段 → 补骨架行；多余字段 → 自定义行保留", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, { title: "t", extra: 5 });
    const names = row.children.map((c) => c.field.name);
    // 全部 schema 字段 + 多余字段
    expect(names).toContain("title");
    expect(names).toContain("body");
    expect(names).toContain("labels");
    expect(names).toContain("meta");
    expect(names).toContain("extra");
    const title = row.children.find((c) => c.field.name === "title")!;
    expect(title.value).toBe("t");
    const extra = row.children.find((c) => c.field.name === "extra")!;
    expect(extra.value).toBe("5");
  });

  it("标量值 → 文本（number → String、boolean → String）", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, { count: 7, flag: true });
    const count = row.children.find((c) => c.field.name === "count")!;
    expect(count.value).toBe("7");
    const flag = row.children.find((c) => c.field.name === "flag")!;
    expect(flag.value).toBe("true");
  });

  it("list 逐项重建（input 元素 → children 子表格）", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, {
      labels: [{ name: "bug", color: "#f00" }, { name: "docs" }],
    });
    const labels = row.children.find((c) => c.field.name === "labels")!;
    expect(labels.items).toHaveLength(2);
    // 每项是元素 input 的 children 行数组
    const first = labels.items[0];
    expect(first.find((c) => c.field.name === "name")?.value).toBe("bug");
    expect(first.find((c) => c.field.name === "color")?.value).toBe("#f00");
    // 第二项缺 color → 空骨架行（忠实还原：不填默认值，默认值由 placeholder 承载）
    expect(labels.items[1].find((c) => c.field.name === "color")?.value).toBe("");
  });

  it("非对象值 → 空行（防御）", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, "oops" as unknown);
    expect(row.field.kind).toBe("input");
    expect(row.children.length).toBeGreaterThan(0);
  });
});

describe("端到端收敛（JSON → 行 → JSON 保真）", () => {
  it("完整字段收敛：非空值全部保留", () => {
    const src = {
      title: "Fix bug",
      body: "desc",
      count: 42,
      flag: true,
      reaction: "THUMBS_UP",
      labels: [{ name: "bug", color: "#f00" }, { name: "docs" }],
      meta: { name: "m", color: "#0f0" },
    };
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, src);
    const out = structuredRowToJson(row);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual(src);
  });

  it("嵌套 list 收敛（list of list）", () => {
    const f = inputTypeToStructured(new GraphQLList(new GraphQLList(GraphQLString)));
    const row = jsonToStructuredRows(f, [["a", "b"], ["c"]]);
    // 外层 items 2 项，每项内层 items
    expect(row.items).toHaveLength(2);
    const inner = row.items[0];
    expect(inner[0].items).toHaveLength(2);
    expect(inner[0].items[0][0].value).toBe("a");
    const res = structuredRowToJson(row);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual([["a", "b"], ["c"]]);
  });

  it("空值跳过收敛：JSON 不含空串字段", () => {
    const f = inputTypeToStructured(CreateIssueInput);
    const row = jsonToStructuredRows(f, { title: "t", body: "", count: 0 });
    const out = structuredRowToJson(row);
    expect(out.ok).toBe(true);
    // body 空串跳过；count 0 保留（数字 0 非空）
    if (out.ok) expect(out.value).toEqual({ title: "t", count: 0 });
  });
});
