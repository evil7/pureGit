# Debug 页面（`/$debug`）技术架构与开发文档

> **独立技术文档**：完整记录 `/$debug`（GitHub API 调试客户端）的技术架构、数据方案、加载与缓存策略、开发约定。**自包含**——不依赖其他文档，读者单凭本文件即可理解全貌并继续开发。

## 1. 背景与定位

`/$debug` 是 PureGit 前端的 **API 调试工具页**（纯前端路由，Worker 不参与）：一个「带查看、补全、测试」的完整 GitHub API 调试客户端，对标 Postman/Apifox 交互模型。

**立项背景（决定性事实）**：GitHub 官方 GraphQL Explorer（explorer.github.com）已于 **2025-11-07 退役**，官方公告的移除原因为技术债 + 高昂维护成本（安全/无障碍）+ 无法保持合规的第三方库依赖；官方明确建议用户使用本地工具（GraphiQL / Insomnia / Altair / gh CLI）。官方主动放弃在线 playground——`/$debug` 正是填补这一空缺的产物。

**能力目标**（查看 / 补全 / 测试三合一）：

| 能力 | 说明 |
|---|---|
| **查看** | REST 端点集合树（按 tag 分组，点按即用）+ GraphQL Schema 树（query/mutation 顶层字段 → 展开返回类型子字段 + union possibleTypes）+ **端点文档**（右侧 Drawer：参数表 / 请求体结构 / 响应结构，200 默认展开） |
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
- 能力：字段补全（上下文感知）、参数补全、枚举值补全、**悬停文档**（description 全量）、语法/语义诊断（**行内标记 + hover tooltip；不挂 lintGutter**——调试面板 GraphQL 编辑框与 JSON/Raw 编辑框视觉一致：仅行号 + 折叠两列 gutter，诊断不占布局）
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
  RequestEditor.tsx   # 请求行 + Tabs + Body 编辑器（含补全挂载）+ URL 框 book icon 文档触发
  ResponsePanel.tsx   # 响应状态条 + Body/Headers（空状态等待占位；文档已迁 Drawer）
  EndpointDocDrawer.tsx # 右侧文档 Drawer（完整端点文档：参数表/请求体/响应结构）
  GraphQLLogo.tsx     # GraphQL 官方 Logo（唯一使用处）
```

依赖关系：`index.tsx → DebugPage → {schema-loader, LeftPanel, RequestEditor, ResponsePanel, EndpointDocDrawer}`；`LeftPanel → {RestTree, GqlTree}`；`RequestEditor → KeyValueTable`；`EndpointDocDrawer → schema-loader（loadResFull）`。schema-loader 独立于 UI（可单测）。

## 12. 构建与分片（codeSplitting）

- **schema 数据全部走 public/ fetch，天然不进 bundle**——体积大头（GraphQL schema 解析用 graphql-js、补全用 cm6-graphql、编辑器用 codemirror）是**运行时依赖**而非静态数据
- `vite.config.ts` 的 `build.rolldownOptions.output.codeSplitting`：将重依赖拆独立命名 chunk，按 DebugPage 懒加载触发时并行加载：
  - `graphql-vendor`：graphql-js（schema 解析）+ cm6-graphql（补全/悬停）——仅 debug 页使用
  - `codemirror-vendor`：CM6 全站编辑器工厂（CodeEditor）及 lezer 语言扩展
- `/$debug` 本身已是 `App.tsx` lazy 路由，独立 chunk（~46KB / gzip 13KB），不进首屏
- 验证：`pnpm --filter web build` 后 debug chunk 保持小、graphql-vendor/codemirror-vendor 独立；>500kB 警告仅剩全站 MarkdownView（@uiw/react-markdown-preview，非 debug 范畴）

## 13. 端点文档（右侧 Drawer，URL 框 book icon 触发）

- **展示位置（2026-08-11 迁移）**：文档以**独立右侧 Drawer** 展示当前所指向接口的完整文档，**不再放进返回面板**（返回面板空状态恢复「点击发送」占位；文档查阅与响应结果彻底分离，阅读空间充足）
- **触发方式**：URL 输入框右侧 `<InputGroupAddon align="inline-end">` 内 **book icon 按钮**——仅当**匹配到正确路径**（endpoint 非空）时显示；点击开/关 Drawer（打开态按钮高亮），未匹配路径自动隐藏并关闭
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
- **响应区默认折叠 + 发送自动展开（2026-08-11）**：未发送数据时响应区**默认折叠**（`respCollapsed` 初始 true，只留头部一行，请求区全高编辑）；发送返回数据后 **`run()` 内自动 `setRespCollapsed(false)` 展开**（结果到达即展示）
- **响应区默认 tab**：默认选中第一个 tab「返回头」（与请求区默认「请求头」对称，DebugPage respTab 初始 "headers"）
- **事件驱动防循环**：参数编辑 onChange 重建 URL、URL 输入框 onChange 反向同步，不经 useEffect 无回写循环；端点匹配只补 path 行/文档，不改 URL
- **默认请求**：进入页面默认 REST + GET（`EMPTY_REQUEST`，URL 直接 `/` 根路径、placeholder `/repos/{owner}/{repo}` 提示典型模板）；GraphQL 模板显式声明 protocol/method
- **GraphQL 编辑框空 + placeholder**：切到 GraphQL（query/mutation）时 query 编辑框**默认空内容**，仅 placeholder 显示示例 `query { viewer { login } }` 提示（`EMPTY_REQUEST.query` 为空、方法下拉切 GraphQL 时 `query: ""` 清空）；左栏 Schema 树/模板点按仍主动生成查询填入（用户行为保留）
- **URL 前缀一致性**：`https://api.github.com` addon 用 `font-mono text-sm leading-none`——与 path 输入框（Input 组件 `md:text-sm` 实际 14px）同字号、`items-center` 垂直居中（leading-none 防 line-height 撑高 InputGroup）
- **布局与请求头统一**：ParamsTable 照搬 KeyValueTable（请求头）骨架——列结构（checkbox / key / value / 操作）、操作列图标（必填 Lock 占位、选填 X 删除 `Button size="icon" variant="ghost" h-6 w-6`）、添加行同为表格内 colSpan 行（靠左与 checkbox 槽对齐）；差异仅在 key 输入框用 `InputGroup` + `InputGroupAddon align="inline-end"` 内嵌类型胶囊（`path[n]` / `query`）
- **复合占位段（单 path 段多参数）合并单行**：段模型 `DebugParam.segPos/segCount/segSeparators`（全可选向后兼容；单占位段恒 segCount=1）——① **识别**：`parsePathSeg`（lib/debug-params.ts 导出）统一解析段内占位符 + 字面分隔符（`{base}...{head}` → names=[base,head]、seps=["","...",""]；复杂段 `{aaa}...{bbb}---{ccc}` 自动适配），`endpointToRequest` / `extractPathParams` / `splitCompoundUrlSeg` 三处复用同一模型；② **列出**：ParamsTable 按 index 分组 path 行，`segCount>1` → **合并单行**——key 显示参数名+真实分隔符（`base...head`），value 每参数独立 Input + 中间真实分隔符文本（低对比非可编辑，title 提示「段内字面分隔符」）；③ **设定**：每 input 更新对应参数行（模型仍每参数一行），分次编辑天然正确，复杂段自动扩展 N input + N-1 分隔符；④ **扁平标签**：胶囊仍 `path[n]`（不引入 `·1/2` 层级后缀）；⑤ **排序**：path 按 index 升序 + 同 index 次级 segPos 升序（base 恒在 head 前）
- **历史 bug（复合段合并依赖段模型）**：`syncParamsFromUrl` 补齐 path 行曾只带 name/index（无段模型）→ 端点匹配后合并失效——补齐/同步分支都须带 segPos/segCount/segSeparators（schema-integration 断言覆盖）
- **编辑器高度自适应拉满**：请求区 Body/Query/Variables 编辑器与响应区返回体——**必须用 `h-full min-h-0` 确定高度链**（外层 scroll 容器高度确定 → 容器 `height:100%` → CodeEditor 外层 `flex-1` → cm-host `flex-1` → cm-editor `height:100%` 依次解析撑满）；**禁止 `min-h-full`**（只设 min-height 不设 height，flex 高度链 indeterminate → CM6 的 `height:100%` 无法解析 → cm-editor/cm-content 塌陷成内容高：空内容只显一行 + 下方大片空白，内容多时被 overflow 裁剪无法滚动——2026-08-11 浏览器实测逮住）。响应区返回体 pretty 态 CodeEditor `fill` 撑满、raw 态 `<pre>` 用 `min-h-full`（内容少时占满容器、内容多时自然撑高外层滚动）——两个展示框均与内容区等高，不留底部空白

## 14. 开发约定

- **数据产物由脚本生成，不手改**：改 schema 结构只动 `scripts/build-schemas-octokit.mjs`，产物重新生成
- **前端消费结构契约**：`debug-openapi.ts`（OpenApiDoc 类型）随产物结构调整同步更新；schema-loader 是唯一 fetch 入口，页面组件不直接 fetch public 文件
- **临时产物即用即删**：测试脚本用后删除，不留垃圾
- **质量门禁**：`pnpm lint`（oxlint 零警告）+ `pnpm format` / `format:check`（oxfmt 一致）+ `pnpm typecheck`（tsc -b，含测试）+ `pnpm --filter web build` 通过
- **测试质量门（新增）**：`pnpm test`（vitest，node 环境）——① `web/test/debug-params.spec.ts`（parseQuery/parsePathSeg/buildUrlFromParams/syncParamsFromUrl 单元）；② `web/test/debug-openapi.spec.ts`（buildGroupFromTag/endpointToRequest/matchEndpoint/endpointStillMatches 单元）；③ `web/test/schema-integration.spec.ts` **全量真实产物验证**——读 `web/public/debug/rest/` 全部 44 tag × req.json、遍历 **1108 个端点**逐一断言 7 项规则（path↔模板占位双向一致 / endpointToRequest 提取正确含段模型 + **required query 行** / matchEndpoint round-trip 命中自身 / 填值 round-trip / endpointStillMatches 固化 / buildUrlFromParams 正向不改 URL / syncParamsFromUrl 反向骨架稳定含段模型一致 + required query 集 + **required 与 type 一致性**），任何解析/填充/匹配/排序改动必须全绿（当前 7809 测试）

## 15. 关键文件索引

| 文件 | 作用 |
|---|---|
| `scripts/build-schemas-octokit.mjs` | 转录 + 三层拆分产物生成 |
| `scripts/update-schemas.mjs` | 双模式封装（octokit 转录 / 官方下载） |
| `web/src/pages/debug/schema-loader.ts` | 智能请求器（缓存/TTL/SWR/预热/进度）+ getAllEndpoints 全量索引 |
| `web/src/pages/debug/rest-meta.ts` | 共享展示元数据（方法色/状态码配色/URL 规整） |
| `web/src/pages/debug/` | 页面全部组件（见 §11） |
| `web/src/lib/debug-api.ts` | 请求执行引擎（GraphQL/REST 直连） |
| `web/src/lib/debug-openapi.ts` | REST 产物结构类型 + 集合树构建 + matchEndpoint/endpointStillMatches |
| `web/src/lib/debug-graphql.ts` | GraphQL schema 加载 + 字段树 + 模板生成 |
| `web/src/lib/debug-store.ts` | Collection/History 持久化 |
| `web/src/lib/json-schema-completion.ts` | REST body JSON-schema 字段级补全（CM6 override 源） |
| `web/src/lib/debug-params.ts` | REST Params 双向联动（全量实时解析 + explicit 语义） |
| `web/src/pages/debug/ParamsTable.tsx` | Params 表格（path[n] 徽章 + query 增删 + 文档 badge + **复合段合并单行**） |
| `web/src/lib/codemirror.ts` | CM6 编辑器工厂（graphql 语言 + json 补全挂载 + tooltip 挂 body） |
| `web/test/` | vitest 质量门测试（debug-params / debug-openapi 单元 + schema-integration 全量产物验证） |
| `web/vitest.config.mts` / `tsconfig.test.json` | 测试环境（node + `@` alias；独立 tsc 引用，纳入 typecheck） |
