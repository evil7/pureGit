# PureGit 文档中心

> **中心思想**：通过 GitHub 官方 API **全量复刻 GitHub 前端**，功能完成度对齐官方（分批推进），界面干净整洁、操作由繁化简——「简约」仅限前端 UX，不作为功能范围判据。（详见 [vision.md](./vision.md)，全项目最高纲领）

本文件是**项目文档体系的总导航**：准确说明 `docs/` 与 `.github/` 下所有协作文件的真实用意、使用方式与适用场景。新开发者 / 新会话（含 AI 编码助手）请从本页开始。

## 一、文档总览（`docs/`）

> 文档集中存放于 `docs/`，随开发即时修订。分**公开**与**内部**两级：公开文档随仓库发布；内部文档已列入 `.gitignore`，**不随仓库公开**、仅本地维护。

### 1.1 公开文档（随仓库发布，贡献者/用户均可见）

| 文档 | 真实用意 | 何时读 / 用 | 使用方式 |
|------|---------|------------|---------|
| [vision.md](./vision.md) | **中心思想与产品定位（最高纲领）**：项目做什么、为什么存在、功能取舍判据 | 任何新功能/新页面**动手前**；方向性取舍时 | 功能是否入范围判据，先读 |
| [design.md](./design.md) | **UI/UX 设计规范（Design System）**：框架层级/单双三栏模板/组件定义/响应式/动画/验收清单 | 写任何 UI/布局/组件**之前** | 对照验收清单自查；`ui-layout` skill 是其速查版 |
| [architecture.md](./architecture.md) | 架构设计：前端 / Worker / CLI 镜像代理、数据流、职责边界、关键技术约束 | 涉及跨层改动、API 数据流、新增端点时 | 先读总体架构图与组件职责边界再动手 |
| [api-compat.md](./api-compat.md) | **API 兼容性对照表单与实施指导**：全量 API 实现方式一览（**GraphQL 唯一主通道 / REST 匿名直连与保留路由 / selfcode fetch / worker 代理 / smart 状态**）+ 不可抗力清单 + 新增 API CheckList | **新增 API / 新页面接入前必读**；审计 API 实现方式时 | 先查 §2 对照表定通道；双端点走 §3 smart 模板；不可抗力查 §4 |
| [debug-page.md](./debug-page.md) | **`/$debug` API 调试页技术架构与开发文档（独立自包含）**：octokit 双库零下载转录、req/res 三层产物、体积结论、智能请求器（缓存/SWR/预热）、骨架屏 + 底部缓存进度条、补全设计、目录拆分、codeSplitting | 开发 / 修改 `/$debug` 页面（页面组件、schema 数据、加载缓存策略、补全）时 | 先读总体架构与产物契约再动手；数据产物由 `scripts/update-schemas.mjs` 生成，前端消费结构见 §11/§15 |
| [debug-graphql-redesign.md](./debug-graphql-redesign.md) | **`/$debug` GraphQL 能力设计**：勾选树 / variables 校验 / 分页方案、核心设计、功能特性清单、模块变更计划 | 继续 GraphQL 调试能力开发时 | 先读 §2 核心设计，再接 §5 执行逻辑 |
| [debug-rest-redesign.md](./debug-rest-redesign.md) | **`/$debug` REST 能力强化设计（反哺对照文档）**：GraphQL 强化成果 ↔ REST 现状逐维对照差异分析、R 系列任务清单（R1 搜索 / R2 body 结构化 / R3 自动刷新 / R4 hover 对齐）、统一协调项——目标使双协议面板对齐、模块化共享、可扩展 | 继续 REST 调试能力开发 / 双协议统一协调时 | 先读 §2 对照差异表，再接 §4 任务清单 |
| [cli-setup.md](./cli-setup.md) | **CLI 接入指南**：git 镜像端点 insteadOf 配置 | 用户配置 git / 排查 clone/pull/push 问题时 | 按步骤操作 |

### 1.2 内部文档（不随仓库公开，仅本地开发使用）

| 文档 | 真实用意 | 使用场景 |
|------|---------|---------|
| `tasks.md` | **需求基线**（In/Out of Scope 判据） | 新需求进来先对照 In/Out 判据 |
| `plan.md` | **依赖层级 + 实现顺序**（静态路线图） | 跨会话恢复进度 |

> 两者已列入 `.gitignore`，`git add` 不会纳入；仅本地保留用于开发跟踪。**开发过程不强制记录任务/决策**——临时任务与决策随开发开始和结束自然消亡，最终结果沉淀在代码注释（总结性语义描述，说明代码最终用意）与公开框架文档中；避免临时记录过度堆积导致文档膨胀、关联混乱。

> **质控/审计类临时计划文档**（《质量控制计划》`tmp/qc-plan-*.md`、《项目资产评估和改进计划》`tmp/asset-audit-*.md`）为任务期临时实施指导，生成于 `tmp/`（即用即删，已被 `.gitignore` 排除，不随仓库公开）：由 `project-qc` / `asset-audit` skill 规范产出、在任务期间驱动整改，**随任务收敛归档**，不留长期文档负担。

### 1.3 开发工具基建（`scripts/` 内部工具 + `scripts/data/` 数据）

> 项目自研内部开发工具，用于 REST 端点精确搜索 + GraphQL schema 递进枚举 + 页面分类的随时查询。**新增 API / 新页面动手前先查索引**；双端点「graph→rest 熔断对等」关系由人主观判断，结论沉淀于 `api-compat.md`。

| 工具 | 真实用意 | 使用方式 |
|------|---------|---------|
| `scripts/rest-index.mjs` | **REST 端点索引生成器**：octokit 零下载转录 REST 1108 操作（`id/method/path/tags/summary/parameters`），**不再聚拢 GraphQL** | `node scripts/rest-index.mjs`（SDK 升级后重跑刷新） |
| `scripts/page-index.mjs` | **官方页面分类索引生成器**：解析 `web/src/App.tsx` 路由树 + 人工校正表 `scripts/data/page-curations.json`（keywords/module/framework/apiIds/status），交叉校验 apiIds | `node scripts/page-index.mjs`（路由或校正表变更后重跑） |
| `scripts/apiidx.mjs` | **查询 CLI**：rest（REST 端点搜索）/ rest-id（端点详情含参数）/ gql（roots 枚举根字段 / search 搜索根字段 / type 类型字段递进 / field 字段详情）/ page / pageapi（页面→API 闭环）/ stats / update | `node scripts/apiidx.mjs <子命令> <参数>` |
| `scripts/gql-schema.mjs` | **GraphQL schema 加载器**：实时直连官方 `api.github.com/graphql`（`GITHUB_TOKEN` 鉴权，introspection）+ 10min 缓存 + 失败降级本地 `@octokit/graphql-schema` | 由 `apiidx gql` 子命令自动调用 |
| `scripts/data/rest-index.json` | REST 端点索引产物（生成） | 由 rest-index.mjs 生成，git 跟踪 |
| `scripts/data/pages-index.json` | 页面分类索引产物（生成） | 由 page-index.mjs 生成，git 跟踪 |
| `scripts/data/page-curations.json` | 页面语义字段人工校正表 | git 跟踪，手工维护后重跑生成器 |

## 二、`.github/` 协作设施（Agent / vibe coding）

> 项目在仓库内固化了一套「Agent 协作设施」，任何 AI 编码助手（Copilot / Cursor / Claude Code 等）可自动上手，无需人工讲解。

| 设施 | 真实用意 | 加载 / 调用方式 |
|------|---------|----------------|
| `.github/copilot-instructions.md` | **全局指令（顶层框架）**：架构红线、开发规范、文档体系与规则层级、构建命令 | 所有会话**自动加载**（vibe coding 的默认遵循路径） |
| `.github/prompts/puregit.prompt.md` | **会话启动总纲**：项目背景/开发原则/技能策略/工作流/会话检查清单 | Chat 输入 `/puregit` 调用；开发 agent 会话自动采用 |
| `.github/skills/shadcn-ui` | shadcn/ui 组件添加流程、目录约定、主题定制 | 任务关键词匹配时自动加载 |
| `.github/skills/replica-workflow` | **官方页面复刻工作流**（6 步：调研/评估/讨论/实施/升华/文档同步） | 复刻/改造官方页面的任务 |
| `.github/skills/ui-layout` | 全 UI/UX 规范**速查**（权威版指向 `design.md`） | 任何 UI/布局任务 |
| `.github/skills/api-strategy` | **API 策略速查**（GraphQL 唯一主通道 + REST 熔断降级复用 rest 层；权威版指向 `architecture.md`「API 模式」与 `api-compat.md`） | 新增/修改 API 接入、smart 封装、GraphQL 模板、REST 降级逻辑 |
| `.github/skills/cf-worker-auth` | Worker OAuth2 令牌管理（端点/KV 会话/密钥安全） | Worker 鉴权任务 |
| `.github/skills/cli-git-mirror` | git 镜像端点自动代理（智能 HTTP 协议/转发） | CLI 代理任务 |
| `.github/skills/project-qc` | **项目质量控制方法论**（宏观 PDCA：第一性原理验收基线、按功能补全测试、覆盖度纠正、变更控制；产出单文件《质量控制计划》`qc-plan-*.md`） | 质量控制/测试补全/覆盖度/验收基线任务 |
| `.github/skills/asset-audit` | **项目资产清查治理方法论**（宏观 PDCA：过时产物/测试/文档/代码膨胀/安全五维审计、分级评估、产出单文件《项目资产评估和改进计划》`asset-audit-*.md`） | 资产清查/审计/清理/整改任务 |

## 三、新会话 / 二次开发启动路径（vibe coding 友好）

1. Copilot 自动加载 `copilot-instructions.md` → 获得红线、规范与文档地图
2. 读本文件（`docs/index.md`）→ 确认文档层级
3. 新功能/方向取舍 → 先读 `vision.md`；涉及 UI → `design.md` + `ui-layout` skill
4. **复刻/改造官方页面 → 加载 `replica-workflow` skill（6 步标准流程）**
5. 涉及 API 数据获取 → 先读 `api-compat.md`（对照表定通道 + 实施指导）＋加载 `api-strategy` skill（GraphQL 唯一主通道 + REST 熔断降级）
6. 动手后：**修正关键框架文档**（vision/design/architecture/api-compat 等公开文档），保持代码与文档同步

## 三·五、调研档案（`docs/research/`）导航

> **官方页面审计档案**：每页一份「事实依据库」（布局/组件/交互/DOM class/对照表）。入口 `00-分型总览.md`（布局分型总表）；编号 = **依赖层级**（L0 基础设施 → L1 公共组件 → L2 全局页 → L3 用户级 → L4 仓库核心 → L5 深度功能）。

- **需求基线** → `docs/tasks.md`（内部）
- **开发路线图** → `docs/plan.md`（内部）
- **公共组件专项**（代码展示/Diff/Markdown 编辑器/回复）→ `04-公共组件层.md`

## 当前状态

- **版本阶段**：**v0.0.1 全量复刻**；0.0.x 内部试错阶段仍有效，可随时开展破坏性、不兼容的重构与尝试（package.json 版本 0.0.1）。
- **开发进度**：L0~L4 核心闭环完成（浏览/协作/账户/CLI）；官方页面分批对齐路线图见内部 `plan.md`。
- **已部署**：Worker `puregit` + 自定义域名 `https://git.deepwn.io`（OAuth 回调与 CLI 镜像端点同域）。
- **已知待修复漏洞（持续跟踪）**：`undici` <7.24.0（WebSocket 3 个 CVE）经 `wrangler`/`vitest-pool-workers` → `miniflare` 引入——Cloudflare 工具链内部锁定版本，overrides 会破坏兼容，**等上游发版**；`nth-check` 已通过 `pnpm-workspace.yaml` overrides 修复（GHSA-rp65-9cf3-cjxr）。
- **开发环境**：**`pnpm dev`（双进程，唯一模式）**——纯 vite 前端 5173 + 独立 `wrangler dev` worker 8787，vite proxy 只转发 `/$auth` 与 git 端点；启动自动 `wrangler types`；构建 `pnpm --filter web build`（详见 copilot-instructions.md「构建与测试」）；**提交前门禁**：`pnpm lint`（oxlint 零警告）+ `pnpm format` / `pnpm format:check`（oxfmt 格式一致）+ `pnpm test`（vitest 质量门——**node 纯函数 + happy-dom 组件双层**：node 层覆盖 API 封装/smart 降级/工具纯函数，组件层（`@testing-library/react`，文件级 `// @vitest-environment happy-dom`）覆盖 Pager/FileTree/CommentsSection 等核心组件与 UI 一致性，`/$debug` 相关改动必跑）；**依赖更新**：`pnpm update:all`（递归更新根/web/worker 全部依赖至现有 semver 范围内最新 + 高危漏洞审计；audit 显式走官方 registry `https://registry.npmjs.org`——npmmirror 镜像不提供审计端点，故不可省略 `--registry`）；**high 漏洞处置**：先调研（`pnpm why` 定位引入链、判断生产/工具链影响）→ 查 advisory 安全版本 → 可选 a. `pnpm-workspace.yaml` overrides 强制修复（补丁级兼容）或 b. 代码层缓解（上游未发版时），流程详见 copilot-instructions.md「依赖安全与更新风控」
- **本地 OAuth 调试**：通用 `local-dev` App（loopback `127.0.0.1` 回调端口可任意），`.dev.vars` 填 `http://127.0.0.1:5173/$auth/callback` + local-dev 凭据

## 开发环境：Windows / PowerShell 5.1（编码与命令注意事项）

> **本机开发环境 = Windows + PowerShell 5.1**（非 bash / 非 PS7）。所有终端命令按 PS 语法书写。完整血泪教训见 `.github/copilot-instructions.md`「Windows / PowerShell 终端注意事项」；要点如下。

- **编码陷阱（最高优先）**：PS 5.1 的 `Get-Content`/`Set-Content`/`Add-Content` **默认 ANSI（GBK）而非 UTF-8**，读写含中文的 UTF-8 源文件会破坏编码（行尾截成 `�?`）→ 构建报 `stream did not contain valid UTF-8`。改代码/注释一律用编辑器工具；确需 PS 写文件用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`（无 BOM）。
- **`&&` 不支持**（PS 7+ 才有）→ 用 `;`；package.json scripts 里的 `&&` 由 npm/pnpm 解析不受影响。
- **`2>&1` 语义不同**：PS 中 native stderr 为 ErrorRecord 对象流，管道过滤行为怪异；`Invoke-WebRequest` 遇 401/302 默认抛异常（需 `-SkipHttpErrorCheck` 或 `-MaximumRedirection 0` + try/catch）。
- **`curl`/`wget` 是别名**（= `Invoke-WebRequest`）→ 用 `Invoke-WebRequest`/`Invoke-RestMethod` 或显式 `curl.exe`。
- **常用映射**：grep → `Select-String`；wc → `Measure-Object`；管道过滤 → `Select-Object -First N`；存在判断 → `Test-Path`。
