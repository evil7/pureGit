---
name: shadcn-ui
description: "Use when: 在 PureGit 前端开发/添加 UI 组件——shadcn/ui 组件添加流程、组件目录约定、主题定制。触发词：shadcn、组件、button、dialog、tailwind、UI"
argument-hint: "需要添加/开发哪个 shadcn 组件或 UI 功能"
---

# shadcn/ui 组件开发

本项目前端采用 shadcn/ui 组件体系。**核心原则：优先复用现成组件，禁止手写重复基础组件。**

> 组件**具体用法**（尺寸/变体/验收）见 `docs/design.md`；本 skill 管「怎么添加/配置」。

## 目录约定

- 前端根目录：`web/`（Vite + React + TS + pnpm + Tailwind CSS）
- 组件统一存放：`web/src/components/ui/`（shadcn 生成，勿手改底层）
- 业务组件：`web/src/components/`
- 颜色走 CSS 变量，**禁止硬编码色值**；路径别名 `@/*` → `web/src/*`

## 添加流程

1. 先检查 `web/src/components/ui/` 是否已有目标组件（复用优先）
2. 若无，用 shadcn CLI 添加：`cd web && pnpm dlx shadcn@latest add <component-name>`
3. 按需调整 props（最小改动），不重构内部结构
4. 使用处 import 自 `@/components/ui/...`

## 检查清单

- [ ] 复用现成组件而非新写基础组件
- [ ] 颜色走 CSS 变量，无硬编码色值
- [ ] 有 loading / error 态
- [ ] import 路径使用 `@/` 别名
