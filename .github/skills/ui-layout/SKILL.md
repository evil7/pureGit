---
name: ui-layout
description: "Use when: 开发 PureGit 前端的任何 UI/UX——页面布局（单页/两栏/三栏）、sticky 侧栏、响应式规则、组件（按钮/卡片/标签/代码框/翻页/对话框）、动画、滚动问题排查。触发词：布局、layout、sticky、侧栏、sidebar、双栏、三栏、grid、响应式、组件、卡片、按钮、代码框、动画、PAGE_SHELL、SIDEBAR_STICKY、CONTENT_FILL"
argument-hint: "需要开发/修复哪个页面的 UI/布局/组件，或参考哪个规范"
---

# PureGit UI/UX 规范（Design System）

> **完整权威**：`docs/design.md`（本 skill 是其速查版，冲突时以 design.md 为准）。
> **一句话**：所有 UI 必须用 `PageLayout` 统一布局组件 + 共享常量（`web/src/lib/layout.ts`）+ shadcn 组件，禁止手写散落类名/硬编码颜色；**自定义阶段 shadcn 原生**——组件直接用官方默认样式，非必要不手动调整尺寸/颜色。

## 1. 全局骨架（所有页面）

```
┌──────────────────────────────────────────────┐
│ TOP_BAR  全局导航  sticky top-0 z-50  h-14   │
├──────────────────────────────────────────────┤
│ PAGE_SHELL  mx-auto max-w-7xl px-4 pt-[23px] │
│  ┌──────────┬─────────────────────────────┐  │
│  │ SIDEBAR  │ CONTENT (min-w-0)           │  │
│  │ sticky   │ CONTENT_FILL                │  │
│  └──────────┴─────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## 2. 统一布局组件：PageLayout（定稿，替代 GRID_2COL_*）

> **全站所有多栏页面统一用 `PageLayout`**（`web/src/components/PageLayout.tsx`）——`left(可选) + 主内容 + right(可选)` 三栏模型；任一栏不传即不渲染。**`GRID_2COL_*` 常量已弃用**（design.md §1.2），禁止新页面使用。

```tsx
<PageLayout
  gap="sm" | "md" | "lg"              // 列间距（官方 280 系 sm；其余 md/lg）
  contentClassName="max-w-230"        // 可选内容限宽（设置页）
  left={{
    node: <nav/>,                     // 左栏内容（不传整栏不渲染）
    width: 280,                       // 宽度（官方实测：200~336）
    lgWidth?: 320,                    // 可选 lg 加宽（blob 树 md 240→lg 320）
    sticky: "nav" | "tool" | "none",  // nav=纯吸附 / tool=限高内滚 / none=随内容滚动
    breakpoint: "md" | "lg" | "xl",   // 侧栏生效断点（默认 md）
    hidden?: boolean,                 // 动态显隐（blob 折叠树，保留 DOM 防重挂载重复请求）
  }}
  right={{ ...同上 }}                 // 右栏（详情 metadata / About）
>
  <main>…主内容…</main>
</PageLayout>
```

- **单页 A 型**：不传 left/right → 单列（等价 `<div className={PAGE_SHELL}><main className="min-w-0">…</main></div>`）
- **items-start 由 PageLayout 内置**（sticky 侧栏必需，否则 stretch 拉满 → sticky 失效）
- 有侧栏时主内容自动 `CONTENT_FILL`；单列不加

## 3. 布局常量（`web/src/lib/layout.ts`）

| 常量 | 类名 | 用途 |
|------|------|------|
| `PAGE_SHELL` | `mx-auto max-w-7xl px-4 pt-[23px]` | 页面外层（⚠️ 禁 `py-*` 底部 padding；顶距 23px = sticky 锚对齐 抖动修复） |
| `SIDEBAR_STICKY` | `md:sticky md:top-20` | **导航型**侧栏（官方式，超高裁切，无内部滚动；锚点留 23px 间隔） |
| `SIDEBAR_STICKY_SCROLL` | `md:sticky md:top-20 md:max-h-[calc(100svh-7rem-1px)] md:overflow-y-auto` | **工具型**侧栏（文件树等需内部滚动） |
| `SIDEBAR_STICKY_SCROLL_HEAD` | `md:sticky md:top-25 md:max-h-[calc(100svh-7rem-1px)] md:overflow-y-auto` | 内容区内工具型 sticky（blob symbols 面板，对齐 sticky 操作头） |
| `CONTENT_FILL` | `md:min-h-[calc(100svh-5rem-1px)]` | 内容区撑满视口剩余（PageLayout 有侧栏时自动加） |

## 4. 五大禁则（代码审计红线）

1. ❌ 外层容器**禁止 `py-*`**（滚到底推 sticky）
2. ❌ 导航型侧栏**禁止 `max-h`/`overflow-y-auto`**（嵌套滚动条根因；仅工具型用 `SIDEBAR_STICKY_SCROLL`）
3. ✅ **必须 `items-start`**：sticky 侧栏作 grid item 必须 `items-start`（PageLayout 内置）——否则 item stretch 拉满行高 → sticky 无吸附空间 → 失效/滚出
4. ❌ 禁止手写散落 `sticky`/`top-14`/`top-20`/`top-25`/`max-h-[calc(...)]` 类名（用共享常量）
5. ❌ 内容区禁止裸放（必须 `min-w-0`）

## 5. 标准模板

### 两栏（设置页/主页：侧栏在左）
```tsx
<div className={PAGE_SHELL}>
  <PageLayout left={{ node: <nav>…</nav>, width: 240, sticky: "nav" }}>
    <main>…</main>
  </PageLayout>
</div>
```

### 两栏·侧栏在右（详情页 metadata）
```tsx
<div className={PAGE_SHELL}>
  <PageLayout right={{ node: <aside>…metadata…</aside>, width: 280, sticky: "nav" }}>
    <main>…标题/正文/评论…</main>
  </PageLayout>
</div>
```

### 三栏（Dashboard 首页）
```tsx
<div className={PAGE_SHELL}>
  <PageLayout
    left={{ node: <div>…账户切换+Top 仓库…</div>, width: 336, sticky: "nav", breakpoint: "xl" }}
    right={{ node: <aside>…</aside>, width: 312, sticky: "nav", breakpoint: "xl" }}
  >
    <main>…动态/热点…</main>
  </PageLayout>
</div>
```

### 工具型侧栏（blob 文件树，内部滚动）
```tsx
<PageLayout
  left={{ node: <FileTree …/>, width: 240, lgWidth: 320, sticky: "tool", hidden: collapsed }}
>
  <main>…</main>
</PageLayout>
```

## 6. 响应式断点

| 断点 | 行为 |
|------|------|
| 默认 <768px | 单列堆叠 |
| md ≥768px | 两栏（D 导航 / B 树 / E 资料卡 / F metadata） |
| lg ≥1024px | 三栏/加宽（300/320px；仓库 About 显示） |
| xl ≥1280px | Dashboard 三栏（336+312） |

## 7. 组件速查（全部详见 design.md §4）

- **按钮**：`Button` variant default/outline/ghost/destructive/link；size **统一 default**（图标按钮 `icon`）——禁止散落 `sm/xs/lg` 与 `h-*/text-xs` 覆盖
- **标签**：`Badge`（状态/元数据）；scope 用 `variant="outline" font-mono text-xs`
- **卡片**：`Card` + `hover:bg-accent/50 transition-colors`
- **表单**：`Input`/`Textarea` + `Label className="mb-1.5 block"`
- **头像**：`Avatar` size-8/10/14+；Fallback 取 login 前 2 大写
- **危险操作**：`AlertDialog` 确认框（删除/退出/改名必用）
- **下拉**：`DropdownMenu`（内容超高 `max-h-80 overflow-y-auto`）
- **加载**：`Skeleton` 占位；错误 `border-destructive/30 bg-destructive/10 text-destructive`；空态走 i18n 键
- **代码框**：CodeMirror 6 高亮 + 行号（CSS counter）；`overflow-x-auto` 防长行溢出
- **翻页**：per_page=30；数量统计读 Link header 末页，无独立分页组件

## 8. 动画

- 页面切换：`page-enter`（fade + 8px 上移，0.28s ease，全局自动）
- hover：`transition-colors`；下拉/弹窗 Radix 默认动画
- ❌ 无折叠/吸顶动画；❌ 无多余弹跳/缩放

## 9. 验收清单（新页面/改布局后逐项核对）

- [ ] 外层 `PAGE_SHELL`（`pt-[23px]`，无 `py-*`）；多栏用 `PageLayout`（left/right，禁 GRID_2COL_*）
- [ ] 侧栏用 `SIDEBAR_STICKY`/`SIDEBAR_STICKY_SCROLL`/`SIDEBAR_STICKY_SCROLL_HEAD`（禁散落类名）
- [ ] 组件全部复用（ui/ 或 components/）；无硬编码颜色
- [ ] shadcn 原生：按钮/输入/下拉/开关等一律 default 尺寸（图标 `icon`），无散落 `size="sm/xs/lg"` 或 `h-*/text-xs` 覆盖
- [ ] loading/error/empty 三态齐全
- [ ] 响应式：默认单列 → md 两栏 → lg/xl 三栏/加宽
- [ ] 矮视口（~500px）滚动到底：导航型侧栏 top 恒定（无偏移）；工具型内部滚动正常
- [ ] 页面切换动画生效；i18n 中英双同步；写操作经 WriteGate
