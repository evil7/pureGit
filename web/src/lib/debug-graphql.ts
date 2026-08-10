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
 * - L1 左栏 Schema 树：query/mutation 顶层字段 → 点按生成「即用」查询模板；
 *   字段可**展开返回类型的子字段**（从外向内浏览，数据已在内存 schema，零请求）
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
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type IntrospectionQuery,
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
  /** 预计算的子字段名（对象/接口返回时取前 N 个标量字段） */
  childFields: string[];
  /** 返回类型的一层子字段（对象/接口；union 无字段）——Schema 树展开浏览用 */
  typeFields?: GqlFieldNode[];
  /** union 返回：possibleTypes 类型名列表（展开浏览显示可并集类型） */
  possibleTypes?: string[];
  deprecated?: boolean;
  desc?: string;
}

/** 模板生成的子字段数量上限（够「即用」不膨胀） */
const CHILD_FIELD_MAX = 4;

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

/**
 * 收集类型字段列表（含展开浏览所需数据）。deep=true 时附加返回类型的一层子字段
 * （typeFields）与 union possibleTypes；deep=false 仅自身字段（避免递归膨胀）。
 */
function collectFields(type: GraphQLObjectType, deep = false): GqlFieldNode[] {
  return Object.values(type.getFields())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f: GraphQLField<unknown, unknown>) => {
      const inner = unwrapToNamed(f.type);
      const scalar = inner !== null && (isScalarType(inner) || isEnumType(inner));
      // 对象/接口返回 → 预取标量子字段（按名排序取前 N，避免递归膨胀）
      const childFields =
        !scalar && inner !== null && isObjectType(inner)
          ? Object.values(inner.getFields())
              .filter((cf) => {
                const ct = unwrapToNamed(cf.type);
                return ct !== null && (isScalarType(ct) || isEnumType(ct));
              })
              .sort((a, b) => a.name.localeCompare(b.name))
              .slice(0, CHILD_FIELD_MAX)
              .map((cf) => cf.name)
          : [];
      const node: GqlFieldNode = {
        name: f.name,
        args: f.args.map((a) => ({
          name: a.name,
          required: isNonNullType(a.type),
          typeLabel: typeLabel(a.type),
        })),
        returnLabel: typeLabel(f.type),
        scalar,
        childFields,
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

/** 生成即用查询体：query { field(args) { 子字段 } }（仅必填参数给示例占位，可选参数省略） */
export function gqlFieldToQuery(field: GqlFieldNode, opType: "query" | "mutation"): string {
  const args = field.args
    .filter((a) => a.required)
    .map((a) => `${a.name}: ${exampleArgValue(a.typeLabel)}`)
    .join(", ");
  const argsStr = args ? `(${args})` : "";
  const body = field.childFields.length ? ` {\n    ${field.childFields.join("\n    ")}\n  }` : "";
  return `${opType} {\n  ${field.name}${argsStr}${body}\n}`;
}

/**
 * 展开浏览：点击返回类型的某个子字段 → 生成只含该子字段的查询
 * `query { root(args) { child } }`（child 通常为标量；对象子字段再展开由 UI 层控制）
 */
export function gqlChildToQuery(
  root: GqlFieldNode,
  child: GqlFieldNode,
  opType: "query" | "mutation",
): string {
  const args = root.args
    .filter((a) => a.required)
    .map((a) => `${a.name}: ${exampleArgValue(a.typeLabel)}`)
    .join(", ");
  const argsStr = args ? `(${args})` : "";
  return `${opType} {\n  ${root.name}${argsStr} {\n    ${child.name}\n  }\n}`;
}
