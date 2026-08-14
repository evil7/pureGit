# PureGit 项目指南（Copilot Instructions）

本文件为工作区级全局指令，自动应用于所有聊天请求。项目框架文档见 `docs/`，本文件只保留对所有任务都相关且关键的内容。

## 项目概览

> **中心思想**：通过 GitHub 官方 API **全量复刻 GitHub 前端**，功能完成度对齐官方、页面干净整洁、操作由繁化简（详见 `docs/vision.md`，全项目最高纲领）。

- **前端**：React + Vite + TypeScript + pnpm + Tailwind CSS + shadcn/ui（组件优先复用，不自造 UI 轮子）
- **后端**：Cloudflare Pages Worker —— GitHub OAuth2 鉴权 + 系统代理（wiki/raw）+ git 端点代理（clone/pull/push）
- **数据源**：GitHub GraphQL API（浏览、搜索、issue/PR，含 star/fork/创建 issue/PR 等基础写操作）
- **CLI 集成**：git 镜像端点代理 —— `insteadOf` 一行配置接入
- **开发阶段**：**v0.0.1 全量复刻**（0.0.x 内部试错阶段仍有效）——可随时开展破坏性、不兼容的重构与尝试，不承诺兼容保留

## 文档体系与规则层级

> 所有项目文档的真实用意与使用方式见 **`docs/index.md`（文档体系总导航）**。规则层级（优先级从高到低，冲突时高层优先）：

1. **本文件（`copilot-instructions.md`）** —— 全局红线与规范，所有会话自动加载
2. **`.github/skills/*`** —— 领域知识速查，任务关键词自动匹配后加载
3. **`docs/*`** —— 权威框架文档：`vision.md`（最高纲领）→ `design.md`（UI/UX 规范）→ `architecture.md`（架构设计）→ `cli-setup.md`（CLI 接入）

**docs/ 两级划分**：

- **公开（随仓库发布）**：`vision.md`（中心思想/功能判据）、`design.md`（Design System）、`architecture.md`（架构设计）、`cli-setup.md`（CLI 接入指南）
- **内部（本地仅用，不随仓库公开）**：临时任务与决策随开发开始和结束自然消亡，最终结果沉淀在代码注释与公开框架文档中——不保留过程记录，避免文档膨胀

**新会话自动遵循路径（vibe coding）**：读本文件 → 读 `docs/index.md` 导航 → 新功能先对照 `vision.md` → 改造/复刻官方页面先走「改造工作流程」（见 skill `replica-workflow`）→ 写 UI 先查 `design.md` 与 `ui-layout` skill → 涉及 API 先查 `architecture.md` → 改动后同步修正关键框架文档。

## 架构红线

1. **密钥安全**：GitHub OAuth `client_secret` 只允许存在于 Worker 端（环境变量 / Secret）。前端**严禁**硬编码任何密钥；前端持有的 access token 仅存**内存变量**（刷新经 Worker `/$auth/session` 恢复），**不得写入 localStorage 明文**。
2. **职责边界**：Worker 只做四件事——① OAuth2 令牌管理（换取/KV 会话/恢复/登出/**PAT 直接登录**）；② CLI git 镜像端点自动代理（clone/pull/push）；③ Wiki 内容代理（`/$wiki/*`）；④ Raw 内容代理（`/$raw/*`）。另含 `/$healthz` 健康检查探活。业务逻辑与 API 请求全在前端。**`/$debug` 为纯前端路由**（前端 SPA 调试面板，worker 完全不参与）。
3. **API 策略（定稿：登录强制 GraphQL 唯一主通道 + 匿名强制 REST）**：**Octokit SDK 统一封装**——登录态**强制 GraphQL 唯一主通道**（不评估收益/复杂度；唯一例外 = GraphQL 无适配时保留 REST）；**匿名强制 REST**（GraphQL 匿名恒 403）；**GraphQL 失败 → `withRestFallback` 熔断降级 REST**。**禁止**新增「REST 优先」模式选项。
4. **UI/UX 规范（design.md 定稿）**：全部 UI 必须遵守 `docs/design.md`。**布局**：多列/分块页面**必须**使用 `PageLayout` 统一布局组件与共享布局常量 `web/src/lib/layout.ts`，**禁止手写散落类名**。**组件**：一律复用 shadcn/ui 与业务组件，禁止硬编码颜色，danger 操作必用 AlertDialog。**自定义阶段 shadcn 原生**：组件构造直接使用 shadcn 官方组件**默认样式**，**非必要不对原始 shadcn 样式手动调整**（禁止散落尺寸覆盖与硬编码色值）；确需定制走主题 CSS 变量。详细规范见 skill `ui-layout`。
5. **外部资产操作问询（红线）**：凡涉及**用户真实外部文件、外部站点的资产、账号、数据、密钥**的操作/访问/使用——如真实 GitHub 账号的写操作、外部站点资源抓取、用户本地真实文件读写——在测试开发中**必须先问询请示用户**，经批准后才按用户指导、限定的方式处理；不得擅自对真实外部资产执行任何写操作或高危访问。

## 开发规范（必须遵守）

1. **计划优先**：动手前先输出研讨/开发计划，与用户确认后再执行。
2. **最小改动**：只做满足需求的最小改动；优先复用现有模块与成熟成品（shadcn/ui、npm 成熟包）。
3. **文档同步**：代码变更后**同步修正关键框架文档**（`docs/vision.md` / `design.md` / `architecture.md` / `cli-setup.md` / `index.md`）。
4. **临时脚本统一放 `tmp/`（即用即删，长期使用迁移 `scripts/`）**：**禁止**在 `web/src`、`worker/src`、`docs/` 等正式目录散落临时测试代码。
5. **0.0.x 内部试错（不保兼容）**：当前处于内部开发试错阶段，不要求兼容保留原有逻辑与代码，可大胆重构与尝试；破坏性改动前说明理由与影响面。
6. **多问询核对**：遇到歧义、方向取舍、技术选择，先提问确认，不擅自假设。
7. **布局一致（红线 4 落地）**：新增/修改任何 UI，先对照 `docs/design.md` 与 `web/src/lib/layout.ts` 共享常量及 `ui-layout` skill 验收清单。
8. **注释规范（总结性语义）**：代码注释写**总结性语义描述**——说明该模块/组件/函数**最终用意**（解决什么问题、关键设计、为什么这样写）；**禁止**在注释中引用决策编号、历史任务编号与过程性日期记录。
9. **提交前质量门禁（每次编写与提交新 commit 前必须通过）**：
   - **oxlint 零警告**：`pnpm lint`（根 oxlint 全量，`--max-warnings 0` 严格门禁）
   - **oxfmt 格式一致**：`pnpm format` 后 `pnpm format:check` 必须通过
   - **测试质量门（web）**：`pnpm test`（vitest）必须全绿

## 改造工作流程（GitHub 官方页面改造标准流程）

> 任何「**改造 / 复刻某个 GitHub 官方页面**」的任务必须遵循以下流程（本项目核心玩法 = 功能对齐官方、UI 自定义，见 `docs/vision.md`）。详细方法论见 skill `replica-workflow`。

1. **对照评估**：对照本项目现有页面逐项评估**改造难度 / 影响 / 收益 / 大致计划流程**，输出对照结论后再进入下一步。
2. **讨论确认**：与用户积极讨论难点、疑点、待定项，确认**核心差异处理方案**后再动手（破坏性重构先说明理由与影响面）。
3. **实施改造**：按方案改造实施；完成后按「**精简界面、纯化功能**」思路提出优化建议。
4. **决策升华**：待用户确认最终决策方案后，对已改造页面进行**改造升华**（打磨细节、补全边界态）。
5. **文档同步**：关键项修订到对应公开框架文档；必要时**重启 dev 进程**；**新增组件需发起 rebuild**（`pnpm build`）。

## 构建与测试

> pnpm workspace：根目录统一管理 `web/`（前端）与 `worker/`（Cloudflare Worker），统一 git 仓库（根目录）。

- 安装依赖：`pnpm install`
- **代码质量门禁**：`pnpm lint`（oxlint 零警告）/ `pnpm format`（oxfmt 全量格式化）/ `pnpm format:check`（格式检查）/ `pnpm test`（web vitest）
- **前端 + Worker 开发（唯一模式）**：`pnpm dev`（双进程：vite 前端 5173 + `wrangler dev` worker 8787）
- 前端构建/类型检查：`pnpm --filter web build`
- Worker 部署：`pnpm --filter worker deploy`；Worker 测试：`pnpm --filter worker test`
- 根目录全量构建：`pnpm build`

## Windows / PowerShell 终端注意事项（必须遵守）

> **开发环境 = Windows + PowerShell 5.1**（非 bash / 非 PS7）。所有终端命令按 PS 语法书写。

1. **编码陷阱（最高优先）**：PS 5.1 的 `Get-Content` / `Set-Content` / `Add-Content` **默认 ANSI（GBK）而非 UTF-8**，读写含中文的 UTF-8 源文件会系统性破坏编码。**改代码/注释一律用编辑器工具**；确需 PS 写文件用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`（无 BOM）。
2. **`&&` 不支持**（PS 7+ 才有）→ 用 `;` 串联。package.json scripts 里的 `&&` 由 npm/pnpm 解析，不受影响。
3. **`curl`/`wget` 是别名**（= `Invoke-WebRequest`）→ 用 `Invoke-WebRequest`/`Invoke-RestMethod` 或显式 `curl.exe`。
4. **长驻进程（dev server）**：用 async 模式启动；查端口 `Get-NetTCPConnection -LocalPort 5173 -State Listen`。

## 常用约定

- **文档中心入口：`docs/index.md`**；**中心思想：`docs/vision.md`**；**UI/UX 规范：`docs/design.md`**；**架构设计：`docs/architecture.md`**
- 组件一律优先从 shadcn/ui 添加（`cd web && pnpm dlx shadcn@latest add <组件>`），禁止手写重复的基础组件
- 目录结构：`web/`（前端）、`worker/`（Cloudflare Worker）、`docs/`（文档）、`.github/`（指令/技能）
- **统一 git 仓库**：仅根目录一个 git 仓库；`web/`、`worker/` 内不得存在 `.git`；提交由根目录执行
