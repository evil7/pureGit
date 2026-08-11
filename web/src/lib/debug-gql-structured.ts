/**
 * GraphQL input/列表结构化纯函数（M5.5：StructuredTable 复合数组编辑器核心）
 *
 * 职责（debug-graphql-redesign.md §0.3 自研 StructuredTable 方案，仅服务 GraphQL variables）：
 * - **inputTypeToStructured**：GraphQLInputType → `StructuredField` 递归模型
 *   （剥 NON_NULL → scalar/enum/boolean/input/list 五种 kind；input 展开字段、
 *   list 收 element——嵌套任意深度）
 * - **buildStructuredValue**：字段 → 骨架值（scalar/enum → ""、boolean → false、
 *   input → 递归对象、list → []）——对齐 buildVariablesJson 语义
 * - **structuredRowsToJson / jsonToStructuredRows**：表格行 ↔ JSON **双向递归序列化**
 *   （空值跳过、Int/Float 转 Number、boolean 转 true/false、input 嵌套对象、
 *   list 逐项序列化；反向缺字段补行、多余字段保留自定义）
 *
 * 设计要点：
 * - **行模型**（StructuredRow）：value 文本 + enabled 开关；kind=input → children 嵌套行；
 *   kind=list → items 数组项（每项 = 元素字段行数组，元素 input 时每项展开子表格）
 * - **Boolean 单独 kind**（非 scalar）——UI 层给 true/false 下拉（同 GqlVariablesPanel 惯例）
 * - 标量带 scalarName（Int/Float/Boolean 转换依据）；字段带 description（hover title）
 * - 与 debug-gql-variables.ts 的 validateVariables 互补：后者校验 JSON 语义，
 *   本库负责「结构驱动编辑 + 双向序列化」；序列化产物可直接喂 validateVariables
 */
import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  type GraphQLInputType,
} from "graphql";

/** 结构字段模型（kind 决定渲染与序列化分支） */
export interface StructuredField {
  name: string;
  kind: "scalar" | "enum" | "boolean" | "input" | "list";
  /** 必填（NON_NULL 或 input 字段 NON_NULL 无默认值） */
  required: boolean;
  /** kind=enum：合法枚举值列表（UI 下拉） */
  enumValues?: string[];
  /** kind=list：元素字段（标量/枚举/布尔/input 均可） */
  element?: StructuredField;
  /** kind=input：递归字段行 */
  fields: StructuredField[];
  /** 类型展示（String! / CreateIssueInput / [String!]!…） */
  typeLabel: string;
  /** kind=scalar 的标量名（Int/Float → 数字转换） */
  scalarName?: string;
  /** 字段说明（hover title） */
  description?: string;
  /** schema 默认值（骨架填充优先） */
  defaultValue?: unknown;
}

/** 表格行模型（value 文本；input → children 嵌套；list → items 数组） */
export interface StructuredRow {
  field: StructuredField;
  /** 标量/枚举/布尔值文本（枚举/布尔 UI 下拉；空 = 未填） */
  value: string;
  enabled: boolean;
  /** kind=input：嵌套字段行 */
  children: StructuredRow[];
  /** kind=list：数组项（每项 = 元素字段行数组） */
  items: StructuredRow[][];
}

/** 递归剥 NON_NULL（返回剥壳后类型 + 是否必填） */
function unwrapNonNull(type: GraphQLInputType): { type: GraphQLInputType; required: boolean } {
  if (isNonNullType(type)) return { type: type.ofType, required: true };
  return { type, required: false };
}

/**
 * GraphQLInputType → StructuredField 递归模型。
 * - NON_NULL 剥壳 → required；LIST → element 递归；INPUT_OBJECT → fields 递归；
 *   ENUM → enumValues；Boolean 标量特殊 kind=boolean（UI 下拉）
 * - typeLabel 用类型对象 toString()（GraphQLNonNull/List 递归输出 "String!" / "[String!]!"）
 */
export function inputTypeToStructured(type: GraphQLInputType): StructuredField {
  const { type: inner, required } = unwrapNonNull(type);
  // typeLabel 用原始类型 toString()（NON_NULL/LIST 递归输出 "String!" / "[String!]!"）
  const label = type.toString();
  if (isListType(inner)) {
    const element = inputTypeToStructured(inner.ofType);
    return {
      name: "",
      kind: "list",
      required,
      element,
      fields: [],
      typeLabel: label,
      defaultValue: undefined,
    };
  }
  const named = getNamedType(inner);
  if (isEnumType(named)) {
    return {
      name: "",
      kind: "enum",
      required,
      enumValues: named.getValues().map((v) => v.name),
      fields: [],
      typeLabel: label,
      description: named.description ?? undefined,
    };
  }
  if (isInputObjectType(named)) {
    const fields = Object.values(named.getFields())
      .map((f) => {
        const fld = inputTypeToStructured(f.type);
        return {
          ...fld,
          name: f.name,
          description: f.description ?? undefined,
          defaultValue: f.defaultValue,
        };
      })
      // 必填字段排最上（其余保持 schema 顺序——Array.sort 稳定）；结构化展开的视觉基线
      .sort((a, b) => Number(b.required) - Number(a.required));
    return {
      name: "",
      kind: "input",
      required,
      fields,
      typeLabel: label,
      description: named.description ?? undefined,
    };
  }
  if (isScalarType(named)) {
    if (named.name === "Boolean") {
      return { name: "", kind: "boolean", required, fields: [], typeLabel: label };
    }
    return {
      name: "",
      kind: "scalar",
      required,
      scalarName: named.name,
      fields: [],
      typeLabel: label,
      description: named.description ?? undefined,
    };
  }
  // 理论不可达（输入类型只含上述五种）
  return { name: "", kind: "scalar", required, scalarName: "String", fields: [], typeLabel: label };
}

/**
 * 字段 → 骨架值（对齐 defaultValueForInputType 语义，供表格初始填充）：
 * scalar/enum → ""、boolean → false、input → 递归对象（schema 默认值优先）、list → []
 */
export function buildStructuredValue(field: StructuredField): unknown {
  if (field.kind === "list") return [];
  if (field.kind === "input") {
    const obj: Record<string, unknown> = {};
    for (const f of field.fields) {
      obj[f.name] = f.defaultValue !== undefined ? f.defaultValue : buildStructuredValue(f);
    }
    return obj;
  }
  if (field.kind === "boolean") return field.defaultValue ?? false;
  return field.defaultValue ?? "";
}

/**
 * 行文本 → JSON 值（空文本 → undefined 跳过；Int/Float 转 Number；boolean 按文本）。
 * 转换失败返回 { ok: false }（UI 红框提示；与 GqlVariablesPanel textToJsonValue 同语义）
 */
function rowValueToJson(row: StructuredRow): { ok: true; value: unknown } | { ok: false } {
  const f = row.field;
  if (f.kind === "scalar" || f.kind === "enum" || f.kind === "boolean") {
    const text = row.value.trim();
    if (text === "") return { ok: true, value: undefined };
    if (f.kind === "boolean") return { ok: true, value: text === "true" };
    if (f.kind === "scalar" && (f.scalarName === "Int" || f.scalarName === "Float")) {
      const n = Number(text);
      if (Number.isNaN(n)) return { ok: false };
      return { ok: true, value: n };
    }
    return { ok: true, value: text };
  }
  // input / list 由结构递归序列化（不走文本）
  return { ok: true, value: undefined };
}

/** input 行 → JSON 对象（enabled 关 / 空值跳过；递归）。空对象 → undefined（未填 = 跳过） */
function inputRowToJson(row: StructuredRow): {
  ok: true;
  value: Record<string, unknown> | undefined;
} {
  const obj: Record<string, unknown> = {};
  for (const child of row.children) {
    if (child.enabled === false) continue;
    const res = structuredRowToJson(child);
    if (res.ok && res.value !== undefined) obj[child.field.name] = res.value;
  }
  // 空对象（无任何有效子值）→ 跳过（与标量空值语义一致）
  return { ok: true, value: Object.keys(obj).length > 0 ? obj : undefined };
}

/** 列表行 → JSON 数组（逐项序列化；元素 input 用 children、标量用 value、嵌套 list 递归）。空 → undefined */
function listRowToJson(row: StructuredRow): { ok: true; value: unknown[] | undefined } {
  const arr: unknown[] = [];
  const f = row.field.element;
  if (!f) return { ok: true, value: undefined };
  for (const item of row.items) {
    if (f.kind === "input") {
      const proxy: StructuredRow = {
        field: f,
        value: "",
        enabled: true,
        children: item,
        items: [],
      };
      const res = structuredRowToJson(proxy);
      if (res.ok && res.value !== undefined) arr.push(res.value);
    } else if (f.kind === "list") {
      // 嵌套 list：item 是单个元素 list 行（递归）
      const res = structuredRowToJson(item[0]);
      if (res.ok && res.value !== undefined) arr.push(res.value);
    } else {
      const proxy: StructuredRow = {
        field: f,
        value: item[0]?.value ?? "",
        enabled: true,
        children: [],
        items: [],
      };
      const res = rowValueToJson(proxy);
      if (res.ok && res.value !== undefined) arr.push(res.value);
    }
  }
  return { ok: true, value: arr.length > 0 ? arr : undefined };
}

/** 单行 → JSON 值（递归分派；undefined = 跳过不输出） */
export function structuredRowToJson(
  row: StructuredRow,
): { ok: true; value: unknown } | { ok: false } {
  const f = row.field;
  if (f.kind === "input") {
    const res = inputRowToJson(row);
    return { ok: true, value: res.value };
  }
  if (f.kind === "list") {
    const res = listRowToJson(row);
    return { ok: true, value: res.value };
  }
  return rowValueToJson(row);
}

/** 表格行数组 → JSON 对象（顶层 variables；enabled 关 / 空名 / 空值跳过） */
export function structuredRowsToJson(rows: StructuredRow[]): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.enabled === false) continue;
    const name = row.field.name.trim();
    if (!name) continue;
    const res = structuredRowToJson(row);
    if (res.ok && res.value !== undefined) json[name] = res.value;
  }
  return json;
}

/**
 * JSON 值 → 表格行（input 递归展开；list 逐项重建）。
 * - 缺字段 → 补骨架行（必填/可选都建，UI 可删可关）
 * - 多余字段 → 保留为自定义行（value 序列化为 JSON 文本；enabled 保持）
 * - scalar/boolean/enum：值 → 文本（number → String、boolean → "true"/"false"）
 */
export function jsonToStructuredRows(field: StructuredField, value: unknown): StructuredRow {
  const empty = (f: StructuredField): StructuredRow => ({
    field: f,
    value: "",
    enabled: true,
    children: f.kind === "input" ? f.fields.map((ff) => empty(ff)) : [],
    items: [],
  });
  if (field.kind === "list") {
    const el = field.element;
    const base: StructuredRow = empty(field);
    if (el && Array.isArray(value)) {
      base.items = value.map((v) => {
        if (el.kind === "input") return jsonToStructuredRows(el, v).children;
        if (el.kind === "list") return [jsonToStructuredRows(el, v)]; // 嵌套 list 递归
        const item: StructuredRow = {
          field: el,
          value: "",
          enabled: true,
          children: [],
          items: [],
        };
        if (typeof v === "string") item.value = v;
        else if (typeof v === "number") item.value = String(v);
        else if (typeof v === "boolean") item.value = String(v);
        else if (v === null) item.value = "";
        else item.value = JSON.stringify(v);
        return [item];
      });
    }
    return base;
  }
  if (field.kind === "input") {
    const obj = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const record = obj as Record<string, unknown>;
    const used = new Set<string>();
    const children = field.fields.map((f) => {
      const row = jsonToStructuredRows(f, record[f.name]);
      if (f.name in record) used.add(f.name);
      return row;
    });
    // 多余字段 → 自定义行
    for (const [k, v] of Object.entries(record)) {
      if (used.has(k)) continue;
      children.push({
        field: { name: k, kind: "scalar", required: false, fields: [], typeLabel: "" },
        value: typeof v === "string" ? v : v === null ? "" : JSON.stringify(v),
        enabled: true,
        children: [],
        items: [],
      });
    }
    return { field, value: "", enabled: true, children, items: [] };
  }
  // 标量/枚举/布尔
  const row = empty(field);
  // 忠实还原：缺字段保持空骨架（默认值由 UI placeholder 承载，不在此填充——
  // 否则未提供的字段会带上默认值再序列化输出，破坏正反向收敛保真）
  if (typeof value === "string") row.value = value;
  else if (typeof value === "number") row.value = String(value);
  else if (typeof value === "boolean") row.value = String(value);
  else if (value !== null && value !== undefined) row.value = JSON.stringify(value);
  return row;
}
