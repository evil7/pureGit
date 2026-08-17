/**
 * debug-rest-structured.spec.ts —— R2：OpenAPI deref schema → StructuredField 映射 + 双向收敛
 *
 * 任务：结构化编辑泛化到 REST body——bodySchema（OpenAPI deref，无 $ref）→ StructuredField，
 * 复用 GraphQL M5.5 的 jsonToStructuredRows / structuredRowToJson / StructuredTable。
 * 本文件验证**映射层**（openApiSchemaToStructured）+ **端到端收敛**（schema → 行 → JSON → 行）。
 *
 * 期望行为 × 用例对照：
 * │ 用例                                          │ 目的                          │
 * │ 1. object：properties + required 必填排最上   │ input 模型 + 必填排序（三修正） │
 * │ 2. array：items 递归 element + typeLabel      │ list 模型 + 嵌套展示          │
 * │ 3. string+enum / boolean / integer / number   │ enum/boolean/scalar 映射      │
 * │ 4. oneOf/anyOf 取首个分支 / allOf 合并        │ 分支防御                      │
 * │ 5. 无 type 有 properties → object（隐含）     │ OpenAPI 省略 type 兜底        │
 * │ 6. 端到端收敛：schema → 骨架 → 序列化         │ 与结构化序列化层配合          │
 * └──────────────────────────────────────────────┴───────────────────────────────┘
 *
 * 修改注意事项：映射层改动（新增分支/type 解析）必须保持「必填排最上」与「收敛保真」基线。
 */
import { describe, it, expect } from "vitest";
import { openApiSchemaToStructured } from "@/lib/debug/debug-rest-structured";
import {
  buildStructuredValue,
  jsonToStructuredRows,
  structuredRowToJson,
} from "@/lib/debug/debug-gql-structured";

describe("openApiSchemaToStructured：object → input", () => {
  it("properties 递归展开 + required 必填排最上（保持 schema 顺序）", () => {
    const f = openApiSchemaToStructured({
      type: "object",
      properties: {
        a: { type: "string", description: "字段 a" },
        b: { type: "integer", description: "字段 b" },
        c: { type: "boolean" },
      },
      required: ["c"],
    });
    expect(f.kind).toBe("input");
    expect(f.typeLabel).toBe("object");
    // 必填 c 排最上；a/b 保持 schema 顺序
    expect(f.fields.map((x) => x.name)).toEqual(["c", "a", "b"]);
    expect(f.fields[0].required).toBe(true);
    expect(f.fields[1]).toMatchObject({ name: "a", kind: "scalar", scalarName: "String" });
    expect(f.fields[1].description).toBe("字段 a");
    expect(f.fields[2]).toMatchObject({ name: "b", kind: "scalar", scalarName: "Int" });
  });

  it("嵌套 object + list 递归任意深度", () => {
    const f = openApiSchemaToStructured({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "integer" }, name: { type: "string" } },
            required: ["id"],
          },
        },
      },
      required: ["items"],
    });
    const items = f.fields[0];
    expect(items).toMatchObject({
      name: "items",
      kind: "list",
      required: true,
      typeLabel: "array<object>",
    });
    expect(items.element?.kind).toBe("input");
    // 嵌套 object 的必填 id 排最上
    expect(items.element?.fields.map((x) => x.name)).toEqual(["id", "name"]);
  });
});

describe("openApiSchemaToStructured：标量 / 枚举 / 布尔", () => {
  it("string+enum → enum；boolean → boolean；integer/number → Int/Float；string → String", () => {
    expect(openApiSchemaToStructured({ type: "string", enum: ["asc", "desc"] })).toMatchObject({
      kind: "enum",
      enumValues: ["asc", "desc"],
      typeLabel: "enum",
    });
    expect(openApiSchemaToStructured({ type: "boolean" })).toMatchObject({
      kind: "boolean",
      typeLabel: "boolean",
    });
    expect(openApiSchemaToStructured({ type: "integer" })).toMatchObject({
      kind: "scalar",
      scalarName: "Int",
      typeLabel: "integer",
    });
    expect(openApiSchemaToStructured({ type: "number" })).toMatchObject({
      kind: "scalar",
      scalarName: "Float",
      typeLabel: "number",
    });
    expect(openApiSchemaToStructured({ type: "string" })).toMatchObject({
      kind: "scalar",
      scalarName: "String",
      typeLabel: "string",
    });
  });

  it("type 数组（含 null）→ 取首个非 null", () => {
    expect(openApiSchemaToStructured({ type: ["string", "null"] })).toMatchObject({
      kind: "scalar",
      scalarName: "String",
    });
  });

  it("default 透传（placeholder 用）", () => {
    expect(openApiSchemaToStructured({ type: "integer", default: 10 })).toMatchObject({
      defaultValue: 10,
    });
  });
});

describe("openApiSchemaToStructured：分支与隐含", () => {
  it("oneOf/anyOf 取首个含 type 的分支", () => {
    const f = openApiSchemaToStructured({
      oneOf: [{ type: "null" }, { type: "string" }, { type: "integer" }],
    });
    // 首个含 type 的分支是 {type:"string"}（null 被过滤）
    expect(f).toMatchObject({ kind: "scalar", scalarName: "String" });
  });

  it("allOf 合并 properties（required 并集）", () => {
    const f = openApiSchemaToStructured({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "integer" } }, required: ["b"] },
      ],
    });
    expect(f.kind).toBe("input");
    expect(f.fields.map((x) => x.name)).toEqual(["a", "b"]);
    expect(f.fields.every((x) => x.required)).toBe(true);
  });

  it("无 type 有 properties → 隐含 object", () => {
    const f = openApiSchemaToStructured({ properties: { name: { type: "string" } } });
    expect(f.kind).toBe("input");
    expect(f.fields.map((x) => x.name)).toEqual(["name"]);
  });
});

describe("端到端收敛（schema → 骨架 → 序列化 → 反向）", () => {
  it("填值往返保真（buildStructuredValue → 行 → JSON → 反向行）", () => {
    const field = openApiSchemaToStructured({
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignee: {
          type: "object",
          properties: { login: { type: "string" } },
        },
      },
      required: ["title"],
    });
    // 骨架值
    const skeleton = buildStructuredValue(field) as Record<string, unknown>;
    expect(Object.keys(skeleton)).toEqual(["title", "body", "labels", "assignee"]);
    expect(skeleton.labels).toEqual([]);
    // 骨架 → 行 → 填值 → 序列化
    const row = jsonToStructuredRows(field, skeleton);
    const set = (r: typeof row, path: string[], value: string) => {
      if (path.length === 0) return;
      r.children = r.children.map((c) => {
        if (c.field.name === path[0]) {
          if (path.length === 1) return { ...c, value };
          if (c.field.kind === "input") {
            set(c, path.slice(1), value);
          }
          return c;
        }
        return c;
      });
    };
    set(row, ["title"], "hello");
    set(row, ["assignee", "login"], "evil7");
    row.children = row.children.map((c) =>
      c.field.name === "labels"
        ? {
            ...c,
            items: [
              [{ field: c.field.element!, value: "bug", enabled: true, children: [], items: [] }],
            ],
          }
        : c,
    );
    const res = structuredRowToJson(row);
    if (!res.ok) throw new Error("序列化失败");
    expect(res.value).toEqual({
      title: "hello",
      assignee: { login: "evil7" },
      labels: ["bug"],
      // body 空值跳过
    });
    // 反向收敛：JSON → 行（值与序列化前一致）
    const back = jsonToStructuredRows(field, res.value);
    const find = (r: typeof back, name: string) => r.children.find((c) => c.field.name === name);
    expect(find(back, "title")?.value).toBe("hello");
    expect(find(back, "assignee")?.children.find((c) => c.field.name === "login")?.value).toBe(
      "evil7",
    );
    expect(find(back, "labels")?.items).toHaveLength(1);
    expect(find(back, "labels")?.items[0][0].value).toBe("bug");
  });
});
