# Debug 页面（`/$debug`）技术架构与开发文档

> **独立技术文档**：完整记录 `/$debug`（GitHub API 调试客户端）的技术架构、数据方案、加载与缓存策略、开发约定。**自包含**——不依赖其他文档，读者单凭本文件即可理解全貌并继续开发。

## 1. 背景与定位

`/$debug` 是 PureGit 前端的 **API 调试工具页**（纯前端路由，Worker 不参与）：一个「带查看、补全、测试」的完整 GitHub API 调试客户端，对标 Postman/Apifox 交互模型。

**立项背景（决定性事实）**：GitHub 官方 GraphQL Explorer（explorer.github.com）已于 **2025-11-07 退役**，官方公告的移除原因为技术债 + 高昂维护成本（安全/无障碍）+ 无法保持合规的第三方库依赖；官方明确建议用户使用本地工具（GraphiQL / Insomnia / Altair / gh CLI）。官方主动放弃在线 playground——`/$debug` 正是填补这一空缺的产物。

**能力目标**（查看 / 补全 / 测试三合一）：

| 能力 | 说明 |
|---|---|
| **查看** | REST 端点集合树（按 tag 分组，点按即用）+ GraphQL Schema 树（query/mutation 顶层字段 → 展开返回类型子字段 + union possibleTypes）+ **端点文档**（未发送时响应面板空状态直接展示：参数表 / 请求体结构 / 响应结构，200 默认展开） |
| **补全** | REST：URL 路径参数 + **requestBody 字段级 JSON 补全**；GraphQL：cm6-graphql 字段/参数/枚举补全 + 悬停文档 + 语法诊断（依赖完整 schema） |
| **测试** | 统一请求面板（GraphQL / REST 共用 DebugRequest 模型），**Params tab（path/query 双向联动）**、请求头 K/V 表格、Body 快速切换（json/form/text）、响应状态/头/体展示、History/Collection 持久化 |

## 2. 总体架构

```
┌─ 数据源（构建期，零下载）────────────────────────────┐
│  @octokit/openapi（REST OpenAPI deref）              │
│  @octokit/graphql-schema（GraphQL 原数据 schema.json）│
│  scripts/build-schemas-octokit.mjs 转录拆分           │
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

转录脚本：`scripts/build-schemas-octokit.mjs`（`pnpm build:schemas`）；双模式封装 `scripts/update-schemas.mjs`（默认 octokit 转录 / `--download` 官方源）。

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

- **位置**：左侧栏（History/API tab 区域）**底部**常驻一条迷你进度条
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
- 能力：字段补全（上下文感知）、参数补全、枚举值补全、**悬停文档**（description 全量）、语法/语义诊断
- `sanitizeDeprecatedConsistency`：修复 GitHub schema 自身 8 处 deprecated 一致性违规（接口字段未弃用而实现字段弃用），使 validateSchema 通过、查询诊断生效（此清洗与体积无关，保留）

## 11. 代码组织：`web/src/pages/debug/` 目录

DebugPage.tsx（当前 ~1600 行单文件）按目录拆分：

```
web/src/pages/debug/
  index.tsx           # lazy 入口（App.tsx lazy 指向这里）
  DebugPage.tsx       # 主布局 + 状态编排 + 骨架屏 + 底部缓存进度条
  schema-loader.ts    # 智能请求器（缓存/TTL/SWR/预热/进度事件）
  rest-meta.ts        # 共享展示元数据（方法徽标色/状态码配色/URL 规整/CT 映射）
  KeyValueTable.tsx   # K/V 表格（请求头/form）
  LeftPanel.tsx       # History / API 两个 tab（含底部进度条）
  RestTree.tsx        # REST 端点树（消费 index.json + tag 懒加载）
  GqlTree.tsx         # GraphQL Schema 树（受控：schema 由 DebugPage 统一持有）
  RequestEditor.tsx   # 请求行 + Tabs + Body 编辑器（含补全挂载）
  ResponsePanel.tsx   # 响应状态条 + Body/Headers + 空状态端点文档
  GraphQLLogo.tsx     # GraphQL 官方 Logo（唯一使用处）
```

依赖关系：`index.tsx → DebugPage → {schema-loader, LeftPanel, RequestEditor, ResponsePanel}`；`LeftPanel → {RestTree, GqlTree}`；`RequestEditor → KeyValueTable`；`ResponsePanel → schema-loader（loadResFull）`。schema-loader 独立于 UI（可单测）。

## 12. 构建与分片（codeSplitting）

- **schema 数据全部走 public/ fetch，天然不进 bundle**——体积大头（GraphQL schema 解析用 graphql-js、补全用 cm6-graphql、编辑器用 codemirror）是**运行时依赖**而非静态数据
- `vite.config.ts` 的 `build.rolldownOptions.output.codeSplitting`：将重依赖拆独立命名 chunk，按 DebugPage 懒加载触发时并行加载：
  - `graphql-vendor`：graphql-js（schema 解析）+ cm6-graphql（补全/悬停）——仅 debug 页使用
  - `codemirror-vendor`：CM6 全站编辑器工厂（CodeEditor）及 lezer 语言扩展
- `/$debug` 本身已是 `App.tsx` lazy 路由，独立 chunk（~46KB / gzip 13KB），不进首屏
- 验证：`pnpm --filter web build` 后 debug chunk 保持小、graphql-vendor/codemirror-vendor 独立；>500kB 警告仅剩全站 MarkdownView（@uiw/react-markdown-preview，非 debug 范畴）

## 13. 端点文档（响应面板空状态）

- **触发**：REST 集合树选中端点后、尚未发送时——响应面板空状态直接展示端点文档（替代独立 drawer，Postman 同思路；发送后自动被真实响应覆盖）
- **内容**：方法徽标 + 路径 + summary/desc → 参数表（name/in/required/type）→ **requestBody 结构**（JSON-schema 树，`oneOf/anyOf` 分支逐层展开）→ **响应状态码列表**
- **响应结构自动加载**：选中端点即自动 `loadResFull`（IndexedDB 缓存秒开），**默认展开第一个 2xx**（通常 200）——首要呈现正常返回结构；其他状态码点开再展开
- **联动**：点按集合树端点即填充请求 + 切换文档；GraphQL 侧字段悬停已覆盖文档能力（Schema 树 + 编辑器悬停足够）
- **数据**：参数/body 来自 req 产物（补全同源），响应结构经 schema-loader.loadResFull 懒加载

## 13.1 REST 请求参数（Params tab，path/query 双向联动）

- **位置**：REST 请求 Tabs 第一位「参数」；端点选择后自动填充——path 行带 `path[n]` 段位置徽章（split('/') 索引，误删占位可快速定位取值位置），query 行空值待填
- **正向（参数 → URL）**：`buildUrlFromParams`（lib/debug-params.ts）——path 参数按 `index` 段位置直接覆盖 URL 对应段（值空/占位/段缺失保留；不依赖 `{name}` 占位符，占位符被替换后仍可正确联动），enabled 且非空的 query 拼接 query string
- **反向（URL → 参数）**：`syncParamsFromUrl`——URL 的 query 同步同名行、新增 key 补新行；path 按 index 取 URL 段同步（占位保持、实际值回写参数表）
- **必填 path 删空自动补回占位符**：value 输入框删空（trim 后为空）→ 自动补回 `{name}`，URL 对应段同步回到占位状态（方便重填；query 选填行不受影响）
- **事件驱动防循环**：参数编辑 onChange 重建 URL、URL 输入框 onChange 反向同步，不经 useEffect 无回写循环
- **默认请求**：进入页面默认 REST + GET（`EMPTY_REQUEST`，URL 空、placeholder `/repos/{owner}/{repo}`）；GraphQL 模板显式声明 protocol/method
- **布局与请求头统一**：ParamsTable 照搬 KeyValueTable（请求头）骨架——列结构（checkbox / key / value / 操作）、操作列图标（必填 Lock 占位、选填 X 删除 `Button size="icon" variant="ghost" h-6 w-6`）、添加行同为表格内 colSpan 行（靠左与 checkbox 槽对齐）；差异仅在 key 输入框用 `InputGroup` + `InputGroupAddon align="inline-end"` 内嵌类型胶囊（`path[n]` / `query`）

## 14. 开发约定

- **数据产物由脚本生成，不手改**：改 schema 结构只动 `scripts/build-schemas-octokit.mjs`，产物重新生成
- **前端消费结构契约**：`debug-openapi.ts`（OpenApiDoc 类型）随产物结构调整同步更新；schema-loader 是唯一 fetch 入口，页面组件不直接 fetch public 文件
- **临时产物即用即删**：测试脚本用后删除，不留垃圾
- **质量门禁**：`pnpm lint`（oxlint 零警告）+ `pnpm format` / `format:check`（oxfmt 一致）+ `pnpm --filter web build` 通过

## 15. 关键文件索引

| 文件 | 作用 |
|---|---|
| `scripts/build-schemas-octokit.mjs` | 转录 + 三层拆分产物生成 |
| `scripts/update-schemas.mjs` | 双模式封装（octokit 转录 / 官方下载） |
| `web/src/pages/debug/schema-loader.ts` | 智能请求器（缓存/TTL/SWR/预热/进度） |
| `web/src/pages/debug/rest-meta.ts` | 共享展示元数据（方法色/状态码配色/URL 规整） |
| `web/src/pages/debug/` | 页面全部组件（见 §11） |
| `web/src/lib/debug-api.ts` | 请求执行引擎（GraphQL/REST 直连） |
| `web/src/lib/debug-openapi.ts` | REST 产物结构类型 + 集合树构建 |
| `web/src/lib/debug-graphql.ts` | GraphQL schema 加载 + 字段树 + 模板生成 |
| `web/src/lib/debug-store.ts` | Collection/History 持久化 |
| `web/src/lib/json-schema-completion.ts` | REST body JSON-schema 字段级补全（CM6 override 源） |
| `web/src/lib/debug-params.ts` | REST Params tab 双向联动（参数 ↔ URL） |
| `web/src/pages/debug/ParamsTable.tsx` | Params 表格（path[n] 徽章 + query 增删） |
| `web/src/lib/codemirror.ts` | CM6 编辑器工厂（graphql 语言 + json 补全挂载 + tooltip 挂 body） |
