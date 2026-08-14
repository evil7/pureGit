---
name: ui-layout
description: "Use when: 开发 PureGit 前端的任何 UI/UX——页面布局（单页/两栏/三栏）、sticky 侧栏、响应式规则、组件（按钮/卡片/标签/代码框/翻页/对话框）、动画、滚动问题排查。触发词：布局、layout、sticky、侧栏、sidebar、双栏、三栏、grid、响应式、组件、卡片、按钮、代码框、动画、PAGE_SHELL、SIDEBAR_STICKY、CONTENT_FILL"
argument-hint: "需要开发/修复哪个页面的 UI/布局/组件，或参考哪个规范"
---

# UI/UX 规范（速查）

> **完整权威**：`docs/design.md`（本 skill 是其速查版）。
> **一句话**：所有 UI 必须用 `PageLayout` 统一布局组件 + 共享常量（`web/src/lib/layout.ts`）+ shadcn 组件，禁止手写散落类名/硬编码颜色；**shadcn 原生**——直接用官方默认样式，非必要不手动调整尺寸/颜色。

## 布局

- 单页 A 型：不传 left/right → 单列
- 多栏：`PageLayout` 三栏模型（left/right 可选 + sticky 三态 + 断点 + hidden）
- 共享常量：`PAGE_SHELL` / `SIDEBAR_STICKY`（导航型）/ `SIDEBAR_STICKY_SCROLL`（工具型）/ `CONTENT_FILL`

## 五大禁则

1. ❌ 外层容器禁 `py-*`（滚到底推 sticky）
2. ❌ 导航型侧栏禁 `max-h`/`overflow-y-auto`（嵌套滚动条；仅工具型用 SCROLL）
3. ✅ 必须 `items-start`（PageLayout 内置）
4. ❌ 禁手写散落 `sticky`/`top-*`/`max-h-[calc(...)]`（用共享常量）
5. ❌ 内容区禁裸放（必须 `min-w-0`）

## 组件速查

- **按钮**：variant default/outline/ghost/destructive/link；size **统一 default**（图标 `icon`）——禁止散落 `sm/xs/lg` 与 `h-*/text-xs` 覆盖
- **表单**：Input/Textarea/Select 默认尺寸；Label `mb-1.5 block`
- **标签/头像/卡片**：Badge（scope 用 outline + font-mono text-xs）/ Avatar / Card + `hover:bg-accent/50`
- **危险操作**：AlertDialog（删除/退出/改名必用）
- **加载/错误/空态**：Skeleton / InlineError + 重试 / i18n `*.empty`

## 响应式

默认单列 → md（≥768px）两栏 → lg（≥1024px）三栏/加宽 → xl（≥1280px）Dashboard 三栏

## 验收清单

- [ ] 外层 `PAGE_SHELL`（无 `py-*`）；多栏用 `PageLayout`
- [ ] 侧栏用共享常量；组件全复用；无硬编码颜色
- [ ] shadcn 原生：一律 default 尺寸（图标 `icon`）
- [ ] loading/error/empty 三态齐全；写操作经 WriteGate；danger 经 AlertDialog
