# PureGit 项目指南（Copilot Instructions）

本文件为工作区级通用指令，自动应用于所有聊天请求。项目详细文档见 `docs/`，本文件只保留对所有任务都相关且关键的内容。

## 项目概览

> **中心思想**：通过 GitHub 官方 API **全面复刻简版 GitHub 前端**，聚焦核心开发者所需的主要管理与使用功能，页面干净整洁、操作由繁化简（详见 `docs/vision.md`，全项目最高纲领）。

- **前端**：React + Vite + TypeScript + pnpm + Tailwind CSS + shadcn/ui（组件优先复用，不自造 UI 轮子）
- **后端**：Cloudflare Pages Worker —— GitHub OAuth2 鉴权 + 系统代理（wiki/raw）+ git 端点代理（clone/pull/push）
- **数据源**：GitHub GraphQL API（浏览、搜索、issue/PR，含 star/fork/创建 issue/PR 等基础写操作）
- **CLI 集成**：镜像端点代理 —— 用户通过 `git config --global url.<worker镜像端点>/.insteadOf https://github.com/` 接入
- **开发阶段**：**0.0.x 内部试错阶段**——可随时开展破坏性、不兼容的重构与尝试，不承诺兼容保留

## 文档体系与规则来源（顶层框架 · vibe coding 友好）

> 所有项目文档的真实用意、使用方式与适用场景见 **`docs/index.md`（文档体系总导航）**。本节约定**规则来源层级**与 **docs 公开/内部两级划分**，任何会话（含二次开发）默认遵循以下路径。

**规则层级（优先级从高到低，冲突时高层优先）**：

1. **本文件（`copilot-instructions.md`）** —— 全局红线与规范，所有会话自动加载
2. **`prompts/puregit.prompt.md`** —— 会话启动总纲（工作流/检查清单），开发 agent 会话自动采用
3. **`skills/*`** —— 领域知识速查，任务关键词自动匹配后加载
4. **`docs/*`** —— 权威完整文档：`vision.md`（最高纲领）→ `design.md`（UI/UX 规范）→ `architecture.md`（架构设计）→ `api-compat.md`（API 对照表单）→ `cli-setup.md`（CLI 接入）

**docs/ 两级划分**：

- **公开（随仓库发布）**：`vision.md`（中心思想/功能判据）、`design.md`（Design System）、`architecture.md`（架构设计）、`api-compat.md`（API 对照表单）、`cli-setup.md`（CLI 接入指南）
- **内部（`.gitignore` 排除，不随仓库公开、仅本地）**：`tasks.md`（需求基线）、`plan.md`（依赖层级）

> **决策记录机制已整体移除**（2026-08-10）：不保留 ADR/决策表。临时任务与决策随开发开始和结束自然消亡，最终结果沉淀在代码注释（总结性语义描述，说明代码最终用意）与公开框架文档中。开发过程中只需**不断修正关键框架文档**（vision/design/architecture/api-compat 等），避免临时记录过度堆积导致文档膨胀、关联混乱。

**新会话自动遵循路径（vibe coding）**：读本文件 → 读 `docs/index.md` 导航 → 新功能先对照 `vision.md` → **复刻/改造官方页面先走「复刻工作策略」6 步流程（见下文 + skill `replica-workflow`）** → 写 UI 先查 `design.md` 与 `ui-layout` skill → 涉及 API 先查 `api-compat.md` → 改动后同步修正关键框架文档。

## 架构红线

0. **中心思想对齐**：一切功能须符合「全面复刻简版 GitHub」定位（`docs/vision.md`）——只做核心开发者高频必需，去杂项；新增功能先对照中心思想，非核心功能明确不入范围。当前处于 **0.0.x 内部试错阶段**，可开展破坏性、不兼容修改和尝试。
1. **密钥安全**：GitHub OAuth `client_secret` 只允许存在于 Worker 端（环境变量 / Secret）。前端**严禁**硬编码任何密钥；前端持有的 access token 仅存**内存变量**（刷新经 Worker `/$auth/session` 恢复），**不得写入 localStorage 明文**。
2. **职责边界**：Worker 只做四件事——① OAuth2 令牌管理（换取/KV 会话/恢复/登出/**PAT 直接登录**）；② CLI git 镜像端点自动代理（clone/pull/push）；③ **Wiki 内容代理**（`/$wiki/*` → raw.githubusercontent.com/wiki——API 无 wiki 通道，服务端 fetch 解决前端 raw 被墙）；④ **Raw 内容代理**（`/$raw/*` → raw.githubusercontent.com，README 图片降级通道）。另含 `/$healthz` 健康检查探活（非业务，通用在线探活，供外部监控程序探活）。**API 调试工具 `/$debug` 为纯前端路由**（`web/src/App.tsx` lazy 页，前端 SPA 调试面板，GraphQL/REST 统一执行，身份切换 匿名/账号/临时 PAT；worker 完全不参与，token 复用主站会话、权限继承主站 session，无额外安全面）。业务逻辑与 API 请求全在前端。**系统路由优先级**：系统前缀保留段（`/$auth`、`/$wiki`、`/$raw`、`/$healthz`、git 端点）优先于用户级通配 `/:owner/:repo`——`$` 前缀（GitHub 用户名/仓库名不含 `$`）永不被用户路由占用；判断顺序：`/$healthz`（无条件探活）→ auth（switch）→ 系统代理（`/$wiki`/`/$raw` 含匿名闸 `PROXY_ALLOW_ANON`，`false` 时强制登录）→ git → SPA fallback（`/$debug` 由前端路由接管）。
3. **访问路径（已定稿）**：注册 GitHub OAuth2 App 申请令牌；前端**全部功能**由该令牌完成，请求**直连 GitHub API**（Bearer token）；Worker 仅承担 OAuth2 登录与 CLI 自动代理。**会话元数据补全**：OAuth 回调网络受限时 `/user` 降级（login/userId 空）→ 前端拿到 token 后补全并 `POST /$auth/session` 写回 KV（worker 用 token 验证身份防伪造，403 identity_mismatch）。**旁路**：github.com 主站受限导致 OAuth 授权页不可达时，登录框可粘贴 PAT 经 `/$auth/pat` 直接登录（PAT 只存 Worker KV + httpOnly cookie，前端不落 localStorage 明文，与 OAuth 同等安全模型）。
4. **API 策略**：**Octokit SDK 统一封装**——REST 走 `@octokit/rest`、GraphQL 走 `@octokit/graphql`，入口 `web/src/lib/octokit.ts`（模式状态/额度跟踪/熔断）；**API 主模式由用户在偏好设置切换**（GraphQL 优先 / REST 优先，localStorage `puregit_api_mode`，默认 GraphQL），偏好页与 footer 显示 REST core 与 GraphQL 双额度（官方 `/rate_limit` 分开计数：认证 REST 5000/时、GraphQL 5000 点/时）；统一经 `web/src/lib/api.ts` 智能封装层，页面组件不感知具体协议；主模式不可用/超时/报错/额度耗尽时自动冗余切换另一模式，**不改变设置项**。
5. **UI/UX 规范（design.md 定稿）**：全部 UI 必须遵守 `docs/design.md`（Design System：框架层级/单双三栏模板/组件定义/响应式/动画/验收清单）。**布局**：多列/分块页面**必须**使用 `PageLayout` 统一布局组件（`web/src/components/PageLayout.tsx`）与共享布局常量 `web/src/lib/layout.ts`（`PAGE_SHELL` / `SIDEBAR_STICKY` / `SIDEBAR_STICKY_SCROLL` / `CONTENT_FILL`），**禁止手写散落类名**；外层容器**禁止 `py-*` 底部 padding**；单层 sticky 侧栏的 grid **必须 `items-start`**（PageLayout 已内置，否则 sticky 失效）；sticky 锚点统一 `top-20`（与 topbar 留 23px 间隔，卡片不贴顶）；导航型侧栏用 `SIDEBAR_STICKY`（纯 sticky，超高裁切），工具型（文件树）用 `SIDEBAR_STICKY_SCROLL`。**组件**：一律复用 shadcn/ui 与业务组件，禁止硬编码颜色，danger 操作必用 AlertDialog。详细规范见 skill `ui-layout`。
6. **外部资产操作问询（红线）**：凡涉及**用户真实外部文件、外部站点的资产、账号、数据、密钥**的操作/访问/使用——如真实 GitHub 账号的写操作（删除/改名/推送真实仓库、修改真实个人资料与设置、使用真实 token/凭据）、外部站点的资源抓取或修改、用户本地真实文件的读写——在测试开发中**必须先问询请示用户**，经批准后才按用户指导、限定的方式处理；不得擅自对真实外部资产执行任何写操作或高危访问。

## 开发规范（必须遵守）

1. **计划优先**：动手前先输出研讨/开发计划，与用户确认后再执行。
2. **最小改动**：只做满足需求的最小改动；优先复用现有模块与成熟成品（shadcn/ui、npm 成熟包）。
3. **文档同步**：代码变更后**同步修正关键框架文档**（`docs/vision.md` / `design.md` / `architecture.md` / `api-compat.md` / `cli-setup.md` / `index.md`）；不强制记录临时任务/决策（见「文档体系」章节）。
4. **临时脚本统一放 `tmp/`（即用即删，长期使用迁移 `scripts/`）**：任务执行中确需临时测试/调试的脚本，统一书写在根目录 `tmp/`（已被 `.gitignore` 排除，不随仓库发布）下，文件名规范清晰（`tmp/<任务名>-<用途>.mjs` 等），**使用后立即清除**，不留垃圾；若确认后续任务仍需长期使用，则**规范文件名并迁移至 `scripts/` 目录**（scripts 下脚本须符合项目统一规范：MJS 格式、oxfmt 格式化、总结性语义注释），迁移后清除 tmp 原文件。**禁止**在 `web/src`、`worker/src`、`docs/` 等正式目录散落临时测试代码。
5. **0.0.x 内部试错（不保兼容）**：当前处于内部开发试错阶段，不要求兼容保留原有逻辑与代码，可大胆重构与尝试；破坏性改动前说明理由与影响面。
6. **多问询核对**：遇到歧义、方向取舍、技术选择，先提问确认，不擅自假设。
7. **布局一致（红线 5 落地）**：新增/修改任何 UI，先对照 `docs/design.md` 与 `web/src/lib/layout.ts` 共享常量及 `ui-layout` skill 验收清单；禁止引入新的散落 sticky 类名、`items-start`、`py-*` 底部 padding。
8. **REST 一律类型化方法**：新增/修改任何 REST 调用，固定端点必须经 `typedRequest` + `octokit.rest.*` 类型化方法（URL 模板/参数编码由 SDK 保证，禁止手拼 URL 的 `githubFetch`/`fetchWithTimeout`）；仅特殊语义端点（raw Accept / base64 解码 / Link 头分页 / Octokit 无类型化方法）可保留底层通道并注释理由。跨仓库 compare 的 basehead 用 `owner:repo:branch` 全冒号格式（`compareCommitsWithBasehead` 整串传参）。
9. **注释规范（总结性语义）**：代码注释写**总结性语义描述**——说明该模块/组件/函数**最终用意**（解决什么问题、关键设计、为什么这样写），对照规范化的框架文件与设计文档；**禁止**在注释中引用决策编号（ADR-xxx）、历史任务编号（T/M 编号）与过程性日期记录；临时任务与决策不留痕，随开发结束自然消亡。
10. **提交前质量门禁（每次编写与提交新 commit 前必须通过）**：
    - **oxlint 零警告（严格规则集）**：`pnpm lint`（根 oxlint 全量 web/worker/scripts，`--max-warnings 0` 严格门禁）——必须**解决全部故障与警告**（error 与 warning 均清零）；**非必要不使用 `eslint-disable`/`oxlint-disable` 注释简单消除**，确属误报才允许豁免并注释理由。规则集为防 bug 严格档：`correctness`+`suspicious` 类目全 error，另加 `eqeqeq`（null: ignore）/`no-param-reassign`/`prefer-const`/`no-constant-binary-expression`/`no-implied-eval`/`no-new-func`/`no-return-assign`/`no-self-compare`/`no-sequences`/`no-var` 精选规则；React 新 JSX Transform 下 `react/react-in-jsx-scope` 已关。
    - **oxfmt 格式一致**：`pnpm format`（根：web/worker/scripts 全量格式化）后 `pnpm format:check` 必须通过——格式规范化、一致性（提交前可先 `pnpm format` 自动规范；PR 评审同样按此格式要求检查 diff）。
    - **测试质量门（web）**：`pnpm test`（vitest）必须全绿——含 `/$debug` 参数解析/填充/匹配/排序的全量真实产物验证（1108 端点 × 6 断言，见 `docs/debug-page.md` §14）；凡改动 debug 相关逻辑必跑。

## 复刻工作策略（GitHub 官方页面复刻标准流程）

> 任何「**复刻 / 改造某个 GitHub 官方页面**」的任务必须遵循以下 6 步流程（本项目核心玩法 = 官方复刻，见 `docs/vision.md`）。详细方法论见 skill `replica-workflow`（复刻任务自动匹配加载）。

1. **官方调研**：访问对应 GitHub 官方页面（`https://github.com/...`），用浏览器 devtools 分析 layout / 功能 / 行为 / 所用可参考组件（DOM class 结构、交互细节、空/加载/错误态），记录调研笔记。**注意**：调研仅限只读观察；涉及真实账号数据的写操作先问询用户（红线 6）。
2. **对照评估**：对照本项目现有页面（已实现者）逐项评估**改造难度 / 影响 / 收益 / 大致计划流程**，输出对照结论后再进入下一步。
3. **讨论确认**：与用户积极讨论难点、疑点、待定项，确认**核心差异处理方案**后再动手。
   - **3.1 破坏性重构**：对难以直接修改到位的文件，可**完全重构**（0.0.x 阶段不保兼容，开发规范 5）；重构前先说明理由与影响面。
4. **实施复刻**：按方案改造实施；完成后按「**精简界面、纯化功能**」思路提出优化建议（去杂项、操作由繁化简，对齐中心思想）。
5. **决策升华**：待用户确认最终决策方案后，对已复刻页面进行**改造升华**（打磨细节、补全边界态）。
6. **文档同步**：关键项修订到对应公开框架文档（`architecture.md` / `design.md` / `api-compat.md` / `vision.md`）；必要时**重启 dev 进程**；**新增组件需发起 rebuild**（`pnpm build`）。
   - **6.1 重大改动审计**：审计所有文档**统一对齐描述与不一致项**；若对数据格式等底层进行调整，还应触发 **clean 重置缓存**（`node scripts/clean.mjs`）。

## 构建与测试

> pnpm workspace：根目录统一管理 `web/`（前端）与 `worker/`（Cloudflare Worker），统一 git 仓库（根目录），子目录不单独 git init。

- 安装依赖：`pnpm install`（根目录，构建脚本已 approve：esbuild/sharp/workerd）
- **代码质量门禁（oxlint + oxfmt + vitest）**：`pnpm lint`（根 oxlint 全量 web/worker/scripts，`--max-warnings 0` 严格零警告；规则集见「开发规范 10」）/ `pnpm format`（oxfmt 全量格式化：web/src、worker/src、worker/test、scripts、web/test）/ `pnpm format:check`（格式检查）/ `pnpm test`（web vitest 质量门）——**每次提交前必须通过**（见「开发规范 10」）；oxfmt 配置根 `.oxfmtrc.json`（2 空格/双引号/分号/LF/printWidth 100，ignore `web/src/components/ui/**`）；oxlint 配置根 `.oxlintrc.json`（monorepo 统一：correctness+suspicious 类目 + react 规则 + scripts/worker node env overrides，ignore 生成物与 ui 组件）
- **前端+Worker 开发（唯一模式）**：`pnpm dev`（双进程：纯 vite 前端 5173 + 独立 `wrangler dev` worker 8787；vite proxy 只转发 `/$auth`、`/$wiki`、`/$raw` 与 git 端点到 8787；启动自动 `wrangler types` 同步 worker 类型；脚本 `scripts/dev-fast.mjs`）
- 前端构建/类型检查：`pnpm --filter web build`（tsc -b + vite build，产物 dist/client）
- Worker 独立调试（不推荐）：`pnpm --filter worker dev`（wrangler dev 8787，仅验证用）
- Worker 部署：`pnpm --filter worker deploy`
- Worker 类型生成：`pnpm --filter worker cf-typegen`（改 bindings 后运行）
- Worker 测试：`pnpm --filter worker test`（vitest）
- 根目录全量构建：`pnpm build`（web 构建 + worker 构建）

## Windows / PowerShell 终端注意事项（必须遵守）

> **开发环境 = Windows + PowerShell 5.1**（非 bash / 非 PS7）。所有终端命令按 PS 语法书写；以下为已验证的血泪教训（曾因此损坏 2 个源文件）。

1. **编码陷阱（最高优先）**：PS 5.1 的 `Get-Content` / `Set-Content` / `Add-Content` **默认 ANSI（GBK）而非 UTF-8**。用它们读写含中文的 UTF-8 源文件会系统性破坏编码（中文行行尾截断成 `�?`）→ 构建报 `stream did not contain valid UTF-8`。**改代码/注释一律用编辑器工具**；确需 PS 写文件用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`（无 BOM）；校验编码用 `[System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false, $true))`。
2. **`&&` 不支持**（PS 7+ 才有）→ 用 `;` 串联。package.json scripts 里的 `&&` 由 npm/pnpm 解析，不受影响。
3. **`2>&1` 语义不同**：PS 中 native stderr 合并为 ErrorRecord 对象流（非文本），`2>&1 | Select-Object` 管道过滤行为怪异；`Invoke-WebRequest` 遇 401/302 默认抛异常（需 `-SkipHttpErrorCheck` 或 `-MaximumRedirection 0` + try/catch）。
4. **`curl`/`wget` 是别名**：PS 中 `curl` = `Invoke-WebRequest` 别名 → 用 `Invoke-WebRequest`/`Invoke-RestMethod` 或显式 `curl.exe`。
5. **常用映射**：grep → `Select-String`；wc → `Measure-Object`；管道过滤 → `Select-Object -First N`；输出超 20KB 自动存临时文件；判断存在 → `Test-Path`。
6. **长驻进程（dev server）**：用 async 模式启动等 idle 信号；查端口 `Get-NetTCPConnection -LocalPort 5173 -State Listen`；查进程 `Get-Process node`。

## 常用约定

- **文档体系与规则层级**见上方「文档体系与规则来源（顶层框架）」；**文档中心入口：`docs/index.md`**；**中心思想：`docs/vision.md`**；**UI/UX 规范：`docs/design.md`**；**架构设计：`docs/architecture.md`**；**API 对照表单：`docs/api-compat.md`**；内部文档（`docs/tasks.md` 需求基线 / `docs/plan.md` 依赖层级）不公开、仅本地使用
- 组件一律优先从 shadcn/ui 添加（`cd web && pnpm dlx shadcn@latest add <组件>`），禁止手写重复的基础组件
- 目录结构：`web/`（前端）、`worker/`（Cloudflare Worker）、`docs/`（文档）、`.github/`（指令/技能/prompt）
- **统一 git 仓库**：仅根目录一个 git 仓库；`web/`、`worker/` 内不得存在 `.git`；提交由根目录执行
