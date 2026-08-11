# PureGit 文档中心

> **中心思想**：通过 GitHub 官方 API 全面复刻简版 GitHub 前端，聚焦核心开发者管理与使用功能，页面干净整洁、操作由繁化简。**（详见 [vision.md](./vision.md)，全项目最高纲领）**

本文件是**项目文档体系的总导航**：准确说明 `docs/` 与 `.github/` 下所有协作文件的真实用意、使用方式与适用场景。新开发者 / 新会话（含 AI 编码助手）请从本页开始。

## 一、文档总览（`docs/`）

> 文档集中存放于 `docs/`，随开发即时修订。分**公开**与**内部**两级：公开文档随仓库发布；内部文档已列入 `.gitignore`，**不随仓库公开**、仅本地维护。

### 1.1 公开文档（随仓库发布，贡献者/用户均可见）

| 文档 | 真实用意 | 何时读 / 用 | 使用方式 |
|------|---------|------------|---------|
| [vision.md](./vision.md) | **中心思想与产品定位（最高纲领）**：项目做什么、为什么存在、功能取舍判据 | 任何新功能/新页面**动手前**；方向性取舍时 | 功能是否入范围判据，先读 |
| [design.md](./design.md) | **UI/UX 设计规范（Design System）**：框架层级/单双三栏模板/组件定义/响应式/动画/验收清单 | 写任何 UI/布局/组件**之前** | 对照验收清单自查；`ui-layout` skill 是其速查版 |
| [architecture.md](./architecture.md) | 架构设计：前端 / Worker / CLI 镜像代理、数据流、职责边界、关键技术约束 | 涉及跨层改动、API 数据流、新增端点时 | 先读总体架构图与组件职责边界再动手 |
| [api-compat.md](./api-compat.md) | **API 兼容性对照表单与实施指导**：全量 API 实现方式一览（GraphQL/REST/selfcode fetch/worker 代理/smart 状态）+ 不可抗力清单 + 新增 API CheckList | **新增 API / 新页面接入前必读**；审计 API 实现方式时 | 先查 §2 对照表定通道；双端点走 §3 smart 模板；不可抗力查 §4 |
| [github-schema.graphql](./github-schema.graphql) | **GitHub GraphQL 官方 schema（快照，官方源）**：字段/枚举/输入对象权威定义；也是 **debug 面板本地 schema 数据源**（`scripts/build-graphql-schema.mjs` 离线生成 `web/public/github-graphql.min.json`） | 写 GraphQL 查询前**确认真实枚举值/字段名**；更新 schema 快照后跑 `pnpm --filter web build:gqlschema` | grep 对应枚举/类型；以官方为准，勿凭记忆猜枚举 |
| [debug-page.md](./debug-page.md) | **`/$debug` API 调试页技术架构与开发文档（独立自包含）**：octokit 双库零下载转录、req/res 三层产物、体积实测、智能请求器（缓存/SWR/预热）、骨架屏 + 底部缓存进度条、补全设计、目录拆分、codeSplitting | 开发 / 修改 `/$debug` 页面（页面组件、schema 数据、加载缓存策略、补全）时 | 先读总体架构与产物契约再动手；数据产物由 `scripts/build-schemas-octokit.mjs` 生成，前端消费结构见 §11/§15 |
| [cli-setup.md](./cli-setup.md) | **CLI 接入指南**：git 镜像端点 insteadOf 配置 | 用户配置 git / 排查 clone/pull/push 问题时 | 按步骤操作 |

### 1.2 内部文档（不随仓库公开，仅本地开发使用）

| 文档 | 真实用意 | 使用场景 |
|------|---------|---------|
| `tasks.md` | **需求基线**（In/Out of Scope 判据） | 新需求进来先对照 In/Out 判据 |
| `plan.md` | **依赖层级 + 实现顺序**（静态路线图） | 跨会话恢复进度 |

> 两者已列入 `.gitignore`，`git add` 不会纳入；仅本地保留用于开发跟踪。**开发过程不强制记录任务/决策**——临时任务与决策随开发开始和结束自然消亡，最终结果沉淀在代码注释（总结性语义描述，说明代码最终用意）与公开框架文档中；避免临时记录过度堆积导致文档膨胀、关联混乱。

## 二、`.github/` 协作设施（Agent / vibe coding）

> 项目在仓库内固化了一套「Agent 协作设施」，任何 AI 编码助手（Copilot / Cursor / Claude Code 等）可自动上手，无需人工讲解。

| 设施 | 真实用意 | 加载 / 调用方式 |
|------|---------|----------------|
| `.github/copilot-instructions.md` | **全局指令（顶层框架）**：架构红线、开发规范、文档体系与规则层级、构建命令 | 所有会话**自动加载**（vibe coding 的默认遵循路径） |
| `.github/prompts/puregit.prompt.md` | **会话启动总纲**：项目背景/开发原则/技能策略/工作流/会话检查清单 | Chat 输入 `/puregit` 调用；开发 agent 会话自动采用 |
| `.github/skills/shadcn-ui` | shadcn/ui 组件添加流程、目录约定、主题定制 | 任务关键词匹配时自动加载 |
| `.github/skills/replica-workflow` | **官方页面复刻工作流**（6 步：调研/评估/讨论/实施/升华/文档同步） | 复刻/改造官方页面的任务 |
| `.github/skills/ui-layout` | 全 UI/UX 规范**速查**（权威版指向 `design.md`） | 任何 UI/布局任务 |
| `.github/skills/cf-worker-auth` | Worker OAuth2 令牌管理（端点/KV 会话/密钥安全） | Worker 鉴权任务 |
| `.github/skills/cli-git-mirror` | git 镜像端点自动代理（智能 HTTP 协议/转发） | CLI 代理任务 |

## 三、新会话 / 二次开发启动路径（vibe coding 友好）

1. Copilot 自动加载 `copilot-instructions.md` → 获得红线、规范与文档地图
2. 读本文件（`docs/index.md`）→ 确认文档层级
3. 新功能/方向取舍 → 先读 `vision.md`；涉及 UI → `design.md` + `ui-layout` skill
4. **复刻/改造官方页面 → 加载 `replica-workflow` skill（6 步标准流程）**
5. 涉及 API 数据获取 → 先读 `api-compat.md`（对照表定通道 + 实施指导）
6. 动手后：**修正关键框架文档**（vision/design/architecture/api-compat 等公开文档），保持代码与文档同步

## 三·五、调研档案（`docs/research/`）导航

> **官方页面审计档案**：每页一份「事实依据库」（布局/组件/交互/DOM class/对照表）。入口 `00-分型总览.md`（布局分型总表）；编号 = **依赖层级**（L0 基础设施 → L1 公共组件 → L2 全局页 → L3 用户级 → L4 仓库核心 → L5 深度功能）。

- **需求基线** → `docs/tasks.md`（内部）
- **开发路线图** → `docs/plan.md`（内部）
- **公共组件专项**（代码展示/Diff/Markdown 编辑器/回复）→ `04-公共组件层.md`

## 当前状态（2026-08-10）

- **版本阶段**：**0.0.x 内部开发试错阶段**——可随时开展破坏性、不兼容的重构与尝试，不承诺兼容保留（package.json 版本 0.0.0）
- **开发进度**：L0~L5 全部实现（浏览/协作/账户/CLI 闭环）；进入**顶层整体优化**阶段（流量排查 / 请求复用集中 / 后端优化 / 文档一致性维护），计划见内部 `plan.md`
- **文档体系规整（2026-08-10）**：**决策记录机制整体移除**——`decisions.md` 已删除、`architecture.md` 不再保留 ADR 索引表；`tasks.md` 只留需求基线、`plan.md` 只留依赖层级；注释规范为**总结性语义描述**（说明代码最终用意），不引用决策编号
- **已部署**：Worker `puregit` + 自定义域名 `https://puregit.deepwn.io`（OAuth 回调与 CLI 镜像端点同域）
- **开发环境**：**`pnpm dev`（双进程，唯一模式）**——纯 vite 前端 5173 + 独立 `wrangler dev` worker 8787，vite proxy 只转发 `/$auth` 与 git 端点；启动自动 `wrangler types`；构建 `pnpm --filter web build`（详见 copilot-instructions.md「构建与测试」）；**提交前门禁**：`pnpm lint`（oxlint 零警告）+ `pnpm format` / `pnpm format:check`（oxfmt 格式一致）+ `pnpm test`（vitest 质量门，`/$debug` 相关改动必跑）
- **本地 OAuth 调试**：通用 `local-dev` App（loopback `127.0.0.1` 回调端口可任意），`.dev.vars` 填 `http://127.0.0.1:5173/$auth/callback` + local-dev 凭据

## 开发环境：Windows / PowerShell 5.1（编码与命令注意事项）

> **本机开发环境 = Windows + PowerShell 5.1**（非 bash / 非 PS7）。所有终端命令按 PS 语法书写。完整血泪教训见 `.github/copilot-instructions.md`「Windows / PowerShell 终端注意事项」；要点如下。

- **编码陷阱（最高优先）**：PS 5.1 的 `Get-Content`/`Set-Content`/`Add-Content` **默认 ANSI（GBK）而非 UTF-8**，读写含中文的 UTF-8 源文件会破坏编码（行尾截成 `�?`）→ 构建报 `stream did not contain valid UTF-8`。改代码/注释一律用编辑器工具；确需 PS 写文件用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`（无 BOM）。
- **`&&` 不支持**（PS 7+ 才有）→ 用 `;`；package.json scripts 里的 `&&` 由 npm/pnpm 解析不受影响。
- **`2>&1` 语义不同**：PS 中 native stderr 为 ErrorRecord 对象流，管道过滤行为怪异；`Invoke-WebRequest` 遇 401/302 默认抛异常（需 `-SkipHttpErrorCheck` 或 `-MaximumRedirection 0` + try/catch）。
- **`curl`/`wget` 是别名**（= `Invoke-WebRequest`）→ 用 `Invoke-WebRequest`/`Invoke-RestMethod` 或显式 `curl.exe`。
- **常用映射**：grep → `Select-String`；wc → `Measure-Object`；管道过滤 → `Select-Object -First N`；存在判断 → `Test-Path`。
