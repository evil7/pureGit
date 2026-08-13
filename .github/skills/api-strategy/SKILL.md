# API 策略 Skill（GraphQL 唯一主通道 + REST 熔断降级）

> Use when: PureGit 项目中新增/修改任何 API 接入、smart 封装、GraphQL 模板、REST 降级逻辑、熔断日志的讨论与实施。触发词：API 策略、GraphQL、REST、熔断、降级、smart、请求模板、路径参数、api-compat、api-log、api-strategy。

## 核心认知（v0.0.1 方案调整 2026-08-12）

**旧方案（废弃）**：「GraphQL 首选 + REST 降级」双通道并重 + 用户可切主模式（GraphQL 优先 / REST 优先）。
问题：GraphQL → REST 是**一对多**（一个复合查询聚合的字段对应 2~5 个 REST 端点），在 GraphQL 模板未定型时写 REST 降级 = 拍脑袋多请求拼装，维护成本翻倍且易失真。

**新方案（当前）**：**GraphQL 唯一主通道 + REST 熔断降级（复用现有 REST 层）**，三步走：

1. **GraphQL 唯一主通道**：双端点 API 以 GraphQL 为唯一实现（smart 函数 = GraphQL 请求模板 + 路径参数变量）；熔断机制框架保留（额度跟踪/cooldown/去重）。
2. **全量迁移至 GraphQL + 立即设计 REST 熔断**：按页面聚合程度调优复合查询（一个路由一次 GraphQL 查询聚合所需字段）；路径参数（`:owner/:repo/:number` 等）映射为**功能通用请求模板 + 变量**（模板集中 `web/src/lib/graphql.ts`）。**GraphQL 通道定型后立即**补 REST 熔断降级——**现有 rest 层代码不废弃**，复用并按聚合边界优化（GraphQL 聚合了哪些 REST 端点 → 降级链按此拆解，多请求并行优于串行）。熔断降级统一经 `withRestFallback`（api-core.ts）包装。
3. **REST 降级链排序**：GraphQL→REST 一对多映射清晰后，降级按「先核心数据再附属数据、多请求并行」排序实现。

## 强制规则

1. **登录态 GraphQL 唯一主通道**：smart 函数第一实现必须 GraphQL；**禁止**新增「REST 优先」模式选项；GraphQL 失败 → 统一 `withRestFallback` 熔断降级 REST（复用 rest 层）。
2. **匿名强制 REST**（硬约束非降级）：GraphQL 匿名恒 403（实测）；匿名时 smart 层短路走 `rest-*.ts`（REST 数据层保留的唯一原因）。
3. **路径参数 → 请求模板变量**：路由参数不做字符串拼查询；统一映射为 `graphql.ts` 模板的变量对象（如 `PULLS_QUERY` + `{owner, name: repo, states, first, orderField, orderDir}`）。
4. **REST 熔断降级复用不废弃**：现有 `rest-*.ts` 代码继续使用（匿名直连 + 熔断降级）；降级链经 `withRestFallback(restFn, detail, gqlResp)` 包装。
5. **REST 固定端点一律类型化方法**：`typedRequest` + `octokit.rest.*`；仅特殊语义端点（raw Accept / base64 / Link 头 / 无类型化方法）保留底层通道并注释理由。

## 动手前：API 对照查询（apiidx 工具）

> 新增 / 修改 API 接入前，先用 `scripts/apiidx.mjs` 查 REST 端点与 GraphQL schema，
> **双端点「graph→rest 熔断对等」关系由人主观判断**（工具不强制提示对等兼容路径；结论沉淀于 `docs/api-compat.md`）。

- **REST 侧**：`node scripts/apiidx.mjs rest <关键词>`（搜索）/ `rest-id <operationId>`（端点详情含参数）
- **GraphQL 侧**（实时直连官方 `api.github.com/graphql`，需系统变量 `GITHUB_TOKEN`；无 token / 权限不足 / 网络受限自动降级本地 `@octokit/graphql-schema`）：
  - `gql roots [query|mutation|all]` —— 枚举根字段
  - `gql search <关键词>` —— 搜索根字段（名字/描述）
  - `gql type <TypeName>` —— 递进：类型字段枚举（含嵌套 / Connection 字段；**这是判断「REST-only 是否有 GraphQL 等价」的关键**，旧索引只录根字段的盲区即在此）
  - `gql field <Type.field>` —— 递进：字段详情（完整参数 + 返回类型）
- **页面侧**：`page <关键词>`（页面搜索）/ `pageapi <关键词>`（页面 → 关联 API 闭环）

## 熔断日志规范（api-log.ts 统一工具）

**格式（简洁无复杂缩进；`↪` 左右空格为图标间隔）**：

```
YYYY-MM-DD 12:23:34:123 [Graph] xxxQuery | vars: {"aa":"bb","cc":11} error(1) 45B 32ms   ← 主请求（异常时状态打 error(n)/network-error）
YYYY-MM-DD 12:23:34:125 [Fallback#3] fetchXxxSmart | error: Resource not found          ← 降级触发（#n = fallback 会话序号）
YYYY-MM-DD 12:23:34:126 ↪ [Rest] GET /repos/xxx/xxx  200  123KB  32ms                   ← fallback（每请求一行）
```

- **时间戳**：`YYYY-MM-DD HH:mm:ss:SSS`（含毫秒，性能对比）
- **协议标注**：`[Graph]` / `[Rest]` 自动判断（ApiMode）；降级触发打 `[Fallback#n]`（error 详情）
- **fallback 图标**：降级后的 REST 请求前缀 `↪`（左右空格为图标间隔），无复杂缩进
- **fallback 序号**：`beginFallback()` 同步递增返回 `{ id, end }`——`#n` 为**值传递**，并发场景下仍能正确关联「哪次降级触发了哪些 REST」（不依赖全局可变状态判断）
- **GraphQL 主请求**：含 `vars: {...}`（变量快照）；有 errors 时状态打 `error(n)`（HTTP 200 但业务错误），错误详情由降级时的 `[Fallback]` 行承担

**通用级别日志（补 catch 块中被静默吞掉的错误/信号，避免丢失调试信息）**：

```
YYYY-MM-DD 12:23:34:130 [Error] fetchXxxSmart | error: REST also failed   ← fallback 也失败 / HTTP 4xx/5xx / 非预期异常
YYYY-MM-DD 12:23:34:130 [Warn]  fetchXxxSmart | network error → cooldown   ← 可预期信号（熔断 / 静默降级返回空 / 补丁回退默认）
YYYY-MM-DD 12:23:34:130 [Info]  graphqlRequest | anonymous → REST          ← 一般信息（匿名短路降级 / 状态提示）
```

- **级别语义**：`[Error]` 真实错误（fallback REST 也失败、HTTP 4xx/5xx、非预期异常）；`[Warn]` 可预期/可恢复信号（网络错误触发熔断、静默降级返回空、补丁失败回退默认值）；`[Info]` 一般信息
- **fallback 失败必打 `[Error]`**：`withRestFallback` 内 `restFn` 抛错 → `logError(detail, e)` 后 rethrow（不吞错误）
- **静默 catch 必补 `[Warn]`**：`catch` 后返回空/默认值/null 的降级路径必须打 `logWarn`（如 fetchRecentBranchesSmart / fetchPullProjectsSmart / fetchTopCommittersSmart），不丢失诊断信息
- 日志仅 DEV 输出（`isDev()`，测试可用 `setApiLogDev(true)` 开启）

## 实施路径

### 第 1 步：GraphQL 唯一主通道改造

对每个 smart 函数：
- GraphQL 通道为唯一实现（模板 + 变量）
- 匿名分支：`if (!token) return fetchXxx(owner, repo, token)`（走 rest-*.ts）
- 失败分支：`withRestFallback(() => fetchXxx(...), "fetchXxxSmart", resp)`（统一降级链 + ↪ 日志）

```ts
export async function fetchXxxSmart(owner: string, repo: string, token?: string | null) {
  if (!token) {
    // 匿名强制 REST（GraphQL 匿名恒 403）——REST 数据层保留的唯一原因
    return fetchXxx(owner, repo, token);
  }
  try {
    const resp = await graphqlRequest(XXX_QUERY, { owner, name: repo }, token);
    if (!hasGraphQLErrors(resp) && resp.data?.repository) {
      return toXxx(resp.data.repository);
    }
    // GraphQL 失败 → 熔断降级 REST（复用 rest 层；日志自动 ↪ 前缀）
    return withRestFallback(() => fetchXxx(owner, repo, token), "fetchXxxSmart", resp);
  } catch (e) {
    return withRestFallback(() => fetchXxx(owner, repo, token), "fetchXxxSmart");
  }
}
```

### 第 2 步：全量迁移 + 模板调优 + 降级链

- 一个路由一次 GraphQL 查询聚合所需字段（如 `fetchPullDetailWithCommentsSmart` 单请求聚合 PR 详情+评论）
- 模板集中 `graphql.ts`，路径参数全部变量化
- GraphQL 定型后**立即**写 REST 降级链（withRestFallback），按聚合边界拆解 REST 端点、并行请求

### 第 3 步：REST 降级链排序与验证

- 降级排序：先核心数据再附属数据；多请求并行（Promise.all）优于串行
- 验证降级链日志：GraphQL 失败日志（vars + error 详情行）+ `↪ [Rest]` 每请求一行
- 同步更新 `docs/api-compat.md` 表

## 相关文件与文档

- 权威文档：`docs/architecture.md`「API 模式」章节、`docs/api-compat.md`（§1 分层 / §2 对照表 / §3 smart 模板 / §5 CheckList / §6 审计速查）
- 代码载体：`web/src/lib/octokit.ts`（SDK 入口/额度/熔断）、`web/src/lib/api-core.ts`（graphqlRequest + withRestFallback）、`web/src/lib/api.ts`（smart barrel）、`web/src/lib/graphql.ts`（请求模板库）、`web/src/lib/api-log.ts`（熔断日志工具）、`web/src/lib/rest.ts` + `rest-*.ts`（REST 数据层：匿名直连 + 降级复用）
- 日志验收：`web/test/api-log.spec.ts`（简洁格式/`[Fallback#n]` 序号/`↪` 图标/时间戳毫秒/vars 快照质量门）
