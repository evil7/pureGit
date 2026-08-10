# 全站布局调研（2026-08-09 重建）

> **文档体系说明**：`docs/research/` 是 GitHub 官方页面的**只读调研档案**（布局分型/区块排布/搜索框/断点/sticky 行为）。
> 2026-08-09 依据「以 PageLayout 三栏模型重构」重新调研并重建本目录，按 **github.com 站点树从浅到深**组织：
>
> | 层级 | 文档 | 内容 |
> |------|------|------|
> | 00 全局 | `00-分型总览.md` | A~H 全站分型 + 搜索框清单 + 宽度/断点/sticky 汇总 |
> | 01 全局框架 | `01-全局框架.md` | TopBar / Footer / 404 |
> | 02 全局页面 | `02-全局页面.md` | Dashboard / 搜索 / 全局 Issues / 全局 Pulls / 通知 |
> | 03 用户级 | `03-用户级页面.md` | 用户主页 / 用户仓库 / 组织主页 / Gist / 个人设置 |
> | 04 仓库外壳 | `04-仓库外壳.md` | RepoHeader / About 显示范围 / 仓库首页 CodeIndex |
> | 05 仓库列表 | `05-仓库列表页.md` | tree / Issues / Pulls / Discussions / Releases / Actions / Projects / Wiki / Security / Insights |
> | 06 详情与深层 | `06-详情与深层页.md` | Issue/PR/Discussion 详情 / 新建页 / blob / 编辑 / 设置 |
>
> 配套实现：`web/src/components/PageLayout.tsx`（三栏模型，2026-08-09）；布局常量 `web/src/lib/layout.ts`；
> 设计规范 `docs/design.md`；任务基线 `docs/tasks.md`。

## 调研方法（只读）

- 浏览器访问官方页（octocat/Hello-World、facebook/react、vercel/next.js 等公开仓库），devtools 量取 pane 宽度 / 断点 / sticky 行为。
- 全程只读：不点击任何写操作（star/fork/创建/删除/评论/提交等）。
- 对照 PureGit 复刻现状（`web/src/pages/` 各页源码），输出差异清单。
