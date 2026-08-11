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
  print,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type IntrospectionQuery,
  type OperationDefinitionNode,
  type FieldNode,
  type ValueNode,
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
  // eslint-disable-next-line no-underscore-dangle -- __schema 为 GraphQL 内省协议强制字段名，非代码命名
  const schemaData = (json.data as { __schema?: unknown } | null)?.__schema;
  if (!schemaData) throw new Error("introspection 无 __schema");
  // eslint-disable-next-line no-underscore-dangle -- 同上：GraphQL 内省协议强制字段名
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
  /** 返回类型最内层命名类型名（标量/枚举为自身；对象/接口/union 为内层类型名）——惰性展开与 connection 识别用 */
  ofTypeName: string;
  /** 返回类型是否为 connection（ofTypeName 以 Connection 结尾的对象）——勾选 nodes 自动展开元素类型用 */
  isConnection: boolean;
  /** 返回类型的一层子字段（对象/接口；union 无字段）——Schema 树展开浏览用，更深层由 ctx.fieldsOf 惰性取 */
  typeFields?: GqlFieldNode[];
  /** union 返回：possibleTypes 类型名列表（展开浏览显示可并集类型） */
  possibleTypes?: string[];
  deprecated?: boolean;
  desc?: string;
}

/**
 * Schema 查询上下文：惰性字段层解析（buildGqlSchemaContext 工厂，内存缓存、零网络）。
 * 任意深度展开时按类型名即时取字段层，避免预构建整棵递归树（防无限膨胀）。
 */
export interface GqlSchemaContext {
  /** query/mutation 根类型名（变量定义与顶层字段解析用） */
  queryTypeName: string;
  mutationTypeName: string;
  /** 取命名类型的字段层（对象/接口 → 字段；union → 空数组；标量/枚举/未知 → undefined） */
  fieldsOf(typeName: string): GqlFieldNode[] | undefined;
}

/**
 * 从运行时 schema 构建惰性字段层解析上下文。fieldsOf 内部缓存各类型字段层——
 * 展开过的类型零重复构建；未知/标量类型返回 undefined（叶子）。
 */
export function buildGqlSchemaContext(schema: GraphQLSchema): GqlSchemaContext {
  const cache = new Map<string, GqlFieldNode[]>();
  const fieldsOf = (typeName: string): GqlFieldNode[] | undefined => {
    const hit = cache.get(typeName);
    if (hit) return hit;
    const t = schema.getType(typeName);
    if (!t) return undefined;
    if (isObjectType(t) || isInterfaceType(t)) {
      const fields = collectFields(t as GraphQLObjectType);
      cache.set(typeName, fields);
      return fields;
    }
    if (isUnionType(t)) {
      cache.set(typeName, []);
      return [];
    }
    return undefined;
  };
  return {
    queryTypeName: schema.getQueryType()?.name ?? "",
    mutationTypeName: schema.getMutationType()?.name ?? "",
    fieldsOf,
  };
}

/** 展开 NON_NULL/LIST 找到最内层命名类型（剥壳后必为命名类型，供 name/ofTypeName 直接访问） */
function unwrapToNamed(t: GraphQLType | null): GraphQLNamedType | null {
  let cur = t;
  while (cur && (isNonNullType(cur) || isListType(cur))) {
    cur = cur.ofType;
  }
  return cur as GraphQLNamedType | null;
}

/** 类型引用链 → 展示文本（Repository!、[User!]!） */
function typeLabel(t: GraphQLType | null): string {
  if (!t) return "";
  if (isNonNullType(t)) return `${typeLabel(t.ofType)}!`;
  if (isListType(t)) return `[${typeLabel(t.ofType)}]`;
  return t.name;
}

/** 展开浏览：顶层字段的返回类型子字段上限（再展开一层；更深层由 UI 惰性触发） */
const TYPE_FIELD_MAX = 30;

/** 字段排序：普通字符序（不区分主键——勾选合并无隐式默认字段，`id` 无特殊地位） */
const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * 收集类型字段列表（一层，不含递归 typeFields——深层由 ctx.fieldsOf 惰性展开）。
 * 每个字段携带 ofTypeName/isConnection，供任意深度解析与 connection 识别。
 */
function collectFields(type: GraphQLObjectType): GqlFieldNode[] {
  return Object.values(type.getFields())
    .sort(byName)
    .map((f: GraphQLField<unknown, unknown>) => {
      const inner = unwrapToNamed(f.type);
      const scalar = inner !== null && (isScalarType(inner) || isEnumType(inner));
      // connection 识别：内层类型为以 Connection 结尾的对象（if 守卫显式收窄，兼容 strict 谓词链）
      let isConnection = false;
      if (inner !== null && isObjectType(inner)) {
        isConnection = inner.name.endsWith("Connection");
      }
      const node: GqlFieldNode = {
        name: f.name,
        args: f.args.map((a) => ({
          name: a.name,
          required: isNonNullType(a.type),
          typeLabel: typeLabel(a.type),
        })),
        returnLabel: typeLabel(f.type),
        scalar,
        ofTypeName: inner?.name ?? "",
        isConnection,
        deprecated: f.deprecationReason != null || undefined,
        desc: f.description?.slice(0, 100) || undefined,
      };
      if (inner !== null && isUnionType(inner)) {
        node.possibleTypes = schemaPossibleTypes(inner);
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

/**
 * 从运行时 schema 构建 query/mutation 顶层字段树。
 * 顶层字段附带一层 typeFields（惰性展开的浏览起点）；更深层由 GqlSchemaContext.fieldsOf 按需取。
 */
export function buildGqlFieldTree(schema: GraphQLSchema): GqlSchemaTree {
  const ctx = buildGqlSchemaContext(schema);
  const top = (t: GraphQLObjectType | null | undefined): GqlFieldNode[] =>
    t
      ? collectFields(t).map((n) =>
          n.scalar || n.possibleTypes
            ? n
            : {
                ...n,
                typeFields: ctx.fieldsOf(n.ofTypeName)?.slice(0, TYPE_FIELD_MAX),
              },
        )
      : [];
  return { query: top(schema.getQueryType()), mutation: top(schema.getMutationType()) };
}

/* ── 勾选合并 → 查询构造（递归 + 变量提取） ─────────────── */

/** 勾选集合 → 查询文档 + 变量定义/骨架（gqlMapToQueryDetailed 返回值） */
export interface GqlQueryResult {
  query: string;
  /** 变量定义参数名列表（如 ["owner", "name"]）——拼接为 `($owner: String!, ...)` */
  varDefs: string[];
  /** 变量 JSON 骨架（变量名 → 初始值；标量/枚举/input 统一空字符串，UI 层按类型渲染辅助） */
  varJson: Record<string, string>;
}

/**
 * 收集字段参数文本并提取 $var 变量定义（递归遍历时共用 defs/json 累加器）。
 * - 值为 `$name`（变量引用）→ 变量定义 `name: 参数类型` + JSON 骨架 `name: ""`
 * - 值为字面量 → 原样输出
 */
function collectArgText(
  field: GqlFieldNode,
  args: Record<string, string>,
  defs: Set<string>,
  json: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (value.startsWith("$")) {
      const varName = value.slice(1);
      const arg = field.args.find((a) => a.name === name);
      if (arg) {
        defs.add(`${varName}: ${arg.typeLabel}`);
        json[varName] = "";
      }
    }
    parts.push(`${name}: ${value}`);
  }
  return parts.join(", ");
}

/**
 * 递归生成单个字段的选择文本（AST 式缩进；含变量提取累加）。
 * `field(args) {\n  child1\n  child2 { ... }\n}`
 */
function nodeToQueryText(
  ctx: GqlSchemaContext,
  field: GqlFieldNode,
  node: GqlSelectionNode,
  indent: number,
  defs: Set<string>,
  json: Record<string, string>,
): string {
  const argsStr = collectArgText(field, node.args, defs, json);
  const children = node.children ?? {};
  const keys = Object.keys(children);
  let text = `${field.name}${argsStr ? `(${argsStr})` : ""}`;
  if (keys.length > 0) {
    const childFields = ctx.fieldsOf(field.ofTypeName) ?? [];
    const body: string[] = [];
    for (const [childName, childNode] of Object.entries(children)) {
      const cf = childFields.find((f) => f.name === childName);
      if (!cf) continue; // 非 schema 字段（防御）
      body.push("  ".repeat(indent) + nodeToQueryText(ctx, cf, childNode, indent + 1, defs, json));
    }
    text += ` {\n${body.join("\n")}\n${"  ".repeat(indent - 1)}}`;
  }
  return text;
}

/**
 * 勾选集合 → 查询文档 + 变量定义/JSON 骨架（同操作类型多字段拼接为单个 selection set）。
 *
 * `query($owner: String!) {\n  repository(owner: $owner) {\n    id\n  }\n}`
 * - body = 实际勾选的子字段（无隐式默认字段/主键）
 * - 必填参数 → `$var` 变量引用（不再内联字面量占位——非法 GraphQL 的根治）
 */
export function gqlMapToQueryDetailed(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
): GqlQueryResult {
  const defs = new Set<string>();
  const json: Record<string, string> = {};
  const rootTypeName = opType === "query" ? ctx.queryTypeName : ctx.mutationTypeName;
  const rootFields = ctx.fieldsOf(rootTypeName) ?? [];
  const blocks: string[] = [];
  for (const [key, node] of Object.entries(map)) {
    if (!key.startsWith(`${opType}:`)) continue;
    const rootName = key.slice(opType.length + 1);
    const root = rootFields.find((f) => f.name === rootName);
    if (!root) continue; // 非 schema 字段（防御）
    blocks.push("  " + nodeToQueryText(ctx, root, node, 2, defs, json));
  }
  const varDefStr = defs.size > 0 ? `(${[...defs].map((d) => `$${d}`).join(", ")})` : "";
  return {
    query: blocks.length > 0 ? `${opType}${varDefStr} {\n${blocks.join("\n")}\n}` : "",
    varDefs: [...defs],
    varJson: json,
  };
}

/** 勾选集合 → 查询文本（空选择 → ""；严格「只有勾选才写入」） */
export function gqlMapToQuery(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
): string {
  return gqlMapToQueryDetailed(ctx, map, opType).query;
}

/**
 * 从查询文本提取顶层字段选择集（双向同步反向通道：编辑器手写 → 勾选状态）
 *
 * `query { viewer { id login } repository(name: "x") { id } }`
 * → `{ opType: "query", fields: [{ name: "viewer", children: [{ name: "id", ... }] }] }`
 * - 任意深度递归（Field kind 过滤，fragment/inline fragment 跳过）
 * - 参数值用 graphql print 原样还原（$var 引用 / 字面量）
 * - 仅取第一个 OperationDefinition（GraphQL 单操作约定）
 * - 语法错误 → null（不反向同步，避免勾选错乱）；空文本 → `{ opType: "query", fields: [] }`
 *   （清空编辑器 → 清空勾选，严格双向同步）
 */
export interface ParsedField {
  name: string;
  /** 参数名 → 值文本（$var 引用或字面量，print 还原） */
  args: Record<string, string>;
  children: ParsedField[];
}

function parseFieldNode(f: FieldNode): ParsedField {
  const args: Record<string, string> = {};
  for (const a of f.arguments ?? []) {
    args[a.name.value] = print(a.value as ValueNode);
  }
  return {
    name: f.name.value,
    args,
    children: (f.selectionSet?.selections ?? [])
      .filter((s): s is FieldNode => s.kind === "Field")
      .map(parseFieldNode),
  };
}

export function parseQueryFieldSelections(
  query: string,
): { opType: "query" | "mutation"; fields: ParsedField[] } | null {
  if (!query?.trim()) return { opType: "query", fields: [] };
  try {
    const doc = parse(query);
    const def = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    );
    if (!def || !def.selectionSet) return null;
    const opType = def.operation === "mutation" ? "mutation" : "query";
    return {
      opType,
      fields: (def.selectionSet.selections ?? [])
        .filter((s): s is FieldNode => s.kind === "Field")
        .map(parseFieldNode),
    };
  } catch {
    return null;
  }
}

/* ── 勾选状态机（嵌套树，纯函数核心，UI 无状态逻辑，全量可测） ── */

/**
 * 勾选树节点：对象字段 → children 嵌套；标量字段 → 叶。
 * args = 已设定参数（必填参数勾选时自动提取为 `$name` 变量引用；可选参数用户手填字面量）。
 *
 * 状态不变量（toggle/normalize/parse 均维持；测试全量覆盖）：
 * - **不变量 1**：对象字段节点存在 ⇔ children 非空（空 selection 非法查询）
 *   （勾选对象字段 = 注入默认字段集；取消最后一个子项 → 级联移除父节点）
 * - **不变量 2**：标量字段节点恒为叶（无 children），存在即勾选
 * - **不变量 3**：生成 query 严格 = 勾选内容（默认字段集仅在「初次勾选对象字段」时注入一次）
 * - **不变量 4**：父级三态按子树递归——全满 → checked / 部分 → indeterminate /
 *   无 → unchecked；标量恒 checked（有节点）
 * - **不变量 5**：正反向收敛——gqlMapToQueryDetailed 产物经 parseQueryFieldSelections +
 *   buildSelectionsFromParsed 归一后与原 map 相等（循环稳定不抖动）
 */
export interface GqlSelectionNode {
  args: Record<string, string>;
  children?: Record<string, GqlSelectionNode>;
}

/** 勾选集合：`${opType}:${root.name}` → 顶层字段的嵌套勾选树 */
export type GqlSelectionMap = Record<string, GqlSelectionNode>;

const selKey = (opType: "query" | "mutation", rootName: string): string => `${opType}:${rootName}`;

/** 必填参数 → `$name` 变量引用（字段调用需带必填参数；勾选即提取） */
function requiredArgVars(field: GqlFieldNode): Record<string, string> {
  const args: Record<string, string> = {};
  for (const a of field.args) if (a.required) args[a.name] = `$${a.name}`;
  return args;
}

/** 默认字段集（fillLeafs 思想）：勾选对象 → 只填充「第一个不可展开标量」——
 * 统一数量（恒 1 个）、统一内容（首个无必填参数标量，按字符序）；
 * 全可展开 → 沿第一项递归深入直至找到叶子（防类型环深度上限）。
 * 无叶子对象（纯聚合/Query 根）→ children 空（nodeToQueryText 输出裸字段，极端边界） */
const DEFAULT_DEPTH_MAX = 4;

/** 在类型字段层找「第一个不可展开标量」（字符序，无必填参数）；全可展开 → 递归第一项 */
function firstLeafField(
  ctx: GqlSchemaContext,
  typeName: string,
  depth: number,
): GqlFieldNode | null {
  if (depth > DEFAULT_DEPTH_MAX) return null;
  const fields = ctx.fieldsOf(typeName) ?? [];
  // 第一遍：第一个无必填参数的标量（不可展开 = 叶子）
  for (const f of fields) {
    if (f.scalar && !f.args.some((a) => a.required)) return f;
  }
  // 全部可展开（或标量均带必填参数）→ 沿第一个可展开字段递归深入
  for (const f of fields) {
    if (!f.scalar) {
      const leaf = firstLeafField(ctx, f.ofTypeName, depth + 1);
      if (leaf) return leaf;
    }
  }
  return null;
}

/**
 * 勾选对象字段 → 构建默认子树：只填充「第一个不可展开标量」——
 * - 普通对象 / connection 统一规则（connection 的 totalCount 恰好是字符序首标量）
 * - args = 必填参数 → `$var` 引用（顶层如 codeOfConduct(key: $key)）
 * - 全可展开 → firstLeafField 递归深入
 */
function buildDefaultSubtree(
  ctx: GqlSchemaContext,
  field: GqlFieldNode,
  depth = 0,
): GqlSelectionNode {
  const children: Record<string, GqlSelectionNode> = {};
  const leaf = firstLeafField(ctx, field.ofTypeName, depth);
  if (leaf) children[leaf.name] = { args: requiredArgVars(leaf) };
  return { args: requiredArgVars(field), children };
}

function cloneNode(n: GqlSelectionNode): GqlSelectionNode {
  return {
    args: { ...n.args },
    children: n.children
      ? Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, cloneNode(v)]))
      : undefined,
  };
}

/** 沿路径取节点（path=[] → 根自身）；路径断裂返回 undefined */
function nodeAt(root: GqlSelectionNode, path: string[]): GqlSelectionNode | undefined {
  let cur: GqlSelectionNode | undefined = root;
  for (const seg of path) {
    cur = cur?.children?.[seg];
    if (!cur) return undefined;
  }
  return cur;
}

/** 沿 schema 解析路径处的字段（path=[] → root 自身）；非 schema 路径返回 undefined */
function fieldAtPath(
  ctx: GqlSchemaContext,
  root: GqlFieldNode,
  path: string[],
): GqlFieldNode | undefined {
  let cur: GqlFieldNode = root;
  for (const seg of path) {
    const fields = ctx.fieldsOf(cur.ofTypeName);
    const next = fields?.find((f) => f.name === seg);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

/**
 * 删除路径处节点；若其父 children 变空 → 级联删除父（维持不变量 1）。
 * 返回是否实际删除（路径断裂返回 false）。
 */
function deleteNodeCascade(root: GqlSelectionNode, path: string[]): boolean {
  if (path.length === 0) return false;
  const last = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length === 0 ? root : nodeAt(root, parentPath);
  if (!parent) return false;
  const children = { ...(parent.children ?? {}) };
  if (!(last in children)) return false;
  delete children[last];
  if (parentPath.length === 0) {
    root.children = children;
  } else if (Object.keys(children).length === 0) {
    deleteNodeCascade(root, parentPath); // 父变空 → 级联删除父
  } else {
    parent.children = children;
  }
  return true;
}

/**
 * 勾选/取消顶层字段（父级 checkbox；path=[]）：
 * - 勾选对象 root → 注入默认子树（buildDefaultSubtree，非全选可见子字段）
 * - 勾选标量 root → 叶（args 含必填参数 → $var）
 * - 取消 → 删除 entry（整棵子树移除）
 */
export function toggleRootSelection(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
): GqlSelectionMap {
  return toggleFieldSelection(ctx, map, opType, root, []);
}

/**
 * 勾选/取消任意深度字段（path 从 root 下一层开始，如 ["issues", "nodes", "title"]）：
 * - 勾选：目标字段 = 标量叶 / 对象默认子树；父链缺失 → 隐式建（空 children + 必填参数 $var）
 * - 取消：删除该节点；父 children 变空 → 级联删除父（不变量 1）
 * - 非 schema 路径 → 原 map 返回（防御）
 */
export function toggleFieldSelection(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
  path: string[],
): GqlSelectionMap {
  const field = fieldAtPath(ctx, root, path);
  if (!field) return map; // 防御：路径无效
  const key = selKey(opType, root.name);
  const next = { ...map };
  const existing = next[key] ? cloneNode(next[key]) : undefined;
  const target = existing ? nodeAt(existing, path) : undefined;
  if (target) {
    // 取消勾选
    if (path.length === 0) {
      delete next[key];
      return next;
    }
    const removed = deleteNodeCascade(existing!, path);
    if (removed && existing!.children && Object.keys(existing!.children).length === 0) {
      delete next[key]; // root children 清空 → 移除整个 entry
    } else {
      next[key] = existing!;
    }
    return next;
  }
  // 勾选：目标节点 = 标量叶 / 对象默认子树
  const node = field.scalar ? { args: requiredArgVars(field) } : buildDefaultSubtree(ctx, field);
  let rootNode: GqlSelectionNode;
  if (existing) {
    rootNode = existing;
  } else if (path.length === 0) {
    rootNode = node;
  } else {
    // 隐式建 root entry（不注入默认集——只勾选子字段时保持父级从简）
    rootNode = { args: requiredArgVars(root), children: {} };
  }
  // 确保父链存在（父缺失 → 隐式建空节点 + 必填参数）
  let cur = rootNode;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!cur.children?.[seg]) {
      const pf = fieldAtPath(ctx, root, path.slice(0, i + 1));
      if (!pf) return map; // 防御
      const children = { ...(cur.children ?? {}) };
      children[seg] = pf.scalar
        ? { args: requiredArgVars(pf) }
        : { args: requiredArgVars(pf), children: {} };
      cur.children = children;
    }
    cur = cur.children![seg];
  }
  // 仅 path 非空时挂载目标字段（path=[] 时 rootNode 已是目标节点，避免 path[-1] 为 undefined 自引用）
  if (path.length > 0) {
    const children = { ...(cur.children ?? {}) };
    children[path[path.length - 1]] = node;
    cur.children = children;
  }
  next[key] = rootNode;
  return next;
}

/**
 * 手写 query 解析结果 → 归一化勾选集（反向同步入口，维持不变量）：
 * - 仅匹配 schema 字段（非 schema 字段 / 内省字段跳过，不产生勾选）
 * - 对象字段 children 空（如手写 `viewer` 无 selection——非法查询）→ 跳过不勾选
 * - 标量字段 → args 保留、无 children（不变量 2）
 */
export function buildSelectionsFromParsed(
  ctx: GqlSchemaContext,
  opType: "query" | "mutation",
  fields: ParsedField[],
  roots: GqlFieldNode[],
): GqlSelectionMap {
  const next: GqlSelectionMap = {};
  for (const f of fields) {
    const root = roots.find((r) => r.name === f.name);
    if (!root) continue;
    if (!root.scalar && f.children.length === 0) continue; // 对象无 selection（非法）跳过
    const node = parsedToNode(ctx, root, f);
    if (node) next[selKey(opType, f.name)] = node;
  }
  return next;
}

/** ParsedField → 勾选树节点（递归；对象空 selection / 非 schema 字段跳过 → undefined） */
function parsedToNode(
  ctx: GqlSchemaContext,
  field: GqlFieldNode,
  parsed: ParsedField,
): GqlSelectionNode | undefined {
  const children: Record<string, GqlSelectionNode> = {};
  if (!field.scalar) {
    const fields = ctx.fieldsOf(field.ofTypeName) ?? [];
    for (const c of parsed.children) {
      const cf = fields.find((f) => f.name === c.name);
      if (!cf) continue; // 非 schema 字段跳过
      const node = parsedToNode(ctx, cf, c);
      if (node) children[c.name] = node;
    }
  }
  if (!field.scalar && Object.keys(children).length === 0) return undefined; // 对象空 selection（不变量 1）
  return { args: { ...parsed.args }, children };
}

/**
 * 父级 checkbox 三态（checked / indeterminate / unchecked）：
 * - 无节点 → unchecked
 * - 对象：children 全满 → checked；部分 → indeterminate
 * - 标量：有节点 → 恒 checked
 */
export function gqlRootCheckState(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
): "checked" | "indeterminate" | "unchecked" {
  return gqlFieldCheckState(ctx, map, opType, root, []);
}

/** 任意深度三态（path 从 root 下一层开始；供深层 UI 展开） */
export function gqlFieldCheckState(
  ctx: GqlSchemaContext,
  map: GqlSelectionMap,
  opType: "query" | "mutation",
  root: GqlFieldNode,
  path: string[],
): "checked" | "indeterminate" | "unchecked" {
  const entry = map[selKey(opType, root.name)];
  if (!entry) return "unchecked";
  const node = nodeAt(entry, path);
  if (!node) return "unchecked";
  const field = fieldAtPath(ctx, root, path);
  if (!field) return "unchecked";
  if (field.scalar) return "checked";
  const total = ctx.fieldsOf(field.ofTypeName)?.length ?? 0;
  const checkedCount = Object.keys(node.children ?? {}).length;
  if (checkedCount === 0) return "unchecked";
  return checkedCount >= total ? "checked" : "indeterminate";
}

/** 两个勾选集合深比较（key 集 + 每节点 args/children 递归相等）——反向同步防循环抖动 */
export function gqlMapsEqual(a: GqlSelectionMap, b: GqlSelectionMap): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => gqlNodesEqual(a[k], b[k]));
}

function gqlNodesEqual(a: GqlSelectionNode, b: GqlSelectionNode): boolean {
  const aa = Object.entries(a.args);
  if (aa.length !== Object.keys(b.args).length) return false;
  if (aa.some(([k, v]) => b.args[k] !== v)) return false;
  const ka = Object.keys(a.children ?? {}).sort();
  const kb = Object.keys(b.children ?? {}).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => gqlNodesEqual(a.children![k], b.children![k]));
}
