# Debug 页面 GraphQL 能力 —— 设计

> GraphQL 调试面板的最终设计：勾选树 / 参数生成 / variables 校验 / 分页等特有能力。
> 总体架构、数据源、产物契约见 `debug-page.md`。

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

## 2. 核心设计

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

## 3.1 Schema 获取策略：本地快照为主 + 在线 introspection 刷新

**策略**（固定单一 endpoint，无需动态获取）：
1. **本地快照为主**（`web/public/debug/gql/schema.json`）——固定 endpoint 下这是正确工程决策：匿名可用、零点数、毫秒级、离线可用
2. **在线 introspection 为刷新通道**（现有 `fetchGqlSchema` 保留）——schema 版本落后时手动刷新；**增强为可选「自动刷新」开关**（Insomnia `automaticFetch` 思路）：登录态 + 本地快照版本落后（`schema.json` 带 @octokit/graphql-schema 包版本）→ 后台自动拉取新 schema 写 IndexedDB
3. **不做纯动态**：每次进页面 introspection 的成本（点数 + 网络 + 失败面）远高于收益，且匿名用户直接不可用
4. 方案「数据不动」原则不变（§1）；schema-loader 结构不变，仅增加「版本落后自动刷新」触发点

---

## 4. 界面方案

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
- **Variables tab（新增 `GqlVariablesPanel`）**：**KV 表格**（对齐 REST 参数操作习惯）——`[checkbox] [key+类型胶囊] [value] [操作]`；必填变量自动锁定行（Lock）、可选变量待选 badge、枚举/布尔下拉、输入自动转 JSON；校验提示 = 输入框红框 + tab 徽标（无校验条文段）
- **Headers tab**：复用现有 `KeyValueTable`（Authorization 行逻辑不变）
- **Tabs 行**：`[Query] [Variables ①] [Headers]`——Variables tab 标签带**未校验错误计数徽标**（`Variables ①`）
- **operation 下拉（D7）**：请求行方法下拉旁新增，仅 GraphQL 多 operation 时显示；切 operation 高亮定位

### 4.4 响应面板：`ResponsePanel` 增强

- 状态条：状态码 / 耗时 / 大小（现有）+ **operation 名**
- **连接分页摘要（D6）**：响应体含 `pageInfo` 时显示 `totalCount: 137 · 已取 100` + **[下一页]** 按钮（自动追加 `after: endCursor` 重新执行）
- Body（JSON 美化）/ Headers tabs（现有逻辑，仅新增分页区）

---

## 5. 执行逻辑

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
- **fillDefaultFields（实际规则）**：勾选对象 → 只填充「**第一个不可展开标量**」（字符序首个无必填参数标量；connection 恰为 totalCount）；全可展开 → 沿第一项递归找叶子（深度上限 DEFAULT_DEPTH_MAX=4）；无叶子对象 → 输出裸字段。**不依赖 id 存在**（schema 实测 913 对象仅 247 有 id）——数量统一、内容有语义、可移植其他 schema
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

## 6. 功能特性清单

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
