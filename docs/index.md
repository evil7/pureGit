# PureGit 文档中心

> **中心思想**：通过 GitHub 官方 API **全量复刻 GitHub 前端**，功能完成度对齐官方、界面干净整洁、操作由繁化简（详见 [vision.md](./vision.md)，全项目最高纲领）。

本文件是**项目文档体系的总导航**：准确说明 `docs/` 与 `.github/` 下所有协作文件的真实用意、使用方式与适用场景。新开发者 / 新会话（含 AI 编码助手）请从本页开始。

## 一、文档总览（`docs/`）

### 公开文档（随仓库发布，贡献者/用户均可见）

| 文档 | 真实用意 | 何时读 |
|------|---------|--------|
| [vision.md](./vision.md) | **中心思想与产品定位（最高纲领）**：项目做什么、为什么存在、功能取舍判据 | 任何新功能/新页面**动手前** |
| [design.md](./design.md) | **UI/UX 设计规范（Design System）**：布局框架/组件规范/响应式/动画/验收清单 | 写任何 UI/布局/组件**之前** |
| [architecture.md](./architecture.md) | **架构设计**：前端 / Worker / CLI 镜像代理、职责边界、API 策略、**Raw 内容通道（$raw 后端）编排** | 涉及跨层改动、API 数据流、新增端点时；`$raw` 文件读取通道/省流方案/反代开关 |
| [cli-setup.md](./cli-setup.md) | **CLI 接入指南**：git 镜像端点 insteadOf 配置 | 用户配置 git / 排查 clone/pull/push 问题时 |

> **内部文档不保留**：临时任务与决策随开发开始和结束自然消亡，最终结果沉淀在代码注释（总结性语义）与公开框架文档中，避免文档膨胀。

## 二、`.github/` 协作设施（Agent / vibe coding）

| 设施 | 真实用意 | 加载 / 调用方式 |
|------|---------|----------------|
| `.github/copilot-instructions.md` | **全局指令（顶层框架）**：架构红线、开发规范、文档体系与规则层级、构建命令 | 所有会话**自动加载** |
| `.github/skills/shadcn-ui` | shadcn/ui 组件添加流程、目录约定、主题定制 | 任务关键词匹配时自动加载 |
| `.github/skills/ui-layout` | 全 UI/UX 规范**速查**（权威版指向 `design.md`） | 任何 UI/布局任务 |
| `.github/skills/api-strategy` | **API 策略速查**（GraphQL 唯一主通道 + REST 熔断降级；权威版指向 `architecture.md`） | 新增/修改 API 接入、smart 封装、REST 降级逻辑 |
| `.github/skills/cf-worker-auth` | Worker OAuth2 令牌管理（端点/KV 会话/密钥安全） | Worker 鉴权任务 |
| `.github/skills/cli-git-mirror` | git 镜像端点自动代理（智能 HTTP 协议/转发） | CLI 代理任务 |
| `.github/skills/replica-workflow` | **官方页面改造工作流**（评估/讨论/实施/升华/文档同步） | 改造/复刻官方页面的任务 |

## 三、新会话 / 二次开发启动路径（vibe coding 友好）

1. Copilot 自动加载 `copilot-instructions.md` → 获得红线、规范与文档地图
2. 读本文件（`docs/index.md`）→ 确认文档层级
3. 新功能/方向取舍 → 先读 `vision.md`；涉及 UI → `design.md` + `ui-layout` skill
4. **改造/复刻官方页面 → 加载 `replica-workflow` skill（标准流程）**
5. 涉及 API 数据获取 → 先读 `architecture.md`「API 模式」＋加载 `api-strategy` skill
6. 动手后：**修正关键框架文档**（vision/design/architecture 等），保持代码与文档同步

## 当前状态

- **版本阶段**：**v0.0.1 全量复刻**；0.0.x 内部试错阶段仍有效，可随时开展破坏性、不兼容的重构与尝试。
- **开发进度**：核心闭环完成（浏览/协作/账户/CLI）；官方页面分批对齐。
- **开发环境**：`pnpm dev`（双进程，唯一模式）；提交前门禁 `pnpm lint` / `pnpm format:check` / `pnpm test`。
