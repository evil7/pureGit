# PureGit UI/UX 设计规范（Design System）

> 本文档定义 PureGit **全部 UI/UX 标准**：从页面框架结构到每个用到的组件（标签、卡片、按钮、代码框、翻页、对话框等）的具体定义、响应规则与动画。
> **总纲**：`docs/vision.md`（中心思想）；**架构落地**：`docs/architecture.md`；本文件是**视觉与交互的唯一权威**，所有页面实现必须对齐。
> 配套 Skill：`.github/skills/ui-layout/SKILL.md`（自动调用入口）与 `.github/skills/shadcn-ui/SKILL.md`（组件添加流程）。

## 0. 设计原则（继承 vision.md「化简」）

| 原则 | 落地要求 |
|------|----------|
| **官方心智** | 页面结构、路由、交互遵循 GitHub 官方布局（替换域名即访问官方）；路径、导航、tabs 位置一致 |
| **组件复用** | 一律使用 shadcn/ui 基础组件（`web/src/components/ui/`）与业务组合组件，禁止手写重复基础组件 |
| **干净整洁** | 统一宽度（max-w-7xl）、统一间距（gap-8/gap-4/gap-2）、统一卡片圆角（--radius 0.625rem）、信息密度适中 |
| **由繁化简** | 高频操作一步直达；去装饰（无广告、无冗余动画、无散落类名） |
| **真实数据** | 全部数据来自官方 API，无造假；loading/error/empty 三态齐全 |

---

## 1. 布局框架（框架结构定义）

### 1.1 全局骨架

所有页面共享同一骨架，固定三层：

```
┌────────────────────────────────────────────────────────────┐
│  TOP_BAR（全局导航，sticky top-0 z-50，高 h-14=56px+border1px）│  ← 全站唯一，App.tsx 渲染
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  PAGE_SHELL（页面外层：mx-auto max-w-7xl px-4 pt-[23px]）  │  ← 每个页面根容器
│  ┌────────────────────────────────────────────────────────┐ │
│  │  布局网格（单页 / 两栏 / 三栏，见 1.2-1.4）                │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

- **TOP_BAR**：Logo + 搜索框 + 操作图标组（Create new/Issues/PRs/Repos/Gist/通知）+ 用户头像；`sticky top-0 z-50`，半透明背景 + 底部 1px 边框。
- **PAGE_SHELL**（`web/src/lib/layout.ts`）：`mx-auto max-w-7xl px-4 pt-[23px]`。⚠️ **禁止 `py-*` 底部 padding**（滚动到底会推 sticky 侧栏）。**顶距 23px（抖动修复）**：topbar 57px + 23px = 80px = sticky 锚 `top-20` → 内容顶与锚点对齐，滚动即吸附、无「跟随→吸附」9px 跳变区间。
- **Footer（AppFooter 修订）**：全站常驻页脚（`<main>` 之后）——`mt-8 border-t`（**与 content 留 32px 间距**，PAGE_SHELL 禁 py-* 故间距由 footer 顶部提供）+ `max-w-7xl` 同宽 + `py-4 text-xs text-muted-foreground`，**左右分栏**（flex justify-between，窄屏换行）：左侧 = 项目仓库链接（**GitHub 官方 mark 图标 + PureGit，a 标签涵盖 star 计数**：Star 图标 + 简写数字，仓库不存在/私有则隐藏 star；**无 copyright**）；右侧 = GitHub API 状态点（绿=可用/红=不可达）+ 额度剩余（**插头 Plug 图标 + 简写数字**，hover title 显示完整 remaining/limit；不用文字）。**额度数据**：订阅 `octokit.ts` 统一 limit 缓存（`subscribeUsageChange`）——每次接口响应头 `x-ratelimit-*` 实时写入全局缓存并通知 footer/设置页，页面任意 REST/GraphQL 活动即时刷新；缓存为空（全站无请求）时才一次 `/rate_limit` 兜底回填（`setApiUsage`）。随页面滚动，不参与 sticky 吸附。

### 1.2 统一布局组件：PageLayout（定稿）

> **全站所有多栏页面统一用 `PageLayout`**（`web/src/components/PageLayout.tsx`），替代旧的 `GRID_2COL_*` 常量与手写 grid。官方全部页面 ≤ 三栏 = `left(可选) + 主内容 + right(可选)`。

```tsx
<PageLayout
  gap="sm" | "md" | "lg"               // 列间距（官方 280 系 sm；其余 md/lg）
  contentClassName="max-w-230"          // 可选内容限宽（设置页）
  left={{
    node: <nav/>,                       // 左栏内容
    width: 280,                         // 宽度（官方实测：200~336）
    lgWidth?: 320,                      // 可选 lg 加宽（blob 树 md 240→lg 320）
    sticky: "nav" | "tool" | "none",      // sticky 两态
    breakpoint: "md" | "lg" | "xl",     // 侧栏生效断点
    hidden?: boolean,                   // 动态显隐（blob 折叠树，保留 DOM）
    className?: string,
  }}
  right={{ ...同上 }}                   // 右栏（F/G 型 metadata/About）
>
  <main>…主内容…</main>
</PageLayout>
```

- **不传 left/right** → 单列 A 型（不渲染该栏 DOM）
- **hidden=true** → 该栏 `hidden` 保留 DOM（防重挂载重复请求）+ grid 模板自动收敛
- **sticky 两态**：`nav`=纯吸附（导航/About/metadata）/ `tool`=限高内滚（过滤栏、blob 树）/ `none`=随内容滚动（symbols 面板）
  （简化：原 `fill` 通底版并入 `tool`，blob 树底部留 32px 余量）
- 有侧栏时主内容自动 `CONTENT_FILL`（撑满视口剩余，sticky 吸附空间）；单列不加

### 1.3 单页（Single Column，A 型）

适用于：无侧栏的简单页面（如登录引导、Pulls 列表、新建页、全局 Issues 总览、Wiki 编辑、404 等）。

```tsx
<div className={PAGE_SHELL}>
  <main className="min-w-0">…</main>
</div>
```
（等价 `<PageLayout>…</PageLayout>`）

### 1.4 两栏（Two Column：sidebar + content）

适用于：设置页（SettingsLayout/OrgSettingsPage）、用户/组织主页（ProfilePages）、仓库 blob 页（RepoCode）、首页（HomePage 左栏）。

> **两栏有两种（明确定稿）**：`GRID_2COL_*` 系列 = **侧栏在左**（导航/过滤/文件树，第一个子元素是窄栏）；`GRID_2COL_ASIDE_280` = **侧栏在右**（详情页右 metadata，第二个子元素是窄栏）。使用前先确认页面语义，勿混用。
>
> **官方全站分型（重建）**：详见 `docs/research/00-分型总览.md`——A 全宽单列 / B 左文件树+内容（blob/edit/new/tree）/ B+ 左树+内容+右面板 / C 左过滤+列表（issues/通知/Projects）/ D 左导航+内容（设置）/ E 左资料+内容（用户页）/ F 内容+右 metadata（issue/PR/Discussion 详情）/ G 内容+右 About（仓库首页 lg）/ H 三栏（Dashboard）。**统一实现：`PageLayout` 三栏模型（`web/src/components/PageLayout.tsx`）——left/right 可选（不传即不渲染）+ hidden 动态显隐 + 宽度/断点/sticky 三态参数化**。

```
┌──────────────────────────────────────────────────────────┐
│ PAGE_SHELL                                              │
│  ┌───────────────┬────────────────────────────────────┐  │
│  │  SIDEBAR      │  CONTENT                           │  │
│  │  (sticky 锁定) │  (CONTENT_FILL 撑满视口剩余)         │  │
│  │  240/260/280px │  min-w-0                          │  │
│  └───────────────┴────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

```tsx
<div className={PAGE_SHELL}>
  <PageLayout
    left={{ node: <nav>…卡片/导航…</nav>, width: 240, sticky: "nav" }}
  >
    <main>…</main>
  </PageLayout>
</div>
```

**侧栏在右的变体（详情页 metadata）**：`right={{ node: <aside>, width: 280, sticky: "nav" }}`，主列在左、aside 右：

```tsx
<div className={PAGE_SHELL}>
  <PageLayout
    right={{ node: <aside>…Assignees/Labels/Milestone…</aside>, width: 280, sticky: "nav" }}
  >
    <main>…标题/正文/评论…</main>
  </PageLayout>
</div>
```

### 1.5 三栏（Three Column：left + content + right）

适用于：首页 Dashboard（左账户+Top 仓库 / 中动态 / 右热点，xl 起）、blob（左树 + 内容 + 右 symbols/outline 面板，lg 起）。

```tsx
<PageLayout
  left={{ node: <左栏/>, width: 300, sticky: "tool", breakpoint: "lg", hidden: 折叠 } }
  right={{ node: <右面板/>, width: 344, sticky: "none", breakpoint: "lg" }}
>
  <main>…主内容…</main>
</PageLayout>
```

- **Dashboard**：left 336 / right 312（xl 起）；右 Explore 已去杂项 → 实际 left + 中两栏。
- **仓库页 G 型**：RepoLayout 内 `right={{ node: <RepoAbout/>, width: 320, sticky: "nav", breakpoint: "lg" }}`；`hideAbout` 页不传 right → 全宽单列。
- **blob B+ 型**：`left={{ node: <FileTreeSidebar/>, width: 240, lgWidth: 320, sticky: "tool", breakpoint: "md", hidden: treeCollapsed }}` + 内容内右面板。

---

## 2. 布局常量（`web/src/lib/layout.ts`）

> **页面多栏一律用 `PageLayout` 组件**（§1.2），以下常量为 PageLayout 内部实现细节 + 少数组件内直接使用。

| 常量 | 类名 | 用途 |
|------|------|------|
| `PAGE_SHELL` | `mx-auto max-w-7xl px-4 pt-[23px]` | 页面外层（居中限宽 + 顶部间距 23px＝与 sticky 锚对齐；⚠️ 禁 `py-*`） |
| `SIDEBAR_STICKY` | `md:sticky md:top-20` | **导航型** sticky 侧栏（PageLayout `sticky:"nav"`；官方式：超高裁切，不做内部滚动；锚点留 23px 间隔） |
| `SIDEBAR_STICKY_SCROLL` | `md:sticky md:top-20 md:max-h-[calc(100svh-7rem-1px)] md:overflow-y-auto` | **工具型** sticky 侧栏（PageLayout `sticky:"tool"`；需内部滚动，如过滤栏 / blob 树；锚点下留 32px 底余量。blob 树亦用此版，原通底 `SIDEBAR_FILL` 已删） |
| `CONTENT_FILL` | `md:min-h-[calc(100svh-5rem-1px)]` | 内容区 min-h（PageLayout 有侧栏时自动加；内容顶 80px + 剩余 → 底≈视口底留 1px 防滚动条抖动；grid ≥ 视口 → sticky 有吸附空间） |
| ~~`GRID_2COL_240/260/280/300`~~ | — | ⚠️ **已弃用**：由 PageLayout `left` 取代（历史：侧栏在左两栏网格，items-start 内置） |
| ~~`GRID_2COL_ASIDE_280`~~ | — | ⚠️ **已弃用**：由 PageLayout `right` 取代（历史：侧栏在右，详情页 metadata） |

**sticky 术语**：nav 高 3.5rem（h-14）+ border 1px = 57px；内容顶 = 57 + PAGE_SHELL 顶距 23px = **80px = sticky 锚点 `top-20`**（内容顶与锚点对齐，无跟随区 抖动修复）；底部余量 2rem；工具型合计 `7rem + 1px`（SIDEBAR_STICKY_SCROLL 的 max-h = 锚 80px + 底余量 32px）。

### 2.1 侧栏滚动策略（官方定稿）

| 侧栏类型 | PageLayout sticky | 场景 | 策略 |
|----------|------|------|------|
| **导航型** | `"nav"` | 设置页左导航、组织设置左卡、用户主页左卡、首页 Top 仓库、About/metadata | `sticky top-20`（距 topbar 底 23px 间隔），超高时**底部裁切**（官方行为；导航内容短，正常视口不超高） |
| **工具型** | `"tool"` | 过滤栏（可折叠）、blob / edit / new 文件树 | `sticky + max-h 扣全高 + 内部 overflow-y-auto`（简化：原 blob 树通底 `"fill"` 并入本态，树底留 32px 余量） |
| **随内容滚动** | `"none"` | blob symbols/outline 面板 | 不 sticky，随内容滚动 |

### 2.2 五大禁则（代码审计红线）

1. ❌ 外层容器**禁止 `py-*`**（底部 padding 滚到底推 sticky）
2. ❌ 导航型侧栏**禁止 `max-h`/`overflow-y-auto`**（制造嵌套滚动条——侧栏内滚而非页面滚动）
3. ✅ **必须 `items-start`**：单层 sticky 侧栏作 grid item 时，必须 `items-start`（`GRID_2COL_*` 已内置）——否则 item 被 stretch 拉满行高 → sticky 元素=父容器高度 → **无吸附空间 → sticky 失效/滚出**（本次问题根因之一）
4. ❌ 禁止手写散落 `sticky`/`top-14`/`top-20`/`max-h-[calc(...)]` 类名（必须用共享常量）
5. ❌ 内容区**禁止裸放**（必须 `min-w-0` + `CONTENT_FILL`，防长内容撑破 grid / 短内容无吸附空间）

---

## 3. 响应式规则（动态响应）

### 3.1 断点体系

| 断点 | 宽度 | 行为 |
|------|------|------|
| 默认（<768px） | 手机 | 单列堆叠：侧栏折叠到内容上方/下方（按语义）；TopBar 图标组保留核心项 |
| `md`（≥768px） | 平板 | 两栏生效（`md:grid-cols-[…_1fr]`）；blob 文件树 240px |
| `lg`（≥1024px） | 桌面 | 三栏/加宽（`lg:grid-cols-[300px_1fr]`）；blob 文件树 280px；仓库 About 显示 |
| `xl`（≥1280px） | 宽屏 | 内容区限宽 `max-w-230`（设置页）；宽内容自然延展 |

### 3.2 各页面响应矩阵

| 页面 | 默认 | md | lg |
|------|------|----|----|
| 设置页（Settings/Org） | 单列（左栏移到内容上方） | 两栏 `240px_1fr` | 同 md |
| 用户/组织主页 | 单列 | 两栏 `260px_1fr` | 同 md |
| 仓库页 | 单列（About 在内容下） | 同默认（About 显示但精简） | 两栏 `flex-row` + About 右栏 |
| blob 页 | 单列（树在上） | 两栏 `240px_1fr`（About 隐藏） | 两栏 `320px_1fr`（**树宽对齐官方 B 型 320px**） |
| 首页 | 单列（热点在中栏下） | 同默认 | 三栏 `300px_minmax(0,1fr)` |
| 搜索页 | 单列 | 同默认 | 同默认 |

### 3.3 滚动行为

- **页面滚动**：单一滚动容器 = 视口（body）。侧栏 sticky 随页面滚动吸附，不产生第二个滚动条（导航型）。
- **工具型内部滚动**：文件树等独立滚动区（`overflow-y-auto`），滚动条细化（index.css 全局样式，8px 圆角）。
- **TopBar**：始终 sticky 置顶，不随滚动收起（当前无折叠/吸顶动画，见 §5）。

---

## 4. 组件规范（具体定义）

> 所有组件优先从 `web/src/components/ui/`（shadcn 生成）复用；业务组合组件在 `web/src/components/`。
> 颜色一律走 CSS 变量（`bg-primary`/`text-muted-foreground` 等），**禁止硬编码色值**。

### 4.1 基础组件（shadcn/ui）

| 组件 | 文件 | 使用规范 |
|------|------|----------|
| **Button** | `ui/button.tsx` | variant：`default`（主操作）/`outline`（次操作）/`ghost`（工具栏）/`destructive`（危险）/`link`（行内链接）；size：`default`（h-9 px-4）/`sm`（h-8）/`icon`（size-8 纯图标）；危险操作配 `AlertDialog` |
| **Badge** | `ui/badge.tsx` | 状态/元数据标签；variant：`default`（主）/`secondary`（次要）/`outline`（scope 徽章等代码串）；`font-mono text-xs` 用于 scope/语言 |
| **Card** | `ui/card.tsx` | 内容块容器；`CardContent` 默认 p-4；hover 反馈用 `hover:bg-accent/50 transition-colors`（如 RepositoryCard） |
| **Input** | `ui/input.tsx` | 单行输入；h-9；表单配 `Label` + `mb-1.5 block` |
| **Textarea** | `ui/textarea.tsx` | 多行输入（描述、issue 正文、GPG 公钥粘贴等） |
| **Label** | `ui/label.tsx` | 表单标签；`className="mb-1.5 block"` |
| **Avatar** | `ui/avatar.tsx` | 用户/组织头像；`size-8`（列表）/`size-10`（卡片）/`size-14+`（主页）；`AvatarFallback` 取 login 前 2 字符大写 |
| **Skeleton** | `ui/skeleton.tsx` | 加载占位；列表用 `h-4 w-…` 按内容形状；全页加载用 `h-64 w-full` |
| **Tabs** | `ui/tabs.tsx` | 分区切换（仓库六 tab 用自定义 border-b 样式，见 RepoHeader） |
| **Switch** | `ui/switch.tsx` | 布尔开关（设置项） |
| **Dialog** | `ui/dialog.tsx` | 弹窗（创建仓库/文件编辑/新增密钥等）；`DialogFooter` 放主操作按钮 |
| **AlertDialog** | `ui/alert-dialog.tsx` | **危险操作确认**（删除/退出组织/变更仓库名）；必须用于破坏性操作 |
| **DropdownMenu** | `ui/dropdown-menu.tsx` | 下拉菜单（Create new、分支切换、更多操作）；内容超高时 `max-h-80 overflow-y-auto` |

### 4.2 业务组合组件（`web/src/components/`）

| 组件 | 用途 | 规范 |
|------|------|------|
| **Logo** | 站标 | TopBar 左侧；`PureGit` 文本 + 图标 |
| **RepoHeader** | 仓库级头部 | 仓库名行（头像+名称+可见性 Badge+Star/Fork 最右）+ 六 tab（Code/Issues/PRs/Discussions/Releases/Projects + Settings 门控）；tab 高亮 `border-b-2 border-foreground`；**tab 计数**（官方实测 Issues/PRs/Security 带数）：Issues/PRs 显示 open 数（GraphQL totalCount 精确，REST 降级 issues 用 open_issues_count 近似、pulls 独立补查）、Security 显示 GHSA 总数（匿名可读），有数据即显示含 0，`formatCount` 压缩（5k/2.4k/43） |
| **RepositoryCard** | 仓库卡片 | `Card + hover:bg-accent/50`；首行 BookOpen 图标+full_name（primary 链接 truncate）；描述 line-clamp-2；语言圆点+star+fork 数；topics 前 3 个 secondary Badge |
| **StarForkButtons** | watch/star/fork 三按钮组 | **官方三按钮结构**：Watch（dropdown：Unwatch/Watch/Ignore，当前态 `bg-accent` 高亮，文案 Watch/Watching/Ignoring）/ Star（已 star 用 default variant+填充星）/ Fork；数字统一 `formatCount` 官方简写（1234→1.2k/123456→123k）；未登录弹登录引导；登录态实时切换（watch=REST PUT /subscription、star=GraphQL 主模式+REST 冗余、fork=REST POST /forks） |
| **WriteGate / PermissionGate** | 权限门控 | 写操作 UI 灰化/隐藏（只读模式）；permission 维度控制（org/account 等） |
| **FileTree** | 文件树 | 工具型侧栏（SIDEBAR_STICKY_SCROLL）；文件夹可展开；当前文件高亮 |
| **RepoAbout** | About 分区侧栏（重构：**官方分区平铺，去卡片**） | 仓库右侧栏 `lg:w-72`（官方 320px pane 语义）；与 Issue 详情右栏一致的分区风格（`space-y-5` + h3 小标题 `text-sm font-semibold`）。分区顺序对齐官方 2026-08：**About**（描述/网站/**TopicTag pills** `rounded-full bg-primary/10 text-primary`/**Resources** 根文件链接（Readme→根页，license→blob，CoC/Contributing/Security→blob，`fetchRootFiles` 探测存在才显示，探测失败隐藏非必须项）/**纵向统计** stars·watching(`subscribers_count`)·forks/**Report repository** 链官方）→ **Releases**（h3+计数徽标；最新 release 卡：绿色 Tag 图标+tag_name+`Latest` 绿徽标+`fmt` 日期，点击进 releases 列表；`+ {N-1} releases` 入口；无 release 显示 No releases published）→ **Packages**（无发布占位，链官方）→ **Contributors**（计数行；头像网格未做——决策省请求）→ **Languages**（进度条+图例；搜索页暂不支持 `l=` 过滤，图例不链接）。**语言成分进度条（官方规则）**：只显示 ≥1% 的语言（LANG_COLORS 5 色循环），**被过滤的 <1% 小语言合并为灰色 `bg-muted-foreground/30`「Other」段**（进度条 + 图例都补足 100%），各段 hover title 显示精确百分比。数据：`fetchLatestReleaseSmart`（GraphQL totalCount+nodes(first:1) 一次查询 / REST per_page=1 一次请求，替代原 `fetchReleasesCountSmart`）+ `fetchContributorsCount` + `fetchRootFiles` |
| **NavPageShell** | 用户级导航页外壳 | issues/pulls/repos/gist/notifications 共用；标题行 + 可选 action（右对齐） |
| **CommentsSection** | issue/PR 评论区（官方结构） | `divide-y overflow-hidden rounded-lg border bg-card` 容器；评论头 `border-b bg-muted/50 px-4 py-2`（UserAvatar size-5 + 作者 + 时间 `fmt` + 编号 `#{i+1}` font-mono + hover 复制链接按钮 `opacity-0 group-hover:opacity-100`）；正文 `prose prose-sm p-4 dark:prose-invert`（MarkdownView）；底部发表框（WriteGate 门控：`canWrite` 显示编辑器 / 只读提示 / 未登录登录按钮）——编辑器 = **MarkdownEditor**（P3），提交成功后 `key` 重建清空，`onCommentAdded` 追加评论刷新计数 |
| **MarkdownView** | GitHub 风格 Markdown 渲染（README/issue/PR/release/评论统一；**换用成品库**） | 封装**成品库 `@uiw/react-markdown-preview`**（GitHub 风格开箱即用：标题锚点 rehype-slug+autolink / GFM 表格·任务列表·脚注 / prism 代码高亮 + `.copied` 复制按钮（hover 显示）/ **GitHub Alerts**（内置 remark-github-blockquote-alert）/ 深色模式 `[data-color-mode]`）；保留 GitHub 特有语法（issue/PR 刚需）：**@mention / #issue / :emoji:**（`githubSyntax` remark 插件 → link / g-emoji）；`urlTransform` 相对路径解析（src→rawBase、href→github blob）+ 协议白名单；components 丢弃 script/style/iframe/object/embed；外链 `target=_blank rel=noopener noreferrer nofollow`；主题经 `wrapperElement[data-color-mode]` 跟随 `useIsDark`；custom.css 覆盖背景透明（跟随站点 bg-card，双类选择器压过库变量）＋标题 `scroll-margin-top:96px`（sticky 面包屑补偿）。**依赖**：`github-markdown-css`/`unified` 已移除；vite `resolve.dedupe: ['react','react-dom']` 防库内 React 副本（Invalid hook call）。详见 research/35 |
| **MarkdownEditor** | Markdown 编辑器（评论/新建 issue/PR 正文统一，P3） | **非受控 textarea**（defaultValue + onChange 同步；清空用 key 重建）+ `@github/markdown-toolbar-element` 12 按钮（md-bold/italic/strike/quote/code/link/image/list/ordered/task/mention/ref）+ `@github/text-expander-element` 补全（`: ` emoji node-emoji / `@ ` 贡献者 contributors API / `# ` issue 列表）+ Write/Preview（SegmentedControl tab variant）+ Ctrl+Enter（onSubmit）；边框容器 `rounded-lg border bg-card`；补全菜单 shadcn 下拉样式（bg-popover shadow-lg） |
| **SegmentedControl** | 分段控件（设置选项/权限模式/周期/Write-Preview） | 统一 8 处重复；`variant="box"`（容器式：`rounded-lg border bg-muted/40 p-1`，激活 `bg-background shadow-sm`）| `variant="tab"`（轻量：无容器，激活 `bg-accent`）；`size="sm"/"xs"`；选项 `{value, label, icon?}`，泛型 `T extends string` |
| **UserAvatar** | 用户头像（统一 13 处裸 img） | `ui/avatar` 封装；圆形 + after 边框 + 首字母回退；尺寸经 className（size-5~10） |
| **LangDot** | 语言色点 | linguist 色表（40+ 语言官方色），未知回退 `bg-muted-foreground/50`；`size-2` 默认 |
| **DiffView** | PR Files changed diff（P2 重构） | **官方 3 列表格**（旧行号/旧代码/新行号/新代码，非 CM6）；add 绿（chart-1 12%）/ del 红（destructive 12%）行背景 + `+/-` marker；hunk 头跨 4 列 + **Expand**（GraphQL 拉 base/head raw → jsdiff 全量对比）；行号锚点 `#diff-{fileHash}L/R{n}`（点击 replaceState + `selected-line` 高亮）；**行内评论**（add/ctx 行 hover `[+]` → MarkdownEditor 表单 → POST review comments）；语法高亮暂缓 |

### 4.3 代码框（CodeMirror 6 统一：编辑 + 只读展示 全面迁移）

> 所有代码展示/编辑场景统一为 **CodeMirror 6**（与 GitHub 官方 blob 编辑器同源），Shiki 高亮已移除。

- **工厂**：`lib/codemirror.ts` 的 `createCmEditor`（扩展组装：行号/语法高亮/缩进/换行/只读/diff 装饰）
- **语言检测**：`lib/languages.ts` `inferLang(path)`——**文件名 > 扩展名（linguist-languages 全量映射）> 冲突默认**（.h→c、.m→objective-c 等），回退 `text` 纯文本；友好显示名 `languageDisplayName`；已装 16 种 CM6 语言包（js/ts/jsx/tsx/json/md/yaml/css/html/python/sql/java/cpp/rust/go/php）。**官方实测：编辑器工具栏无语言徽章**（无高亮时也不显示），语言仅由路径隐式推断（对齐 github.com blob 编辑器）。
- **组件**：
  - `CodeEditor`：编辑态 CM6（可写）+ 预览态 CM6 只读；头部官方同款三下拉 **Indent mode**（Spaces/Tabs）、**Indent size**（2/4/8）、**Line wrap**（No wrap/Soft wrap），切换即时重建
  - `CodeView`：只读展示（`readOnly` + `editable:false`，保留选择/复制/搜索）；支持 `diffLines` 行背景装饰（add 绿 / del 红）
- **主题（修复「仅两色」+ 扩至 9 套）**：code-theme `preview.tokens` **完整 token 调色板**（每主题明/暗各一套 `HighlightTokens`：keyword/string/number/function/type/comment/property 7 色，与各主题真实配色一致）→ `EditorView.theme` + `buildHighlightStyle`（HighlightStyle 逐一映射 tag）。**9 套主题**：GitHub / VS Code / One Dark / Solarized / Material / Catppuccin / Gruvbox / **Dracula** / **Tokyo Night**（调研流行配色新增，shiki 内置 id 配对：dracula↔min-light、tokyo-night↔tokyo-night-light）。**此前缺陷**：`buildHighlightStyle` 只收 accent/fg 二色，所有 token 堆叠 → 视觉仅 2 色；现已按每主题真实 token 色修复（github-dark 实测 7 色）
- **使用场景**：blob 页（CodeView）、Gist 详情（CodeView）、Preferences 示例卡（CodeView）、PR Files changed diff（CodeView + diffLines）、文件编辑/新建（CodeEditor）
- 工具栏：Raw 查看/复制/下载（ButtonGroup 紧凑图标）；`overflow-x-auto` 防长行溢出。
- **官方行为复刻（Phase 8）**：
  - **行号点击选行**：点击行号选中整行（**含行尾换行**，`lineNumbers({ domEventHandlers })`）；Shift+点击从当前 anchor 扩展选区；编辑/只读均支持（`selectLineOnClick` 默认 true）。选区背景为**半透明蓝**（`color-mix(var(--primary) 30%)`，GitHub 官方同款；覆盖 CM6 默认浅灰/浅紫，聚焦/非聚焦一致）
  - **Symbols 面板（官方 blob 右侧大纲 + Definition/References 详情视图）**：blob 页文件头新增 **code-square 图标按钮**（官方 `Open symbols panel`，操作栏**最右**，官方实测：Raw 组 → Edit/More-edit → symbols 顺序）→ 内容区展开**代码右侧列 300px**（官方右侧抽屉 325px，非中间 3 栏——浏览器实测修正）。符号提取 `lib/symbols.ts` `collectSymbols`——**遍历 CM6 的 Lezer 语法树**（零依赖零 API，Gitea 同方案；官方用 web worker + tree-sitter 不公开）：`KIND_BY_NODE` 节点名映射（JS/TS `FunctionDeclaration`/`ClassDeclaration`/`VariableDefinition`…、Python `FunctionDefinition`、Java `MethodDeclaration`、Go `FuncDecl`/`TypeSpec`、Rust `FunctionItem`/`StructItem`… 16 语言），取名字子节点 → `{label, kind, line}`。**⚠️ 惰性解析坑（实测）**：CM6 lezer 解析是**惰性/增量**的，`syntaxTree(state)` 只含可视区已解析部分（大文件仅前 ~100 行）→ 必须 `ensureSyntaxTree(state, doc.length, 1000)` 强制同步解析全文（`fullTree` 封装），否则只提取开头几个符号。**点击 symbol → 官方详情视图**：高亮定义行（整行选区 dispatch + URL hash `#L{n}`）+ 面板切换为 **All symbols 返回 + kind/名称标题 + `Definitions in this file`（定义行）+ `References in this file`（引用行列表，行号+行文本，点击跳转）+ `Search for this symbol` 链接**。引用提取 `collectReferences`——**全文正则扫描符号名 + lezer 树 `resolve` 裁决**（排除注释/字符串/正则内误报；lezer 的 JSX 标签名是节点**字段**而非子节点/文本，逐节点提取不可行，故用全文扫描覆盖 JSX/identifier/属性访问全形态）。CodeView 新增 `onSymbolsChange`（符号列表）+ `onViewReady`（CM view 供点击 dispatch/提取引用）。
  - **折叠符号（改 lucide chevron）**：`foldGutter({ markerDOM })` 自定义 —— 行号右侧 **lucide chevron SVG**（12px，与文件树展开箭头同款：展开 `chevron-down` / 闭合 `chevron-right`，低对比，hover 高亮 + 可点击），CSS 位于 custom.css `.cm-foldMarker`
  - **Outline 面板（官方 blob 页 markdown 目录索引）**：markdown 文件（.md/.markdown/.mdown/.mkd/.mdx）blob 页显示**渲染视图**（MarkdownView，非代码高亮）+ 操作栏最右 **list-unordered 图标按钮**（官方同款，替代 symbols 按钮）→ 右侧 **Outline 面板 300px**（官方 324px）：`Outline` 标题 + 关闭 + **Filter headings 过滤框** + 标题树（**层级缩进** pl=(level-1)*12 + `#` 前缀 + 文本）。标题提取 `lib/markdown-outline.ts` `extractOutline`——逐行解析 ATX 标题（排除围栏代码块），slug 用 **GitHub slugger 同款规则**（github-slugger v2：`/[^\p{L}\p{N}\-_ ]/gu` 移除 + 空格逐个转 `-` + 小写 + trim；`React + TypeScript + Vite` → `react--typescript--vite`，中文保留；重复标题自动 `-1/-2`）。**点击 → 立即跳转**（官方锚点同款，非 smooth）：`scrollIntoView` + URL hash `#id`；标题元素 `scroll-mt-24` 补偿 sticky 面包屑。MarkdownView 新增 `headings` prop（渲染后按文档序给 h1~h6 赋 id，保证与 outline 列表一致）。
  - **markdown 成品库渲染（换用 `@uiw/react-markdown-preview`，详见 research/35）**：MarkdownView 封装成品库（GitHub 风格：标题锚点/表格/引用/代码高亮+复制/GitHub Alerts/任务列表/深色模式开箱即用），**放弃官方 DOM 逐项复刻**（markdown-heading/anchor/highlight/复制按钮等自研适配全部删除，维护成本高且随库版本迭代耦合）。**主题跟随**：库按 `[data-color-mode]`（wrapper 属性，由 useIsDark 跟随站点 .dark）切换自身变量；custom.css 用**双类选择器** `.wmde-markdown[data-color-mode].wmde-markdown`（0,3,0 压过库的 `[data-color-mode] .wmde-markdown` 0,2,0）覆盖 `background-color: transparent` 跟随站点背景。**表面色完全跟随站点（用户决策：去 GitHub 内置色板）**：库在 `@media (prefers-color-scheme)` 内 `.wmde-markdown`（0,1,0）/ `.wmde-markdown[data-color-mode*='dark']`（0,2,0）定义 GitHub 色板（canvas #0d1117/#fff、fg #c9d1d9/#24292f 等）与站点 zinc 主题色温不符（表格行/代码块偏蓝黑）→ custom.css 覆盖全部**表面变量** → 站点变量（canvas-default→transparent 跟随卡片、canvas-subtle→--muted 代码块、fg-default→--foreground、fg-muted→--muted-foreground、border→--border、neutral-muted→--muted 实色 行内 code、accent-fg→--chart-1 蓝链接、alerts 语义映射 note→chart-1/tip→chart-2/important→chart-4/warning→chart-3/caution→destructive，站点无黄 warning 用灰蓝中性化）；**保留 `--color-prettylights-syntax-*` 语法 token**（代码高亮必需）。**色度统一（用户反馈：链接与站外不一致，测试页全元素实测）**：差异——链接 chart-1 蓝 vs 站外 `--primary` 近白 / 行内 code 透明 12% vs 站外实色 / 表头全透明 vs 站外 muted / alert 全透明 vs 官方 subtle 底 / checkbox accent auto → custom.css 追加：`.wmde-markdown[data-color-mode] a{color:var(--primary)}`（0,2,1 压过库 `.wmde-markdown a` 0,1,1；hover 下划线库 `a:hover` 已带）、`th{background-color:var(--muted)}`、`input[type=checkbox]{accent-color:var(--chart-2)}`、alert 5 类各补 `--color-*-subtle` 12% 底（accent/success/done/attention/danger）。**保留的定制**：`githubSyntax`（@mention/#issue/emoji）、`urlTransform`（相对路径 + 协议白名单）、危险标签丢弃、外链安全属性。**标题 id**：库 rehype-slug 生成（github-slugger 规则），与 outline 面板 `extractOutline` 一致；custom.css 加 `.wmde-markdown h[id]{scroll-margin-top:96px}`。
  - **blob 头部三行结构（官方同款；D12 定稿 + D14/D15 滚动细节）**：① **面包屑行 sticky**（`sticky top-14`，仅面包屑 repo/文件名 + Copy path + **Top 按钮** + 折叠态 `[展开树][分支][Go to file]`）；② **Latest commit 行**（**中间**，透明无边框 `px-3 py-2`：头像+作者+message+sha+时间+History，官方 LatestCommit 同款）；③ **操作头 = 内容容器顶部一体**（官方 BlobViewHeader `#repos-sticky-header`：**sticky** `top-[calc(3.5rem+2.75rem)]`（100px = 面包屑底，展开/折叠面包屑均 45px 实测）粘于面包屑下、**未粘住自带圆角顶 `rounded-t-md` + 全边框 + `bg-muted` 实色底，粘住后圆角 0**（官方 Box_1_stickied `border-radius:0` 同款，scroll 监听 `rect.top<=102` 判定 `headerStickied`），与内容容器 `rounded-b-md border border-t-0 bg-card` **无缝拼接（gap 0）** 成一体容器；中间分隔线 = 操作头 border-top。**粘住时面包屑 `border-b-transparent`**（官方 outerWrapperStickied 无底边框——避免面包屑 border-b 与操作头 border-top 双线；border-b-transparent 无 border-width，面包屑底 = 100 与操作头顶 100 无缝）。**面包屑背景（D15）**：未粘住 `bg-background/95 backdrop-blur`（顶部视觉），**粘住后切实色 `bg-background`**（官方 outerWrapperStickied 实色 bgColor-muted 同款——半透明+blur 会让滚过的内容从下方透出形成「半透明影印」，实测确认是 CSS 半透明问题而非 overflow）。**Top 按钮（D15）**：在**右侧 `ml-auto` 容器**（折叠态 `[Go to file][Top]`，展开态 `[Top]`），官方 GoToTopButton 最右同款（实测 right=crumb right-16px padding）。**⚠️ overflow-hidden 坑（实测）**：内容容器**禁止 `overflow-hidden`**（会破坏内部 sticky——sticky 相对 overflow 容器滚动而非视口，滚出即消失）；一体感靠**操作头/内容各自圆角拼接**而非外层 overflow 裁剪（官方 Box_1 同款 `border-radius 6px 6px 0 0`）。**SegmentedControl**：markdown 文件显示 **Preview / Code** 两 tab（官方 Preview/Code/Blame；**Blame 未实现舍弃**），Preview=渲染视图（+Outline 面板），Code=CM 代码视图；代码文件无 tab（仅 Code）。**舍弃的官方按钮**：space/copilot/agent（Copilot 生态）与 Blame。**⚠️ 修正记录**：D9 曾把操作组并入面包屑单行、D11 改「操作头非 sticky 随内容滚走」、又改「独立 sticky 悬浮框（mb-2 分离）」（均偏离官方——用户两次否定「操作栏应该在预览页面里面的顶部」「为何是分离开的」）→ **D12 定稿**：commit 行移中间 + 操作头 sticky 并入内容容器顶部无缝一体；**D14**（用户反馈「滚动后圆角/附着/对齐差异」）→ 粘住后操作头圆角 0 + top 102→100 贴住面包屑底 + 面包屑粘住隐藏底边框；**D15**（用户反馈「Top 应在最右」「内容半透明影印」）→ Top 移右侧 ml-auto 容器 + 面包屑粘住切实色背景（实测 README/package.json 两场景）。
  - **blob 布局多态（官方逐状态实测，详见 research/33）**：官方 blob 页 = `d-flex flex-row`（左树 pane 320px 可折叠 | 内容 flex-1 | 右面板 symbols/outline 344px 可开关）→ 4 态：①树展开+面板关=两栏 1:4（树 320+内容）；②树展开+面板开=三栏 1:3:1（+右面板 344）；③树折叠+面板开=两栏 4:1（折叠头+内容+面板）；④树折叠+面板关=单栏（内容全宽）。**折叠态头部（对齐官方单行）**：官方折叠态 = sticky **单行 48px**（`[Files展开][分支][面包屑][Copy path] | [Go to file][操作]`，无独立工具栏行）→ 本地原「独立折叠工具栏行（mb-3 border 卡）+ sticky 两行」3 行结构废除，改 **TreeCollapseCtx context**（RepoCode Provider）→ BlobPage 单行 sticky 内渲染 `[展开树按钮][BranchPicker 分支][面包屑][Copy path]` + 右侧 `[GoToFileInput][操作组]`（展开态仅面包屑+操作组，树 pane 自带 Files 标题+Collapse）；**已复刻**：`RepoCode` 持 `treeCollapsed`（折叠单栏/展开 `lg:grid-cols-[320px_1fr]`）；`FileTreeSidebar` 删 collapsed 分支（仅展开态：Files 标题 + Collapse 按钮 + `BranchPicker` + Go to file + 树）；`BranchPicker`/`GoToFileInput` 抽取复用；BlobPage 右面板（symbols/outline 300px）与树折叠正交（内容区自动变宽）。
  - **gutter 事件实现原理**：CM6 gutter 事件经 `.cm-gutter` 元素冒泡监听，`view.lineBlockAtHeight(y - view.documentTop)` 反查行（坐标换算）；handler 返回 true 触发 `preventDefault`

### 4.4 列表与翻页

- **列表加载**：列表页统一 `per_page=30`（参数化）；加载中 `Skeleton`，失败显示错误条 + 重试，空数据显示 empty 文案（i18n）。
- **翻页（定稿）**：**共享 `Pager` 组件**（`web/src/components/Pager.tsx`，shadcn Pagination + 页码窗口 ±2 + 省略号，仅 >1 页渲染）——核心页（搜索结果/仓库 Issues/Pulls/Profile 仓库·Star）页码分页；我的列表（Issues/Pulls/Gists/通知/Releases 左栏）「加载更多」按钮（批次拉满判断 hasMore + 追加去重）；Top 仓库 8→20→全部展开（满 100 追加 REST page=2）；数量统计（Releases/Contributors）用 `per_page=1` 读 Link header 末页，避免全量拉取。
- **搜索框（定稿）**：`SearchInput`（`web/src/components/SearchInput.tsx`）——左搜索图标 + 输入框 + Clear，`size="md|lg"`；**去语法高亮**（用户拍板「保持纯粹」）；`RepoSearchInput` 委托它（仓库 Issues/Pulls/Discussions 列表搜索框）；搜索页大框 lg。
- **相对时间**：`relativeTime()` 函数（刚刚/分钟/小时/天前）；日期用 `toLocaleDateString()`。

### 4.5 状态三态规范

| 状态 | 实现 |
|------|------|
| **Loading** | `Skeleton` 占位（不显示「加载中…」文本残留）；列表形状对齐内容 |
| **Error（两级 定稿）** | **整页级致命错误**（页面无内容可显示：404 资源不存在 / 未登录限流 / 5xx）→ **全局错误页**（`web/src/components/ErrorPages.tsx`）：路由级 `errorElement`（`RouteErrorPage`，位于 `App.tsx`）分类分发——404 → `NotFoundPage`（场景：**可复用 `NotFoundSceneLayout` 组件**——**粒子背景 `fixed inset-0` portal 到 body 铺满全视口（z-[-1] 不挡交互）**，内容层 PAGE_SHELL 单栏居中（`children` 插槽传入标题/搜索框/链接，`scene` prop 控制是否渲染中央场景）；中央场景 = **animejs v4 叙事「寻物侦探」**——描边 GitHub 小猫居中偏下**左右歪头张望（rotateZ 倾斜 + translateX 平移，纯 2D 无翻身）**，手臂举放大镜（lucide Search，手柄朝身体、贴右肩下方）**骨骼联动 2D 横移摆动**（杠杆位移 ×1.6 + 惯性延迟 + 手腕 outBack 弹性，拟真物理态）；**背景粒子重生系统**：20 光点 + 12 符号（问号/PR/分支/repo/代码/星标，lucide 描边图标）**纯随机位置**淡入→停留→淡出→随机重生（重生排除已占位避免同点重叠；生成算法简单高效，无排除计算）；**中央内容区用主题色径向渐变遮罩**——`.nf3d-content-mask` 为**自包裹 wrapper**（包住 scene + children，尺寸=内容实际包围盒，shrink-to-fit 天然自适应任意 children 高宽），渐变百分比相对 wrapper 自身，中央 62% 不透明 `--background` 盖住粒子、92% 透明露出粒子，人物动画区与子 DOM 区零视觉重叠（聚光灯式留白焦点；`NotFoundScene.tsx` + `.nf3d-*`，`prefers-reduced-motion` 隐藏粒子静态展示）。下接站内搜索框 + 返回首页/GitHub Support 链接，兼作路由 `path="*"` 兜底）、限流 → `RateLimitPage`（未登录登录引导 + 聚光灯；已登录稍后重试，footer 额度实时显示）、其他 → `ErrorPage`（status 徽标 + 友好文案 + **`<details>` 可展开原始 JSON 响应体**）。页面模式：catch 后 `setError(normalizeApiError(e))`（`ApiError` 增强：`isNotFound/isRateLimit/isServerError` 分类 + `rawBody/parsed`），render 中 `throw`（或 JSX 内 `<ThrowError err={error} />`）冒泡至 errorElement。**两个实测坑（修复）**：① errorElement 替换发生错误的 route 层级 → `RouteErrorPage` 自备完整 chrome（Nav + main + Footer），避免 404/限流页变裸页面；② errorElement 渲染后编程式 `navigate()` URL 变但内容卡错误页 → `RouteErrorPage` 监听 `location.key` 变化强制 `window.location.reload()`（Link 导航正常，navigate 触发整页刷新重置）。**局部区块错误**（表单/评论/列表子区/可重试区块）→ 保留 **`InlineError`** 组件（`variant=error` 红卡 / 限流自动 `warning` 琥珀卡 / `size="sm"` 紧凑）+ `apiErrorMessage()` 提取 + toast 提醒（`toast.ts`：限流/模式切换 30s 节流）；**限流文案（定稿）**：`GitHub API 请求过于频繁或超出官方限制（N次/小时）`（N 取 `x-ratelimit-limit`，不做重置倒计时）——未登录追加 `…，登录后可获得更高配额（5000 次/小时）` 并触发登录聚光灯（30s 节流） |
| **Empty** | 明确空态文案（i18n：`*.empty` 键），不显示空白 |

> **错误分层原则**：整页无内容（仓库/用户/详情/列表页加载失败）→ 全局错误页（页面被替换，导航即恢复）；页面主体正常但局部失败（feed/trending/搜索/评论/表单）→ 局部 InlineError + 重试/占位。不做「全站 92 处 InlineError 全改」——局部错误保留上下文内联语义。

### 4.6 新建类整页（复刻官方路径 定稿）

> **决策**：新建仓库/issue/PR 一律使用**整页**（`/new`、`/{owner}/{repo}/issues/new`、`/{owner}/{repo}/pulls/new`），**不使用弹框**——对齐官方路径/行为；原弹框组件（WriteActions、NewRepoDialog 弹框版）已删除。

| 页面 | 路径 | 规范 |
|------|------|------|
| **NewRepositoryPage** | `/new` | `PAGE_SHELL` + `max-w-2xl`；Owner 下拉（个人+组织，Avatar+login）+ 仓库名/描述 + Public/Private 卡片（`border-foreground bg-accent/40` 选中态）+ README 初始化 Switch；创建按钮右对齐（`flex justify-end`）；成功后 `navigate(\`/${full_name}\`)` |
| **NewIssuePage** | `/{owner}/{repo}/issues/new` | `PAGE_SHELL` + `max-w-3xl`；返回链接（ghost sm）+ 标题（2xl）+ 标题 Input + Markdown Textarea（rows=8）+ 提交按钮 + 「提交至 owner/repo」提示；成功后跳 `/${owner}/${repo}/issues/{number}` |
| **NewPullRequestPage** | `/{owner}/{repo}/pulls/new` | `PAGE_SHELL` + `max-w-3xl`；Base（默认 `main`）/Compare 双列（`sm:grid-cols-2`）+ 标题 + 正文；成功后跳 PR 详情 |
| **FileEditorPage（新建/编辑文件 对齐官方实测）** | `/{o}/{r}/new/{branch}/*`（新建）/ `/{o}/{r}/edit/{branch}/*`（编辑） | `PAGE_SHELL` + `max-w-4xl`；面包屑（repo / 目录段可点跳 tree / **文件名输入框**——输入 `/` 自动切目录段、最前 Backspace 合并、空文件名纯文本无高亮）`in {branch}`；右上角 `Cancel changes`（ghost，navigate(-1)）+ `Commit changes…` 按钮（禁用于空文件名）；编辑区 `CodeEditor`（min-h-80）。**Commit 弹 Dialog**（官方实测结构）：Commit message（新建预填 `Create {file}`）/ Extended description + **Direct commit or PR 分组 Radio**（直接提交到 `{branch}` 默认 / 新建分支 `{login}-patch-1` 输入框）；提交逻辑：直接 → `updateFileContent(branch)` 跳 `blob/{branch}/`；新建分支 → **先 `createBranch`（POST /git/refs，官方 contents API 无 `new_branch` 参数——实测被静默忽略仍提交原分支，见 api-compat §4.15）→ 再 `updateFileContent(newBranch)`** 跳 `blob/{newBranch}/` |
| **权限门控（三页共用）** | — | 未登录 → 「使用 GitHub 登录」引导（`login({ mode: "write" })`）；只读 → 「切换完全控制」（`login({ mode: "write", redirect: 当前路径 })`）；表单提交按钮随状态禁用（`disabled={submitting || !title.trim()}` 等） |
| **入口** | — | Issues/Pulls 列表页按钮 `<Button size="sm" asChild><Link to={绝对路径}>`（**必须绝对路径**）；topbar CreateNewMenu：New repository → `/new`，New issue/PR → RepoPickerDialog 选仓库 → `/{o}/{r}/issues|pulls/new` |

---

## 5. 动画与过渡规范

| 场景 | 规范 |
|------|------|
| **页面切换** | `page-enter`：fade + 8px 上移，0.28s ease（全局 `main > *` 自动播放；仓库 tab 切换用 `.page-enter` key 容器） |
| **hover 过渡** | 可点击卡片 `transition-colors`（如 `hover:bg-accent/50`）；图标按钮 `transition-colors` |
| **sticky** | 无折叠/吸顶动画（精简化，sticky 元素始终完整显示） |
| **下拉/弹窗** | Radix 默认动画（tw-animate-css）；时长 0.1-0.2s |
| **保存反馈** | 保存成功提示 3s 后自动消失（`setTimeout`） |
| **禁用清单** | ❌ 无必要的弹跳/缩放/轮播；❌ 页面级入场动画叠加（fade 与 slide 二选一） |

---

## 6. 文本与间距规范

| 项 | 规范 |
|----|------|
| 标题层级 | h1：`text-2xl font-semibold`（页面标题）；h2：`text-lg font-semibold`（区块标题）；区块描述：`text-sm text-muted-foreground` |
| 正文 | `text-sm text-muted-foreground`（次要）/ `text-sm`（主要） |
| 代码/scope | `font-mono text-xs` |
| 间距 | 栏间 `gap-8`；区块内 `gap-3`；表单 `gap-4`；紧凑组 `gap-2`；图标文字 `gap-1.5` |
| 卡片 | 圆角 `rounded-lg` + `border bg-card`；内容 padding p-4 |
| 截断 | 长文本 `truncate`/`line-clamp-2`；grid 内容列必须 `min-w-0` |
| 图标 | lucide；`size-4`（行内）/`size-3.5`（紧凑）/`size-8+`（大图标/头像场景） |

---

## 7. 验收清单（新页面/改布局/新组件后逐项核对）

- [ ] 布局：外层 `PAGE_SHELL`（无 `py-*`）；多栏 grid 用 `GRID_2COL_*`（含 `items-start`）；侧栏用 `SIDEBAR_STICKY`/`SIDEBAR_STICKY_SCROLL`；内容区 `min-w-0` + `CONTENT_FILL`
- [ ] 组件：全部用 `@/components/ui/` 与 `@/components/` 复用组件；无硬编码颜色；无手写重复基础组件
- [ ] 三态：loading（Skeleton）/ error（destructive 条+重试）/ empty（i18n 文案）齐全
- [ ] 响应式：默认单列堆叠；md 两栏；lg 三栏/加宽（对照 §3.2 矩阵）
- [ ] 滚动：矮视口（~500px）滚动到底，导航型侧栏 top 恒定（无 8px 偏移）；工具型侧栏内部滚动正常
- [ ] 动画：页面切换 `page-enter` 生效；无多余动画
- [ ] i18n：全部用户可见文案走 i18n 键（中英双同步）
- [ ] 权限：写操作经 WriteGate 门控（只读模式灰化）
