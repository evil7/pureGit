# PureGit UI/UX 设计规范（Design System）

> 本文档定义 PureGit **全部 UI/UX 标准**：页面框架结构、组件规范、响应式规则与动画。
> **总纲**：`docs/vision.md`（中心思想）；**架构落地**：`docs/architecture.md`；本文件是**视觉与交互的唯一权威**。
> 配套 Skill：`.github/skills/ui-layout/SKILL.md`（速查 + shadcn 组件添加流程）。

## 0. 设计原则（继承 vision.md「化简」）

| 原则 | 落地要求 |
|------|----------|
| **官方心智** | 页面结构、路由、交互遵循 GitHub 官方布局（替换域名即访问官方）；路径、导航、tabs 位置一致 |
| **组件复用** | 一律使用 shadcn/ui 基础组件（`web/src/components/ui/`）与业务组合组件，禁止手写重复基础组件 |
| **shadcn 原生** | 组件构造直接使用 shadcn 官方组件**默认样式**（尺寸/颜色/间距/圆角），非必要不对原始 shadcn 样式手动调整；确需定制走主题 CSS 变量，禁止散落尺寸覆盖与硬编码色值 |
| **干净整洁** | 统一宽度、统一间距、统一圆角、信息密度适中 |
| **真实数据** | 全部数据来自官方 API，无造假；loading/error/empty 三态齐全 |
| **官方兜底** | 官方功能**无公开 API** 时：构造预留页/预留项并**外链引导至官方**（新窗口，标注「仅官方」），不凭空捏造数据、不做假开关；参考 actions 页 Management 分组外链项 |

## 1. 布局框架

### 1.1 全局骨架

所有页面共享同一骨架，固定三层：

```
┌────────────────────────────────────────────────────────────┐
│  TOP_BAR（全局导航，sticky top-0 z-50）                      │  ← 全站唯一，App.tsx 渲染
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  PAGE_SHELL（页面外层）                                      │  ← 每个页面根容器
│  ┌────────────────────────────────────────────────────────┐ │
│  │  布局网格（单页 / 两栏 / 三栏）                          │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

- **TOP_BAR**：Logo + 搜索框 + 操作图标组 + 用户头像；`sticky top-0 z-50`。
- **PAGE_SHELL**（`web/src/lib/layout.ts`）：页面外层容器。⚠️ **禁止 `py-*` 底部 padding**（滚动到底会推 sticky 侧栏）。
- **Footer**：全站常驻页脚，随页面滚动，不参与 sticky 吸附。

### 1.2 统一布局组件：PageLayout（定稿）

> **全站所有多栏页面统一用 `PageLayout`**（`web/src/components/PageLayout.tsx`）——`left(可选) + 主内容 + right(可选)` 三栏模型；任一栏不传即不渲染。

```tsx
<PageLayout
  gap="sm" | "md" | "lg"          // 列间距
  contentClassName="max-w-..."     // 可选内容限宽
  left={{ node: <nav/>, width: 280, sticky: "nav" | "tool" | "none", breakpoint: "md", hidden?: boolean }}
  right={{ ...同上 }}
>
  <main>…主内容…</main>
</PageLayout>
```

- **单页 A 型**：不传 left/right → 单列
- **hidden=true** → 该栏 `hidden` 保留 DOM（防重挂载重复请求）
- **sticky 两态**：`nav`=纯吸附 / `tool`=限高内滚 / `none`=随内容滚动
- 有侧栏时主内容自动撑满视口剩余；`items-start` 由 PageLayout 内置（sticky 侧栏必需）

### 1.3 布局常量（`web/src/lib/layout.ts`）

| 常量 | 用途 |
|------|------|
| `PAGE_SHELL` | 页面外层（⚠️ 禁 `py-*` 底部 padding） |
| `SIDEBAR_STICKY` | 导航型侧栏（纯吸附，超高裁切，无内部滚动） |
| `SIDEBAR_STICKY_SCROLL` | 工具型侧栏（文件树等需内部滚动） |
| `CONTENT_FILL` | 内容区撑满视口剩余（有侧栏时自动加） |

### 1.4 五大禁则（代码审计红线）

1. ❌ 外层容器**禁止 `py-*`**（滚到底推 sticky）
2. ❌ 导航型侧栏**禁止 `max-h`/`overflow-y-auto`**（嵌套滚动条根因；仅工具型用 `SIDEBAR_STICKY_SCROLL`）
3. ✅ **必须 `items-start`**：sticky 侧栏作 grid item 必须 `items-start`（PageLayout 内置）
4. ❌ 禁止手写散落 `sticky`/`top-*`/`max-h-[calc(...)]` 类名（用共享常量）
5. ❌ 内容区禁止裸放（必须 `min-w-0`）

## 2. 组件规范

- **按钮**：`Button` variant default/outline/ghost/destructive/link；size **统一 default**（图标按钮 `icon`）——禁止散落 `size="sm/xs/lg"` 与 `h-*/text-xs` 尺寸覆盖
- **表单**：`Input`/`Textarea`/`Select` 等一律默认尺寸；标签 `Label className="mb-1.5 block"`
- **标签**：`Badge`（状态/元数据）；scope 用 `variant="outline" font-mono text-xs`
- **头像**：`Avatar`；Fallback 取 login 前 2 大写
- **危险操作**：`AlertDialog` 确认框（删除/退出/改名必用）
- **下拉**：`DropdownMenu`（内容超高 `max-h-80 overflow-y-auto`）
- **加载/错误/空态**：`Skeleton` 占位 / `InlineError` + 重试 / empty 文案（i18n `*.empty` 键）
- **预留外链项**：官方功能**无公开 API** 时的标准处置——构造预留项（图标 + 标签 + 外链），`<a href={官方路径} target="_blank" rel="noreferrer">` 跳转官方页；末尾附 `ExternalLink` 图标 + 「仅官方」小徽标（`text-[10px] text-muted-foreground/70`）+ `title` 提示「官方专属功能」；用于设置/管理类页面的侧栏导航或分组列表
- **颜色**：一律走主题 CSS 变量，禁止硬编码色值

## 3. 响应式断点

| 断点 | 行为 |
|------|------|
| 默认 <768px | 单列堆叠 |
| md ≥768px | 两栏（导航 / 树 / 资料卡 / metadata） |
| lg ≥1024px | 三栏/加宽（仓库 About 显示） |
| xl ≥1280px | Dashboard 三栏 |

## 4. 动画

- 页面切换：`page-enter`（fade + 上移，全局自动）
- hover：`transition-colors`；下拉/弹窗 Radix 默认动画
- ❌ 无折叠/吸顶动画；❌ 无多余弹跳/缩放

## 5. 验收清单（新页面/改布局后逐项核对）

- [ ] 外层 `PAGE_SHELL`（无 `py-*`）；多栏用 `PageLayout`（禁手写 grid）
- [ ] 侧栏用共享常量（`SIDEBAR_STICKY`/`SIDEBAR_STICKY_SCROLL`，禁散落类名）
- [ ] 组件全部复用（ui/ 或 components/）；无硬编码颜色
- [ ] shadcn 原生：按钮/输入/下拉/开关等一律 default 尺寸（图标 `icon`），无散落尺寸覆盖
- [ ] loading/error/empty 三态齐全
- [ ] 响应式：默认单列 → md 两栏 → lg/xl 三栏/加宽
- [ ] 矮视口滚动到底：导航型侧栏 top 恒定；工具型内部滚动正常
- [ ] 页面切换动画生效；i18n 中英双同步；写操作经 WriteGate；danger 操作经 AlertDialog
- [ ] 无 API 的官方功能用「预留外链」而非假开关；外链 `target="_blank"` + 标注「仅官方」
