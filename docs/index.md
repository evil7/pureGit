# PureGit 文档中心

> **中心思想**：通过 GitHub 官方 API **全量复刻 GitHub 前端**，功能完成度对齐官方、界面干净整洁、操作由繁化简（详见 [vision.md](./vision.md)，全项目最高纲领）。

本文件是**项目文档体系的总导航**：说明 `docs/` 与 `.github/` 下所有协作文件的真实用意。新开发者 / 新会话（含 AI 编码助手）请从本页开始。

## 一、公开文档（`docs/`）

| 文档 | 真实用意 | 何时读 |
|------|---------|--------|
| [vision.md](./vision.md) | **中心思想（最高纲领）**：做什么、为什么、功能取舍判据 | 新功能/新页面**动手前** |
| [design.md](./design.md) | **UI/UX 设计规范**：布局框架/组件规范/响应式/动画/验收清单 | 写任何 UI/布局/组件**之前** |
| [architecture.md](./architecture.md) | **架构设计**：前端/Worker/CLI 职责边界、API 策略、Raw/Release 内容通道 | 跨层改动、API 数据流、新增端点时 |
| [cli-setup.md](./cli-setup.md) | **CLI 接入指南**：git 镜像端点 insteadOf 配置 | 配置 git / 排查 clone/pull/push 时 |
| [deploy.md](./deploy.md) | **部署指南**：Cloudflare Workers 一键脚本 + 手动步骤、配置项说明 | 部署 / 更新 / 二次部署时 |

> **内部文档不保留**：临时任务与决策随开发结束自然消亡，最终结果沉淀在代码注释（总结性语义）与公开框架文档中，避免文档膨胀。

## 二、`.github/` 协作设施（Agent 协作）

- `.github/copilot-instructions.md` —— **全局指令（顶层框架）**：架构红线、开发规范、规则层级、构建命令（所有会话自动加载）
- `.github/skills/replica-workflow` —— 官方页面改造工作流（评估→讨论→实施→升华→文档同步）
- `.github/skills/api-strategy` —— API 策略速查（GraphQL 唯一主通道 + REST 熔断降级）
- `.github/skills/ui-layout` —— UI/UX 规范速查 + shadcn 组件添加流程
- `.github/skills/cf-worker-auth` —— Worker OAuth2 令牌管理
- `.github/skills/cli-git-mirror` —— git 镜像端点自动代理

> 各 skill 仅承载「何时用 + 怎么走流程」，权威细节一律指向对应 `docs/*` 文档。

## 三、新会话启动路径

1. 自动加载 `copilot-instructions.md` → 获得红线、规范与文档地图
2. 读本文件（`docs/index.md`）→ 确认文档层级
3. 新功能/方向取舍 → 先读 `vision.md`；涉及 UI → `design.md` + `ui-layout` skill
4. 改造/复刻官方页面 → `replica-workflow` skill；涉及 API → `architecture.md` + `api-strategy` skill
5. 动手后：**修正关键框架文档**（vision/design/architecture 等），保持代码与文档同步
