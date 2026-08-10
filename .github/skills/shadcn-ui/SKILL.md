---
name: shadcn-ui
description: "Use when: 在 PureGit 前端开发/添加 UI 组件——shadcn/ui 组件添加流程、Tailwind 配置、组件目录约定、主题定制。触发词：shadcn、组件、button、dialog、tailwind、UI"
argument-hint: "需要添加/开发哪个 shadcn 组件或 UI 功能"
---

# PureGit shadcn/ui 组件开发

本项目前端采用 shadcn/ui 组件体系。**核心原则：优先复用现成组件，禁止手写重复的基础组件。**
> 组件**具体定义**（尺寸/变体/用法/验收）见 `docs/design.md` §4；本 skill 管「怎么添加/配置」，design.md 管「用成什么样」。

## 目录与配置约定

- 前端根目录：`web/`（Vite + React + TS + pnpm + Tailwind CSS）
- 组件统一存放：`web/src/components/ui/`（shadcn 生成，勿手改底层）
- 业务组件：`web/src/components/` 与页面组件同层，基于 ui 组件组合
- Tailwind 配置：`web/tailwind.config.{js,ts}`；主题色走 CSS 变量（`hsl(var(--primary))` 等），**禁止硬编码颜色**
- 路径别名 `@/*` → `web/src/*`（tsconfig + vite config 已配）

## 添加 shadcn 组件流程

1. 先检查 `web/src/components/ui/` 是否已有目标组件（复用优先）
2. 若无，用 shadcn CLI 添加：
   ```bash
   cd web && pnpm dlx shadcn@latest add <component-name>
   ```
3. 按需调整组件 props/样式（最小改动），不重构其内部结构
4. 新组件使用处必须 import 自 `@/components/ui/...`

## 组件使用规范

- **按钮**：`@/components/ui/button`，variant 用默认（default/outline/ghost/destructive/link）；size default/sm/icon
- **表单**：`@/components/ui/form` + `react-hook-form` + `zod`（若未安装则先 add form）
- **对话框**：`@/components/ui/dialog`（普通弹窗）或 alert-dialog（**危险操作确认必用**：删除/退出/改名）
- **列表/加载**：`@/components/ui/skeleton` + `@/components/ui/card`
- **标签**：`@/components/ui/badge`（状态/元数据；scope 用 outline + font-mono text-xs）
- **空态/错误态**：所有列表页必须处理 loading（skeleton）与 error（提示 + 重试）
- **暗色模式**：主题切换保持 CSS 变量驱动（oklch 变量，无硬编码色值）

## 页面结构约定

```
web/src/
├── components/ui/        # shadcn 生成的底层组件（勿手写重复）
├── components/           # 业务组合组件
├── lib/                  # utils（cn）、api（GitHub 请求封装）
├── hooks/                # 自定义 hooks（如 useAuth、useGitHub）
└── pages/                # 页面级组件（路由对应）
```

## 检查清单（提交前）

- [ ] 复用了现成组件而非新写基础组件
- [ ] 颜色走 CSS 变量，无硬编码色值
- [ ] 有 loading / error 态
- [ ] import 路径使用 `@/` 别名
