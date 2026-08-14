---
name: api-strategy
description: "Use when: 新增/修改 PureGit 的 API 接入——GraphQL 唯一主通道、smart 封装、REST 熔断降级、匿名 REST。触发词：API、GraphQL、REST、熔断、降级、smart、请求模板、octokit"
argument-hint: "要新增/修改哪个 API 接入，或参考哪种 smart 封装模式"
---

# API 策略（GraphQL 唯一主通道 + REST 熔断降级）

> **权威依据**：`docs/architecture.md`「API 模式」。本 skill 是速查版。

## 通道铁律（定稿）

1. **登录态强制 GraphQL 唯一主通道**：凡有 GraphQL 适配的 API，登录时一律走 GraphQL（smart 函数 = GraphQL 请求模板 + 路径参数变量）。**「收益低 / 繁琐」不构成例外**——唯一例外 = **GraphQL 无适配**（schema 无对应字段/端点/能力）才保留 REST。
2. **匿名强制 REST**（硬约束非降级）：GraphQL 匿名恒 403，匿名时 smart 层短路走 REST 数据层。
3. **GraphQL 失败 → `withRestFallback` 熔断降级 REST**（复用 rest 层，日志 `↪` 标记）。

## 强制规则

1. smart 函数第一实现必须 GraphQL；**禁止**新增「REST 优先」模式选项。
2. 路径参数不做字符串拼查询，统一映射为 GraphQL 模板变量。
3. REST 固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法；仅特殊语义端点（raw Accept / base64 / Link 头 / 无类型化方法）保留底层通道并注释理由。
4. 页面/组件只 import `@/lib/api`（smart 层），不感知具体协议。

## 实施要点

1. GraphQL 模板（集中 `graphql.ts` + 路径参数变量）
2. smart 函数：登录 GraphQL 唯一实现 + 匿名短路 REST + `withRestFallback` 降级
3. 补 smart 降级决策单测 + 门禁（`pnpm lint` / `format:check` / `test` / `--filter web build`）
