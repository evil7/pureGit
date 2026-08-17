/**
 * 布局规范（统一 Layout System）—— 详见 docs/design.md §1-§3 与 skill ui-layout
 *
 * 全局骨架（所有页面共享）：
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  TOP_BAR 全局导航  sticky top-0 z-50  h-14(56px)+1px      │
 * └──────────────────────────────────────────────────────────┘
 * ┌──────────────────────────────────────────────────────────┐
 * │  PAGE_SHELL  mx-auto max-w-7xl px-4 pt-[23px]            │
 * │  ┌───────────────┬────────────────────────────────────┐  │
 * │  │ SIDEBAR_STICKY │ CONTENT_FILL (min-w-0)            │  │
 * │  │ 240/260/280px  │                                   │  │
 * │  └───────────────┴────────────────────────────────────┘  │
 * └──────────────────────────────────────────────────────────┘
 *
 * 滚动根因（审计定稿，docs/design.md §2.2 五大禁则）：
 *   1. 外层底部 padding（py-*）→ 滚到底 grid 底部被推 → sticky 上移。⇒ 只留顶部间距。
 *   2. **sticky 失效双陷阱**：
 *      a. 单层 sticky 侧栏作 grid item 时若被 stretch 拉满行高 → 无吸附空间 → 失效。
 *         ⇒ grid 必须 `items-start`（GRID_2COL_* 已内置），让 item 高=内容高。
 *      b. 导航型侧栏加 max-h+overflow-y-auto → 矮视口制造嵌套滚动条（侧栏内滚而非页滚）。
 *         ⇒ 导航型纯 sticky（官方式，超高裁切）；仅工具型（文件树）用 SIDEBAR_STICKY_SCROLL。
 *   3. 内容超高无 CONTENT_FILL 兜底 → 短内容页 grid < 视口 → sticky 吸附空间不足。
 *      ⇒ 内容区加 CONTENT_FILL（min-h 撑满视口剩余）。
 *   4. **sticky 锚点必须与内容顶对齐（抖动修复）**：topbar 高 57px（h-14+1px），
 *      内容顶 = 57 + PAGE_SHELL 顶距 = 57 + 23 = 80px = `top-20`（80px）。此前 pt-8（32px）
 *      → 内容顶 89px > 锚 80px，产生 9px「先跟随、后吸附」区间，短内容页（设置页）滚动时
 *      侧栏上下跳动。⇒ PAGE_SHELL 顶距 23px，内容顶 = 锚点，滚动即吸附、无跟随区。
 *
 * 术语：nav 高 3.5rem（h-14）+ border-bottom 1px = 57px；sticky 锚点 top-20 = 80px（距 topbar 底 23px）；
 * 底部余量 2rem（32px）；工具型 max-h = 锚 80 + 底余量 32 = 112px = 7rem + 1px。
 */

/** 页面外层容器：居中限宽 + 顶部间距 23px（⚠️ 禁止 py-*，底部 padding 会引发 sticky 偏移）
 * 顶部 23px：topbar 57px + 23px = 80px = sticky 锚 top-20 → 内容顶与锚点对齐，
 * 滚动即吸附无「跟随→吸附」跳变（设置页抖动修复）。 */
export const PAGE_SHELL = "mx-auto max-w-7xl px-4 pt-[23px]";

/**
 * 导航型 sticky 侧栏（官方式 定稿）：
 * 纯 `sticky top-20`（距顶 80px，与 topbar 底 57px 留 23px 视觉间隔），超高时底部裁切（不做内部滚动，避免嵌套滚动条）。
 * 使用方式：`<div className={SIDEBAR_STICKY}><nav>…</nav></div>`
 * ⚠️ 父 grid 必须 `items-start`（GRID_2COL_* 已内置，否则 item 被 stretch 拉满 → sticky 无吸附空间失效）。
 */
export const SIDEBAR_STICKY = "md:sticky md:top-20";

/**
 * 工具型 sticky 侧栏（需内部独立滚动，如 blob 文件树）：
 * sticky + 限高视口内（扣 topbar 57px + 顶间隔 23px + 底余量 32px = 7rem+1px）+ 内部滚动兜底。
 * 仅用于内容可能超长且需独立滚动的工具面板；导航类侧栏一律用 SIDEBAR_STICKY。
 */
export const SIDEBAR_STICKY_SCROLL =
  "md:sticky md:top-20 md:max-h-[calc(100svh-7rem-1px)] md:overflow-y-auto";

/**
 * 内容区内工具型 sticky（blob symbols 面板等 E34g）：
 * 锚点 top-25（100px）与 blob 操作头（sticky top-25）对齐——symbols 面板与操作头同处内容区
 * 一行（flex items-start），滚动时两者一起吸附才不错位。
 * 与 SIDEBAR_STICKY_SCROLL（top-20 对齐内容顶，PageLayout 级侧栏）区分：
 * 本常量用于**内容区内部**的次级工具面板（对齐上方 sticky 操作头）。
 */
export const SIDEBAR_STICKY_SCROLL_HEAD =
  "md:sticky md:top-25 md:max-h-[calc(100svh-7rem-1px)] md:overflow-y-auto";

/**
 * 内容区填充：min-h 撑满视口内剩余高度（内容顶 80px + min-h 100svh-81px → 内容底 ≈ 视口底，
 * 留 1px 防滚动条临界出现/消失抖动）→ grid 高度 ≥ 视口，sticky 侧栏始终有吸附空间。
 */
export const CONTENT_FILL = "md:min-h-[calc(100svh-5rem-1px)]";

/** 两栏网格（内容列自适应）：侧栏 240px（设置/组织设置）。⚠️ items-start 必须保留：
 *  单层 sticky 侧栏直接作 grid item，若不 items-start 会被 stretch 拉满行高 → 无吸附空间 → sticky 失效。 */
export const GRID_2COL_240 = "grid gap-8 md:grid-cols-[240px_1fr] md:items-start";
/** 两栏网格：侧栏 260px（用户/组织主页） */
export const GRID_2COL_260 = "grid gap-8 md:grid-cols-[260px_1fr] md:items-start";
/** 两栏网格：侧栏 280px（blob 文件树） */
export const GRID_2COL_280 = "grid gap-3 md:grid-cols-[280px_1fr] md:items-start";
/** 两栏网格：侧栏 300px（首页，lg 起） */
export const GRID_2COL_300 = "grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start";

/**
 * 两栏网格 · 侧栏在右（内容列在左）：aside 280px（Issue/PR 详情右 metadata）。
 * ⚠️ 与上方 GRID_2COL_* 的「侧栏在左」区分——前者侧栏放第一个子元素（左），
 * 本常量侧栏放第二个子元素（右）。两种两栏语义不同，勿混用。items-start 同样内置。
 */
export const GRID_2COL_ASIDE_280 = "grid gap-3 md:grid-cols-[minmax(0,1fr)_280px] md:items-start";
