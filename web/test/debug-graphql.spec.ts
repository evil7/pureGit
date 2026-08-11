/**
 * ============================================================================
 * debug-graphql.ts 单元测试 —— GraphQL Schema 树 / 嵌套树勾选状态机 / 查询构造质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * `/$debug` 调试客户端 GraphQL 侧全部纯函数逻辑的**独立全覆盖质量门**（与 REST 侧
 * debug-params / debug-openapi / schema-integration 三文件分工：REST 管 REST，
 * 本文件管 GraphQL）。覆盖五层：Schema 树构建（buildGqlFieldTree +
 * buildGqlSchemaContext 惰性展开）、嵌套树勾选状态机（toggleRootSelection /
 * toggleFieldSelection / buildSelectionsFromParsed / gqlRootCheckState /
 * gqlFieldCheckState）、查询构造（gqlMapToQuery / gqlMapToQueryDetailed 含 $var
 * 变量提取）、反向解析（parseQueryFieldSelections），以及正反向收敛一致性（不变量 5）。
 *
 * 【业务基线（2026-08-11 M1 重构定稿，勿改）】
 * 1. **只有被勾选才写入**：生成 query 严格 = 勾选内容，无隐式默认字段/主键；
 *    对象字段默认集仅在「初次勾选该对象字段」时注入一次（fillLeafs 思想）
 * 2. **点击树项仅展开**：勾选（checkbox）= 唯一选中动作（组件层行为，本文件测状态机）
 * 3. **不主键区分**：排序普通字符序（id 无特殊地位；默认集 = 首个无必填标量）
 * 4. **参数模式**：必填参数 → `$var` 变量引用（非内联字面量——非法 GraphQL 根治）；
 *    可选参数用户手填字面量原样输出
 * 5. 状态不变量（toggle/normalize/parse 全程维持）：
 *    - 不变量 1：对象字段节点存在 ⇔ children 非空（空 selection 非法查询；
 *      取消最后一个子项 → 级联移除父节点直至顶层 entry）
 *    - 不变量 2：标量字段节点恒为叶（无 children），存在即勾选
 *    - 不变量 3：生成 query 仅含勾选内容
 *    - 不变量 4：父级三态 = unchecked / indeterminate（部分）/ checked（全满或标量）
 *    - 不变量 5：正反向收敛——gqlMapToQueryDetailed 产物 → parse →
 *      buildSelectionsFromParsed 归一后与原 map 相等（循环稳定不抖动）
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                            │ 用例（it 标题）        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. buildGqlFieldTree / ctx：                        │ 顶层字段字符序         │
 * │    - 顶层字段按普通字符序（id 不特殊）                │ typeFields 字符序       │
 * │    - typeFields 一层子字段（对象/接口返回）            │ union possibleTypes    │
 * │    - union 返回 → possibleTypes；无 typeFields       │ 标量字段               │
 * │    - 标量返回 → scalar=true 无 typeFields            │ ofTypeName/isConnection│
 * │    - ofTypeName 内层类型名 / isConnection 识别        │ deprecated / args      │
 * │    - deprecated 标记 / args required / returnLabel   │ 无 childFields 残留    │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. toggleRootSelection：                             │ 勾选对象 → 默认子树    │
 * │    - 勾选对象 root → 注入默认子树（首个无必填标量）   │ 标量 root 叶           │
 * │    - connection root → totalCount（字符序首标量）    │ connection 默认子树    │
 * │    - 勾选标量 root → 叶（args 必填 → $var）           │ 取消 → 移除 entry      │
 * │    - 再勾选 = 取消 → 移除 entry                       │ 纯函数不修改原 map     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. toggleFieldSelection（任意深度）：                 │ 隐式建父级 entry       │
 * │    - 子字段勾选隐式建父级 entry（不注入默认集）        │ 深层 3 级路径          │
 * │    - 深层路径沿 schema 解析（3 级可表达）             │ 取消深层 → 级联到顶层  │
 * │    - 取消最后一个子项 → 级联移除至顶层 entry（不变量 1）│ 追加子项               │
 * │    - 取消非最后子项 → 保留                            │ 非 schema 路径防御     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. buildSelectionsFromParsed（反向归一化）：          │ schema 字段建 entry    │
 * │    - 匹配 schema 顶层字段建 entry                    │ 非 schema 字段跳过     │
 * │    - 非 schema 字段 / 内省字段跳过                    │ 对象空 selection 跳过   │
 * │    - 对象空 selection（非法查询）跳过                  │ 标量空 selection 保留   │
 * │    - 标量空 selection 保留                            │ mutation 匹配自身根    │
 * │    - args 还原（$var 引用 / 字面量）                  │ args 还原 / 深层还原    │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 5. gqlRootCheckState / gqlFieldCheckState（三态）：  │ 无 entry → unchecked   │
 * │    - 无 entry → unchecked                            │ 对象部分 → indeterminate│
 * │    - 对象全满 → checked / 部分 → indeterminate        │ 标量恒 checked          │
 * │    - 标量有 entry → checked                           │ 深层三态（path）        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 6. gqlMapToQuery / gqlMapToQueryDetailed：           │ 多字段同操作拼接        │
 * │    - 同操作类型多字段拼接为单个 selection set          │ 必填参数 → $var 提取    │
 * │    - 必填参数 → $var 变量定义 + JSON 骨架              │ mutation input $var    │
 * │    - 对象 root 只输出勾选子字段（无默认 id）           │ 标量 root 无 body       │
 * │    - 标量 root 无 selection set                       │ 深层递归嵌套           │
 * │    - 空选择 → 空字符串                                │ 空 map → 空字符串      │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 7. parseQueryFieldSelections：                        │ 正常解析顶层字段        │
 * │    - 提取顶层字段（Field kind 过滤）                  │ 深层 children 递归      │
 * │    - 深层递归；args 用 print 还原                     │ args 还原               │
 * │    - 语法错误 → null；空文本 → 空 fields               │ 语法错误 / 空文本       │
 * │    - 多操作取第一个；mutation opType                  │ 多操作取首个 / mutation │
 * │    - fragment/inline fragment 跳过                   │ fragment 过滤           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 8. 不变量 5（正反向收敛）：                            │ 部分勾选收敛            │
 * │    gqlMapToQuery → parse → buildSelectionsFromParsed │ 默认集勾选收敛          │
 * │    = 原 map（循环稳定，双向不抖动）                    │ $var 参数收敛 / 标量    │
 * │                                                       │ 多字段混合 / 空收敛     │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from "vitest";
import { buildClientSchema, type GraphQLSchema } from "graphql";
import {
  buildGqlFieldTree,
  buildGqlSchemaContext,
  buildSelectionsFromParsed,
  gqlFieldCheckState,
  gqlMapToQuery,
  gqlMapToQueryDetailed,
  gqlMapsEqual,
  gqlRootCheckState,
  parseQueryFieldSelections,
  toggleFieldSelection,
  toggleRootSelection,
  type GqlFieldNode,
  type GqlSchemaContext,
  type GqlSelectionMap,
} from "@/lib/debug-graphql";

/* ── mini schema 夹具（覆盖 object/interface/union/enum/scalar/list/non-null/input/deprecated） ── */

/** TypeRef 辅助：标量 */
const S = (name: string) => ({ kind: "SCALAR", name });
/** TypeRef 辅助：非空 */
const NN = (ofType: unknown) => ({ kind: "NON_NULL", ofType });
/** TypeRef 辅助：列表 */
const L = (ofType: unknown) => ({ kind: "LIST", ofType });

/** 精简 introspection 夹具：Query（5 字段）+ User/Repository 链 + Node 接口 + SearchResultItem union + mutation */
function miniIntrospection(): unknown {
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
              name: "node",
              args: [{ name: "id", type: NN(S("ID")) }],
              type: { kind: "INTERFACE", name: "Node" },
            },
            {
              name: "search",
              args: [
                { name: "query", type: NN(S("String")) },
                { name: "type", type: NN({ kind: "ENUM", name: "SearchType" }) },
                { name: "first", type: S("Int") },
              ],
              type: NN({ kind: "OBJECT", name: "SearchResultItemConnection" }),
            },
            {
              name: "searchResult",
              args: [],
              type: { kind: "UNION", name: "SearchResultItem" },
            },
            { name: "scalarField", args: [], type: NN(S("String")) },
            {
              name: "deprecatedField",
              args: [],
              type: S("String"),
              description: "Old field, use viewer",
              isDeprecated: true,
              deprecationReason: "Use viewer instead",
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
            { name: "name", args: [], type: S("String") },
            { name: "email", args: [], type: NN(S("String")) },
            { name: "avatarUrl", args: [], type: NN({ kind: "SCALAR", name: "URI" }) },
            {
              name: "repositories",
              args: [],
              type: NN({ kind: "OBJECT", name: "RepositoryConnection" }),
            },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
        },
        {
          kind: "OBJECT",
          name: "Repository",
          fields: [
            { name: "id", args: [], type: NN(S("ID")) },
            { name: "name", args: [], type: NN(S("String")) },
            { name: "description", args: [], type: S("String") },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
        },
        {
          kind: "OBJECT",
          name: "RepositoryConnection",
          fields: [
            { name: "totalCount", args: [], type: NN(S("Int")) },
            { name: "edges", args: [], type: NN(L({ kind: "OBJECT", name: "RepositoryEdge" })) },
          ],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "RepositoryEdge",
          fields: [{ name: "node", args: [], type: { kind: "OBJECT", name: "Repository" } }],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "SearchResultItemConnection",
          fields: [
            { name: "totalCount", args: [], type: NN(S("Int")) },
            {
              name: "edges",
              args: [],
              type: NN(L({ kind: "OBJECT", name: "SearchResultItemEdge" })),
            },
          ],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "SearchResultItemEdge",
          fields: [{ name: "node", args: [], type: { kind: "UNION", name: "SearchResultItem" } }],
          interfaces: [],
        },
        {
          kind: "INTERFACE",
          name: "Node",
          fields: [{ name: "id", args: [], type: NN(S("ID")) }],
          interfaces: [],
        },
        {
          kind: "UNION",
          name: "SearchResultItem",
          possibleTypes: [
            { kind: "OBJECT", name: "Issue" },
            { kind: "OBJECT", name: "PullRequest" },
          ],
        },
        {
          kind: "OBJECT",
          name: "Issue",
          fields: [
            { name: "id", args: [], type: NN(S("ID")) },
            { name: "title", args: [], type: NN(S("String")) },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
        },
        {
          kind: "OBJECT",
          name: "PullRequest",
          fields: [
            { name: "id", args: [], type: NN(S("ID")) },
            { name: "title", args: [], type: NN(S("String")) },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
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
        {
          kind: "SCALAR",
          name: "URI",
          specifiedByURL: null,
        },
        { kind: "SCALAR", name: "String", specifiedByURL: null },
        { kind: "SCALAR", name: "Int", specifiedByURL: null },
        { kind: "SCALAR", name: "Float", specifiedByURL: null },
        { kind: "SCALAR", name: "Boolean", specifiedByURL: null },
        { kind: "SCALAR", name: "ID", specifiedByURL: null },
        {
          kind: "OBJECT",
          name: "Mutation",
          fields: [
            {
              name: "addReaction",
              args: [
                {
                  name: "input",
                  type: NN({ kind: "INPUT_OBJECT", name: "AddReactionInput" }),
                },
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
          ],
        },
        {
          kind: "OBJECT",
          name: "AddReactionPayload",
          fields: [
            { name: "clientMutationId", args: [], type: S("String") },
            { name: "reaction", args: [], type: { kind: "OBJECT", name: "Reaction" } },
          ],
          interfaces: [],
        },
        {
          kind: "OBJECT",
          name: "Reaction",
          fields: [
            { name: "id", args: [], type: NN(S("ID")) },
            { name: "content", args: [], type: NN({ kind: "ENUM", name: "ReactionContent" }) },
          ],
          interfaces: [{ kind: "INTERFACE", name: "Node" }],
        },
        {
          kind: "ENUM",
          name: "ReactionContent",
          enumValues: [
            { name: "THUMBS_UP", isDeprecated: false },
            { name: "THUMBS_DOWN", isDeprecated: false },
          ],
        },
      ],
      directives: [
        {
          name: "include",
          isRepeatable: false,
          locations: ["FIELD", "FRAGMENT_SPREAD", "INLINE_FRAGMENT"],
          args: [{ name: "if", type: NN(S("Boolean")) }],
        },
        {
          name: "skip",
          isRepeatable: false,
          locations: ["FIELD", "FRAGMENT_SPREAD", "INLINE_FRAGMENT"],
          args: [{ name: "if", type: NN(S("Boolean")) }],
        },
        {
          name: "deprecated",
          isRepeatable: false,
          locations: ["FIELD_DEFINITION", "ENUM_VALUE", "ARGUMENT_DEFINITION"],
          args: [{ name: "reason", type: S("String") }],
        },
      ],
    },
  };
}

let cachedSchema: GraphQLSchema | null = null;
/** 构建 mini 运行时 schema（缓存复用，避免每用例重建） */
function miniSchema(): GraphQLSchema {
  if (!cachedSchema) {
    cachedSchema = buildClientSchema(miniIntrospection() as never);
  }
  return cachedSchema;
}

/** 惰性字段层解析上下文（每次新建，缓存独立） */
function gqlCtx(): GqlSchemaContext {
  return buildGqlSchemaContext(miniSchema());
}

/** 从 tree 找顶层字段（query/mutation 均查） */
function findRoot(tree: ReturnType<typeof buildGqlFieldTree>, name: string): GqlFieldNode {
  const f = [...tree.query, ...tree.mutation].find((x) => x.name === name);
  if (!f) throw new Error(`fixture 缺顶层字段 ${name}`);
  return f;
}

/* ═══ 1. buildGqlFieldTree：Schema 树构建 ═══ */

describe("buildGqlFieldTree：Schema 树构建", () => {
  it("query 顶层字段按普通字符序（id 不特殊，deprecatedField 打头）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    expect(tree.query.map((f) => f.name)).toEqual([
      "deprecatedField",
      "node",
      "scalarField",
      "search",
      "searchResult",
      "viewer",
    ]);
  });

  it("mutation 顶层字段存在（addReaction）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    expect(tree.mutation.map((f) => f.name)).toEqual(["addReaction"]);
  });

  it("对象返回 → typeFields 一层子字段，按字符序（id 不再恒最前）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const viewer = findRoot(tree, "viewer");
    expect(viewer.typeFields?.map((f) => f.name)).toEqual([
      "avatarUrl",
      "email",
      "id",
      "login",
      "name",
      "repositories",
    ]);
    expect(viewer.scalar).toBe(false);
    // 子字段自身结构完整（惰性层不带更深 typeFields）
    const login = viewer.typeFields![3];
    expect(login.scalar).toBe(true);
    expect(login.returnLabel).toBe("String!");
    expect(login.typeFields).toBeUndefined();
  });

  it("接口返回（node: Node）→ typeFields 含接口字段 id + 必填参数", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const node = findRoot(tree, "node");
    expect(node.scalar).toBe(false);
    expect(node.typeFields?.map((f) => f.name)).toEqual(["id"]);
    expect(node.args).toEqual([{ name: "id", required: true, typeLabel: "ID!" }]);
  });

  it("union 返回 → possibleTypes 名列表；无 typeFields", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const searchResult = findRoot(tree, "searchResult");
    expect(searchResult.possibleTypes).toEqual(["Issue", "PullRequest"]);
    expect(searchResult.typeFields).toBeUndefined();
  });

  it("对象返回含 list 链 → typeFields 正常（search: SearchResultItemConnection）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const search = findRoot(tree, "search");
    expect(search.typeFields?.map((f) => f.name)).toEqual(["edges", "totalCount"]);
    expect(search.returnLabel).toBe("SearchResultItemConnection!");
  });

  it("标量返回 → scalar=true 且无 typeFields（裸字段）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const scalarField = findRoot(tree, "scalarField");
    expect(scalarField.scalar).toBe(true);
    expect(scalarField.typeFields).toBeUndefined();
    expect(scalarField.returnLabel).toBe("String!");
  });

  it("ofTypeName 内层类型名 + isConnection 识别", () => {
    const tree = buildGqlFieldTree(miniSchema());
    expect(findRoot(tree, "viewer").ofTypeName).toBe("User");
    expect(findRoot(tree, "viewer").isConnection).toBe(false);
    expect(findRoot(tree, "search").ofTypeName).toBe("SearchResultItemConnection");
    expect(findRoot(tree, "search").isConnection).toBe(true);
    expect(findRoot(tree, "scalarField").ofTypeName).toBe("String");
  });

  it("args：必填（NON_NULL）标记 + 可选省略", () => {
    const tree = buildGqlFieldTree(miniSchema());
    const search = findRoot(tree, "search");
    expect(search.args).toEqual([
      { name: "query", required: true, typeLabel: "String!" },
      { name: "type", required: true, typeLabel: "SearchType!" },
      { name: "first", required: false, typeLabel: "Int" },
    ]);
  });

  it("deprecated 标记（isDeprecated → deprecated=true；desc 来自 description）", () => {
    const tree = buildGqlFieldTree(miniSchema());
    expect(findRoot(tree, "deprecatedField").deprecated).toBe(true);
    expect(findRoot(tree, "deprecatedField").desc).toBe("Old field, use viewer");
    expect(findRoot(tree, "viewer").deprecated).toBeUndefined();
  });

  it("mutation 字段：必填 input 参数", () => {
    const tree = buildGqlFieldTree(miniSchema());
    expect(findRoot(tree, "addReaction").args).toEqual([
      { name: "input", required: true, typeLabel: "AddReactionInput!" },
    ]);
  });

  it("惰性字段层解析：fieldsOf 未知/标量 → undefined，union → 空数组", () => {
    const c = gqlCtx();
    expect(c.fieldsOf("String")).toBeUndefined();
    expect(c.fieldsOf("NoSuchType")).toBeUndefined();
    expect(c.fieldsOf("SearchResultItem")).toEqual([]);
    expect(c.fieldsOf("User")?.map((f) => f.name)).toEqual([
      "avatarUrl",
      "email",
      "id",
      "login",
      "name",
      "repositories",
    ]);
  });
});

/* ═══ 2. toggleRootSelection：父级勾选 ═══ */

describe("toggleRootSelection：父级勾选（默认字段集注入）", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const scalarField = findRoot(tree, "scalarField");

  it("勾选对象 root → 注入默认子树（第一个不可展开标量，字符序）", () => {
    const next = toggleRootSelection(c, {}, "query", viewer);
    // User 字符序：avatarUrl < email < id < login < name < repositories → 首个无必填标量 avatarUrl
    expect(Object.keys(next["query:viewer"].children ?? {})).toEqual(["avatarUrl"]);
  });

  it("connection root → totalCount + 必填参数 $var（query/type）；nodes 不存在则不注入", () => {
    const search = findRoot(tree, "search");
    const next = toggleRootSelection(c, {}, "query", search);
    expect(next["query:search"].args).toEqual({ query: "$query", type: "$type" });
    expect(Object.keys(next["query:search"].children ?? {})).toEqual(["totalCount"]);
  });

  it("勾选标量 root → 叶（args 含必填参数 $var；无 children）", () => {
    const next = toggleRootSelection(c, {}, "query", scalarField);
    expect(next["query:scalarField"].args).toEqual({});
    expect(next["query:scalarField"].children).toBeUndefined();
  });

  it("再勾选同一 root = 取消 → 移除 entry（含全部子项）", () => {
    const once = toggleRootSelection(c, {}, "query", viewer);
    const twice = toggleRootSelection(c, once, "query", viewer);
    expect(twice["query:viewer"]).toBeUndefined();
    expect(Object.keys(twice)).toHaveLength(0);
  });

  it("纯函数：原 map 不被修改", () => {
    const original: GqlSelectionMap = {};
    toggleRootSelection(c, original, "query", viewer);
    expect(Object.keys(original)).toHaveLength(0);
  });

  it("mutation 类型独立 key 空间（query/mutation 同名字段不冲突）", () => {
    const addReaction = findRoot(tree, "addReaction");
    const next = toggleRootSelection(c, {}, "mutation", addReaction);
    expect(next["mutation:addReaction"]).toBeDefined();
    expect(next["query:addReaction"]).toBeUndefined();
  });
});

/* ═══ 3. toggleChildSelection：子项勾选 ═══ */

describe("toggleFieldSelection：子字段勾选（任意深度）", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");

  it("未勾选父级时勾选子项 → 隐式建父级 entry（仅该子项，不注入默认集）", () => {
    const next = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    expect(Object.keys(next["query:viewer"].children ?? {})).toEqual(["login"]);
  });

  it("追加多个子项（累加）", () => {
    let next = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    next = toggleFieldSelection(c, next, "query", viewer, ["email"]);
    next = toggleFieldSelection(c, next, "query", viewer, ["id"]);
    expect(Object.keys(next["query:viewer"].children ?? {}).sort()).toEqual([
      "email",
      "id",
      "login",
    ]);
  });

  it("取消非最后子项 → 保留其余（不变量 1 仍成立）", () => {
    let next = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    next = toggleFieldSelection(c, next, "query", viewer, ["email"]);
    next = toggleFieldSelection(c, next, "query", viewer, ["login"]);
    expect(Object.keys(next["query:viewer"].children ?? {})).toEqual(["email"]);
    expect(next["query:viewer"]).toBeDefined();
  });

  it("取消最后一个子项 → 移除整个 entry（父级一并取消，无默认字段兜底）", () => {
    const once = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    const twice = toggleFieldSelection(c, once, "query", viewer, ["login"]);
    expect(twice["query:viewer"]).toBeUndefined();
    expect(Object.keys(twice)).toHaveLength(0);
  });

  it("深层 3 级路径：viewer.repositories.edges.node → 隐式建父链 + 目标默认子树", () => {
    const path = ["repositories", "edges", "node"];
    const next = toggleFieldSelection(c, {}, "query", viewer, path);
    const entry = next["query:viewer"];
    // viewer 隐式建（无默认集）；repositories/edges 隐式建空节点；node 目标注入默认子树
    // Repository 字符序：description < id < name → 首个无必填标量 description
    const node = entry.children!["repositories"].children!["edges"].children!["node"];
    expect(Object.keys(node.children ?? {})).toEqual(["description"]);
  });

  it("取消深层子项 → 级联删除父链直至顶层 entry（不变量 1）", () => {
    const path = ["repositories", "edges", "node"];
    let next = toggleFieldSelection(c, {}, "query", viewer, path);
    next = toggleFieldSelection(c, next, "query", viewer, path);
    expect(next["query:viewer"]).toBeUndefined();
  });

  it("非 schema 路径（防御）→ 原 map 返回", () => {
    const next = toggleFieldSelection(c, {}, "query", viewer, ["noSuchField"]);
    expect(next).toEqual({});
  });
});

/* ═══ 4. buildSelectionsFromParsed：反向归一化 ═══ */

describe("buildSelectionsFromParsed：手写解析 → 勾选归一化", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const queryRoots = tree.query;
  const mutationRoots = tree.mutation;

  it("匹配 schema 顶层字段 → 建 entry（children 递归原样）", () => {
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [{ name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] }],
      queryRoots,
    );
    expect(Object.keys(next["query:viewer"].children ?? {})).toEqual(["login"]);
  });

  it("非 schema 顶层字段（内省 __schema 等）→ 跳过不勾选", () => {
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [
        { name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] },
        { name: "__schema", args: {}, children: [{ name: "types", args: {}, children: [] }] },
        { name: "notAField", args: {}, children: [] },
      ],
      queryRoots,
    );
    expect(Object.keys(next)).toEqual(["query:viewer"]);
  });

  it("对象 root 空 selection（手写 `viewer` 无子字段，非法查询）→ 跳过（不变量 1）", () => {
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [{ name: "viewer", args: {}, children: [] }],
      queryRoots,
    );
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("标量 root 空 selection → 保留（不变量 2）", () => {
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [{ name: "scalarField", args: {}, children: [] }],
      queryRoots,
    );
    expect(next["query:scalarField"]).toBeDefined();
  });

  it("mutation 匹配自身根（mutation:addReaction）", () => {
    const next = buildSelectionsFromParsed(
      c,
      "mutation",
      [
        {
          name: "addReaction",
          args: { input: "$input" },
          children: [{ name: "clientMutationId", args: {}, children: [] }],
        },
      ],
      mutationRoots,
    );
    expect(next["mutation:addReaction"]).toBeDefined();
  });

  it("query 字段不误入 mutation 空间", () => {
    const next = buildSelectionsFromParsed(
      c,
      "mutation",
      [{ name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] }],
      mutationRoots,
    );
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("args 还原：$var 引用与字面量原样保留", () => {
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [
        {
          name: "search",
          args: { query: '"x"', type: "REPOSITORY" },
          children: [{ name: "totalCount", args: {}, children: [] }],
        },
      ],
      queryRoots,
    );
    expect(next["query:search"].args).toEqual({ query: '"x"', type: "REPOSITORY" });
  });

  it("深层对象空 selection → 跳过（不变量 1 递归成立）", () => {
    // node 是对象但无 children（非法）→ 跳过 → repositories 空 → 整体跳过
    const next = buildSelectionsFromParsed(
      c,
      "query",
      [
        {
          name: "viewer",
          args: {},
          children: [
            {
              name: "repositories",
              args: {},
              children: [
                { name: "edges", args: {}, children: [{ name: "node", args: {}, children: [] }] },
              ],
            },
          ],
        },
      ],
      queryRoots,
    );
    expect(next["query:viewer"]).toBeUndefined();
  });
});

/* ═══ 5. gqlRootCheckState：父级三态 ═══ */

describe("gqlRootCheckState / gqlFieldCheckState：父级 checkbox 三态", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const scalarField = findRoot(tree, "scalarField");

  it("无 entry → unchecked", () => {
    expect(gqlRootCheckState(c, {}, "query", viewer)).toBe("unchecked");
  });

  it("对象部分勾选（默认集 < 全量）→ indeterminate", () => {
    const partial = toggleRootSelection(c, {}, "query", viewer);
    expect(gqlRootCheckState(c, partial, "query", viewer)).toBe("indeterminate");
  });

  it("对象 children 全满 → checked", () => {
    let next: GqlSelectionMap = {};
    for (const f of ["avatarUrl", "email", "id", "login", "name", "repositories"]) {
      next = toggleFieldSelection(c, next, "query", viewer, [f]);
    }
    expect(gqlRootCheckState(c, next, "query", viewer)).toBe("checked");
  });

  it("标量有 entry → checked（无 indeterminate 态）", () => {
    const sel = toggleRootSelection(c, {}, "query", scalarField);
    expect(gqlRootCheckState(c, sel, "query", scalarField)).toBe("checked");
  });

  it("深层三态（path）：勾选 viewer.repositories 单子项 → viewer indeterminate；repositories indeterminate（connection 默认集 1/2）", () => {
    const next = toggleFieldSelection(c, {}, "query", viewer, ["repositories"]);
    expect(gqlRootCheckState(c, next, "query", viewer)).toBe("indeterminate");
    expect(gqlFieldCheckState(c, next, "query", viewer, ["repositories"])).toBe("indeterminate");
    expect(gqlFieldCheckState(c, next, "query", viewer, ["login"])).toBe("unchecked");
  });
});

/* ═══ 6. gqlSelectionsToQuery / gqlMapToQuery：查询构造 ═══ */

describe("gqlMapToQuery / gqlMapToQueryDetailed：勾选 → 查询构造", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const search = findRoot(tree, "search");
  const scalarField = findRoot(tree, "scalarField");
  const addReaction = findRoot(tree, "addReaction");

  it("只输出勾选子字段（无默认主键/隐式字段——严格「勾选什么写什么」）", () => {
    const map = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    expect(gqlMapToQuery(c, map, "query")).toBe("query {\n  viewer {\n    login\n  }\n}");
  });

  it("勾选对象 root → 默认子树完整输出（首个无必填标量）", () => {
    const map = toggleRootSelection(c, {}, "query", viewer);
    expect(gqlMapToQuery(c, map, "query")).toBe("query {\n  viewer {\n    avatarUrl\n  }\n}");
  });

  it("同操作类型多字段拼接为单个 selection set（AST 式构造）", () => {
    const map = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    const scalar = toggleRootSelection(c, map, "query", scalarField);
    expect(gqlMapToQuery(c, scalar, "query")).toBe(
      "query {\n  viewer {\n    login\n  }\n  scalarField\n}",
    );
  });

  it("必填参数 → $var 变量定义 + JSON 骨架（connection search）", () => {
    const map = toggleRootSelection(c, {}, "query", search);
    const { query, varDefs, varJson } = gqlMapToQueryDetailed(c, map, "query");
    expect(query).toBe(
      "query($query: String!, $type: SearchType!) {\n  search(query: $query, type: $type) {\n    totalCount\n  }\n}",
    );
    expect(varDefs).toEqual(["query: String!", "type: SearchType!"]);
    expect(varJson).toEqual({ query: "", type: "" });
  });

  it("mutation 必填 input 参数 → $var 提取（非法字面量根治）", () => {
    const map = toggleRootSelection(c, {}, "mutation", addReaction);
    const { query, varDefs, varJson } = gqlMapToQueryDetailed(c, map, "mutation");
    expect(query).toBe(
      "mutation($input: AddReactionInput!) {\n  addReaction(input: $input) {\n    clientMutationId\n  }\n}",
    );
    expect(varDefs).toEqual(["input: AddReactionInput!"]);
    expect(varJson).toEqual({ input: "" });
  });

  it("字面量参数原样输出（用户手填可选参数）", () => {
    const map: GqlSelectionMap = {
      "query:search": {
        args: { query: '"x"', type: "REPOSITORY", first: "10" },
        children: { totalCount: { args: {} } },
      },
    };
    expect(gqlMapToQuery(c, map, "query")).toBe(
      'query {\n  search(query: "x", type: REPOSITORY, first: 10) {\n    totalCount\n  }\n}',
    );
  });

  it("深层递归嵌套（viewer.repositories.edges.node）", () => {
    const map = toggleFieldSelection(c, {}, "query", viewer, ["repositories", "edges", "node"]);
    expect(gqlMapToQuery(c, map, "query")).toBe(
      "query {\n  viewer {\n    repositories {\n      edges {\n        node {\n          description\n        }\n      }\n    }\n  }\n}",
    );
  });

  it("标量 root → 无 selection set（裸字段）", () => {
    const map = toggleRootSelection(c, {}, "query", scalarField);
    expect(gqlMapToQuery(c, map, "query")).toBe("query {\n  scalarField\n}");
  });

  it("opType 过滤：query/mutation 各自独立输出", () => {
    let map = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    map = toggleRootSelection(c, map, "mutation", addReaction);
    expect(gqlMapToQuery(c, map, "query")).toBe("query {\n  viewer {\n    login\n  }\n}");
    expect(gqlMapToQuery(c, map, "mutation")).toBe(
      "mutation($input: AddReactionInput!) {\n  addReaction(input: $input) {\n    clientMutationId\n  }\n}",
    );
  });

  it("空 map → 空字符串（清空 query 语义）", () => {
    expect(gqlMapToQuery(c, {}, "query")).toBe("");
    expect(gqlMapToQuery(c, {}, "mutation")).toBe("");
  });
});

/* ═══ 7. parseQueryFieldSelections：反向解析 ═══ */

describe("parseQueryFieldSelections：编辑器文本 → 选择集", () => {
  it("正常解析：顶层字段 + 一层子字段（args 空对象）", () => {
    expect(parseQueryFieldSelections('query { viewer { login } node(id: "x") { id } }')).toEqual({
      opType: "query",
      fields: [
        { name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] },
        { name: "node", args: { id: '"x"' }, children: [{ name: "id", args: {}, children: [] }] },
      ],
    });
  });

  it("深层 children 递归（3 级）", () => {
    const parsed = parseQueryFieldSelections(
      "query { viewer { repositories { edges { node { id } } } } }",
    );
    expect(parsed?.fields[0].children[0].children[0].children[0]).toEqual({
      name: "node",
      args: {},
      children: [{ name: "id", args: {}, children: [] }],
    });
  });

  it("args 还原：$var 引用与字面量用 print 还原", () => {
    const parsed = parseQueryFieldSelections(
      "query($query: String!) { search(query: $query, type: REPOSITORY, first: 10) { totalCount } }",
    );
    expect(parsed?.fields[0].args).toEqual({ query: "$query", type: "REPOSITORY", first: "10" });
  });

  it("省略 operation 关键字 → 默认 query", () => {
    expect(parseQueryFieldSelections("{ viewer { login } }")).toEqual({
      opType: "query",
      fields: [{ name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] }],
    });
  });

  it("语法错误 → null（不反向同步，避免勾选错乱）", () => {
    expect(parseQueryFieldSelections("query { viewer {")).toBeNull();
    expect(parseQueryFieldSelections("query viewer }")).toBeNull();
  });

  it("空文本/纯空白 → 空 fields（清空编辑器 → 清空勾选）", () => {
    expect(parseQueryFieldSelections("")).toEqual({ opType: "query", fields: [] });
    expect(parseQueryFieldSelections("   \n  ")).toEqual({ opType: "query", fields: [] });
  });

  it("mutation opType 识别 + input 字面量还原", () => {
    const parsed = parseQueryFieldSelections(
      'mutation { addReaction(input: { subjectId: "x" }) { clientMutationId } }',
    );
    expect(parsed?.opType).toBe("mutation");
    expect(parsed?.fields[0].args).toEqual({ input: '{ subjectId: "x" }' });
  });

  it("多操作文档 → 取第一个 OperationDefinition（GraphQL 单操作约定）", () => {
    expect(
      parseQueryFieldSelections("query A { viewer { login } } query B { scalarField }"),
    ).toEqual({
      opType: "query",
      fields: [{ name: "viewer", args: {}, children: [{ name: "login", args: {}, children: [] }] }],
    });
  });

  it("fragment 定义与 spread / inline fragment 不产生字段选择", () => {
    const q = `
      fragment UserFrag on User { login }
      query { viewer { ...UserFrag ... on User { email } } }
    `;
    expect(parseQueryFieldSelections(q)).toEqual({
      opType: "query",
      fields: [{ name: "viewer", args: {}, children: [] }],
    });
  });
});

/* ═══ 8. 不变量 5：正反向收敛（循环稳定） ═══ */

describe("不变量 5：正反向收敛（勾选 → 生成 → 解析 → 归一 = 原勾选）", () => {
  const c = gqlCtx();
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const search = findRoot(tree, "search");
  const scalarField = findRoot(tree, "scalarField");
  const addReaction = findRoot(tree, "addReaction");

  /** 收敛断言：map → 生成 query → 解析 → 归一 = 原 map（按 opType 过滤） */
  const roundTrip = (map: GqlSelectionMap) => {
    for (const opType of ["query", "mutation"] as const) {
      const { query } = gqlMapToQueryDetailed(c, map, opType);
      const parsed = parseQueryFieldSelections(query);
      expect(parsed).not.toBeNull();
      const roots = opType === "query" ? tree.query : tree.mutation;
      const back = buildSelectionsFromParsed(c, parsed!.opType, parsed!.fields, roots);
      const filtered = Object.fromEntries(
        Object.entries(map).filter(([k]) => k.startsWith(`${opType}:`)),
      );
      expect(gqlMapsEqual(back, filtered)).toBe(true);
    }
  };

  it("部分勾选（viewer 单子项）收敛", () => {
    roundTrip(toggleFieldSelection(c, {}, "query", viewer, ["login"]));
  });

  it("默认集勾选（viewer 全默认子树）收敛", () => {
    roundTrip(toggleRootSelection(c, {}, "query", viewer));
  });

  it("$var 参数收敛（search 必填参数）", () => {
    roundTrip(toggleRootSelection(c, {}, "query", search));
  });

  it("mutation 收敛（addReaction input $var）", () => {
    roundTrip(toggleRootSelection(c, {}, "mutation", addReaction));
  });

  it("多字段混合（query viewer + mutation addReaction）收敛", () => {
    let map = toggleFieldSelection(c, {}, "query", viewer, ["login"]);
    map = toggleRootSelection(c, map, "mutation", addReaction);
    roundTrip(map);
  });

  it("标量裸字段收敛", () => {
    roundTrip(toggleRootSelection(c, {}, "query", scalarField));
  });

  it("空勾选收敛（空 map → 空 query → 空勾选）", () => {
    roundTrip({});
  });

  it("反向手写 → 勾选 → 生成：手写内容原样保留（无隐式字段注入）", () => {
    const parsed = parseQueryFieldSelections(
      'query { search(query: "x", type: REPOSITORY) { totalCount } }',
    )!;
    const map = buildSelectionsFromParsed(c, parsed.opType, parsed.fields, tree.query);
    expect(gqlMapToQuery(c, map, "query")).toBe(
      'query {\n  search(query: "x", type: REPOSITORY) {\n    totalCount\n  }\n}',
    );
    roundTrip(map);
  });
});
