/**
 * ============================================================================
 * debug-graphql.ts 单元测试 —— GraphQL Schema 树 / 勾选状态机 / 查询构造质量门
 * ============================================================================
 *
 * 【本文件针对的任务 / 要求 / 目的】
 * `/$debug` 调试客户端 GraphQL 侧全部纯函数逻辑的**独立全覆盖质量门**（与 REST 侧
 * debug-params / debug-openapi / schema-integration 三文件分工：REST 管 REST，
 * 本文件管 GraphQL）。覆盖四层：Schema 树构建（buildGqlFieldTree）、勾选状态机
 * （toggleRootSelection / toggleChildSelection / buildSelectionsFromParsed /
 * gqlRootCheckState）、查询构造（gqlSelectionsToQuery / gqlMapToQuery）、
 * 反向解析（parseQueryFieldSelections），以及正反向收敛一致性（不变量 5）。
 *
 * 【业务基线（2026-08-11 定稿，勿改）】
 * 1. **只有被勾选才写入**：生成 query 严格 = 勾选内容，无隐式默认字段/主键
 * 2. **点击树项仅展开**：勾选（checkbox）= 唯一选中动作（组件层行为，本文件测状态机）
 * 3. **不主键区分**：排序普通字符序（id 无特殊地位）；勾选父级 → 子项全自动勾选
 * 4. 状态不变量（toggle/normalize 全程维持）：
 *    - 不变量 1：对象 root → entry 存在 ⇔ children.size > 0
 *    - 不变量 2：标量 root → children 恒空（entry 存在即勾选）
 *    - 不变量 3：生成 query 仅含勾选内容
 *    - 不变量 4：父级三态 = unchecked / indeterminate（部分）/ checked（全满或标量）
 *    - 不变量 5：正反向收敛——gqlMapToQuery 产物 → parse → buildSelectionsFromParsed
 *      归一后与原 map 相等（循环稳定不抖动）
 *
 * 【期望行为与用例对照（修改测试前必读：每条都是需求基线，勿降低断言强度）】
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ 期望行为                                            │ 用例（it 标题）        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 1. buildGqlFieldTree：                              │ query 顶层字段字符序    │
 * │    - 顶层字段按普通字符序（id 不特殊）                │ typeFields 字符序       │
 * │    - typeFields 一层子字段（对象/接口返回）            │ （id 不再恒最前）       │
 * │    - union 返回 → possibleTypes；无 typeFields       │ union possibleTypes    │
 * │    - 标量返回 → scalar=true 无 typeFields            │ 标量字段                │
 * │    - deprecated 标记 / args required / returnLabel   │ args 与弃用标记         │
 * │    - 不再产出 childFields（旧隐式默认字段数据源）      │ 无 childFields 残留     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 2. toggleRootSelection：                             │ 勾选对象 root 全选子项  │
 * │    - 勾选对象 root → children = 全部可见子字段名       │ 标量 root 空集          │
 * │    - 勾选标量 root → children 空（裸字段）            │ 取消 → 移除 entry       │
 * │    - 再勾选 = 取消 → 移除 entry                       │ 原 map 不被修改（纯函数）│
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 3. toggleChildSelection：                            │ 隐式建父级 entry        │
 * │    - 子项勾选隐式建父级 entry                         │ 追加子项                │
 * │    - 取消最后一个子项 → 移除 entry（不变量 1）         │ 取消至空移除 entry       │
 * │    - 取消非最后子项 → 保留                            │ 取消非最后保留           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 4. buildSelectionsFromParsed（反向归一化）：          │ schema 字段建 entry     │
 * │    - 匹配 schema 顶层字段建 entry                    │ 非 schema 字段跳过      │
 * │    - 非 schema 字段 / 内省字段跳过                    │ 对象空 selection 跳过    │
 * │    - 对象空 selection（非法查询）跳过                  │ 标量空 selection 保留    │
 * │    - 标量空 selection 保留                            │ mutation 匹配自身根      │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 5. gqlRootCheckState（父级三态）：                    │ 无 entry → unchecked    │
 * │    - 无 entry → unchecked                            │ 对象全选 → checked       │
 * │    - 对象全满 → checked / 部分 → indeterminate        │ 对象部分 → indeterminate │
 * │    - 标量有 entry → checked                           │ 标量恒 checked           │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 6. gqlSelectionsToQuery / gqlMapToQuery：            │ 多字段同操作拼接         │
 * │    - 同操作类型多字段拼接为单个 selection set          │ 必填参数占位（…/0/true）  │
 * │    - 必填参数给示例占位，可选省略                      │ 无默认主键（严格勾选）    │
 * │    - 对象 root 只输出勾选子字段（无默认 id）           │ 标量 root 无 body        │
 * │    - 标量 root 无 selection set                       │ opType 过滤             │
 * │    - 空选择 → 空字符串                                │ 空 map → 空字符串        │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 7. parseQueryFieldSelections：                        │ 正常解析顶层字段         │
 * │    - 提取顶层字段 + 一层子字段（Field kind 过滤）      │ 语法错误 → null          │
 * │    - 语法错误 → null；空文本 → 空 fields               │ 空文本 → 空 fields        │
 * │    - 多操作取第一个；mutation opType                  │ 多操作取首个 / mutation  │
 * │    - fragment/inline fragment 跳过                   │ fragment 过滤            │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ 8. 不变量 5（正反向收敛）：                            │ 部分勾选收敛             │
 * │    gqlMapToQuery → parse → buildSelectionsFromParsed │ 全量勾选收敛             │
 * │    = 原 map（循环稳定，双向不抖动）                    │ 标量收敛 / 空收敛         │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from "vitest";
import { buildClientSchema, type GraphQLSchema } from "graphql";
import {
  buildGqlFieldTree,
  buildSelectionsFromParsed,
  gqlMapToQuery,
  gqlRootCheckState,
  gqlSelectionsToQuery,
  parseQueryFieldSelections,
  toggleChildSelection,
  toggleRootSelection,
  type GqlFieldNode,
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

/** 勾选集合相等比较（key 数 + children 集相等；不比较 root 引用——同 key root 必然同源） */
function sameSelections(a: GqlSelectionMap, b: GqlSelectionMap): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
  return keysA.every((k) => {
    const ca = a[k].children;
    const cb = b[k].children;
    return (
      ca.size === cb.size &&
      [...ca].sort().join(",") === [...cb].sort().join(",") &&
      a[k].opType === b[k].opType
    );
  });
}

/** 从 tree 找顶层字段（query/mutation 均查） */
function findRoot(tree: ReturnType<typeof buildGqlFieldTree>, name: string): GqlFieldNode {
  const f = [...tree.query, ...tree.mutation].find((x) => x.name === name);
  if (!f) throw new Error(`fixture 缺顶层字段 ${name}`);
  return f;
}

/* ═══ 1. buildGqlFieldTree：Schema 树构建 ═══ */

describe("buildGqlFieldTree：Schema 树构建", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const search = findRoot(tree, "search");
  const searchResult = findRoot(tree, "searchResult");
  const scalarField = findRoot(tree, "scalarField");
  const deprecatedField = findRoot(tree, "deprecatedField");
  const node = findRoot(tree, "node");
  const addReaction = findRoot(tree, "addReaction");

  it("query 顶层字段按普通字符序（id 不特殊，deprecatedField 打头）", () => {
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
    expect(tree.mutation.map((f) => f.name)).toEqual(["addReaction"]);
  });

  it("对象返回 → typeFields 一层子字段，按字符序（id 不再恒最前）", () => {
    expect(viewer.typeFields?.map((f) => f.name)).toEqual([
      "avatarUrl",
      "email",
      "id",
      "login",
      "name",
      "repositories",
    ]);
    // 子字段自身结构完整
    const login = viewer.typeFields![3];
    expect(login.scalar).toBe(true);
    expect(login.returnLabel).toBe("String!");
    expect(login.typeFields).toBeUndefined();
  });

  it("接口返回（node: Node）→ typeFields 含接口字段 id", () => {
    expect(node.scalar).toBe(false);
    expect(node.typeFields?.map((f) => f.name)).toEqual(["id"]);
    // 必填参数 args 标记
    expect(node.args).toEqual([{ name: "id", required: true, typeLabel: "ID!" }]);
  });

  it("union 返回 → possibleTypes 名列表；无 typeFields", () => {
    expect(searchResult.possibleTypes).toEqual(["Issue", "PullRequest"]);
    expect(searchResult.typeFields).toBeUndefined();
  });

  it("对象返回含 list 链 → typeFields 正常（connection edges 结构）", () => {
    expect(search.typeFields?.map((f) => f.name)).toEqual(["edges", "totalCount"]);
    expect(search.returnLabel).toBe("SearchResultItemConnection!");
  });

  it("标量返回 → scalar=true 且无 typeFields（裸字段）", () => {
    expect(scalarField.scalar).toBe(true);
    expect(scalarField.typeFields).toBeUndefined();
    expect(scalarField.returnLabel).toBe("String!");
  });

  it("args：必填（NON_NULL）标记 + 可选省略", () => {
    expect(search.args).toEqual([
      { name: "query", required: true, typeLabel: "String!" },
      { name: "type", required: true, typeLabel: "SearchType!" },
      { name: "first", required: false, typeLabel: "Int" },
    ]);
  });

  it("deprecated 标记（isDeprecated → deprecated=true；desc 来自 description）", () => {
    expect(deprecatedField.deprecated).toBe(true);
    expect(deprecatedField.desc).toBe("Old field, use viewer");
    expect(viewer.deprecated).toBeUndefined();
  });

  it("mutation 字段：必填 input 参数", () => {
    expect(addReaction.args).toEqual([
      { name: "input", required: true, typeLabel: "AddReactionInput!" },
    ]);
  });

  it("不再产出 childFields（旧隐式默认字段数据源已移除）", () => {
    expect("childFields" in viewer).toBe(false);
    expect("childFields" in scalarField).toBe(false);
  });
});

/* ═══ 2. toggleRootSelection：父级勾选 ═══ */

describe("toggleRootSelection：父级勾选（勾选父级 → 子项全自动勾选）", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const scalarField = findRoot(tree, "scalarField");

  it("勾选对象 root → children = 全部可见子字段名（全自动勾选）", () => {
    const next = toggleRootSelection({}, "query", viewer);
    expect(next["query:viewer"].children.size).toBe(6);
    expect([...next["query:viewer"].children].sort()).toEqual([
      "avatarUrl",
      "email",
      "id",
      "login",
      "name",
      "repositories",
    ]);
  });

  it("再勾选同一 root = 取消 → 移除 entry（含全部子项）", () => {
    const once = toggleRootSelection({}, "query", viewer);
    const twice = toggleRootSelection(once, "query", viewer);
    expect(twice["query:viewer"]).toBeUndefined();
    expect(Object.keys(twice)).toHaveLength(0);
  });

  it("勾选标量 root → children 空集（裸字段；不变量 2）", () => {
    const next = toggleRootSelection({}, "query", scalarField);
    expect(next["query:scalarField"].children.size).toBe(0);
  });

  it("取消标量 root → 移除 entry", () => {
    const once = toggleRootSelection({}, "query", scalarField);
    const twice = toggleRootSelection(once, "query", scalarField);
    expect(Object.keys(twice)).toHaveLength(0);
  });

  it("纯函数：原 map 不被修改", () => {
    const original: GqlSelectionMap = {};
    toggleRootSelection(original, "query", viewer);
    expect(Object.keys(original)).toHaveLength(0);
  });

  it("mutation 类型独立 key 空间（query/mutation 同名字段不冲突）", () => {
    const next = toggleRootSelection({}, "mutation", viewer);
    expect(next["mutation:viewer"]).toBeDefined();
    expect(next["query:viewer"]).toBeUndefined();
  });
});

/* ═══ 3. toggleChildSelection：子项勾选 ═══ */

describe("toggleChildSelection：子项勾选", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");

  it("未勾选父级时勾选子项 → 隐式建父级 entry（仅该子项）", () => {
    const next = toggleChildSelection({}, "query", viewer, "login");
    expect([...next["query:viewer"].children]).toEqual(["login"]);
  });

  it("追加多个子项（累加）", () => {
    let next = toggleChildSelection({}, "query", viewer, "login");
    next = toggleChildSelection(next, "query", viewer, "email");
    next = toggleChildSelection(next, "query", viewer, "id");
    expect([...next["query:viewer"].children].sort()).toEqual(["email", "id", "login"]);
  });

  it("取消非最后子项 → 保留其余（不变量 1 仍成立）", () => {
    let next = toggleChildSelection({}, "query", viewer, "login");
    next = toggleChildSelection(next, "query", viewer, "email");
    next = toggleChildSelection(next, "query", viewer, "login");
    expect([...next["query:viewer"].children]).toEqual(["email"]);
    expect(next["query:viewer"]).toBeDefined();
  });

  it("取消最后一个子项 → 移除整个 entry（父级一并取消，无默认字段兜底）", () => {
    const once = toggleChildSelection({}, "query", viewer, "login");
    const twice = toggleChildSelection(once, "query", viewer, "login");
    expect(twice["query:viewer"]).toBeUndefined();
    expect(Object.keys(twice)).toHaveLength(0);
  });
});

/* ═══ 4. buildSelectionsFromParsed：反向归一化 ═══ */

describe("buildSelectionsFromParsed：手写解析 → 勾选归一化", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const queryRoots = tree.query;
  const mutationRoots = tree.mutation;

  it("匹配 schema 顶层字段 → 建 entry（children 原样）", () => {
    const next = buildSelectionsFromParsed(
      "query",
      [{ name: "viewer", children: ["login", "email"] }],
      queryRoots,
    );
    expect([...next["query:viewer"].children].sort()).toEqual(["email", "login"]);
  });

  it("非 schema 顶层字段（内省 __schema 等）→ 跳过不勾选", () => {
    const next = buildSelectionsFromParsed(
      "query",
      [
        { name: "viewer", children: ["login"] },
        { name: "__schema", children: ["types"] },
        { name: "notAField", children: [] },
      ],
      queryRoots,
    );
    expect(Object.keys(next)).toEqual(["query:viewer"]);
  });

  it("对象 root 空 selection（手写 `viewer` 无子字段，非法查询）→ 跳过（不变量 1）", () => {
    const next = buildSelectionsFromParsed("query", [{ name: "viewer", children: [] }], queryRoots);
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("标量 root 空 selection → 保留（不变量 2）", () => {
    const next = buildSelectionsFromParsed(
      "query",
      [{ name: "scalarField", children: [] }],
      queryRoots,
    );
    expect(next["query:scalarField"]).toBeDefined();
    expect(next["query:scalarField"].children.size).toBe(0);
  });

  it("mutation 匹配自身根（mutation:addReaction）", () => {
    const next = buildSelectionsFromParsed(
      "mutation",
      [{ name: "addReaction", children: ["clientMutationId"] }],
      mutationRoots,
    );
    expect(next["mutation:addReaction"]).toBeDefined();
  });

  it("query 字段不误入 mutation 空间", () => {
    const next = buildSelectionsFromParsed(
      "mutation",
      [{ name: "viewer", children: ["login"] }],
      mutationRoots,
    );
    expect(Object.keys(next)).toHaveLength(0);
  });
});

/* ═══ 5. gqlRootCheckState：父级三态 ═══ */

describe("gqlRootCheckState：父级 checkbox 三态", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const scalarField = findRoot(tree, "scalarField");

  it("无 entry → unchecked", () => {
    expect(gqlRootCheckState({}, "query", viewer)).toBe("unchecked");
  });

  it("对象全选（children 满）→ checked", () => {
    const full = toggleRootSelection({}, "query", viewer);
    expect(gqlRootCheckState(full, "query", viewer)).toBe("checked");
  });

  it("对象部分勾选 → indeterminate", () => {
    const partial = toggleChildSelection({}, "query", viewer, "login");
    expect(gqlRootCheckState(partial, "query", viewer)).toBe("indeterminate");
  });

  it("标量有 entry → checked（无 indeterminate 态）", () => {
    const sel = toggleRootSelection({}, "query", scalarField);
    expect(gqlRootCheckState(sel, "query", scalarField)).toBe("checked");
  });
});

/* ═══ 6. gqlSelectionsToQuery / gqlMapToQuery：查询构造 ═══ */

describe("gqlSelectionsToQuery / gqlMapToQuery：勾选 → 查询构造", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const node = findRoot(tree, "node");
  const search = findRoot(tree, "search");
  const scalarField = findRoot(tree, "scalarField");
  const addReaction = findRoot(tree, "addReaction");

  it("只输出勾选子字段（无默认主键/隐式字段——严格「勾选什么写什么」）", () => {
    const map = toggleChildSelection({}, "query", viewer, "login");
    expect(gqlMapToQuery(map, "query")).toBe("query {\n  viewer {\n    login\n  }\n}");
  });

  it("同操作类型多字段拼接为单个 selection set（AST 式构造）", () => {
    let map = toggleChildSelection({}, "query", viewer, "login");
    map = toggleChildSelection(map, "query", node, "id");
    expect(gqlMapToQuery(map, "query")).toBe(
      'query {\n  viewer {\n    login\n  }\n  node(id: "…") {\n    id\n  }\n}',
    );
  });

  it('必填参数示例占位：字符串 → "…"、数字 → 0（Int）', () => {
    const map = toggleRootSelection({}, "query", search);
    const q = gqlMapToQuery(map, "query");
    expect(q).toContain('search(query: "…", type: "…")');
    // first 为可选参数 → 不输出
    expect(q).not.toContain("first:");
  });

  it("标量 root → 无 selection set（裸字段）", () => {
    const map = toggleRootSelection({}, "query", scalarField);
    expect(gqlMapToQuery(map, "query")).toBe("query {\n  scalarField\n}");
  });

  it("mutation 必填 input 参数占位", () => {
    const map = toggleRootSelection({}, "mutation", addReaction);
    expect(gqlMapToQuery(map, "mutation")).toBe(
      'mutation {\n  addReaction(input: "…") {\n    clientMutationId\n    reaction\n  }\n}',
    );
  });

  it("opType 过滤：query/mutation 各自独立输出", () => {
    let map = toggleChildSelection({}, "query", viewer, "login");
    map = toggleChildSelection(map, "mutation", addReaction, "clientMutationId");
    expect(gqlMapToQuery(map, "query")).toBe("query {\n  viewer {\n    login\n  }\n}");
    expect(gqlMapToQuery(map, "mutation")).toBe(
      'mutation {\n  addReaction(input: "…") {\n    clientMutationId\n  }\n}',
    );
  });

  it("空 map → 空字符串（清空 query 语义）", () => {
    expect(gqlMapToQuery({}, "query")).toBe("");
    expect(gqlMapToQuery({}, "mutation")).toBe("");
  });

  it("gqlSelectionsToQuery 列表版：与 map 版产物一致", () => {
    const map = toggleChildSelection({}, "query", viewer, "login");
    const list = Object.values(map)
      .filter((s) => s.opType === "query")
      .map(({ root, children }) => ({ root, children }));
    expect(gqlSelectionsToQuery("query", list)).toBe(gqlMapToQuery(map, "query"));
  });

  it("对象 root 勾选全自动子项 → 生成全字段 query", () => {
    const map = toggleRootSelection({}, "query", viewer);
    const q = gqlMapToQuery(map, "query");
    expect(q).toContain("avatarUrl");
    expect(q).toContain("repositories");
    expect(q).not.toContain("id\n  }"); // 无隐式主键——id 只是普通勾选项之一
  });
});

/* ═══ 7. parseQueryFieldSelections：反向解析 ═══ */

describe("parseQueryFieldSelections：编辑器文本 → 选择集", () => {
  it("正常解析：顶层字段 + 一层子字段", () => {
    expect(parseQueryFieldSelections('query { viewer { login } node(id: "x") { id } }')).toEqual({
      opType: "query",
      fields: [
        { name: "viewer", children: ["login"] },
        { name: "node", children: ["id"] },
      ],
    });
  });

  it("省略 operation 关键字 → 默认 query", () => {
    expect(parseQueryFieldSelections("{ viewer { login } }")).toEqual({
      opType: "query",
      fields: [{ name: "viewer", children: ["login"] }],
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

  it("mutation opType 识别", () => {
    expect(
      parseQueryFieldSelections("mutation { addReaction(input: {}) { clientMutationId } }"),
    ).toEqual({
      opType: "mutation",
      fields: [{ name: "addReaction", children: ["clientMutationId"] }],
    });
  });

  it("多操作文档 → 取第一个 OperationDefinition（GraphQL 单操作约定）", () => {
    expect(
      parseQueryFieldSelections("query A { viewer { login } } query B { scalarField }"),
    ).toEqual({
      opType: "query",
      fields: [{ name: "viewer", children: ["login"] }],
    });
  });

  it("fragment 定义与 spread / inline fragment 不产生字段选择", () => {
    const q = `
      fragment UserFrag on User { login }
      query { viewer { ...UserFrag ... on User { email } } }
    `;
    expect(parseQueryFieldSelections(q)).toEqual({
      opType: "query",
      fields: [{ name: "viewer", children: [] }],
    });
  });

  it("嵌套子字段只取一层（children 为直接子级 Field 名，深层不再展开）", () => {
    expect(parseQueryFieldSelections("query { viewer { repositories { totalCount } } }")).toEqual({
      opType: "query",
      fields: [{ name: "viewer", children: ["repositories"] }],
    });
  });
});

/* ═══ 8. 不变量 5：正反向收敛（循环稳定） ═══ */

describe("不变量 5：正反向收敛（勾选 → 生成 → 解析 → 归一 = 原勾选）", () => {
  const tree = buildGqlFieldTree(miniSchema());
  const viewer = findRoot(tree, "viewer");
  const scalarField = findRoot(tree, "scalarField");
  const addReaction = findRoot(tree, "addReaction");

  /** round-trip：map → query → parse → buildSelectionsFromParsed → 与 map 比较 */
  const roundTrip = (map: GqlSelectionMap) => {
    for (const opType of ["query", "mutation"] as const) {
      const q = gqlMapToQuery(map, opType);
      const parsed = parseQueryFieldSelections(q);
      expect(parsed).not.toBeNull();
      const roots = opType === "query" ? tree.query : tree.mutation;
      const back = buildSelectionsFromParsed(opType, parsed!.fields, roots);
      const filtered = Object.fromEntries(
        Object.entries(map).filter(([, s]) => s.opType === opType),
      );
      expect(sameSelections(back, filtered)).toBe(true);
    }
  };

  it("部分勾选（viewer 单子项）收敛", () => {
    roundTrip(toggleChildSelection({}, "query", viewer, "login"));
  });

  it("全量勾选（父级全自动子项）收敛", () => {
    roundTrip(toggleRootSelection({}, "query", viewer));
  });

  it("多字段混合（query viewer + mutation addReaction）收敛", () => {
    let map = toggleChildSelection({}, "query", viewer, "login");
    map = toggleChildSelection(map, "query", viewer, "email");
    map = toggleChildSelection(map, "mutation", addReaction, "clientMutationId");
    roundTrip(map);
  });

  it("标量裸字段收敛", () => {
    roundTrip(toggleRootSelection({}, "query", scalarField));
  });

  it("空勾选收敛（空 map → 空 query → 空勾选）", () => {
    roundTrip({});
  });

  it("反向手写 → 勾选 → 生成：手写内容原样保留（无隐式字段注入）", () => {
    // 手写 viewer { login }（无 id）→ 勾选状态只有 login
    const parsed = parseQueryFieldSelections("query { viewer { login } }")!;
    const roots = tree.query;
    const map = buildSelectionsFromParsed("query", parsed.fields, roots);
    expect([...map["query:viewer"].children]).toEqual(["login"]);
    // 正向生成不含 id（严格勾选驱动）
    expect(gqlMapToQuery(map, "query")).toBe("query {\n  viewer {\n    login\n  }\n}");
  });
});
