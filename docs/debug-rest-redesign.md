# Debug 页面 REST 能力 —— 强化设计

> REST 面板对照 GraphQL 面板的能力差异分析与统一协调任务，使双协议面板对齐。

---

## 1. 定位与决策原则

| 原则 | 含义 |
|---|---|
| **反哺对齐** | GraphQL 面板已强化的能力（搜索/结构化编辑/自动刷新/hover 全文），REST 面板在相同位置逐项对照补齐；REST 侧独有能力（Params 联动/端点文档/tag 懒加载）保持并作为 GraphQL 的参照 |
| **模块化共享** | 双协议共性能力下沉共享模块（搜索组件、StructuredTable、刷新机制），不复制粘贴；各协议特有逻辑保留在各自组件 |
| **最小改动** | 只补真实差距，不做为做而做（参照 M5 翻页舍弃先例）；每项改造前先做价值评估 |
| **纯函数可测** | 新增匹配/过滤/序列化逻辑下沉 lib 纯函数，vitest 全量覆盖（延续现有质量门禁） |
| **数据不动** | REST 产物三层结构（req / res-min / res-full）不变；schema-loader 智能请求器是唯一 fetch 入口 |

---

## 2. 对照差异分析（GraphQL 强化成果 ↔ REST 现状）

> 对照维度：**左栏集合树 / 请求区 Tabs / 编辑器补全 / 结构化编辑 / 数据刷新 / 展示细节**。

| 维度 | GraphQL 已实现（含偏离） | REST 现状 | 差距判定 |
|---|---|---|---|
| **集合树渲染模型** | M3：扁平化可见行 + `@tanstack/react-virtual` 虚拟滚动（DOM 恒 ~40 行）；多级缩进 | RestTree：**同款**扁平化 + 虚拟滚动（tag/端点/骨架/错误统一行；行高 26px、缩进 14px） | ✅ 已对齐 |
| **集合树搜索** | F9：搜索框（`/` 快捷键聚焦、X 清除、placeholder）+ 跨全树包含匹配（字段名/返回类型/desc）+ 无命中分组头隐藏 | **无搜索**——43 tag 只能手动逐个展开浏览；1108 端点定位靠眼睛 | ✅ **R1**（本次已实施）；**二次优化（用户拍板）**：**只搜顶层**——GraphQL 索引只收 query/mutation 顶层字段（304 条，命中精准不炸）、REST 去掉 desc/summary 长文本匹配（label 已含 summary） |
| **hover 详情** | F12：字段 title = 返回类型 + 参数清单 + **desc 全文**（不再截 100 字） | EndpointRow title = `METHOD path` + desc/summary（**截断与否未核实**） | ⚠️ **R4** 对齐检查 |
| **结构化编辑** | M5.5：StructuredTable 递归表格（input 子表格 / list 数组编辑器 / 枚举下拉 / 必填琥珀星标）——schema 驱动、双向序列化收敛 | body 为 JSON 手写编辑器 + json-schema-completion 字段级补全（提示字段名/类型/必填，**非结构化表单**）；variables 已由 M5.5 值格内嵌展开 | ✅ **R2**（2026-08-11：统一 toggle——默认 JSON 编辑器 ↔ 结构化列表视图，双协议同模式） |
| **数据刷新** | F13：登录态 + 本地快照版本落后（7 天 TTL）→ 后台自动 introspection 写 IndexedDB | RestTree 仅**手动刷新**（RefreshCw 重拉 index）；无自动机制 | ⚠️ **R3** |
| **Variables / 参数表** | M4：KV 表格 variables（**对齐 REST 参数操作习惯**——checkbox/类型胶囊/枚举下拉/必填锁定） | ParamsTable（path/query 双向联动 + 复合段 + 必填锁定）——**GraphQL 学习原型** | ✅ 反向对齐完成 |
| **缺 key 补全** | F10：自定义变量行 name Input `datalist` 补全（未添加的声明变量名） | query 可选参数 badge 点击补行 | ✅ 等价（形式不同、语义对齐） |
| **编辑器补全** | cm6-graphql：字段/参数/枚举补全 + 悬停文档 + 行内诊断 | CodeEditor JSON 语言 + json-schema-completion 字段级补全；URL path/query/请求头名提示 | ✅ 已对齐 |
| **勾选交互** | M3：勾选树 + 双向同步（勾选 = 唯一选中动作） | 端点**点选**填充（无勾选语义） | 不适用（交互模型不同，保留） |
| **多 operation** | M6：query 内多 operation 下拉切换 + operationName 附带 | 无对应（单方法单端点） | 不适用 |
| **空/加载/错误态** | GqlTree：骨架屏 / 错误 + 重试 | RestTree：骨架屏 / 错误行 | ✅ 已对齐 |
| **懒加载** | schema 全量内存加载（数据不动） | tag 级懒加载（index 首屏 + 展开才 loadRestTag）+ 后台预热 | ✅ REST 更优，保持 |

### 2.1 结论

1. **已对齐**：渲染模型（虚拟滚动）、编辑器补全、空/加载/错误态、KV 表格习惯（GraphQL 学 REST）——无需改动
2. **需补齐（R 系列）**：搜索（R1 ✅）、body 结构化编辑（R2）、自动刷新（R3）、hover 对齐（R4）
3. **REST 独有保持**：Params 双向联动、端点文档 Drawer、tag 懒加载——作为双协议工具的整体资产

---

## 3. 核心设计

| # | 决策 | 内容 |
|---|---|---|
| **D1** | **搜索数据源** | 搜索用 `getAllEndpoints()` 全量索引（1108 端点；预热后内存缓存毫秒级），**不依赖 tag 展开状态**——搜索 = 全局检索（对照 GqlTree 搜索模式跨全树匹配）；首次搜索未预热时触发全量加载（加载态提示） |
| **D2** | **搜索行模型** | 搜索模式**平铺命中端点**（不再 tag 分组）——43 tag 是资源分类而非语义分组，平铺 + tag 徽章前缀最利于扫描；结果计数徽章；无命中 → 空态提示；虚拟滚动保留（全命中 1108 行也只渲染可视区） |
| **D3** | **body 结构化编辑** | 复用 M5.5 StructuredTable 模型：OpenAPI bodySchema（deref 产物，无 `$ref`）→ 结构模型（object → 字段行 / array → 列表 / enum → 下拉 / 必填锁定）→ 双向序列化写 `req.body`；**与 variables 共用同一 StructuredTable 组件**（协议差异只在结构模型构建层） |
| **D4** | **自动刷新** | 对照 F13：登录态 + REST 产物版本落后（index.json 带 openapi 版本号）→ 后台重拉 index/tag 写 IndexedDB；`getRestVersion` 已有版本号，改造点收敛 |

---

## 4. REST 强化任务清单（R 系列）

| # | 任务 | 对照 | 优先级 | 状态 |
|---|---|---|---|---|
| **R1** | **端点搜索框**：RestTree 顶部搜索框（`/` 快捷键、X 清除）；`filterRestEndpoints` 纯函数匹配 tag/方法/路径/label；搜索模式平铺命中 + tag 徽章 + 结果计数 + 空态；虚拟滚动保留 | F9 | P0 | ✅ |
| **R2** | **body 结构化编辑（统一 toggle）**：REST body 与 GraphQL variables 统一「默认 JSON 编辑器 ↔ 结构化列表视图」toggle；切换按钮放 tab 右侧工具栏，JSON 模式有格式化按钮；复用 M5.5 StructuredTable 与序列化层，仅新增结构模型构建层（`openApiSchemaToStructured`）；json-schema-completion 补全保留（JSON 模式） | M5.5 | P1 | ✅ |
| **R3** | **产物自动刷新**：登录态 + 版本落后 → 后台重拉 index/tag 写 IndexedDB（对照 F13 的 getGqlSchemaFetchedAt + saveGqlSchemaOnline 模式）；RestTree 手动刷新保留 | F13 | P2 | ⏳ |
| **R4** | **hover 详情对齐**：EndpointRow title 确认 desc 全文（F12 已改 GraphQL 侧不截断，REST 侧同规则）；如有截断统一 | F12 | P1 | ⏳ |
| **R5** | **搜索组件提取共享**：GqlTree / RestTree 搜索框 UI 提取共享组件（如 `TreeSearchInput`），双协议零复制；**第二行标题栏共享 `SchemaHeader`** + **刷新/加载占位共享 `TreeListSkeleton`** | F9 / R1 | P1 | ✅ |
| **R6** | **测试门对齐**：filterRestEndpoints 用例纳入 debug-openapi.spec.ts；R2/R3 新增纯函数全量覆盖；schema-integration 1108 端点断言保持全绿 | §14 | 持续 | ⏳ |

---
