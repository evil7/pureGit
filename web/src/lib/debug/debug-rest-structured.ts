/**
 * REST body 结构化纯函数（R2：结构化编辑泛化到 REST body）
 *
 * 复用 GraphQL M5.5 的结构化模型（StructuredField/StructuredRow）——
 * 序列化层（jsonToStructuredRows / structuredRowToJson / StructuredTable）完全通用，
 * 本库只负责 **OpenAPI deref schema → StructuredField** 的映射层：
 *
 * - `openApiSchemaToStructured(schema)`：递归转换
 *   - `type: object` → kind=input（properties 递归展开；父级 required 数组标记必填）
 *   - `type: array` → kind=list（items 递归为 element）
 *   - `type: string + enum` → kind=enum；`type: boolean` → kind=boolean
 *   - `type: integer/number` → kind=scalar（Int/Float 数字转换）；`type: string` → scalar(String)
 *   - `oneOf/anyOf` → 取首个含 type 的分支；`allOf` → 合并 properties
 *   - **必填字段排最上**（对齐 GraphQL 结构化三修正：必填前、可选后保持 schema 顺序）
 * - typeLabel：展示用（"object" / "array<string>" / "string" 等），与 GraphQL toString() 同职责
 *
 * 数据源：DebugPage 的 bodySchema（ep.op.body["application/json"]，deref 产物无 $ref）。
 */
import type { StructuredField } from "./debug-gql-structured";

/** schema 字段的 description / default（可选，hover title / placeholder 用） */
function metaOf(ps: Record<string, unknown>): { description?: string; defaultValue?: unknown } {
  const description =
    typeof ps.description === "string" && ps.description.trim() !== "" ? ps.description : undefined;
  const defaultValue = "default" in ps ? (ps.default as unknown) : undefined;
  return { description, defaultValue };
}

/**
 * OpenAPI deref schema → StructuredField 递归模型。
 * - 无 type 但有 properties → object（OpenAPI 省略 type 的隐含对象）
 * - type 数组（如 ["string","null"]）→ 取首个非 null；nullable 无独立必填语义
 *   （REST 必填完全由父级 required 数组决定，此处不传 required）
 */
export function openApiSchemaToStructured(schema: Record<string, unknown>): StructuredField {
  // 分支合并：oneOf/anyOf 取首个含 type/properties 的分支；allOf 合并全部 properties
  const oneOf = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    const first = oneOf.find(
      (b) => b && typeof b === "object" && ("type" in b || "properties" in b),
    );
    if (first && typeof first === "object") {
      return openApiSchemaToStructured(first as Record<string, unknown>);
    }
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = { ...schema, properties: {}, required: [] };
    // 清除分支字段——否则递归时再次命中 allOf 无限循环
    delete merged.allOf;
    delete merged.oneOf;
    delete merged.anyOf;
    for (const part of schema.allOf) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.properties && typeof p.properties === "object") {
        merged.properties = { ...(merged.properties as object), ...(p.properties as object) };
      }
      if (Array.isArray(p.required)) {
        merged.required = [
          ...new Set([...(merged.required as string[]), ...(p.required as string[])]),
        ];
      }
    }
    return openApiSchemaToStructured(merged);
  }

  const rawType = schema.type;
  const types = Array.isArray(rawType)
    ? (rawType as unknown[]).filter((t) => t !== "null")
    : rawType
      ? [rawType]
      : [];
  const typeList = types.map(String);

  // object：显式 type 或 隐式（无 type 但有 properties）
  if (typeList.includes("object") || (typeList.length === 0 && schema.properties)) {
    const props = schema.properties as Record<string, unknown> | undefined;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const fields = Object.entries(props ?? {})
      .map(([name, ps]) => {
        const f = openApiSchemaToStructured(ps as Record<string, unknown>);
        const meta = metaOf(ps as Record<string, unknown>);
        return {
          ...f,
          name,
          required: required.includes(name),
          description: meta.description,
          defaultValue: meta.defaultValue,
        };
      })
      // 必填字段排最上（其余保持 schema 顺序——Array.sort 稳定；对齐 GraphQL 三修正）
      .sort((a, b) => Number(b.required) - Number(a.required));
    return {
      name: "",
      kind: "input",
      required: false,
      fields,
      typeLabel: "object",
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }

  // array：items 递归为 element（无 items → String 兜底）
  if (typeList.includes("array")) {
    const items = schema.items;
    const element =
      items && typeof items === "object"
        ? openApiSchemaToStructured(items as Record<string, unknown>)
        : ({
            name: "",
            kind: "scalar" as const,
            required: false,
            scalarName: "String",
            fields: [],
            typeLabel: "string",
          } satisfies StructuredField);
    return {
      name: "",
      kind: "list",
      required: false,
      element,
      fields: [],
      typeLabel: `array<${element.typeLabel}>`,
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }

  // boolean / 数字 / 字符串（含枚举）
  if (typeList.includes("boolean")) {
    return {
      name: "",
      kind: "boolean",
      required: false,
      fields: [],
      typeLabel: "boolean",
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }
  if (typeList.includes("integer")) {
    return {
      name: "",
      kind: "scalar",
      required: false,
      scalarName: "Int",
      fields: [],
      typeLabel: "integer",
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }
  if (typeList.includes("number")) {
    return {
      name: "",
      kind: "scalar",
      required: false,
      scalarName: "Float",
      fields: [],
      typeLabel: "number",
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }
  if (Array.isArray(schema.enum)) {
    return {
      name: "",
      kind: "enum",
      required: false,
      enumValues: (schema.enum as unknown[]).filter((v) => typeof v === "string").map(String),
      fields: [],
      typeLabel: "enum",
      description: metaOf(schema).description,
      defaultValue: metaOf(schema).defaultValue,
    };
  }
  return {
    name: "",
    kind: "scalar",
    required: false,
    scalarName: "String",
    fields: [],
    typeLabel: "string",
    description: metaOf(schema).description,
    defaultValue: metaOf(schema).defaultValue,
  };
}
