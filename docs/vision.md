# PureGit 中心思想（产品定位）

> 本文档是全项目**最高纲领**，定义「做什么、为什么、做成什么样」。
> 所有子文档（design / architecture / api-compat / tasks / 规范 / prompt）均以此为准绳对齐；
> 任何新增功能、UI 决策、技术取舍，先对照本文档再动手。

## 一句话定位

> **通过 GitHub 官方 API，全面复刻一个「简版 GitHub」前端；聚焦核心开发者日常所需的管理与使用功能，页面干净整洁、操作由繁化简。**

## 三个支柱

### 1. 全面（Coverage）—— 覆盖核心开发者功能闭环

不满足于「浏览站」，而是复刻 GitHub 的核心能力闭环：

| 领域 | 覆盖功能 |
|------|----------|
| **浏览** | **首页 Dashboard（动态 Feed + 热点今日/本周/本月）**、搜索（仓库/用户/issue）、仓库详情（README/文件树/代码高亮/语言统计/About）、用户与组织主页、Releases |
| **协作** | issue（列表/详情/**创建**）、PR（列表/详情/**创建**）、star / unstar / fork |
| **账户** | 个人资料、账号、邮箱、组织、我的仓库、外观主题（/settings 复刻简化版）、**权限管理（scope 分级 + 重新登录切换）** |
| **身份** | **GitHub OAuth2 登录（可选权限：仅限访问 / 读写控制 + private/org 勾选）**、会话恢复、前端全功能由 token 直连官方 API |
| **CLI** | git 镜像端点自动代理：clone / pull / push（insteadOf 一行配置接入） |

### 2. 简版（Simplicity）—— 去杂项，回归版本管理本源

**只做核心开发者需要的**；一切不属于开发者日常高频使用的杂项一律不实现：

- ❌ Packages（软件包托管非版本管理核心）
- ❌ 代码评审工作流（review 留言、合并 PR、批准等高级流程）
- ❌ 多账号切换、自建用户体系、计费/限流等运维增值
- ❌ 深度安全子页（Dependabot / Code scanning / Secret scanning，需额外 scope）

> **实现现状**：文件在线编辑 / 新增 / 删除（直接 commit 到分支）已实现（CodeMirror 6 编辑器，与官方 blob 编辑器同源——行号、语法高亮、自动缩进、括号匹配等原生能力）；Actions / Wiki / Security 核心（SECURITY.md + 公告）/ Insights Pulse 已实现；对应子功能仍去杂项（Actions 图表、Security Dependabot/扫描、Insights 图表子页）。Packages、评审工作流、Webhooks、Pages 托管保持不实现。

> **未登录访问策略**：仅开放仓库 Code 浏览（根/tree/blob/new/edit）；其余仓库 tab（Issues/Pulls/Actions/Security/Insights/Wiki/Releases/Projects/Settings）切换时内容区显示登录墙（LoginPrompt + 聚光灯动画指引右上角登录按钮，URL 驱动、登录后回落）。首页/搜索/用户主页保持匿名可浏览。

> 取舍判据：**「这个功能是不是一个开发者打开 GitHub 高频使用 / 管理自己与团队仓库所必需的？」**
> 是 → 保留并做简；否 → 明确不实现（纳入内部 Out of Scope 清单）。

### 3. 化简（Clarity）—— 干净整洁、操作由繁化简

- **页面干净**：统一宽度、统一间距、统一组件（shadcn/ui），信息密度适中，无广告无干扰
- **操作化简**：高频操作一步直达（star / fork / 创建 issue 在详情页直接可用）；导航符合 GitHub 心智模型（仓库六 tab、设置左侧导航）
- **技术化简**：Octokit SDK 统一封装 + 用户可选主模式（GraphQL 优先 / REST 优先），双额度自动冗余，页面组件不感知协议细节

## 设计原则（映射到开发）

| 原则 | 落地要求 |
|------|----------|
| 全面 | 功能清单见各子文档与 In Scope 约定；新增功能须先对照本表是否属于核心闭环 |
| 简版 | 不属于核心的功能写 Out of Scope，**不实现**；当前处于 **0.0.x 内部试错阶段**，可大胆重构删除 |
| 化简 | 页面复用 shadcn/ui；布局遵循 GitHub 心智模型；交互一步直达 |
| 干净 | 统一 max-w-6xl、min-w-0 截断、多色语言条等细节是「干净」的具体体现 |
| 真实 | 一切数据来自官方 API（Octokit SDK 统一封装，主模式用户可选、双额度自动冗余），不造假数据 |

## 验收视角（面向最终用户的一句话）

> 「一个登录后能看、能搜、能管（issue/PR/star/fork/设置）、能 clone/pull/push 的干净版 GitHub。」
