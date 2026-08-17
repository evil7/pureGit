# PureGit 项目指南（Copilot Instructions）

本文件为工作区级全局指令，自动应用于所有会话。**规则层级**（冲突时高层优先）：
本文件（全局红线）→ `.github/skills/*`（领域速查）→ `docs/*`（权威框架文档）。
完整文档地图见 `docs/index.md`。

## 项目身份

通过 GitHub 官方 API **全量复刻 GitHub 前端**：功能对齐官方、界面干净整洁、操作由繁化简（详见 `docs/vision.md`，最高纲领）。当前阶段 **v0.0.1 全量复刻**（0.0.x 内部试错，可破坏性重构、不保兼容）。

## 红线（框架协议，全部会话必须遵守）

1. **密钥安全**：`client_secret` 仅存 Worker 环境变量/Secret；前端**严禁**硬编码密钥；access token 仅存**内存**（刷新经 Worker `/$auth/session` 恢复），**不得写入 localStorage 明文**。
2. **职责边界**：Worker 只做——OAuth2 令牌管理（含 PAT 直接登录）、git 镜像端点代理、`/$wiki/*` 代理、`/$raw/*` 代理、`/$healthz`；业务逻辑与 API 请求全在前端。`/$debug` 为纯前端路由（worker 不参与）。详见 `docs/architecture.md`。
3. **API 策略**：Octokit SDK 统一封装——登录态**强制 GraphQL 唯一主通道**（唯一例外 = GraphQL 无适配）；**匿名强制 REST**（GraphQL 匿名恒 403）；GraphQL 失败 → `withRestFallback` 熔断降级 REST。**禁止**新增「REST 优先」模式。详见 `docs/architecture.md` + skill `api-strategy`。
4. **UI/UX**：必须遵守 `docs/design.md`——多栏用 `PageLayout` + 共享常量 `web/src/lib/layout.ts`；一律复用 shadcn/ui；禁止硬编码颜色；danger 用 AlertDialog；shadcn 原生默认样式。详见 skill `ui-layout`。
5. **外部资产问询（红线）**：凡涉及**用户真实外部文件、外部站点资产、账号、数据、密钥**的访问或写操作，**必须先问询请示用户**，经批准后按用户指导、限定的方式处理，不得擅自操作。

## 开发规范

1. **计划优先**：动手前先输出研讨/开发计划，与用户确认后再执行。
2. **最小改动**：只做满足需求的最小改动；优先复用现有模块与成熟成品（shadcn/ui、npm 成熟包）。
3. **文档同步**：代码变更后同步修正关键框架文档（`vision.md` / `design.md` / `architecture.md` / `cli-setup.md` / `index.md`）。
4. **临时脚本**统一放 `tmp/`（即用即删；长期使用迁移 `scripts/`），**禁止**在 `web/src`、`worker/src`、`docs/` 散落临时测试代码。
5. **0.0.x 内部试错**：不保兼容，可大胆重构；破坏性改动前说明理由与影响面。
6. **多问询核对**：遇到歧义、方向取舍、技术选择，先提问确认，不擅自假设。
7. **注释规范（契约而非过程转录）**：注释写**总结性语义**——模块/组件/函数的最终用意、关键设计、为什么这样写；**禁止**引用决策编号、历史任务编号、过程性日期记录。
8. **提交前质量门禁**：`pnpm lint`（oxlint 零警告）/ `pnpm format` 后 `pnpm format:check` 通过 / `pnpm test`（vitest）全绿。
9. **预留外链官方**：官方功能**无公开 API** 时，构造预留页/预留项并**外链引导至官方**（`target="_blank"` + 标注「仅官方」），不捏造假开关、不凭空造数据；参考 actions 页 Management 分组外链项。详见 `docs/design.md`「官方兜底」。

## 工作流速查（按任务类型走 skill）

- **改造/复刻官方页面** → skill `replica-workflow`（评估→讨论→实施→升华→文档同步）
- **新增/修改 API 接入** → skill `api-strategy`；**写 UI/加组件** → skill `ui-layout`
- **Worker 鉴权** → skill `cf-worker-auth`；**CLI git 代理** → skill `cli-git-mirror`

## 构建与测试

> pnpm workspace：根目录统一管理 `web/`（前端）与 `worker/`（Cloudflare Worker），统一 git 仓库（仅根目录一个 `.git`，提交由根执行）。

- 安装：`pnpm install`；开发（唯一模式，双进程 vite 5173 + wrangler 8787）：`pnpm dev`
- 质量门禁：`pnpm lint` / `pnpm format` / `pnpm format:check` / `pnpm test`
- 构建：`pnpm --filter web build`（前端）/ `pnpm build`（根全量）
- Worker：`pnpm --filter worker deploy`（部署）/ `pnpm --filter worker test`（测试）

## Windows / PowerShell 5.1 陷阱（必须遵守）

> **开发环境 = Windows + PowerShell 5.1**（非 bash / 非 PS7），终端命令按 PS 语法书写。

1. **编码**：`Get-Content`/`Set-Content`/`Add-Content` 默认 ANSI（GBK），读写中文 UTF-8 源文件会破坏编码。改代码/注释一律用编辑器工具；确需 PS 写文件用 `[System.IO.File]::WriteAllText($path,$content,[System.Text.UTF8Encoding]::new($false))`（无 BOM）。
2. **`&&` 不支持**（PS 7+ 才有）→ 用 `;` 串联（package.json scripts 内的 `&&` 由 pnpm 解析，不受影响）。
3. **`curl`/`wget` 是别名**（= `Invoke-WebRequest`）→ 用 `Invoke-WebRequest`/`Invoke-RestMethod` 或显式 `curl.exe`。
4. **长驻进程**：dev server 用 async 启动；查端口 `Get-NetTCPConnection -LocalPort 5173 -State Listen`。
