# Debug 页面 GraphQL 能力 —— 重构设计方案（决策版 + 实施记录）

> 状态：**决策已定 + 实施中**，本文件为执行依据与实施状态记录，不再含备选项。
> 目标：以最佳用户操作体验为核心，走最简方案路径，尽量使用成型维护健全的库。
> 修订（2026-08-11）：**确认整体结构与原始出入不大，框架结构、编辑框基础模块等公共组件一律复用**
> ——不新建独立工作台；仅对 GraphQL 特有能力（勾选树深度/参数生成/variables 校验/分页）做逻辑重构与界面增强。
> 生成日期：2026-08-11（内部试错阶段，可破坏性重构）

---

## 0. 实施状态（2026-08-11 修订）

> 本节记录**已实施里程碑的完成情况与相对本方案的偏离**（0.0.x 试错阶段，实施中按实操反馈修订），未做项列入 §10 计划。代码最终用意见各模块文件头总结性注释。

### 0.1 已完成

| 里程碑 | 状态 | 实际实现与偏离 |
|---|---|---|
| **M1** 嵌套树状态机 | ✅ | `web/src/lib/debug-graphql.ts`：任意深度嵌套树 + 必填参数 $var 提取 + 手写/勾选双向同步（不变量 1–5 全实现，65 测试）。**偏离**：默认字段集由「id + 前 3 标量」改为「**第一个不可展开标量**」——勾选对象只填充字符序首个无必填参数标量（connection 恰为 totalCount）；全可展开则沿第一项递归找叶子；不依赖 id 存在（schema 实测 913 对象仅 247 有 id，旧规则 73% 踏空）。理由：数量统一、内容有语义、可移植其他 schema |
| **M2** variables 纯函数三件套 | ✅ | `web/src/lib/debug-gql-variables.ts`：`collectVariables`（AST 提取变量定义）/ `buildVariablesJson`（递归骨架）/ `parseVariablesJson`（语法与语义分离）/ `validateVariables`（双向校验），22 测试 |
| **M3** GqlTree 重构 | ✅ | `web/src/pages/debug/GqlTree.tsx`：任意深度勾选树 + 反向同步接线。**偏离**：① 渲染模型改为**扁平化可见行 + `@tanstack/react-virtual` 虚拟滚动**（递归 FieldRow 全量挂载导致展开 >2s 迟滞；扁平 DFS 只遍历已展开子树，DOM 恒 ~40 行）；② 多级缩进统一 `paddingLeft = 6 + depth × 14px`；③ **不做下钻导航栈**（原 M5 计划取消，勾选树即主交互）；④ 内省分组保留 |
| **M4** Variables 面板 | ✅ | `web/src/pages/debug/GqlVariablesPanel.tsx` + RequestEditor 接入。**重大偏离**：由「JSON 编辑器 + chips + 校验条」改为 **KV 表格**（对齐 REST 参数操作习惯）——`[checkbox] [key+类型胶囊] [value] [操作 Lock/X]`；必填变量自动锁定行、可选变量待选 badge（同 REST docBadges）、枚举/布尔下拉、输入 → 自动转 JSON 写 `req.variables`（发送/历史零改动复用）、正反向同步防光标跳动（lastEmitted）；**校验提示只保留输入框红框 + tab 徽标**（校验条/错误明细/JSON 提示文段已移除） |
| **M5.5** StructuredTable 复合数组编辑器 | ✅ | `web/src/lib/debug-gql-structured.ts`（纯函数）+ `web/src/pages/debug/StructuredTable.tsx` + GqlVariablesPanel 接入。**实现与偏离**：① `StructuredField` 五分类（scalar/enum/boolean/input/list）+ `inputTypeToStructured` 递归（NON_NULL 剥壳 → required；input 展开 fields 含默认值；list 收 element 任意深度嵌套）；② 双向序列化 `jsonToStructuredRows`（忠实还原——缺字段空骨架，默认值由 placeholder 承载，保证正反向收敛）/ `structuredRowToJson`（空 input/list → undefined 跳过）；③ **UI 为「值格内嵌展开」**——input/list 变量行 value 格变展开按钮（chevron），点击行下展开子表格：input → 递归字段行（checkbox + 必填琥珀标记/可选灰胶囊 + 枚举下拉/嵌套子表格）、list → 数组编辑器（[+ 添加] 项 + 删除）；④ 枚举/布尔/标量行维持现状零回归；⑤ 24 测试（结构/骨架/序列化/反向/端到端收敛）。**三修正（用户拍板）**：必填字段排最上（`inputTypeToStructured` 稳定排序）、必填星号红色（`text-destructive`）、必填 checkbox 禁用不可取消勾选。**范围限定**：仅服务 GraphQL variables（REST body / REST 列表参数未做——最小范围，用户拍板） |
| **F12** hover 详情补齐 | ✅ | `web/src/lib/debug-graphql.ts`：`desc: f.description || undefined`（不再 slice(0,100) 截断）——字段 hover title 显示 desc 全文 |
| **F9** Schema 搜索过滤 | ✅ | `web/src/pages/debug/GqlTree.tsx`：搜索框（`/` 快捷键聚焦、X 清除、placeholder）+ `flattenRows` 搜索模式（跨全树匹配字段名/返回类型/desc；命中行 + 祖先链路径）+ `hasAnyMatch`（无命中分组头隐藏）+ `walkField` 搜索模式遍历全部子树 + 内省模板过滤；i18n keys `gql.searchPlaceholder`/`gql.searchClear` |
| **F2** nodes/edges 自动带 totalCount | ✅ | `web/src/lib/debug-graphql.ts` `toggleFieldSelection`：勾选 nodes/edges 且父为 connection → 自动附带 `children.totalCount = { args: {} }` |
| **M6** 多 operation 下拉 | ✅ | `web/src/lib/debug-graphql.ts` `collectGqlOperations(query)`（AST 提取 name/label/opType/varNames；语法错误 → null）+ `web/src/pages/debug/RequestEditor.tsx` operation DropdownMenu（仅 `gqlOps.length > 1` 显示；切换写 `req.operationName`）+ `web/src/lib/debug-api.ts` `executeDebug` GraphQL body 附带 `operationName`；71 测试 |
| **F13** schema 自动刷新 | ✅ | `web/src/lib/debug-graphql.ts` `fetchGqlSchemaIntrospection(token)`（返回 `{__schema}` 原始数据）+ `web/src/pages/debug/schema-loader.ts` `getGqlSchemaFetchedAt()`（IndexedDB 缓存时间戳）/ `saveGqlSchemaOnline()`（写 IndexedDB + 内存 + 运行时 schema）+ `DebugPage` 登录态 + 本地快照过旧（7 天 TTL）→ 后台 introspection 刷新 |
| **F10** 缺变量 key 补全 | ✅ | `web/src/pages/debug/GqlVariablesPanel.tsx`：自定义变量行 name Input 加 `list="gql-var-names"` + `<datalist>` 列出未添加的声明变量名（GraphQL 变量声明自动补全） |
| **connection 拆包 + 公共语法屏蔽** | ✅ | **用户拍板：解析层刻意去除**——`edges`/`nodes`/`node` 等 connection 语法节点是复合查询语法结构而非「API 功能端点」，在 `buildGqlSchemaContext` 的 `fieldsOf` 层去除（不按勾选决定）：object 元素 connection → 直接返回元素字段；union/interface 元素 → 保持原样但过滤语法字段（edges/nodes/node/pageInfo/cursor，业务聚合如 codeCount/totalCount 保留）；**顶层 `node`/`nodes`/`relay`/`resource` 是 Relay 公共语法（跨站点内建）→ 顶层列表整体屏蔽**（query 30→26 字段）。一次改动全链路生效（树/勾选/构造/反向同步自动受益），conn 徽章保留。89 测试（新增 5 用例） |

### 0.2 已取消 / 延后

- **下钻导航栈（原 M5 / F5）**：取消——勾选树即主交互，字段 hover 详情（title）已承载类型/参数/desc
- **`graphql-language-service` 显式依赖（D8）**：未引入——补全仍用 cm6-graphql，variables 校验自实现纯函数（见 §5.3），无额外依赖需求
- **ResponsePanel 分页摘要（原 M4 后半 / F7）**：**舍弃（2026-08-11 用户拍板）**——MVP 覆盖展示不合并（翻页后看不到前页，无法对比累计）；游标不与 query 条件/变量联动（改条件后旧游标失效）；实际调试改 `first: 100` 更直接；多 connection 嵌套（issues→nodes→comments→nodes）游标生命周期 + 结果合并去重 + 测试矩阵爆炸，维护成本远超 debug 工具定位。**D6 决策一并废止**（不做自动翻页），input/列表变量 JSON 字面量已由 **M5.5 StructuredTable** 承接（✅ 完成）
- **复合数组编辑器（input 嵌套展开）**：新增 **M5.5 计划**（调研结论见 §0.3）——input 变量当前仍为 JSON 字面量（value 格手写 + 骨架占位），拟以结构驱动递归表格替换

### 0.3 复合数组编辑器调研（新增）

**结论：无现成包可「良好」复用，建议自研 `StructuredTable`。**

| 候选包 | 评估 |
|---|---|
| `@rjsf/core`（react-jsonschema-form） | 能力最全（嵌套/数组增删原生），但①必须 JSON Schema 输入——GraphQL input 需自写转换；②默认 HTML 表单无 shadcn 主题，需重做。两座大山，不采用 |
| `jsoneditor`（josdejong） | 树/表格/代码三模式成熟，但非 schema 驱动（不知必填/枚举），独立 CSS 与 shadcn 割裂，体积 ~500KB，不采用 |
| **自研 `StructuredTable`** | **采用**：结构驱动（`StructuredField`：kind scalar/enum/boolean/input/list + required/enumValues/element/fields），递归渲染复用现有 KV 表格行模式（input → 缩进子表格、list → 数组编辑器）；值递归序列化 → JSON。数据源直接驱动（GraphQL introspection input 结构 / REST OpenAPI bodySchema 均已就绪），同时服务 GraphQL variables / REST body / REST 列表参数 |

---

## 1. 设计目标与决策原则

| 原则 | 含义 |
|---|---|
| **体验优先** | 对标 Apollo Sandbox / GraphiQL Explorer 的「勾选即得」交互，消灭手写 GraphQL 门槛 |
| **最简路径** | 不引入重型框架；能复用开源库就不自造；分页等重事务只做 MVP |
| **结构复用** | **复用现有 `DebugPage` 框架与公共组件**（`CodeEditor`/`KeyValueTable`/`ResponsePanel`/`schema-loader`/请求行+Tabs 交互模型），仅重构 GraphQL 特有能力；与原始出入不大则一律原地增强 |
| **纯函数可测** | 核心逻辑全部下沉 lib 纯函数，vitest 全量覆盖（延续现有质量门禁） |
| **数据不动** | schema 仍全量内存加载（117KB brotli 毫秒级），不做按需抓取/分片 |

---

## 2. 核心决策（D1–D8）

| # | 决策 | 决策内容 |
|---|---|---|
| **D1** | **界面架构** | **复用现有框架**：DebugPage 布局、请求行（方法+URL+Send）、请求 Tabs 交互、左栏 History/API 插槽、右侧 ResponsePanel 全部保留；GraphQL 能力在现有插槽内增强——① 左栏 API tab 的 `GqlTree` **重构**为任意深度勾选树+下钻；② `RequestEditor` 的 GraphQL tabs **增强**（Variables 校验面板、operation 下拉）；③ `ResponsePanel` 增加分页摘要。**不新建独立工作台，不删除 GqlTree 位置** |
| **D2** | **勾选模型** | 勾选状态机从「2 级 {root: Set<children>}」重构为**任意深度嵌套树**；勾选对象字段自动附加默认字段集（fillLeafs 思想）；勾选 `nodes/edges` 自动展开元素类型并附加其默认集 |
| **D3** | **参数模式** | **彻底放弃内联字面量**（`input: "…"`、`type: "…"` 均为非法 GraphQL）。勾选含必填参数字段 → 自动生成 `$var` 占位 + 变量定义，variables 面板自动生成对应 JSON 条目 |
| **D4** | **variables 联动** | query ↔ variables **双向联动校验**（缺失/多余/类型不匹配/JSON 语法），复用 `graphql-language-service` 的语义分析能力 |
| **D5** | **展开方式** | Schema Explorer 采用「点击下钻导航栈 + 勾选树」双模式：勾选树用于构建查询；字段名点击下钻查看类型文档（doc-explorer 导航栈式） |
| **D6** | **分页** | 不做自动翻页（应用层重事务，工具层无先例）。提供 **pageInfo 摘要 + 「下一页」按钮**最小 MVP |
| **D7** | **多 operation** | 支持一个文档多个 operation：AST 提取 → 下拉切换 + 当前 operation 高亮 |
| **D8** | **库依赖** | 新增显式依赖 `graphql-language-service`（graphiql 官方 monorepo 子包，cm6-graphql 已在内部使用，零额外成本）；保留 graphql-js + cm6-graphql；**不引入** codemirror-graphql（CM5 不兼容 CM6） |

---

## 3. 依赖库决策

| 库 | 用途 | 决策 |
|---|---|---|
| `graphql`（已有） | parse / TypeInfo / visit / buildClientSchema / 类型判断 | 保留 |
| `cm6-graphql`（已有） | 编辑器补全 / 悬停 / 语法诊断 | 保留，继续作为编辑器语言层 |
| **`graphql-language-service`（新增）** | `getAutocompleteSuggestions`（语义化补全 item）、`getDiagnostics`（校验）、`getHoverInformation`——分析层一站式 | **引入**（cm6-graphql 传递依赖已存在，仅加显式声明） |
| `codemirror-graphql` | CM5 版 GraphiQL 组件 | **不引入**（CM6 不兼容） |
| 其它重型构建器（graphql-zeus 等） | 代码生成 | **不引入**（超出调试工具定位） |

> 理由：我们已用 `cm6-graphql` 的 UI 层，但它的回调只给渲染结果；下沉到 `graphql-language-service` 可直接拿 `CompletionItem[]` 语义数据（label/detail/documentation/isDeprecated/sortText/insertText），支撑 Explorer 展示、variables 校验等自有 UI。

---

## 3.1 Schema 获取策略：本地快照为主 + 在线 introspection 刷新（决策）

**问题**：schema 需要本地吗？调研工具是否都通过接口动态获取？

**调研事实（主流工具 schema 获取方式）**：

| 工具 | schema 获取方式 |
|---|---|
| **Insomnia** | `fetchGraphQLSchemaForRequest`——从请求 URL **动态 introspection**（`automaticFetch` 默认开启，URL 变更自动拉取）；另有本地 JSON 导入兜底 |
| **GraphiQL** | 双通道：`fetcher` 动态 introspection（`createSchemaFetcher`）+ 本地 SDL/JSON/URL 传入；monaco-graphql 提供 `schemaLoader` 动态加载器 |
| **Apollo Sandbox** | 输入 endpoint URL 自动 introspection（闭源） |
| **Altair** | URL introspection + 本地文件导入 |
| **vscode-graphql** | graphql-config 的 `schema` 可配 URL（服务端动态 getSchema）或本地文件 |

**共同点**：通用工具**面对任意 endpoint**，无法预知 schema → **必须动态获取**，本地文件只是离线/兜底选项。

**我们场景的本质差异（关键决策依据）**：

| 维度 | 通用工具 | PureGit Debug（GitHub） |
|---|---|---|
| endpoint | 任意、未知 | **固定单一**：api.github.com/graphql |
| 匿名可用 | 通常可 | introspection **恒 401**（需 token） |
| 刷新成本 | 小 schema 可接受 | 全量 introspection（~4000 类型）**耗 GraphQL 点数**（5000 点/时配额），且网络受限地区可能失败 |
| 本地快照 | 不可能（不可知） | **可行且秒开**（117KB brotli，实测） |

**决策**：
1. **本地快照为主**（`web/public/debug/gql/schema.json`）——固定 endpoint 下这是正确工程决策：匿名可用、零点数、毫秒级、离线可用
2. **在线 introspection 为刷新通道**（现有 `fetchGqlSchema` 保留）——schema 版本落后时手动刷新；**增强为可选「自动刷新」开关**（Insomnia `automaticFetch` 思路）：登录态 + 本地快照版本落后（`schema.json` 带 @octokit/graphql-schema 包版本）→ 后台自动拉取新 schema 写 IndexedDB
3. **不做纯动态**：每次进页面 introspection 的成本（点数 + 网络 + 失败面）远高于收益，且匿名用户直接不可用
4. 方案「数据不动」原则不变（§1）；schema-loader 结构不变，仅增加「版本落后自动刷新」触发点

---

## 4. 界面方案（决策）

### 4.1 总体布局：现有 DebugPage 框架内增强（复用插槽）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 请求行：[query ▾] [https://api.github.com/graphql            ] [◉ Send] [⚡格式化] │ ← 复用现有；新增 operation 下拉（D7）
├───────────────────┬───────────────────────────────────────────┬───────────────┤
│ ① 左栏 History/API│ ② 请求区（RequestEditor，复用）              │ ③ 响应面板     │
│   [History][API]  │  Tabs: [Query] [Variables ①] [Headers]    │ (ResponsePanel)│
│   ▾ query (30)    │ ┌─ Query（CodeEditor，复用）───────────────┐ │ 200 OK 480ms  │
│     ☑ repository  │ │ query($owner: String!, $name: String!)   │ │ 1.2KB JSON    │
│     │ ☑ id        │ │ { repository(...) { id issues { ... } } }│ │               │
│     │ ☑ issues    │ └────────────────────────────────────────┘ │ { data: ... } │
│       ☑ nodes     │ ┌─ Variables（新增 GqlVariablesPanel）────┐ │               │
│         ☑ title   │ │ { "owner": "evil7", "name": "pureGit" }  │ │ [Body ▾][Headers]│
│   ...（GqlTree 重构│ │ ✅ 校验通过                            │ │ 分页：137·已取10│
│   任意深度+下钻）   │ └────────────────────────────────────────┘ │ [下一页]        │
└───────────────────┴───────────────────────────────────────────┴───────────────┘
```

> 插槽映射：① = `LeftPanel` API tab 内的 `GqlTree`（重构）；② = `RequestEditor` 的 GraphQL tabs（增强）；③ = `ResponsePanel`（增强）。全部复用现有组件树与状态流，无整区切换。

### 4.2 左栏 API tab：`GqlTree` 重构（勾选树 + 导航栈）

- **位置不变**：仍在 LeftPanel 的 API tab 内（REST 树 / GraphQL 树同插槽切换），query / mutation 两个分组（默认都展开，右侧数字=顶层字段数）
- **勾选树升级为任意深度**：字段行 = [checkbox] [字段名] [参数徽标?] [子项计数] [▶ 下钻]
  - checkbox 勾选 → 写入查询（D2）；勾选带参数字段 → 自动提取变量（D3）
  - 字段名点击 → **下钻导航栈**查看类型文档（返回按钮逐级回退），与勾选互不干扰
  - 对象字段勾选 → 自动展开其子字段并全选默认集；`nodes/edges` → 自动进入元素类型
- **搜索框**：过滤当前分组字段名（insomnia 式，快捷键 `/` 聚焦）
- **枚举/input 参数徽标**：字段名右侧显示 `(input: CreateIssueInput!)`，下钻可看 input 字段树/枚举值列表
- 底部**内省分组**：`__schema` / `__type` / `__typename` 模板保留
- hover 详情补齐（F12：返回类型 + 参数清单 + desc 全文，不再截 100 字）

### 4.3 请求区 Tabs：`RequestEditor` 增强

- **Query tab**：`CodeEditor`（复用）+ cm6-graphql（补全/悬停/诊断全保留）；反向同步勾选（D2 扩展为任意深度）
- **Variables tab（新增 `GqlVariablesPanel`）**：**KV 表格**（对齐 REST 参数操作习惯，§0.1 M4 偏离）——`[checkbox] [key+类型胶囊] [value] [操作]`；必填变量自动锁定行（Lock）、可选变量待选 badge、枚举/布尔下拉、输入自动转 JSON；校验提示 = 输入框红框 + tab 徽标（无校验条文段）
- **Headers tab**：复用现有 `KeyValueTable`（Authorization 行逻辑不变）
- **Tabs 行**：`[Query] [Variables ①] [Headers]`——Variables tab 标签带**未校验错误计数徽标**（`Variables ①`）
- **operation 下拉（D7）**：请求行方法下拉旁新增，仅 GraphQL 多 operation 时显示；切 operation 高亮定位

### 4.4 响应面板：`ResponsePanel` 增强

- 状态条：状态码 / 耗时 / 大小（现有）+ **operation 名**
- **连接分页摘要（D6）**：响应体含 `pageInfo` 时显示 `totalCount: 137 · 已取 100` + **[下一页]** 按钮（自动追加 `after: endCursor` 重新执行）
- Body（JSON 美化）/ Headers tabs（现有逻辑，仅新增分页区）

---

## 5. 执行逻辑（决策后数据流）

### 5.1 勾选状态机（D2，核心重构）

```
数据结构：GqlSelectionMap → 嵌套树
{
  "query:repository": {
    args: { owner: "$owner", name: "$name" },        // 必填参数 → 变量引用
    children: {
      id: {},                                        // 标量叶
      issues: {
        args: { first: "10" },                        // 可选参数用户填值后写入
        children: {
          totalCount: {},
          nodes: {
            children: { title: {}, number: {} },      // nodes → 自动展开元素类型
          },
        },
      },
    },
  },
}
```

- 状态不变量（重构后）：
  1. 对象字段 entry 存在 ⇔ children.size > 0（空 selection 非法）
  2. 标量叶恒无 children
  3. 生成 query 严格 = 勾选内容（+ 默认字段集注入仅在「初次勾选对象字段」时一次）
  4. 父级三态按子树递归
  5. 正反向收敛（勾选→生成→解析→归一 稳定）
- **fillDefaultFields（实际规则，§0.1 M1 偏离）**：勾选对象 → 只填充「**第一个不可展开标量**」（字符序首个无必填参数标量；connection 恰为 totalCount）；全可展开 → 沿第一项递归找叶子（深度上限 DEFAULT_DEPTH_MAX=4）；无叶子对象 → 输出裸字段。**不依赖 id 存在**（schema 实测 913 对象仅 247 有 id）——数量统一、内容有语义、可移植其他 schema
- **connection 识别**：`unwrapToNamed(type).name.endsWith("Connection")` → 勾选 nodes/edges 时自动进入 `nodes` 元素类型并全选其默认集；`totalCount` / `pageInfo` 自动附带（可选，勾选 nodes 时默认带 `totalCount`）

### 5.2 参数 → 变量提取（D3）

```
勾选字段 f（args 含必填）
→ 生成变量定义：query($owner: String!, $name: String!)   // 类型 = 参数 GraphQL 类型标签
→ 字段调用：repository(owner: $owner, name: $name)
→ variables JSON 骨架：{ "owner": "", "name": "" }        // 填入 Variables 面板
→ 用户填值 → JSON 校验通过 → Send
```

- 可选参数：不自动提取；字段下钻文档中显示，用户手动在 Query 中补（cm6 补全会提示）或在下钻面板点「添加变量」
- 枚举参数：提取为变量后，Variables 面板对应 key 用**枚举下拉**（enumValues 列表）而非自由文本（复用 D5 下钻面板的枚举数据）
- input 对象参数：提取为变量，Variables 面板生成**嵌套 JSON 骨架**（递归 inputFields 结构 + 必填标记）

### 5.3 variables 双向校验（D4）

```
parse(query) 成功
→ 提取 VariableDefinitionNode[] → variableToType: { owner: GraphQLNonNull(String), ... }
→ JSON.parse(variables)
→ 校验：① JSON 语法 ② 缺失（query 声明但 JSON 无 key）③ 多余（JSON 有但 query 未声明）
        ④ 类型不匹配（isNonNullType/isListType/enum 值合法性/input 结构）
→ 结果：{ valid, errors: [{ key, kind, message }] } → 编辑器校验条 + tab 徽标
```

> 实现来源：`graphql-language-service` 无现成 `validateVariables` 导出（其 codemirror-graphql 版在 CM5 包），**自行实现纯函数**（~80 行，parse+遍历+JSON 校验），可测。`collectVariables` 亦自实现（AST 遍历，简单）。

### 5.4 分页（D6，MVP）

```
响应体含 pageInfo{hasNextPage, endCursor} 且 hasNextPage
→ 面板显示：totalCount: N · 已取 M（M=当前 nodes.length）
→ [下一页] 点击：在对应 connection 字段参数上补 after: "$endCursor" → 重新执行
→ 新响应覆盖展示（不做结果合并，MVP 从简；合并留待后续）
```

- 实现：响应解析时用 `TypeInfo`/AST 匹配「含 pageInfo 的 connection 字段路径」→ 记录路径与游标；下一页 = 在路径对应字段参数注入 `after` 后重跑

### 5.5 多 operation（D7）

```
AST.definitions 过滤 OperationDefinition
→ operation 名列表 → 请求行下拉
→ 切换：写入 operationName（body 附带），编辑器光标定位到对应 operation 开头
→ 高亮：非当前 operation 区域用 CSS 半透明覆盖（insomnia highlightOperation 思路）
```

### 5.6 反向同步（D2 扩展）

```
编辑器 query 变化（无语法错误）
→ parse → 递归遍历 SelectionSet → 还原嵌套树勾选（含 args 中的变量引用还原为 entry.args）
→ 与当前勾选比较 → 不同才更新（延续不变量 5 防抖）
```

---

## 6. 功能特性清单（决策后定义）

| # | 特性 | 优先级 |
|---|---|---|
| F1 | 任意深度勾选树 + 对象默认字段集（fillLeafs） | P0 |
| F2 | nodes/edges 自动展开元素类型 + 自动带 totalCount | P0 |
| F3 | 必填参数 → $var 提取 + variables 自动生成骨架 | P0 |
| F4 | query↔variables 双向校验（缺失/多余/类型/语法）+ tab 徽标 | P0 |
| F5 | 字段名下钻导航栈（类型文档 + 枚举值列表 + input 字段树） | P1 |
| F6 | variables 面板枚举值下拉、input 嵌套 JSON 骨架 | P1 |
| F7 | 连接分页：pageInfo 摘要 + 下一页按钮 | P1 |
| F8 | 多 operation 下拉切换 + 高亮 | P2 |
| F9 | Schema Explorer 搜索过滤（/ 快捷键） | P2 |
| F10 | 缺变量名 key 补全（variables JSON 内提示 $name） | P2 |
| F11 | 内省分组模板（__schema/__type/__typename）保留 | P1（现有能力迁移） |
| F12 | hover 详情补齐（返回类型 + 参数清单 + desc 全文，不再截 100 字） | P1（顺手修复） |
| F13 | **schema 自动刷新**：登录态 + 本地快照版本落后 → 后台自动 introspection 写 IndexedDB（Insomnia automaticFetch 思路，可选开关） | P2 |

---

## 7. 用户操作流程构想（场景走查）

### 场景 A：零基础构造一条仓库查询
1. 进入 `/$debug` → 切 GraphQL 协议 → 左侧自动出现 Schema Explorer（schema 从 IndexedDB 秒开）
2. 在 query 分组勾选 `repository` → 字段自动展开并勾选默认集（id/name…）
3. 勾选 `issues` → 自动出现 `nodes` → 自动勾选 `nodes` 的子默认集（title/number）——编辑器已实时生成完整嵌套查询
4. 注意到必填参数 `owner/name` 已变成 `$owner/$name`，Variables 面板自动出现 `{ "owner": "", "name": "" }`
5. 填 `evil7` / `pureGit` → 校验条变绿 ✅ → 点 Send
6. 响应区显示 `totalCount: 137 · 已取 10` + 点 **[下一页]** 追加游标翻页

### 场景 B：mutation 构造（痛点修复）
1. 勾选 `createIssue` → 自动生成 `mutation($input: CreateIssueInput!)` + Variables 生成**嵌套骨架** `{ "input": { "repositoryId": "", "title": "" } }`（必填字段标记）
2. 填值 → 校验 → Send —— 全程无非法 GraphQL 手写

### 场景 C：资深用户手写
1. 直接手写 query → cm6 补全/悬停/诊断照常
2. 手写内容自动反向同步为勾选状态；variables 缺 key 时编辑器顶部提示 `⚠ 缺失变量`
3. 字段名上 Ctrl+点击（jump 能力，P2 可选）→ 下钻查看该字段文档

### 场景 D：多 operation
1. 一个文档写 `query A {...}` + `mutation B {...}` → 请求行下拉出现 A/B
2. 切 B → 高亮定位，Send 只发 B

---

## 8. 模块与文件变更计划（复用导向）

| 文件 | 动作 | 说明 |
|---|---|---|
| `web/src/lib/debug-graphql.ts` | **重构** | 状态机改嵌套树 + fillDefaultFields + connection 识别 + $var 生成；导出保持向后兼容命名（测试同步） |
| `web/src/lib/debug-gql-variables.ts` | **新增** | collectVariables / buildVariablesJson（骨架）/ validateVariables（纯函数，全量可测） |
| `web/src/lib/debug-gql-paging.ts` | **新增** | 响应 connection 路径定位 + 下一页参数注入（纯函数） |
| `web/src/pages/debug/GqlTree.tsx` | **重构**（**不删除、位置不变**） | 左栏 API tab 插槽内升级：任意深度勾选树 + 下钻导航栈 + 搜索 + hover 全文；props 透传方式不变 |
| `web/src/pages/debug/GqlVariablesPanel.tsx` | **新增** | Variables tab 内容：CodeEditor（复用）+ 校验条 + 枚举/input 辅助 + 缺 key 补全；由 RequestEditor 引用 |
| `web/src/pages/debug/RequestEditor.tsx` | **改造（增强）** | GraphQL tabs 增强：Variables tab 渲染 GqlVariablesPanel；Tabs 徽标；operation 下拉（D7）；反向同步接线不变 |
| `web/src/pages/debug/ResponsePanel.tsx` | **改造（增强）** | 新增分页摘要区 + 下一页（D6）；其余复用 |
| `web/src/pages/debug/DebugPage.tsx` | 微调 | 状态接线：变量校验结果、分页游标、operation 下拉状态；无布局变更 |
| `web/src/pages/debug/LeftPanel.tsx` | 微调 | GqlTree 新 props 透传（如有） |
| `web/src/pages/debug/schema-loader.ts` | 不变 | schema 仍全量加载 |
| `web/src/pages/debug/CodeEditor.tsx` / `KeyValueTable.tsx` | **不动** | 完全复用（GraphQL query/variables/headers 均用现有组件） |
| `web/package.json` | 新增依赖 | `graphql-language-service` |
| `web/test/debug-graphql.spec.ts` | **重构** | 勾选状态机用例适配嵌套树 + 新增 variables/分页用例 |
| `docs/debug-page.md` | **同步** | GraphQL 章节更新为增强后能力（架构章节基本不变） |

---

## 9. 测试与质量门禁影响

- **单元测试（P0 同步）**：`debug-graphql.spec.ts` 重构——嵌套树状态机不变量（1-5）重写；新增 `debug-gql-variables.spec.ts`（collectVariables/骨架生成/校验矩阵：缺失/多余/类型/枚举非法/input 结构）；`debug-gql-paging.spec.ts`（路径定位/参数注入）
- **质量门禁不变**：`pnpm lint` 零警告、`pnpm format` 通过、`pnpm test` 全绿（含 `/$debug` 1108 端点真实产物验证——REST 侧不受影响）
- **构建**：`pnpm --filter web build` 确认 graphql-vendor chunk 正常（graphql-language-service 与 graphql-js 同 chunk，体积增量可忽略）
- **新增组件 → rebuild**：`pnpm build`（按开发规范 6）

---

## 10. 实施顺序（决策后 + 实际修订）

> **已完成**：M1 ✅（daa06dd）→ M2 ✅（61d28df）→ M3 ✅（7937720 + 扁平化虚拟滚动 67b5419 + 缩进 44533ac）→ M4 ✅（e474caa + KV 表格 a64c6d3 + 红框提示 81e3a85）。每步保持 `pnpm test` 全绿（当前 7896 测试，含 87 GraphQL 用例）。

1. ~~M1（P0）~~ ✅ `debug-graphql.ts` 嵌套树重构 + $var 生成 + 测试重写（默认字段集按 §0.1 偏离）
2. ~~M2（P0）~~ ✅ `debug-gql-variables.ts` 纯函数三件套 + 测试
3. ~~M3（P0）~~ ✅ `GqlTree.tsx` 任意深度勾选树 + 反向同步（扁平化 + 虚拟滚动 + 层级缩进）
4. ~~M4（P1）~~ ✅ `GqlVariablesPanel` 接入 Variables tab（KV 表格版，见 §0.1 偏离）
5. ~~M5（P1）~~ ❌ **舍弃**（2026-08-11 用户拍板：翻页 MVP 无合并无价值 + 多连接维护爆炸；D6 废止，见 §0.2）
6. ~~M5.5（P1）~~ ✅ `StructuredTable` 复合数组编辑器——`debug-gql-structured.ts` 纯函数 + StructuredTable 递归组件 + GqlVariablesPanel 值格内嵌展开（仅 GraphQL variables，见 §0.1）
7. **M6（P2）** ✅ 多 operation 下拉 + operationName 附带（collectGqlOperations + RequestEditor 下拉）；F12/F9/F2/F13/F10 一并完成（见 §0.1）
8. **M7** ✅ `docs/debug-page.md` 同步 + `pnpm build` + 全量质量门禁（7927 测试全绿；LINT/FMT/TSC/BUILD 通过）

> 每步结束保持 `pnpm test` 全绿（纯函数先行，UI 后置，测试先行驱动）。复用组件（CodeEditor/KeyValueTable/ResponsePanel/schema-loader）全程不动，改动面收敛到 GqlTree + RequestEditor + 新增小组件。
>
> **后续（反哺对照）**：GraphQL 强化成果反哺 REST 面板——见 `debug-rest-redesign.md`（R1 搜索已实施 ✅，R2 body 结构化 / R3 自动刷新 / R4 hover 对齐待做）。
