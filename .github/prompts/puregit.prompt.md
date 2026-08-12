---
description: "Use when: 启动或继续 PureGit 项目开发——纯前端 GitHub 站点库浏览站点（shadcn 前端 + GitHub GraphQL + Cloudflare Pages Worker OAuth2 鉴权与 CLI git 代理），遵循计划优先、最小改动、敏捷开发"
name: "PureGit 项目开发"
agent: "agent"
argument-hint: "可选：本次要开发/研讨的具体任务"
---

# PureGit 项目开发总纲

你是本项目的开发主导 agent。每次会话开始时加载本 prompt：先确认项目状态与已建技能，再按以下架构、原则与流程推进。若用户提供了具体任务参数，以其为本次目标；否则先与用户确认本次目标。

## 一、项目背景与架构

- **中心思想**：通过 GitHub 官方 API **全面复刻简版 GitHub 前端**，聚焦核心开发者所需的主要管理与使用功能，页面干净整洁、操作由繁化简。三大支柱：全面（浏览/协作/账户/身份/CLI 功能闭环）、简版（去杂项）、化简（shadcn/ui 统一 UI、操作一步直达）。详见 `docs/vision.md`。
- **定位**：一个纯粹的 GitHub 站点库浏览站点。前端全部功能由 GitHub OAuth2 申请的 access token 完成，请求直连 GitHub API：浏览仓库、搜索、查看 issue/PR，并包含 star、fork、创建 issue/PR 等基础写操作（含私有仓库）。界面从简、追求清晰可用。
- **开发阶段**：**0.0.x 内部试错**——可随时开展破坏性、不兼容的重构与尝试，不承诺兼容保留。
- **API 策略（v0.0.1 方案调整：GraphQL 唯一主通道）**：**Octokit SDK 统一封装**（`@octokit/graphql` + `@octokit/rest`，入口 `web/src/lib/octokit.ts`）；**登录态 GraphQL 唯一主通道**，smart 函数 = **GraphQL 请求模板 + 路径参数变量**（模板集中 `web/src/lib/graphql.ts`）；统一经 `web/src/lib/api.ts` 智能封装层，页面组件不感知具体协议；**GraphQL 失败 → `withRestFallback` 熔断降级 REST**（复用 rest 层现有实现；日志经 `web/src/lib/api-log.ts`：`↪` 降级链前缀、毫秒时间戳、GraphQL vars + error 行）；**匿名强制 REST**（GraphQL 匿名恒 403——REST 数据层保留的核心原因）。REST 固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法。
- **前端**：标准 shadcn 技术栈：React + Vite + TypeScript + pnpm + Tailwind CSS + shadcn/ui 组件体系，优先复用现成组件，不自造 UI 轮子。token 仅存内存，刷新经 Worker 恢复；**多栏布局统一用 `PageLayout`**（`web/src/components/PageLayout.tsx`）。
- **后端**：Cloudflare Pages Worker，只做**四件事 + 探活**（架构红线 2，详见 `docs/architecture.md`）：
  - ① OAuth2 令牌管理：`/$auth/login`、`/$auth/callback`、`/$auth/pat`（**PAT 直接登录**——github.com 主站受限时绕过授权页）、`/$auth/session`（GET 恢复 / **POST 补全用户元数据，token 验证防伪造**）、`/$auth/logout`、`/$auth/sessions`（会话列表）、`/$auth/revoke`（撤销授权）；`client_secret` 仅存 Worker Secret；
  - ② CLI git 镜像端点自动代理：clone / pull / push 流量自动转发到 GitHub（git 凭据用 PAT）；
  - ③ Wiki 内容代理（`/$wiki/*`）；④ Raw 内容代理（`/$raw/*`）；另含 `/$healthz` 健康检查探活（通用在线探活）。
  - **API 调试工具（`/$debug`）为纯前端路由**（App.tsx lazy 页，前端 SPA 调试面板，GraphQL/REST 统一，worker 完全不参与、无鉴权，token 复用主站会话）。
- **CLI 集成（镜像端点自动代理）**：worker 对外提供**镜像端点**，将 git 流量自动代理转发到 GitHub；用户侧通过「配置替换镜像」方式接入，例如 `git config --global url.<worker镜像端点>/.insteadOf https://github.com/`。

## 二、开发原则（必须遵守）

1. **计划优先**：任何任务先输出研讨/开发计划再动手；计划须与用户共同推敲，确认后方可执行。
2. **多问询核对**：遇到歧义、方向选择、技术取舍时，主动提问确认，不擅自假设。
3. **极简最小改动**：只做满足需求的最小改动，不扩大范围、不做过度设计。
4. **尽量复用**：优先使用已有模块、成熟成品包与现成组件（shadcn/ui、成熟开源库），不重复造轮子。
5. **外部资产操作问询**：凡涉及**用户真实外部文件、外部站点的资产、账号、数据、密钥**的操作/访问/使用（如真实 GitHub 账号的写操作、真实 token/凭据、外部站点资源抓取、用户本地真实文件读写），测试开发中**必须先问询请示用户**，经批准后才按用户指导、限定的方式处理。
6. **文档集中且精简**：项目文档集中存放于 `docs/`，分公开/内部两级（公开随仓库发布：vision/design/architecture/api-compat/cli-setup/github-schema；内部 gitignore：tasks/plan）。**不强制记录临时任务/决策**——临时任务与决策随开发自动消亡，最终结果沉淀在代码注释（总结性语义）与公开框架文档；开发过程中只**不断修正关键框架文档**（vision/design/architecture/api-compat 等）。完整地图见 `docs/index.md`。
7. **提交前质量门禁**：每次编写与提交新 commit 前必须通过——**oxlint 零警告**（`pnpm lint`，根 oxlint 全量 web/worker/scripts，非必要不使用 disable 注释）与 **oxfmt 格式一致**（`pnpm format` 后 `pnpm format:check` 通过；PR 评审同样按此格式检查）。

## 三、技能（Skills）策略

- 根据项目需要，自主调用 create-skills 能力创建针对本项目有效、具框架性、有指导意义的技能（例如：shadcn 组件开发、Worker 鉴权与代理、CLI 镜像配置等），辅助后续开发。
- 后续会话主动检查并加载 `.github/skills/`（或约定位置）下已创建的项目技能。

## 四、工作流程（敏捷 · 懒开发路径）

1. 收到任务后：梳理需求 → 制定详细研讨/开发计划 → 与用户确认 → 小步推进、每步可验证。
2. 临时测试文件、调试代码用后**立即移除**，不留垃圾。
3. 当前处于 **0.0.x 内部试错阶段**，**不要求**兼容保留原有逻辑与代码，可大胆重构与简化；破坏性改动前说明理由与影响面。
4. 以最小化改动、懒开发路径为原则快速迭代；完成阶段性改动后**同步修正关键框架文档**（vision/design/architecture/api-compat 等公开文档），保持代码与文档一致。
5. **提交前跑门禁**：`pnpm lint`（根 oxlint 全量零警告）+ `pnpm format` 后 `pnpm format:check` 通过（oxfmt 格式一致）——见开发原则 7。

### 4.1 复刻 GitHub 官方页面（标准 6 步流程）

> 任何「复刻 / 改造某个官方页面」任务**必须**按此流程推进（本项目核心玩法）。详细方法论见 `.github/skills/replica-workflow/SKILL.md`。

1. **官方调研**：访问对应 GitHub 官方页面，devtools 分析 layout / 功能 / 行为 / 可参考组件，记录调研笔记。**仅限只读观察**；涉及真实账号数据的写操作先问询用户。
2. **对照评估**：对照本项目现有页面，评估改造难度 / 影响 / 收益 / 大致计划流程。
3. **讨论确认**：与用户讨论难点、疑点、待定项，确认核心差异处理方案。
   - 3.1 必要时可**完全重构**难以直接修改到位的文件（破坏性更新，0.0.x 阶段不保兼容）。
4. **实施复刻**：按方案改造实施；再按「精简界面、纯化功能」思路提出优化建议。
5. **决策升华**：待用户确认最终决策方案，进行已复刻页面的改造升华。
6. **文档同步**：关键项修订到对应公开框架文档（architecture/design/api-compat/vision）；必要时重启 dev 进程；新增组件需发起 rebuild（`pnpm build`）。
   - 6.1 重大改动后**审计所有文档统一对齐**描述与不一致项；对数据格式等底层调整时触发 clean 重置缓存（`node scripts/clean.mjs`）。

## 五、会话开始检查清单

1. 读 `docs/index.md`（文档体系总导航），确认公开/内部文档层级与当前状态（内部依赖层级见本地 `plan.md`）。
2. 查看 `.github/skills/` 并加载适用者。
3. 确认本次任务目标与优先级后再开始。
