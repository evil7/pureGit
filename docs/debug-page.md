# Debug 页面（`/$debug`）技术架构与开发文档

> **独立技术文档**：完整记录 `/$debug`（GitHub API 调试客户端）的技术架构、数据方案、加载与缓存策略、开发约定。**自包含**——不依赖其他文档，读者单凭本文件即可理解全貌并继续开发。

## 1. 背景与定位

`/$debug` 是 PureGit 前端的 **API 调试工具页**（纯前端路由，Worker 不参与）：一个「带查看、补全、测试」的完整 GitHub API 调试客户端，对标 Postman/Apifox 交互模型。

**立项背景（决定性事实）**：GitHub 官方 GraphQL Explorer（explorer.github.com）已于 **2025-11-07 退役**，官方公告的移除原因为技术债 + 高昂维护成本（安全/无障碍）+ 无法保持合规的第三方库依赖；官方明确建议用户使用本地工具（GraphiQL / Insomnia / Altair / gh CLI）。官方主动放弃在线 playground——`/$debug` 正是填补这一空缺的产物。

**能力目标**（查看 / 补全 / 测试三合一）：

| 能力 | 说明 |
|---|---|
| **查看** | REST 端点集合树（按 tag 分组，点按即用）+ GraphQL Schema 树（query/mutation 分组 + **字段勾选合并构造** + 展开返回类型子字段 + union possibleTypes + **内省分组**）+ **端点文档**（右侧 Drawer：参数表 / 请求体结构 / 响应结构，200 默认展开） |
| **补全** | REST：URL 路径参数 + **requestBody 字段级 JSON 补全**；GraphQL：cm6-graphql 字段/参数/枚举补全 + 悬停文档 + 语法诊断（依赖完整 schema） |
| **测试** | 统一请求面板（GraphQL / REST 共用 DebugRequest 模型），**Params tab（path/query 双向联动）**、请求头 K/V 表格、Body 快速切换（json/form/text）、响应状态/头/体展示、History/Collection 持久化 |

## 2. 总体架构

```
┌─ 数据源（构建期，零下载）────────────────────────────┐
│  @octokit/openapi（REST OpenAPI deref）              │
│  @octokit/graphql-schema（GraphQL 原数据 schema.json）│
│  scripts/update-schemas.mjs 转录拆分（--upgrade 升级）│
└──────────────┬───────────────────────────────────────┘
               ▼
┌─ 静态产物（web/public/debug/，随仓库发布）───────────┐
│  rest/index.json（tag 清单）                         │
│  rest/<tag>.req.json（请求部分）                     │
│  rest/<tag>.res-min.json（响应状态码精简）           │
│  rest/<tag>.res-full.json（响应完整 schema）         │
│  gql/schema.json（GraphQL 原数据）                   │
└──────────────┬───────────────────────────────────────┘
               ▼
┌─ 前端（web/src/pages/debug/）────────────────────────┐
│  schema-loader：智能请求器（缓存优先 + 过期 + 预热） │
│  DebugPage：布局编排 + 骨架屏 + 底部缓存进度条      │
│  RestTree / GqlTree / RequestEditor / ResponsePanel  │
│  DocDrawer：端点文档浏览（规划）                      │
└──────────────────────────────────────────────────────┘
```

**职责边界**：数据源与前端严格解耦——脚本只管「从 octokit 转录拆分产物」，前端只管「按策略加载消费」。两者通过 `web/public/debug/` 下的文件结构对接，互不感知对方实现。

## 3. 数据源：octokit 双库零下载转录

直接从项目已安装的 octokit 依赖提取，**无需访问网络**，与当前实际使用的 SDK 版本完全同步：

| 库 | 提供数据 | 转录方式 |
|---|---|---|
| `@octokit/openapi` | REST OpenAPI 完整文档 | `schemas["api.github.com.deref"]`（deref 变体已展开全部 `$ref`，前端零解析逻辑） |
| `@octokit/graphql-schema` | GraphQL 官方 schema | `schema.json`（官方完整 introspection 原数据，**不转义不精简**，直接输出） |

> 注意：REST 必须用 **deref** 变体。非 deref 的 parameters 是 `$ref` 引用不展开，前端需要自写 `$ref` 解析器（复杂 + 出错面）。deref 的 4× 体积劣势被 brotli 压缩大幅抹平（见 §5 实测），故取 deref。

转录脚本：`scripts/update-schemas.mjs`（单一入口——`pnpm update:schemas` 转录已安装 SDK / `--upgrade` 先升级 @octokit/openapi + @octokit/graphql-schema 到 npm 最新再转录；数据源已直接用 octokit，无 URL 下载模式；**转录前先清空 rest/gql 产物目录**，schema 更新后 tag/类型集合变化时不留冗余旧文件）。

## 4. 产物结构：req / res-min / res-full 三层

REST 按 **operation 拆分三类文件**，每类按 tag 分文件：

```
web/public/debug/
  rest/index.json            # ~2KB：43 个 tag 清单（tag 名 + 端点数 + req 文件大小）
  rest/<tag>.req.json        # 请求部分
  rest/<tag>.res-min.json    # 响应状态码精简
  rest/<tag>.res-full.json   # 响应完整 schema
  gql/schema.json            # GraphQL 原数据
```

**三类文件的定义**：

| 文件 | 内容 | 用途 | 消费时机 |
|---|---|---|---|
| `<tag>.req.json` | operationId / summary / desc / tags / parameters（name、in、required、type、desc）+ **requestBody content-type 列表 + body schema 全量** | 集合树端点展示 + **body 字段级补全** + 请求构造 | 展开 tag / 点按端点 |
| `<tag>.res-min.json` | responses 只留 `{status, desc}` 列表（按状态码排序） | 集合树状态码展示 | 随 req 一起 |
| `<tag>.res-full.json` | responses **完整 schema**（响应体结构文档） | 文档 drawer 浏览响应结构 | 打开文档 drawer 时（懒加载） |
| `gql/schema.json` | GraphQL 完整 introspection（含全部 description） | Schema 树 + cm6-graphql 补全 + 悬停文档 | 首次进入 GraphQL tab |

**关键取舍**：原始 deref 24MB 中，**responses 完整 schema 占 ~11.3MB（85%）**——但那是响应示例文档，不是请求/补全所需。req（1.1MB raw）+ res-min（245KB raw）即覆盖全部「查看端点 + 构造请求 + body 补全」能力；res-full 仅文档浏览需要，按需加载。**不砍任何 requestBody schema**（字段级补全的数据完整保留）。

## 5. 体积实测数据（决策依据，2026-08-10 实测）

> 传输量以 **brotli** 为准（Cloudflare Pages 静态资源自动 gzip/brotli，免费）。

### REST 按 tag 拆分（raw / gzip / brotli）

| tag | req (br) | res-min (br) | res-full (br) |
|---|---|---|---|
| repos | 22KB | 3KB | 41KB |
| actions | 10KB | 2KB | 19KB |
| orgs | 10KB | 1KB | 21KB |
| issues | 4KB | 1KB | 13KB |
| codespaces | 4KB | 1KB | 10KB |
| 其余 38 tag | 各 ≤ 4KB | 各 ≤ 1KB | 各 ≤ 12KB |
| **合计** | **97KB** | **13KB** | **277KB** |

### GraphQL 原数据

| 数据 | raw | gzip | brotli |
|---|---|---|---|
| `schema.json`（完整 introspection，1606 类型 / 6262 字段） | 2584KB | 204KB | **117KB** |

### 结论

- **全部 schema 数据 brotli 后 ~490KB**，最大单文件 117KB（GraphQL）——任何单文件加载毫秒级，**无进度条需求**，仅需骨架屏
- **brotli 压缩率惊人**（res-full raw 12.2MB → 277KB，44×）：JSON 重复结构（key/类型模式）被字典式压缩器自动吸收
- 因此**不引入任何额外压缩/序列化库**（msgpack/zstd/lz-string 等在 brotli 后无增益），见 §9

## 6. 前端加载策略：懒加载 + 后台预热

**三层加载模型**（用户确认方案）：

```
进入页面
  ├─ 立即：rest/index.json（tag 骨架，~2KB）→ 集合树显示 43 个 tag + 端点数
  ├─ 按需：展开 tag → 拉 <tag>.req.json + <tag>.res-min.json（毫秒级）
  │       打开文档 drawer → 拉 <tag>.res-full.json
  └─ 后台：异步遍历全部 tag 预热（req + res-min + res-full），不阻塞 UI
```

1. **首屏**：只拉 `index.json` 渲染骨架，零等待
2. **交互懒加载**：展开 tag 才拉 req/res-min；文档 drawer 打开才拉 res-full
3. **后台预热**：页面空闲时**异步拉取全部 tag 数据**，写入本地缓存——用户实际浏览时命中的是「已预热的缓存」，体感秒开
4. **GraphQL**：首次进入 GraphQL tab 拉 `schema.json`（117KB）+ 后台构建 schema

## 7. 缓存层：智能请求器

**核心组件**：`schema-loader.ts` 中的**智能请求器**——自动决策「用缓存还是拉新数据」，并对缓存做**过期判断**，同时暴露**后台任务进度**供 UI 感知。

### 7.1 缓存键与存储

- **存储**：IndexedDB（数据大，localStorage 5MB 上限不够；解析产物序列化存储）
- **缓存键**：`debug:rest:req:<tag>` / `debug:rest:res-min:<tag>` / `debug:rest:res-full:<tag>` / `debug:gql:schema`
- **缓存内容**：分两级——
  - **解析态**（优）：直接缓存 `JSON.parse` 后的对象 / 已构建的 schema 结构 → 二次进入**跳过 fetch + parse**
  - 原始文本兜底：fetch 失败重试时用

### 7.2 过期策略

| 维度 | 策略 |
|---|---|
| **过期时长** | 默认 TTL（如 24h）；GitHub schema 更新节奏低（REST 版本化、GraphQL 周更），24h 足够 |
| **过期判断** | 读缓存时校验 `timestamp`；过期 → 标记 stale → 返回 stale 数据供 UI **立即使用** + **后台刷新**新数据写回（stale-while-revalidate，SWR 模式） |
| **强制刷新** | 用户手动触发（「刷新 schema」按钮）绕过缓存 |
| **版本失效** | `index.json` 带 `version`（脚本转录时写入 openapi/graphql-schema 包版本）——发现版本变化 → 全量缓存失效重拉 |

### 7.3 请求器接口

```ts
interface CacheEntry<T> { data: T; timestamp: number; version: string }
type LoadResult<T> = { data: T; source: "cache" | "network" | "stale" };

// 统一入口：缓存优先 → 过期 SWR → 失败降级（cache 兜底 / null）
loadRestTag(tag: string): Promise<LoadResult<{ req: ReqFile; resMin: ResMinFile }>>
loadResFull(tag: string): Promise<LoadResult<ResFullFile>>
loadGqlSchema(): Promise<LoadResult<GraphQLSchema>>
preloadAll(): Promise<void>   // 后台预热：遍历 index.json 全部 tag，逐个走请求器写缓存
```

**请求器统一规则**：
- 命中未过期缓存 → 直接返回（零网络）
- 命中过期缓存 → 立即返回 stale（UI 不等待）+ 后台拉新写回
- 无缓存 → 网络拉取，失败降级到其它 tag 缓存/错误提示
- **并发去重**：同一 tag 多个组件同时请求 → 合并为一次 fetch（promise 复用）
- **后台任务队列**：预热只占空闲带宽，与用户交互拉取互不干扰

## 8. UI：骨架屏 + 底部缓存进度条

### 8.1 骨架屏（替代进度条）

- 页面加载（index.json + 布局）期间：左栏 tag 骨架占位（skeleton 灰块）、请求区骨架
- 展开 tag 懒加载瞬间：该 tag 下端点行骨架
- 使用 shadcn `skeleton` 组件，无进度条

### 8.2 左栏底部缓存进度条（后台任务视觉感知）

- **位置**：左栏底部常驻一条迷你进度条
- **语义**：后台预热 / 过期刷新进行中的**视觉反馈**——用户正常使用不受影响，但能感知「有后台任务在跑」
- **展示**：`正在预载 schema 数据 23/43`（shadcn `progress` 组件，细高度、低对比色，不打扰）
- **行为**：
  - 首次进入页面 → 后台预热启动 → 进度条可见，逐步推进
  - 预热完成 → 进度条消失（或显示「已是最新」短暂后淡出）
  - 某 tag 过期触发后台刷新 → 进度条短暂出现（`刷新 repos…`）
  - 用户交互拉取不显示进度条（毫秒级，无感知）
  - 手动强制刷新 → 进度条常显直到完成

## 9. 压缩 / 序列化方案结论

**结论：不引入任何额外压缩或序列化库，依赖 Cloudflare Pages 自动 brotli。**

| 方案 | 相对 JSON+brotli 增益 | 结论 |
|---|---|---|
| zstd（fflate） | br 后再压 ~5-8% | 不值得 |
| MessagePack / CBOR | brotli 后基本持平 | 不值得 |
| lz-string | 远差于 br | 淘汰 |
| Protobuf / FlatBuffers | 需生成器、schema 僵化 | 过度设计 |

**原理**：brotli 这类字典式压缩器自动发现 JSON 重复结构（`"type"`、`"properties"`、`"description"` 重复数百次），把 key 字典收益吃满；二进制序列化对「压缩后的传输」无增益。**唯一可探索的优化是 key 字典化**（key→单字符）——但 br 后增量仅 5-8%，收益 < 复杂度，不做。

## 10. 补全能力设计

### 10.1 REST：requestBody 字段级 JSON 补全

- 数据：`<tag>.req.json` 中 `body`（content-type → schema 全量）已完整保留
- 实现：`lib/json-schema-completion.ts` 轻量扫描器沿 JSON 结构维护对象/数组栈（正确跳过字符串/转义），
  在对象 key 上下文（`{`/`,` 后）沿路径在 schema 的 `properties` 提示字段名，附类型/必填标记/description；
  嵌套对象逐层展开（输入 `{` 继续提示下一层）、数组按 `items`；deref 产物无 `$ref`，防御性处理 `allOf`
- 挂载：Body 编辑器（`json` 语言）传 `jsonSchema` → `createCmEditor` 自动挂 `autocompletion override`
- URL 路径参数（`{owner}`/`{repo}` 占位）、query 参数名、请求头名均可提示

### 10.2 GraphQL：完整 schema 驱动

- 数据：`gql/schema.json` 完整 introspection（含全部 description）→ `buildClientSchema` → 清洗 deprecated 一致性 → 注入 cm6-graphql
- 能力：字段补全（上下文感知）、参数补全、枚举值补全、**悬停文档**（description 全量）、语法/语义诊断（**行内标记 + hover tooltip；不挂 lintGutter**——调试面板 GraphQL 编辑框与 JSON/Raw 编辑框视觉一致：仅行号 + 折叠两列 gutter，诊断不占布局）
- `sanitizeDeprecatedConsistency`：修复 GitHub schema 自身 8 处 deprecated 一致性违规（接口字段未弃用而实现字段弃用），使 validateSchema 通过、查询诊断生效（此清洗与体积无关，保留）

## 11. 代码组织：`web/src/pages/debug/` 目录

DebugPage.tsx（当前 ~1600 行单文件）按目录拆分：

```
web/src/pages/debug/
  index.tsx           # lazy 入口（App.tsx lazy 指向这里）
  DebugPage.tsx       # 主布局 + 状态编排 + 骨架屏 + URL 子路径驱动协议（/$debug/rest|graph 双向绑定）
  schema-loader.ts    # 智能请求器（缓存/TTL/SWR/预热/进度事件 + clearRestCache 刷新清缓存）
  rest-meta.ts        # 共享展示元数据（方法徽标色/状态码配色/URL 规整/CT 映射）
  KeyValueTable.tsx   # K/V 表格（请求头/form）+ 常用 header 预设 badge + HeaderValueCombobox 值下拉
  HeaderValueCombobox.tsx # shadcn Combobox（Popover+Command）请求头枚举值下拉（替代 datalist）
  header-presets.ts   # 常用请求头预设（COMMON_HEADER_PRESETS：key + 值枚举）
  LeftPanel.tsx       # REST / Graph 两个 tab（协议切换，直观选择接口类型；历史已迁 HistoryDrawer）
  HistoryDrawer.tsx   # 执行历史右侧 Drawer（请求区常驻 icon 触发；自动保存唯一行为 + 计数/清空）
  TreeSearchInput.tsx # 共享搜索框（第一行；/ 快捷键聚焦 + X 清除；GqlTree/RestTree 共用）
  TreeListSkeleton.tsx # 共享刷新/加载占位（GqlTree loading + RestTree 刷新/首载统一骨架）
  SchemaHeader.tsx    # 共享协议标题栏（第二行：纯数字版本徽章 + hover 数据源 + 刷新 + 进度条）
  RestTree.tsx        # REST 端点树（搜索第一行 + 版本行；tag 懒加载 + 刷新全量重拉带进度 + 刷新骨架占位）
  GqlTree.tsx         # GraphQL Schema 树（搜索第一行 + 版本行；索引搜索只搜顶层 + deferred）
  GqlVariablesPanel.tsx # GraphQL Variables tab（R2 双模式：json 默认 CodeEditor / structured KV 表格 + 结构化展开）
  StructuredTable.tsx   # M5.5 结构化递归表格（input 子表格 / list 数组编辑器；R2 起双协议共用）
  BodyStructuredPanel.tsx # R2 REST body 结构化列表视图（deref schema → StructuredField → 双向序列化）
  RequestEditor.tsx   # 请求行 + Tabs + Body 编辑器（含补全挂载）+ M6 GraphQL operation 下拉 + R2 格式化/切换工具栏
  ResponsePanel.tsx   # 响应状态条 + Body/Headers（空状态等待占位；文档已迁 Drawer）
  EndpointDocDrawer.tsx # 右侧文档 Drawer（完整端点文档：参数表/请求体/响应结构）
  GraphQLLogo.tsx     # GraphQL 官方 Logo（唯一使用处）
```

依赖关系：`index.tsx → DebugPage → {schema-loader, LeftPanel, RequestEditor, ResponsePanel, EndpointDocDrawer, HistoryDrawer}`；`LeftPanel → {RestTree, GqlTree}`；`RequestEditor → KeyValueTable + GqlVariablesPanel（GraphQL Variables tab）+ BodyStructuredPanel（REST body 结构化）`；`GqlVariablesPanel → StructuredTable`；`BodyStructuredPanel → StructuredTable`；`EndpointDocDrawer → schema-loader（loadResFull）`。schema-loader 独立于 UI（可单测）。

## 12. 构建与分片（codeSplitting）

- **schema 数据全部走 public/ fetch，天然不进 bundle**——体积大头（GraphQL schema 解析用 graphql-js、补全用 cm6-graphql、编辑器用 codemirror）是**运行时依赖**而非静态数据
- `vite.config.ts` 的 `build.rolldownOptions.output.codeSplitting`：将重依赖拆独立命名 chunk，按 DebugPage 懒加载触发时并行加载：
  - `graphql-vendor`：graphql-js（schema 解析）+ cm6-graphql（补全/悬停）——仅 debug 页使用
  - `codemirror-vendor`：CM6 全站编辑器工厂（CodeEditor）及 lezer 语言扩展
- `/$debug` 本身已是 `App.tsx` lazy 路由，独立 chunk（~46KB / gzip 13KB），不进首屏
- 验证：`pnpm --filter web build` 后 debug chunk 保持小、graphql-vendor/codemirror-vendor 独立；>500kB 警告仅剩全站 MarkdownView（@uiw/react-markdown-preview，非 debug 范畴）

## 13. 端点文档（右侧 Drawer，左栏对应端点行 hover 触发）

- **展示位置（2026-08-11 迁移）**：文档以**独立右侧 Drawer** 展示当前所指向接口的完整文档，**不再放进返回面板**（返回面板空状态恢复「点击发送」占位；文档查阅与响应结果彻底分离，阅读空间充足）
- **触发方式（2026-08-12 迁移）**：左栏 REST 端点树中**当前匹配的端点行**（URL+method 匹配或点选，行背景高亮）——hover 该行时右侧浮现 **book icon 按钮**（opacity 过渡，打开态高亮）；点击开/关 Drawer。未匹配端点（自定义 URL）无任何行按钮，Drawer 自动关闭
- **宽度**：`w-2/3! max-w-none!`（总宽度 2/3；vaul 默认 `w-3/4` + `sm:max-w-sm` 太窄，须同时清 max-width 否则 24rem 卡住）
- **完整内容**：方法徽标（`text-xs font-bold px-2 py-1`，与 `text-sm` 路径垂直居中协调）+ 路径 + tag + summary/desc → **区段标题统一（`DocSectionTitle` 组件：`text-[11px] uppercase` 无图标 + 可选 hint 后缀）**——参数（含计数）/ 请求体结构（hint=content-type 列表）/ 响应三者结构一致 → **参数表（name/in/type/required/desc 完整五列）** → **requestBody 结构**（JSON-schema 树，`oneOf/anyOf` 分支逐层展开）→ **响应状态码列表**
- **响应结构自动加载**：Drawer 打开即自动 `loadResFull`（IndexedDB 缓存秒开），**默认展开第一个 2xx**（通常 200）——首要呈现正常返回结构；其他状态码点开再展开
- **联动**：端点点选/URL 匹配都会实时刷新 Drawer 内容；Drawer 打开时切换端点文档自动更新
- **数据**：参数/body 来自 req 产物（补全同源），响应结构经 schema-loader.loadResFull 懒加载
- **组件**：`web/src/pages/debug/EndpointDocDrawer.tsx`（SchemaTree/ResponseSchemas 由原 ResponsePanel 迁入，逻辑不变）

## 13.1 REST 请求参数（Params tab，path/query 双向联动 + 文档对照）

**权威原则**：URL 是 query 参数的权威源，端点文档是 path 参数与可选参数的权威源。表格行按来源区分 `DebugParam.explicit`：`true` = 已在 URL 显式出现（反向同步/移除、空值也输出裸名）；`false` = 编辑中行（文档填充/手动添加，空值不输出、反向保留）。

- **位置**：REST 请求 Tabs 第一位「参数」；端点选择后自动填充——path 行带 `path[n]` 段位置徽章（split('/') 索引，误删占位可快速定位取值位置），query 行空值待填
- **参数 tab 显示条件**：仅当匹配到端点文档**且文档含需设定的参数（path/query）**才显示「参数」tab；未匹配（自定义 URL）/文档无参数 → 不显示参数 tab
- **默认 tab 优先级（2026-08-11 规范）**：REST **参数 > 请求数据 > 请求头**——有文档参数 → 参数；无参数但有请求数据（POST/PUT 等非 GET/HEAD/OPTIONS）→ 请求数据；否则 → 请求头（第一个 tab）；GraphQL → 查询
- **正向（参数 → URL）**：`buildUrlFromParams`（lib/debug-params.ts）——path 参数按 `index` 段位置直接覆盖 URL 对应段（值空/占位/段缺失保留；不依赖 `{name}` 占位符）；**段内含 `{name}` 子占位（复合段如 `{base}...{head}`）→ 只替换该子串**（共享 index 的多个 path 参数互不破坏、其余部分保留），否则整体覆盖段；**复合占位分次编辑**（先填 base 段变 `main...{head}` 再填 head 时 `{base}` 子串已消失 → 整体覆盖会毁段）→ **doc 提供模板时复合段直接从模板段重建**（模板永远含全部 `{name}`，缺失参数行子占位保留）；query enabled 即输出——值非空 → `name=value`，值空但显式 → 裸名 `name`（`?aa&bb` 无值 query 循环不丢）；disabled / 空值非显式 → 不输出
- **反向（URL → 参数）**：`syncParamsFromUrl`——URL 出现的 query key → 行显式同步（value/enabled/explicit）；显式行被 URL 移除 → 表格移除（文档参数自动转 badge）；disabled 行保留；编辑中行（explicit=false）——**提供 doc 时若不在文档 query 参数集则移除**（切换端点清残留，旧端点文档行不属于新端点）、在文档集内保留待填；URL 新 key 补显式行（**重复 key `?a=1&a=2` 只补首个**，表格单 key 模型）。path 按 index 同步段值；提供 doc 模板时 path 行集合完全对齐模板（补缺失/移多余，path 行只能来自端点）；**复合占位段（共享 index）按模板段字面分隔符切分各自子串**（`{base}...{head}` + `main...dev` → base 行 "main"、head 行 "dev"）
- **表格展示排序**（`syncParamsFromUrl` 返回前统一重排）：path 恒在前按段位置 index 升序（模板顺序）；query 按 URL 出现顺序（parseQuery 保序）——URL 中无此行（disabled 保留 / 文档待填）保持相对顺序排末尾。排序不影响语义（path 按 index、query 按 enabled+value），正向构建 `buildUrlFromParams` 按数组序输出 → 表格序 = URL 序 → 双向循环稳定
- **必填 path 删空 → 占位提示 + URL 回占位**：value 输入框删空（trim 后为空）→ 不再自动补回 `{name}` 文本，改由 **placeholder 提示必填**（`{name}`，数字类型参数显示 `1`）；`buildUrlFromParams` 在 doc 提供模板时**直接恢复模板占位段**（URL 回 `/orgs/{org}/repos`），空段为「未填」状态；query 选填行不受影响
- **required 语义（锁定 + 未填警告）**：`DebugParam.required?: boolean` 标记必填（path 行恒 `required: true`，query 行仅 OpenAPI `required: true` 参数）——① **锁定**：required 行操作列恒 Lock 占位（path 行 disabled checkbox，双保险不可删不可禁用），非必填行 X 可删；② **必填 query 自动列行**：端点匹配只自动填充 required query 行（explicit=false 编辑中，空值不输出 URL、填值后输出），非必填 query 以 badge 呈现；③ **未填警告**：required 行 value 为空 → 输入框 `border-destructive/70 bg-destructive/5 focus-visible:ring-destructive/30` 警告样式 + placeholder 必填提示，URL 该参数为占位/缺失态；填值后警告消除
- **复合段合并行同享 required**：`{base}...{head}` 复合段合并单行的每个独立 input 同样带 placeholder（`{base}`/`{head}`）与未填警告样式
- **文档可选参数待选 badge**：ParamsTable 接收 docQueryNames（当前匹配端点 query 参数名），badges = 文档参数 − 表格已有，显示在**添加按钮（纯 icon，与其他 table 一致无文字）右侧**（虚线胶囊）；点击 → 补行（**explicit=true 显式行：空值即输出裸名 `?aaa`**，满足「只 key 无值」双态）→ badge 消失。手动删除的文档 query 行同样转为 badge
- **query 来源基线**：**非必填 query 不自动列出**——端点匹配（点选）只自动填充 **required query** 行（explicit=false 编辑中，空值不输出 URL、填值后输出）；非必填全部以 badge 呈现由用户自行决定添加。手写 URL 匹配场景下 query（含 required）也以 badge 呈现（URL 是权威源，用户自拼）
- **query 只 key 无值 / 有值双态**：explicit=true 行空值 → 裸名 `name`（URL `?aaa`）；填值 → `name=value`（URL `?aaa=bbb`）；反向手写 `?aaa` → 显式空值行，正向裸名保持不丢
- **URL+方法匹配端点 → 自动加载文档（文档权威 + 端点固化）**：DebugPage 防抖 250ms 用 `matchEndpoint`（debug-openapi.ts 段级模板匹配：段数相同、`{name}` 通配、**评分制**——① 静态段数优先（`rule-suites` 不被 `{ruleset_id}` 抢）；② 同静态段数时占位段**字面结构分**（模板自身最高分，其次段内字面片段如 `...` 出现在 URL 段 → `{base}...{head}` 不被排序在前的 `{basehead}` 抢，**不依赖数组顺序**）；空 URL 守卫用 `url.trim()===""`，**根路径 `/`（段数 0）仍可匹配**）匹配 `getAllEndpoints()`（schema-loader 全量索引），**仅当无端点或当前端点与 URL 结构不再匹配时触发**：
  - 命中 → 加载端点文档（右侧 Drawer 内容）+ bodySchema（补全）+ 骨架对齐（path 行对齐模板、query 按文档全集）
  - 未命中 → 清空文档（转显式行模式）
  - **端点固化**：端点确定后 URL 微编辑（填值/改值，静态段与段数不变）不触发重新匹配——`endpointStillMatches`（方法一致 + 段数相同 + 静态段位置值相等）判定通过即跳过，表格值由 RequestEditor URL onChange（传 doc）即时同步；URL 结构变化（静态段/段数改变）或方法切换 → 判定失败 → 重新匹配换端点/清空。杜绝微编辑端点跳变与匹配失败丢文档
- **响应区默认折叠 + 发送自动展开（2026-08-11）**：未发送数据时响应区**默认折叠**（`respCollapsed` 初始 true，只留头部一行，请求区全高编辑）；发送响应数据后 **`run()` 内自动 `setRespCollapsed(false)` 展开**（结果到达即展示）
- **响应区默认 tab（2026-08-11 更新）**：初始「响应头」；**请求后按内容自动切换**——有响应数据（Length > 0）→ Body，无数据内容（Length 0，如 DELETE 204 等）→ Headers（REST 与 GraphQL 同规则；页面统一描述：请求头/请求数据/响应头/响应数据）
- **事件驱动防循环**：参数编辑 onChange 重建 URL、URL 输入框 onChange 反向同步，不经 useEffect 无回写循环；端点匹配只补 path 行/文档，不改 URL
- **默认请求**：进入页面默认 REST + GET（`EMPTY_REQUEST`，URL 直接 `/` 根路径、placeholder `/repos/{owner}/{repo}` 提示典型模板）；GraphQL 模板显式声明 protocol/method
- **子路径驱动协议（/$debug/rest | /$debug/graph，2026-08-11）**：`App.tsx` 加 `/$debug/:proto` 路由——URL 子路径是协议权威，与点击切换（方法下拉/端点选择）**双向绑定**：① **URL → 协议**：直接访问 `/$debug/graph` → 协议切 GraphQL（query）、`/$debug/rest` → REST（GET）；无子路径/非法值 → `navigate replace` 归一化补全为 `/$debug/rest`；② **协议 → URL**：方法下拉切协议/端点选择 → `navigate replace` 写回对应子路径（程序化协议变化置 `programmaticProtoRef` 跳过反向回写防循环；URL→协议 effect 仅依赖 proto 快照判断，不响应 req.protocol 避免与反向 effect 冲突）——**URL 始终带子路径，可分享/刷新不丢类型**
- **GraphQL 编辑框空 + placeholder**：切到 GraphQL（query/mutation）时 query 编辑框**默认空内容**，仅 placeholder 显示示例 `query { viewer { login } }` 提示（`EMPTY_REQUEST.query` 为空、方法下拉切 GraphQL 时 `query: ""` 清空）；左栏 Schema 树/勾选合并/内省分组点按仍主动生成查询填入（用户行为保留）
- **GraphQL 勾选合并（勾选唯一选中 + 双向同步，2026-08-11 定稿）**：query/mutation 字段行（含展开的子字段）前有 checkbox——**勾选 = 唯一选中动作**（无独立按钮，**点击字段名仅展开/收起**返回类型子字段，不再生成单字段模板）。**勾选父级 → 子项全自动勾选**（对象 root 自动带全部可见子字段）；**只有被勾选才写入**——生成 query 严格 = 勾选内容（`gqlMapToQuery`，无隐式默认字段/主键）；父级三态（checked / indeterminate / unchecked，radix `CheckedState`），**取消最后一个子项 → 父级一并取消**；取消全部勾选 → 清空 query。**反向同步（手写 → 勾选）**：监听编辑器 query（`editorQuery` prop），无语法错误时 `parseQueryFieldSelections`（graphql.parse AST 提取顶层字段+子字段）→ `buildSelectionsFromParsed` 归一化（非 schema 字段/内省字段跳过、对象空 selection 跳过）→ 与当前勾选比较，不同才更新；语法错误/空 query → 不反向/清空勾选。**状态机纯函数**（`toggleRootSelection` / `toggleChildSelection` / `buildSelectionsFromParsed` / `gqlRootCheckState` / `gqlMapToQuery`，lib/debug-graphql.ts）——不变量：对象 root entry 存在 ⇔ children>0、标量 children 恒空、正反向收敛循环稳定（debug-graphql.spec.ts 全量覆盖）。**多 mutation input 变量冲突消解（2026-08-11 数字递增定稿）**：多个 mutation 的必填 `input` 参数同名 `$input`（GraphQL 变量必须唯一）→ `gqlMapToQueryDetailed` 预扫描引用计数（`countVarRefs`，>1 即冲突）→ `collectArgText` 维护已占用变量名集合 + 冲突计数器 map，**全部字段数字递增命名 `参数名+序号`**（`$input` 冲突 → `$input1` / `$input2` / …，列表会显示各自类型无需语义化长名，更简化；单字段引用保持原名 `$input`），字段引用与变量定义同步改名——`mutation($input1: AddStarInput!, $input2: CreateDiscussionInput!) { addStar(input: $input1) {...} createDiscussion(input: $input2) {...} }`（debug-graphql.spec.ts 用例：fixture 加 createDiscussion 第二 mutation，多选冲突消解）
- **GraphQL 列表排序与计数（2026-08-11）**：① **普通字符序**（`byName`，**不区分主键**——勾选合并无隐式默认字段，`id` 无特殊地位，不再恒最前）；② **父级后方数字 = 子条目数量**（对照 REST tag 的端点数语义）——字段行右侧徽章从 args 数改为可展开子字段数（`typeFields?.length`，union 用 possibleTypes），args 参数清单保留在 hover title（子字段 args 徽章一并移除）
- **GraphQL connection 拆包（2026-08-11 解析层去除）**：`edges`/`nodes`/`node` 等 connection 语法节点是复合查询的语法结构而非「API 功能端点」，在**树形解析层（`buildGqlSchemaContext` 的 `fieldsOf`）刻意去除**，不按勾选决定（嵌套多处 `nodes[]` 噪音大、去留有歧义）——① **object 元素拆包**：`fieldsOf` 遇 `obj.name.endsWith("Connection")` 且 `connectionElement(obj)` 为 **object 类型** → 直接返回**元素类型字段**（跳过 edges/nodes/pageInfo 语法层，如 `assignableUsers` 展开直接见 User 字段）；② **union/interface 元素保持原样但过滤语法字段**（如 `SearchResultItemConnection`）：拆包无意义（无公共字段），保持原样展示但过滤 `edges/nodes/node/pageInfo/cursor` 语法字段，**业务聚合字段保留**（`codeCount`/`issueCount`/`totalCount` 等——totalCount 是 GitHub 连接计数，有业务价值不在过滤集）；③ **顶层 `node(id: ID!)`/`nodes(ids:)`/`relay`/`resource` 是 Relay 公共语法（跨站点通用内建，非业务端点），顶层列表整体屏蔽**（`GQL_TOP_SYNTAX_FIELDS`，query 30→26 字段）；④ 一次改动全链路生效（树/勾选/构造/反向同步自动受益，而非 UI 层过滤）；⑤ conn 徽章保留（hover 提示拆包语义）。测试覆盖：object 元素拆包 / union 元素过滤语法保留业务 / 顶层 node 屏蔽 / 屏蔽不入搜索索引 / 反向同步跳过屏蔽字段 / 非 connection 不误伤 / 生成 query 无 edges 包装 / 默认子树取元素字段 / 手写 edges 反向不勾选（debug-graphql.spec.ts）
- **GraphQL 内省分组（替代自定义模板）**：GqlTree 底部（原模板位置）固定「内省」分组默认展开——`__schema`（queryType/mutationType/types）/ `__type(name: "…")` / `__typename`，点击填充内省查询（GraphQL spec 标准）；`PRESET_COLLECTION` GraphQL 预设渲染移除（数据保留供历史去重）
- **Schema/端点搜索（F9 + R1，2026-08-11 定稿）**：**统一布局**——搜索框第一行（`TreeSearchInput` 共享组件：`/` 快捷键聚焦、X 清除），**第二行 `纯数字版本徽章 (刷新icon)`**（`SchemaHeader` 共享组件：无协议标题文字——版本徽章只显示数字版本 `22.0.0` / `15.26.1`（无包名前缀；hover 完整 `schema data by pkg@ver`）；GraphQL 版本经转录脚本 `gql/index.json` + `getGqlVersion()`，与 REST index.json 对称）；**刷新时列表占位统一 `TreeListSkeleton` 共享组件**（GqlTree loading + RestTree 刷新/首载均显示同款骨架，视觉一致）；**只搜顶层（用户拍板）**——① GraphQL：`buildGqlSearchIndex`（`debug-graphql.ts`）只收集 query/mutation 顶层字段（屏蔽公共语法后 ~296 条，不递归子字段——搜索定位顶层后点开浏览子字段；命中精准不炸），`searchGqlIndex` O(顶层数) 极快 + `MAX_SEARCH_HITS=100` 截断 + `useDeferredValue`（输入即时、检索低优先级滞后不阻塞）；② REST：`filterRestEndpoints` 只匹配 tag/方法/路径/label（label 已含 summary，去掉 desc/summary 长文本噪音）
- **GraphQL 结构化变量（M5.5，2026-08-11）**：input/list 变量行 value 格由「JSON 字面量手写」改为**结构化编辑器**——① **值格内嵌展开**：input/list 变量行 value 格为展开按钮（chevron，点击展开/收起），行下展开子表格（`StructuredTable` 组件）——**展开子表格紧跟对应变量行正下方**（同一行 map 内 Fragment 内联渲染，多变量时一一对应不串位；勿用独立 map 集中渲染组末尾）；② **input → 递归字段行**（checkbox + 必填琥珀标记/可选灰胶囊 + 值控件递归——枚举/布尔下拉、嵌套 input 再展开子表格）；③ **list → 数组编辑器**（[+ 添加] 项 + 每项删除；元素 input → 子表格、标量 → 输入框）；④ **双向序列化**：编辑 → `structuredRowToJson`（空 input/list → undefined 跳过、Int/Float 转 Number）写 `req.variables`（发送/历史零改动复用）；外部 JSON（历史重放）→ `jsonToStructuredRows` 反向重建（缺字段空骨架——**忠实还原**，默认值由 placeholder 承载，保证正反向收敛）；⑤ 纯函数 `lib/debug-gql-structured.ts`（`inputTypeToStructured` 递归模型 / `buildStructuredValue` 骨架 / 双向序列化）全量可测（debug-gql-structured.spec.ts 24 用例）。**三修正（用户拍板）**：必填排最上 / 星号红色 / 必填 checkbox 不可取消
- **R2 body/variables 结构化 toggle（2026-08-11 统一双协议）**：**默认 JSON 编辑器 ↔ 可切换结构化列表视图**——① **toggle 按钮在 tab 右侧工具栏**（格式化按钮旁；结构化模式无格式化、JSON 模式有格式化）；② **REST Body**：`BodyStructuredPanel`——bodySchema（OpenAPI deref）→ `openApiSchemaToStructured`（`lib/debug-rest-structured.ts`，object/array/enum/boolean/Int/Float/oneOf/anyOf/allOf/隐含 object，必填排最上）→ StructuredTable 递归表单（object 字段行、array 数组编辑器、enum 下拉、必填锁定 + 星号、placeholder 承载默认值）；编辑 `structuredRowToJson` 写 `req.body`，切回 JSON 即时可见；无 bodySchema（未匹配端点）→ 切换按钮禁用；③ **GraphQL Variables**：`GqlVariablesPanel` 双模式（`viewMode`）——json 模式 CodeEditor 直编（校验 parseVariablesJson + validateVariables）、structured 模式现有 KV 表格（M4/M5.5 全保留，校验走表格序列化）；④ 格式化按 tab 分流（GraphQL Variables tab 格式化 variables / 其他格式化 query）；⑤ json-schema-completion 补全保留（JSON 模式）。**结构化表无添加按钮（2026-08-11 用户拍板）**：variables structured 模式去掉「添加自定义行」Plus 按钮——变量由 query 声明派生、schema 驱动，自定义添加无意义（发送 extra 校验提醒），仅保留**可选声明变量待选 badge**（`$name` 胶囊补行）；自定义变量需手写 JSON 模式（json 视图可自由编辑任意 JSON）
- **请求头常用预设（2026-08-11）**：KeyValueTable 添加按钮右侧显示「常用:」预设 badge（`COMMON_HEADER_PRESETS`，`header-presets.ts`）——点击补行（key 预填 + value 取首个枚举值；已有同名头不重复补）；**枚举头 value 输入用 `HeaderValueCombobox`（shadcn Combobox：Popover+Command）下拉**（替代浏览器原生 datalist——datalist 无下拉指示器/原生样式不可控/交互不可预测；组合框输入框右侧 ChevronDown 箭头按钮，点击弹出命令面板预设值，点选填充，仍可自由输入任意值，如 Accept: application/vnd.github+json / application/json / text/plain）；预设含 Accept / Content-Type / X-GitHub-Api-Version / User-Agent / If-None-Match / If-Modified-Since / X-GitHub-Next-Global-ID（仅请求头 tab 启用，form 表格不显示）
- **请求 Tabs 徽章与告警（2026-08-11）**：tab 右侧实时状态提示——① **REST 参数计数徽章**：匹配端点文档的需设定参数数（path+query，灰色小徽章）；② **REST Body JSON 错误**：json bodyType 且非空文本 JSON 解析失败 → 「请求数据」tab 右侧红色 `TriangleAlert`；③ **GraphQL query 语法错误**：query 非空且 parse 失败（`collectGqlOperations` 返回 null）→ 「查询」tab 右侧红色 `TriangleAlert`（修复即消失）；④ **GraphQL 变量错误计数**：「变量」tab 红色计数徽章（`validateVariablesText` 实时校验——query/变量输入即更新，**不依赖切换 Variables 面板**；面板挂载后其上抛的精细值覆盖实时值）
- **URL 前缀一致性**：`https://api.github.com` addon 用 `font-mono text-sm leading-none`——与 path 输入框（Input 组件 `md:text-sm` 实际 14px）同字号、`items-center` 垂直居中（leading-none 防 line-height 撑高 InputGroup）
- **布局与请求头统一**：ParamsTable 照搬 KeyValueTable（请求头）骨架——列结构（checkbox / key / value / 操作）、操作列图标（必填 Lock 占位、选填 X 删除 `Button size="icon" variant="ghost" h-6 w-6`）、添加行同为表格内 colSpan 行（靠左与 checkbox 槽对齐）；差异仅在 key 输入框用 `InputGroup` + `InputGroupAddon align="inline-end"` 内嵌类型胶囊（`path[n]` / `query`）
- **复合占位段（单 path 段多参数）合并单行**：段模型 `DebugParam.segPos/segCount/segSeparators`（全可选向后兼容；单占位段恒 segCount=1）——① **识别**：`parsePathSeg`（lib/debug-params.ts 导出）统一解析段内占位符 + 字面分隔符（`{base}...{head}` → names=[base,head]、seps=["","...",""]；复杂段 `{aaa}...{bbb}---{ccc}` 自动适配），`endpointToRequest` / `extractPathParams` / `splitCompoundUrlSeg` 三处复用同一模型；② **列出**：ParamsTable 按 index 分组 path 行，`segCount>1` → **合并单行**——key 显示参数名+真实分隔符（`base...head`），value 每参数独立 Input + 中间真实分隔符文本（低对比非可编辑，title 提示「段内字面分隔符」）；③ **设定**：每 input 更新对应参数行（模型仍每参数一行），分次编辑天然正确，复杂段自动扩展 N input + N-1 分隔符；④ **扁平标签**：胶囊仍 `path[n]`（不引入 `·1/2` 层级后缀）；⑤ **排序**：path 按 index 升序 + 同 index 次级 segPos 升序（base 恒在 head 前）
- **历史 bug（复合段合并依赖段模型）**：`syncParamsFromUrl` 补齐 path 行曾只带 name/index（无段模型）→ 端点匹配后合并失效——补齐/同步分支都须带 segPos/segCount/segSeparators（schema-integration 断言覆盖）
- **编辑器高度自适应拉满**：请求区 Body/Query/Variables 编辑器与响应区返回体——**必须用 `h-full min-h-0` 确定高度链**（外层 scroll 容器高度确定 → 容器 `height:100%` → CodeEditor 外层 `flex-1` → cm-host `flex-1` → cm-editor `height:100%` 依次解析撑满）；**禁止 `min-h-full`**（只设 min-height 不设 height，flex 高度链 indeterminate → CM6 的 `height:100%` 无法解析 → cm-editor/cm-content 塌陷成内容高：空内容只显一行 + 下方大片空白，内容多时被 overflow 裁剪无法滚动——2026-08-11 浏览器实测逮住）。响应区返回体 pretty 态 CodeEditor `fill` 撑满、raw 态 `<pre>` 用 `min-h-full`（内容少时占满容器、内容多时自然撑高外层滚动）——两个展示框均与内容区等高，不留底部空白

## 14. 开发约定

- **数据产物由脚本生成，不手改**：改 schema 结构只动 `scripts/update-schemas.mjs`，产物重新生成
- **前端消费结构契约**：`debug-openapi.ts`（OpenApiDoc 类型）随产物结构调整同步更新；schema-loader 是唯一 fetch 入口，页面组件不直接 fetch public 文件
- **临时产物即用即删**：测试脚本用后删除，不留垃圾
- **质量门禁**：`pnpm lint`（oxlint 零警告）+ `pnpm format` / `format:check`（oxfmt 一致）+ `pnpm typecheck`（tsc -b，含测试）+ `pnpm --filter web build` 通过
- **测试质量门（新增）**：`pnpm test`（vitest，node 环境）——**REST 侧四文件**：① `web/test/debug-params.spec.ts`（parseQuery/parsePathSeg/buildUrlFromParams/syncParamsFromUrl 单元）；② `web/test/debug-openapi.spec.ts`（buildGroupFromTag/endpointToRequest/matchEndpoint/endpointStillMatches + **R1 filterRestEndpoints 搜索过滤（只搜顶层）** 单元）；③ `web/test/debug-rest-structured.spec.ts`（**R2 openApiSchemaToStructured 映射**：object/array/enum/boolean/Int/Float/oneOf/allOf/隐含 object + 端到端收敛）；④ `web/test/schema-integration.spec.ts` **全量真实产物验证**——读 `web/public/debug/rest/` 全部 44 tag × req.json、遍历 **1108 个端点**逐一断言 8 项规则（path↔模板占位双向一致 / endpointToRequest 提取正确含段模型 + **required query 行** / matchEndpoint round-trip 命中自身 / 填值 round-trip / endpointStillMatches 固化 / buildUrlFromParams 正向不改 URL / syncParamsFromUrl 反向骨架稳定含段模型一致 + required query 集 + **required 与 type 一致性** / **R2 body schema 可结构化转换**——303 个 JSON body 全部可转 + 必填排最上）。**GraphQL 侧独立文件**：⑤ `web/test/debug-graphql.spec.ts`（buildGqlFieldTree 树构建 / 勾选状态机 toggle×2+buildSelectionsFromParsed+gqlRootCheckState / gqlSelectionsToQuery+gqlMapToQuery 构造 / parseQueryFieldSelections 解析 / **不变量 5 正反向收敛** / **M6 collectGqlOperations 多 operation 提取** / **搜索索引只搜顶层** / **connection 拆包 + 公共语法屏蔽**——mini schema 夹具覆盖 object/interface/union/enum/scalar/list/non-null/input/deprecated，**90 用例**（含多 mutation input 冲突消解））；⑥ `web/test/debug-gql-variables.spec.ts`（collectVariables / buildVariablesJson 骨架 / validateVariables 校验矩阵，22 用例）；⑦ `web/test/debug-gql-structured.spec.ts`（**M5.5 结构化**：inputTypeToStructured 五分类递归 / buildStructuredValue 骨架 / structuredRowToJson+rowsToJson 序列化 / jsonToStructuredRows 反向 / **端到端收敛**，24 用例）。REST 与 GraphQL 分工独立、互不依赖；任何解析/填充/匹配/排序/序列化改动必须全绿（当前 **9077** 测试）。**GraphQL 强化与 REST 反哺对照见 `debug-rest-redesign.md`**

## 15. 关键文件索引

| 文件 | 作用 |
|---|---|
| `scripts/update-schemas.mjs` | 单一入口：octokit 转录三层拆分 + `--upgrade` 升级包后转录 |
| `scripts/update-schemas.mjs` | 双模式封装（octokit 转录 / 官方下载） |
| `web/src/pages/debug/schema-loader.ts` | 智能请求器（缓存/TTL/SWR/预热/进度）+ getAllEndpoints 全量索引 + clearRestCache 刷新清缓存 + getGqlVersion 版本读取 |
| `web/src/pages/debug/rest-meta.ts` | 共享展示元数据（方法色/状态码配色/URL 规整） |
| `web/src/pages/debug/TreeSearchInput.tsx` | 共享搜索框（第一行；`/` 快捷键 + X 清除；GqlTree/RestTree 共用） |
| `web/src/pages/debug/SchemaHeader.tsx` | 共享协议标题栏（第二行：纯数字版本徽章 + hover `schema data by` + 刷新 + 进度条/状态） |
| `web/src/pages/debug/HeaderValueCombobox.tsx` | 请求头枚举值下拉（shadcn Combobox：Popover+Command；替代 datalist） |
| `web/src/pages/debug/TreeListSkeleton.tsx` | 共享刷新/加载占位（GqlTree loading + RestTree 刷新/首载统一骨架） |
| `web/src/pages/debug/header-presets.ts` | 常用请求头预设（COMMON_HEADER_PRESETS：key + 值枚举） |
| `web/src/pages/debug/` | 页面全部组件（见 §11） |
| `web/src/lib/debug-api.ts` | 请求执行引擎（GraphQL/REST 直连） |
| `web/src/lib/debug-openapi.ts` | REST 产物结构类型 + 集合树构建 + matchEndpoint/endpointStillMatches + **R1 filterRestEndpoints 搜索过滤（只搜顶层）** |
| `web/src/lib/debug-graphql.ts` | GraphQL schema 加载 + 字段树 + **buildGqlSearchIndex/searchGqlIndex 顶层搜索索引** + **公共语法屏蔽（GQL_TOP_SYNTAX_FIELDS / GQL_CONN_SYNTAX_FIELDS）+ connection 拆包** |
| `web/src/lib/debug-gql-variables.ts` | GraphQL 变量三件套（collectVariables / 骨架 / 双向校验） |
| `web/src/lib/debug-gql-structured.ts` | **M5.5 结构化**：inputTypeToStructured 递归模型 / 骨架 / 双向序列化（R2 起双协议共用） |
| `web/src/lib/debug-rest-structured.ts` | **R2 REST 结构化映射**：openApiSchemaToStructured（OpenAPI deref schema → StructuredField） |
| `web/src/pages/debug/StructuredTable.tsx` | **M5.5 结构化递归表格**（input 子表格 / list 数组编辑器；GraphQL variables 与 REST body 共用） |
| `web/src/pages/debug/BodyStructuredPanel.tsx` | **R2 REST body 结构化视图**（body JSON ↔ 结构化行双向序列化） |
| `web/src/lib/debug-store.ts` | Collection/History 持久化 |
| `web/src/lib/json-schema-completion.ts` | REST body JSON-schema 字段级补全（CM6 override 源） |
| `web/src/lib/debug-params.ts` | REST Params 双向联动（全量实时解析 + explicit 语义） |
| `web/src/pages/debug/ParamsTable.tsx` | Params 表格（path[n] 徽章 + query 增删 + 文档 badge + **复合段合并单行**） |
| `web/src/lib/codemirror.ts` | CM6 编辑器工厂（graphql 语言 + json 补全挂载 + tooltip 挂 body） |
| `web/test/` | vitest 质量门测试（REST：debug-params / debug-openapi 单元 + schema-integration 全量产物；GraphQL：debug-graphql + debug-gql-variables + debug-gql-structured 全逻辑） |
| `web/vitest.config.mts` / `tsconfig.test.json` | 测试环境（node + `@` alias；独立 tsc 引用，纳入 typecheck） |
