/**
 * GraphQL 变量三件套（调试工具 variables 面板的纯函数核心，UI 无状态逻辑，全量可测）
 *
 * 职责（对标 Insomnia/GraphiQL 的 variableToType 联动校验思路）：
 * - **collectVariables**：从 query AST 提取变量定义 → `GqlVariableDef[]`
 *   （name / 类型展示 / 必填标记 / 解析后 GraphQLInputType——枚举合法值与 input 字段结构校验的数据源）
 * - **buildVariablesJson**：变量定义 → JSON 骨架（标量/枚举 → ""、input 递归字段、列表 → []），
 *   Variables 面板初始填充用
 * - **validateVariables**：双向校验（缺失必填 / 多余 / 类型不匹配 / 枚举非法 / input 结构），
 *   返回错误列表驱动校验条与 tab 徽标
 *
 * 设计要点：
 * - parseVariablesJson 独立（JSON 语法错误与语义校验分离）
 * - 可选变量缺失不报错（GraphQL 规范允许省略）；仅必填（NON_NULL）缺失报错
 * - input 对象：缺必填字段、多余字段、字段类型不匹配均报错；嵌套递归
 */
import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInputType,
  isListType,
  isNonNullType,
  isScalarType,
  parse,
  print,
  typeFromAST,
  type GraphQLInputType,
  type GraphQLSchema,
} from "graphql";

/** 从 query 提取的单个变量定义 */
export interface GqlVariableDef {
  name: string;
  /** 类型展示（如 "String!"、"CreateIssueInput!"、"Int"） */
  typeLabel: string;
  /** 必填（NON_NULL）——缺失校验用 */
  required: boolean;
  /** 解析后输入类型（枚举/input 深度校验用） */
  type: GraphQLInputType;
}

/** 变量校验错误（kind 区分；UI 按 kind 渲染徽标/文案） */
export interface GqlVariableError {
  /** 变量名（不含 $）或 input 字段路径（如 "input.title"） */
  key: string;
  kind: "missing" | "extra" | "type-mismatch";
  message: string;
}

/**
 * 从 query 文本提取变量定义（遍历全部 OperationDefinition——切 operation 不丢变量）。
 * - 语法错误 → null（不校验，UI 提示查询语法错误）；空文本 → []
 * - 非输入类型（如变量引用输出类型）跳过
 */
export function collectVariables(query: string, schema: GraphQLSchema): GqlVariableDef[] | null {
  if (!query?.trim()) return [];
  try {
    const doc = parse(query);
    const defs: GqlVariableDef[] = [];
    for (const def of doc.definitions) {
      if (def.kind !== "OperationDefinition") continue;
      for (const v of def.variableDefinitions ?? []) {
        const type = typeFromAST(schema, v.type);
        if (!type || !isInputType(type)) continue;
        defs.push({
          name: v.variable.name.value,
          typeLabel: print(v.type),
          required: isNonNullType(type),
          type,
        });
      }
    }
    return defs;
  } catch {
    return null;
  }
}

/** 输入类型 → 默认骨架值（递归；先剥 NON_NULL 再判 LIST） */
function defaultValueForInputType(type: GraphQLInputType): unknown {
  if (isNonNullType(type)) return defaultValueForInputType(type.ofType);
  if (isListType(type)) return [];
  const named = getNamedType(type);
  if (isScalarType(named) || isEnumType(named)) return "";
  if (isInputObjectType(named)) {
    const obj: Record<string, unknown> = {};
    for (const f of Object.values(named.getFields())) {
      // schema 默认值优先，否则递归骨架（input 嵌套展开，无需 schema 也可生成结构）
      obj[f.name] =
        f.defaultValue !== undefined ? f.defaultValue : defaultValueForInputType(f.type);
    }
    return obj;
  }
  return "";
}

/**
 * 变量定义 → JSON 骨架（Variables 面板初始填充）：
 * - 标量/枚举 → ""（枚举 UI 层给下拉；标量给类型化输入框）
 * - input 对象 → 递归字段骨架（含嵌套 input / 列表）
 * - 列表 → []
 */
export function buildVariablesJson(defs: GqlVariableDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) out[d.name] = defaultValueForInputType(d.type);
  return out;
}

/**
 * JSON 文本 → 解析值（JSON 语法错误与语义校验分离）。
 * 调用方：解析失败 → 展示语法错误；成功 → 传 validateVariables。
 */
export function parseVariablesJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON 语法错误" };
  }
}

/**
 * 变量值 ↔ 类型递归校验（返回该值路径下的全部错误；无错误 → []）：
 * - 标量：String/ID/URI 等 → string；Int/Float → number；Boolean → boolean
 * - 枚举：string 且在 enumValues 内
 * - 列表：数组，逐元素递归
 * - input 对象：object；缺必填字段、多余字段、字段类型不匹配均递归报错
 */
function checkValue(
  value: unknown,
  type: GraphQLInputType,
  key: string,
  path: string,
): GqlVariableError[] {
  const errors: GqlVariableError[] = [];
  // 非空包装：null/undefined → 报错
  if (isNonNullType(type)) {
    if (value === null || value === undefined) {
      errors.push({ key, kind: "type-mismatch", message: `${path} 不能为空` });
      return errors;
    }
    return checkValue(value, type.ofType, key, path);
  }
  // 列表
  if (isListType(type)) {
    if (!Array.isArray(value)) {
      errors.push({ key, kind: "type-mismatch", message: `${path} 应为数组` });
      return errors;
    }
    for (let i = 0; i < value.length; i++) {
      errors.push(...checkValue(value[i], type.ofType, key, `${path}[${i}]`));
    }
    return errors;
  }
  const named = getNamedType(type);
  // 标量
  if (isScalarType(named)) {
    if (named.name === "Int" || named.name === "Float") {
      if (typeof value !== "number") {
        errors.push({ key, kind: "type-mismatch", message: `${path} 应为数字（${named.name}）` });
      }
    } else if (named.name === "Boolean") {
      if (typeof value !== "boolean") {
        errors.push({ key, kind: "type-mismatch", message: `${path} 应为布尔（Boolean）` });
      }
    } else if (typeof value !== "string") {
      errors.push({ key, kind: "type-mismatch", message: `${path} 应为字符串（${named.name}）` });
    }
    return errors;
  }
  // 枚举
  if (isEnumType(named)) {
    if (typeof value !== "string" || !named.getValues().some((v) => v.name === value)) {
      errors.push({
        key,
        kind: "type-mismatch",
        message: `${path} 应为枚举值之一：${named
          .getValues()
          .map((v) => v.name)
          .join(" | ")}`,
      });
    }
    return errors;
  }
  // input 对象
  if (isInputObjectType(named)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push({ key, kind: "type-mismatch", message: `${path} 应为对象（${named.name}）` });
      return errors;
    }
    const obj = value as Record<string, unknown>;
    const fields = Object.values(named.getFields());
    // 缺必填字段（schema 默认值可豁免）
    for (const f of fields) {
      if (isNonNullType(f.type) && f.defaultValue === undefined && !(f.name in obj)) {
        errors.push({
          key: `${key}.${f.name}`,
          kind: "missing",
          message: `${path} 缺少必填字段 ${f.name}`,
        });
      }
    }
    // 多余字段 + 字段类型递归
    for (const [k, v] of Object.entries(obj)) {
      const field = named.getFields()[k];
      if (!field) {
        errors.push({
          key: `${key}.${k}`,
          kind: "extra",
          message: `${path} 含未声明字段 ${k}`,
        });
        continue;
      }
      errors.push(...checkValue(v, field.type, `${key}.${k}`, `${path}.${k}`));
    }
    return errors;
  }
  return errors;
}

/**
 * 变量双向校验（query 已声明变量 ↔ JSON 提供的值）：
 * - **缺失**：必填（NON_NULL）变量 JSON 未提供
 * - **多余**：JSON 提供的变量 query 未声明
 * - **类型不匹配**：标量/枚举/列表/input 结构递归校验
 * 通过（无错误）→ []；query 无变量 → []（空 query 场景不误报）
 */
export function validateVariables(defs: GqlVariableDef[], json: unknown): GqlVariableError[] {
  const errors: GqlVariableError[] = [];
  const isJsonObj = typeof json === "object" && json !== null && !Array.isArray(json);
  const obj: Record<string, unknown> = isJsonObj ? (json as Record<string, unknown>) : {};
  const defMap = new Map(defs.map((d) => [d.name, d]));
  // 缺失（必填）
  for (const d of defs) {
    if (d.required && !(d.name in obj)) {
      errors.push({
        key: d.name,
        kind: "missing",
        message: `缺少必填变量 $${d.name} (${d.typeLabel})`,
      });
    }
  }
  // 多余
  for (const key of Object.keys(obj)) {
    if (!defMap.has(key)) {
      errors.push({ key, kind: "extra", message: `变量 $${key} 未在查询中声明` });
    }
  }
  // 类型校验
  for (const d of defs) {
    if (!(d.name in obj)) continue;
    errors.push(...checkValue(obj[d.name], d.type, d.name, `$${d.name}`));
  }
  return errors;
}

/**
 * 文本级变量校验（query + variables 文本 + schema → 错误列表，纯函数）：
 * 供 RequestEditor **tab 徽标实时计算**（无需切换/挂载 Variables 面板）——
 * query 输入时立即反映变量缺失/多余/类型错误计数，与 GqlVariablesPanel 内部
 * 校验结果同源（均为 collectVariables + parseVariablesJson + validateVariables）。
 * - query 语法错误 / schema 未就绪 → null（无法提取变量定义，不报数）
 * - variables JSON 语法错误 → 计入错误（1 条语法错误）
 */
export function validateVariablesText(
  query: string,
  variables: string,
  schema: GraphQLSchema | null,
): GqlVariableError[] | null {
  if (!schema) return null;
  const defs = collectVariables(query, schema);
  if (defs === null) return null; // query 语法错误 → 不报数
  const parsed = parseVariablesJson(variables);
  if (!parsed.ok) {
    return [{ key: "(json)", kind: "type-mismatch", message: parsed.error }];
  }
  const json =
    typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : {};
  return validateVariables(defs, json);
}
