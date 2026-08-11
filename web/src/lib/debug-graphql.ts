/**
 * GitHub GraphQL Schema 获取 + 查询模板生成（调试工具用）
 *
 * 数据源双通道（与 REST OpenAPI 同模式）：
 * - **本地 min.json**（主通道）：`/github-graphql.min.json`（scripts/build-graphql-schema.mjs
 *   从已入库的官方 SDL 快照 docs/github-schema.graphql 离线生成，1.5MB raw / 87KB gzip）——
 *   fetch 本地静态文件毫秒级、匿名可用、无网络 introspection 大请求
 * - **在线 introspection**（刷新通道）：带 token POST api.github.com/graphql 标准 introspection
 *   （官方 explorer 同款）→ 官方完整 schema（~4000 类型，含 preview 门控）——schema 快照
 *   版本落后时手动刷新，仅内存缓存
 *
 * 两者产物同构（__schema 精简 introspection），buildClientSchema 统一构建，驱动：
 * - L1 左栏 Schema 树：query/mutation 顶层字段 → checkbox **勾选合并**构造查询
 *   （勾选父级自动全选可见子字段，生成内容 = 实际勾选，无隐式默认字段/主键）；
 *   字段点击**仅展开**返回类型子字段（从外向内浏览，数据已在内存 schema，零请求）
 * - L2 编辑器智能提示：GraphQL body 编辑器挂 cm6-graphql（codemirror.ts），
 *   由本 schema 提供字段/参数/枚举补全与语法诊断
 */
import {
  buildClientSchema,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type IntrospectionQuery,
  type OperationDefinitionNode,
  type FieldNode,
} from "graphql";

const GQL_ENDPOINT = "https://api.github.com/graphql";

/**
 * 精简 introspection query（对齐 GitHub 官方 explorer 的 schema 获取思路）：
 * 只取类型骨架——kind/name/fields/args/type 引用链 + 弃用标记，
 * 丢弃 description/directives/specifiedByURL 等体积大头（buildClientSchema 对缺失字段容忍）。
 * TypeRef 递归展开 7 层足够覆盖 NON_NULL/LIST 深层嵌套。
 *
 * 注意：graphql-js buildClientSchema 对以下字段**强制要求**（缺失即抛错）——
 * directives.locations / directives.args、object/interface.interfaces、union.possibleTypes、
 * enum.enumValues、inputObject.inputFields、field.args、arg.type；均已在 query 中请求。
 */
const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      fields(includeDeprecated: true) {
        name
        args { ...InputValue }
        type { ...TypeRef }
        isDeprecated
        deprecationReason
      }
      inputFields { ...InputValue }
      interfaces { ...TypeRef }
      enumValues(includeDeprecated: true) { name isDeprecated deprecationReason }
      possibleTypes { ...TypeRef }
    }
    directives {
      name
      isRepeatable
      locations
      args { ...InputValue }
    }
  }
}

fragment InputValue on __InputValue {
  name
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType { kind name }
            }
          }
        }
      }
    }
  }
}`;

/** 内存缓存（DebugPage 卸载后重建不重复拉取） */
let cachedSchema: GraphQLSchema | null = null;

/**
 * 由 introspection 原数据（__schema）构建运行时 schema，统一入口：
 * - 本地产物 /debug/gql/schema.json（@octokit/graphql-schema 原数据，含 description）
 * - 在线 introspection 结果（fetchGqlSchema）
 * 构建后清洗 deprecated 一致性违规（见 sanitizeDeprecatedConsistency）。
 * schema 的获取/缓存由 schema-loader.ts 统一管理（TTL/SWR/预热），本函数纯构建。
 */
export function buildGqlSchemaFromIntrospection(introspection: {
  __schema: unknown;
}): GraphQLSchema {
  cachedSchema = sanitizeDeprecatedConsistency(
    buildClientSchema(introspection as unknown as IntrospectionQuery),
  );
  return cachedSchema;
}

/**
 * 清理 GitHub schema 自身的 deprecated 一致性违规（GraphQL 规范禁止，但官方 schema 存在）：
 * 接口字段未弃用时，实现字段不得弃用。cm6-graphql 的 lint 会先 validateSchema(schema），
 * 这些违规导致验证非空——其逻辑是「有验证错误且不开 showErrorOnInvalidSchema 就整个跳过」
 * （连查询诊断 getDiagnostics 也一起吞掉）。故构建后清洗违规字段，令 validateSchema 通过、
 * 查询诊断正常生效（官方 explorer 同样忽略此类结构噪音）。
 */
export function sanitizeDeprecatedConsistency(schema: GraphQLSchema): GraphQLSchema {
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) && !isInterfaceType(type)) continue;
    const ifaces = type.getInterfaces();
    if (!ifaces.length) continue;
    const fields = type.getFields();
    for (const iface of ifaces) {
      for (const [name, ifaceField] of Object.entries(iface.getFields())) {
        const implField = fields[name];
        if (!implField) continue;
        // 接口字段未弃用而实现字段弃用 → 清除实现字段的弃用标记（跟随接口）
        if (ifaceField.deprecationReason == null && implField.deprecationReason != null) {
          (implField as { deprecationReason?: string | null }).deprecationReason = undefined;
        }
      }
    }
  }
  return schema;
}

export function getCachedGqlSchema(): GraphQLSchema | null {
  return cachedSchema;
}

export function clearCachedGqlSchema(): void {
  cachedSchema = null;
}

/**
 * 在线刷新：带 token introspection（官方 explorer 同款）→ 构建运行时 schema。
 * 匿名（token 为空）GitHub 恒 401，调用方提示「需登录」；schema 快照版本落后时手动刷新。
 */
export async function fetchGqlSchema(token: string | null): Promise<GraphQLSchema> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`introspection HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const json = (await res.json()) as { data?: unknown; errors?: Array<{ message?: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "introspection errors");
  }
  const schemaData = (json.data as { __schema?: unknown } | null)?.__schema;
  if (!schemaData) throw new Error("introspection 无 __schema");
  return buildGqlSchemaFromIntrospection({ __schema: schemaData });
}

/* ── 顶层字段树（左栏 Schema 树数据源） ─────────────────────── */

export interface GqlArgNode {
  name: string;
  /** 必填参数（NON_NULL）——模板生成时给出示例值占位 */
  required: boolean;
  /** 类型展示（如 "String!"、"Int"、"ID"） */
  typeLabel: string;
}

export interface GqlFieldNode {
  name: string;
  args: GqlArgNode[];
  /** 返回类型展示（如 "Repository!"、"[User!]!"） */
  returnLabel: string;
  /** 标量/枚举返回（无子字段，模板为裸调用） */
  scalar: boolean;
  /** 返回类型的一层子字段（对象/接口；union 无字段）——Schema 树展开浏览用 */
  typeFields?: GqlFieldNode[];
  /** union 返回：possibleTypes 类型名列表（展开浏览显示可并集类型） */
  possibleTypes?: string[];
  deprecated?: boolean;
  desc?: string;
}

/** 展开 NON_NULL/LIST 找到最内层命名类型 */
function unwrapToNamed(t: GraphQLType | null): GraphQLType | null {
  let cur = t;
  while (cur && (isNonNullType(cur) || isListType(cur))) {
    cur = cur.ofType;
  }
  return cur;
}

/** 类型引用链 → 展示文本（Repository!、[User!]!） */
function typeLabel(t: GraphQLType | null): string {
  if (!t) return "";
  if (isNonNullType(t)) return `${typeLabel(t.ofType)}!`;
  if (isListType(t)) return `[${typeLabel(t.ofType)}]`;
  return t.name;
}

/** 展开浏览：字段的返回类型子字段上限（再递归一层，避免树无限膨胀） */
const TYPE_FIELD_MAX = 30;

/** 字段排序：普通字符序（不区分主键——勾选合并无隐式默认字段，`id` 无特殊地位） */
const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * 收集类型字段列表（含展开浏览所需数据）。deep=true 时附加返回类型的一层子字段
 * （typeFields）与 union possibleTypes；deep=false 仅自身字段（避免递归膨胀）。
 */
function collectFields(type: GraphQLObjectType, deep = false): GqlFieldNode[] {
  return Object.values(type.getFields())
    .sort(byName)
    .map((f: GraphQLField<unknown, unknown>) => {
      const inner = unwrapToNamed(f.type);
      const scalar = inner !== null && (isScalarType(inner) || isEnumType(inner));
      const node: GqlFieldNode = {
        name: f.name,
        args: f.args.map((a) => ({
          name: a.name,
          required: isNonNullType(a.type),
          typeLabel: typeLabel(a.type),
        })),
        returnLabel: typeLabel(f.type),
        scalar,
        deprecated: f.deprecationReason != null || undefined,
        desc: f.description?.slice(0, 100) || undefined,
      };
      // 展开浏览数据（仅顶层字段附带；返回对象/接口 → 一层子字段，union → possibleTypes）
      if (deep && inner !== null && !scalar) {
        if (isObjectType(inner)) {
          node.typeFields = collectFields(inner).slice(0, TYPE_FIELD_MAX);
        } else if (isInterfaceType(inner)) {
          node.typeFields = collectFields(inner as unknown as GraphQLObjectType).slice(
            0,
            TYPE_FIELD_MAX,
          );
        } else {
          node.possibleTypes = schemaPossibleTypes(inner);
        }
      }
      return node;
    });
}

/** union 的 possibleTypes 名列表 */
function schemaPossibleTypes(t: GraphQLType): string[] | undefined {
  if (isUnionType(t)) {
    return t.getTypes().map((x) => x.name);
  }
  return undefined;
}

export interface GqlSchemaTree {
  query: GqlFieldNode[];
  mutation: GqlFieldNode[];
}

/** 从运行时 schema 构建 query/mutation 顶层字段树（含展开浏览数据） */
export function buildGqlFieldTree(schema: GraphQLSchema): GqlSchemaTree {
  const q = schema.getQueryType();
  const m = schema.getMutationType();
  return {
    query: q ? collectFields(q, true) : [],
    mutation: m ? collectFields(m, true) : [],
  };
}

/* ── 点按字段 → 即用查询模板 ─────────────────────────────── */

/** 参数示例值（按类型名启发式：数字/布尔 → 字面量；其余 → 字符串占位提示替换） */
function exampleArgValue(typeLabelText: string): string {
  const base = typeLabelText.replace(/[[\]!]/g, "");
  if (base === "Int" || base === "Float") return "0";
  if (base === "Boolean") return "true";
  return '"…"';
}

/** 勾选合并的单个字段选择（root 顶层字段 + 其下勾选的子字段集） */
export interface GqlSelection {
  root: GqlFieldNode;
  /** 勾选的子字段名集（对象类型恒非空——状态机不变量；标量类型恒空） */
  children: Set<string>;
}

/**
 * 勾选合并 → 标准查询文档（AST 式构造：同操作类型多字段拼接为一个 selection set）
 *
 * `query {\n  viewer { login }\n  repository(name: "…") { id name }\n}`
 * - body = **实际勾选的子字段集**（无隐式默认字段/主键——严格「勾选什么写什么」）
 * - 标量 root（无子字段勾选）→ 裸字段调用（无 selection set）
 * - 对象 root 子字段集恒非空（勾选状态机不变量 1 保证，此处仅防御性处理）
 * - 必填参数仍给 `"…"` 内联占位（即点即用，单 tab 完成）
 */
export function gqlSelectionsToQuery(
  opType: "query" | "mutation",
  selections: GqlSelection[],
): string {
  const blocks = selections.map(({ root, children }) => {
    const args = root.args
      .filter((a) => a.required)
      .map((a) => `${a.name}: ${exampleArgValue(a.typeLabel)}`)
      .join(", ");
    const argsStr = args ? `(${args})` : "";
    // 严格勾选驱动：仅写入实际勾选的子字段（标量 → 无 body）
    const body = children.size > 0 ? ` {\n    ${[...children].join("\n    ")}\n  }` : "";
    return `  ${root.name}${argsStr}${body}`;
  });
  return `${opType} {\n${blocks.join("\n")}\n}`;
}

/**
 * 从查询文本提取顶层字段选择集（双向同步反向通道：编辑器手写 → 勾选状态）
 *
 * `query { viewer { id login } repository(name: "x") { id } }`
 * → `{ opType: "query", fields: [{ name: "viewer", children: ["id", "login"] },
 *      { name: "repository", children: ["id"] }] }`
 * - 仅取第一个 OperationDefinition（GraphQL 单操作约定）
 * - 语法错误 → null（不反向同步，避免勾选错乱）；空文本 → `{ opType: "query", fields: [] }`
 *   （清空编辑器 → 清空勾选，严格双向同步）
 */
export function parseQueryFieldSelections(
  query: string,
): { opType: "query" | "mutation"; fields: { name: string; children: string[] }[] } | null {
  if (!query?.trim()) return { opType: "query", fields: [] };
  try {
    const doc = parse(query);
    const def = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    );
    if (!def || !def.selectionSet) return null;
    const opType = def.operation === "mutation" ? "mutation" : "query";
    const fields = (def.selectionSet.selections ?? [])
      .filter((s): s is FieldNode => s.kind === "Field")
      .map((f) => ({
        name: f.name.value,
        children: (f.selectionSet?.selections ?? [])
          .filter((s): s is FieldNode => s.kind === "Field")
          .map((c) => c.name.value),
      }));
    return { opType, fields };
  } catch {
    return null;
  }
}

/* ── 勾选状态机（GqlTree 勾选合并的纯函数核心，UI 无状态逻辑，全量可测） ── */

/**
 * 勾选条目：同操作类型共享 map；children 恒为「实际勾选的子字段名集」。
 *
 * 状态不变量（推演基线，toggle/normalize/parse 均维持；测试全量覆盖）：
 * - **不变量 1**：对象类型 root → entry 存在 ⇔ children.size > 0
 *   （勾选父级 = 全选可见子字段；取消最后一个子项 = 移除整个 entry）
 * - **不变量 2**：标量类型 root → children 恒空（无子字段），entry 存在即勾选
 * - **不变量 3**：生成 query 仅含实际勾选内容（无隐式默认字段/主键——不主键区分）
 * - **不变量 4**：父级三态 = 无 entry→unchecked / children 全满→checked /
 *   部分勾选→indeterminate；标量恒 checked（有 entry）
 * - **不变量 5**：正反向收敛——gqlMapToQuery 产物经 parseQueryFieldSelections +
 *   buildSelectionsFromParsed 归一后与原 map 相等（循环稳定不抖动）
 */
export interface GqlSelectionState {
  opType: "query" | "mutation";
  root: GqlFieldNode;
  children: Set<string>;
}

/** 勾选集合：`${opType}:${root.name}` → 勾选条目 */
export type GqlSelectionMap = Record<string, GqlSelectionState>;

const selKey = (opType: "query" | "mutation", rootName: string): string => `${opType}:${rootName}`;

/**
 * 勾选/取消顶层字段（父级 checkbox；勾选 = 唯一选中动作）：
 * - 勾选对象 root → children = 全部可见子字段名（**子项全自动勾选**）
 * - 勾选标量 root → children 空（裸字段调用）
 * - 取消 → 删除 entry（子项一并取消）
 */
export function toggleRootSelection(
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
): GqlSelectionMap {
  const key = selKey(opType, root.name);
  const next = { ...map };
  if (next[key]) {
    delete next[key];
  } else {
    next[key] = {
      opType,
      root,
      // 对象类型全选可见子字段；标量无子字段（空集）
      children: new Set((root.typeFields ?? []).map((f) => f.name)),
    };
  }
  return next;
}

/**
 * 勾选/取消子字段（子项 checkbox）：
 * - 勾选：entry 不存在则隐式建（仅勾选该子项）；已存在则追加
 * - 取消最后一个子项 → 移除 entry（维持不变量 1，父级随之变 unchecked，
 *   无默认字段兜底——严格「勾选什么写什么」）
 */
export function toggleChildSelection(
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
  childName: string,
): GqlSelectionMap {
  const key = selKey(opType, root.name);
  const next = { ...map };
  const cur = next[key] ?? { opType, root, children: new Set<string>() };
  const children = new Set(cur.children);
  if (children.has(childName)) {
    children.delete(childName);
    if (children.size === 0) {
      delete next[key];
    } else {
      next[key] = { opType, root, children };
    }
  } else {
    children.add(childName);
    next[key] = { opType, root, children };
  }
  return next;
}

/**
 * 手写 query 解析结果 → 归一化勾选集（反向同步入口，维持不变量）：
 * - 仅匹配 schema 顶层字段（非 schema 字段 / 内省字段跳过，不产生勾选）
 * - 对象 root 但 children 空（如手写 `viewer` 无 selection——非法查询）→ 跳过不勾选
 * - 标量 root → children 恒空保留（不变量 2）
 */
export function buildSelectionsFromParsed(
  opType: "query" | "mutation",
  fields: { name: string; children: string[] }[],
  roots: GqlFieldNode[],
): GqlSelectionMap {
  const next: GqlSelectionMap = {};
  for (const { name, children } of fields) {
    const root = roots.find((f) => f.name === name);
    if (!root) continue; // 非 schema 顶层字段（内省等）跳过
    if (!root.scalar && children.length === 0) continue; // 对象无 selection（非法）跳过
    next[selKey(opType, name)] = { opType, root, children: new Set(children) };
  }
  return next;
}

/**
 * 父级 checkbox 三态（checked / indeterminate / unchecked）：
 * - 无 entry → unchecked
 * - 对象：children 全满 → checked；部分 → indeterminate
 * - 标量：有 entry → 恒 checked
 */
export function gqlRootCheckState(
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
): "checked" | "indeterminate" | "unchecked" {
  const entry = map[selKey(opType, root.name)];
  if (!entry) return "unchecked";
  if (root.scalar) return "checked";
  const total = root.typeFields?.length ?? 0;
  return entry.children.size >= total ? "checked" : "indeterminate";
}

/** 勾选集合 → 查询文本（同操作类型拼接；空选择 → ""；严格「只有勾选才写入」） */
export function gqlMapToQuery(map: GqlSelectionMap, opType: "query" | "mutation"): string {
  const selections = Object.values(map)
    .filter((s) => s.opType === opType)
    .map(({ root, children }) => ({ root, children }));
  return selections.length > 0 ? gqlSelectionsToQuery(opType, selections) : "";
}
