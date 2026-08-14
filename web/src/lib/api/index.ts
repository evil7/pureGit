/**
 * GitHub API smart 封装层 - barrel（拆分）
 *
 * 原单文件 2362 行已按业务板块拆分为：
 * - api-core.ts  graphqlRequest 模式包装 + 日志/熔断工具
 * - api-user.ts  viewer/账户/邮箱/组织列表/SSH/关注
 * - api-repo.ts  仓库详情/创建/star/fork/主题/订阅/删除/计数
 * - api-repo-extra.ts  仓库扩展（Projects v2/topics/订阅/最近分支/删除/Security）
 * - api-file.ts  文件内容（blob/目录/README/根文件/编辑页）
 * - api-org.ts   用户/组织主页 + 组织详情/更新/成员
 * - api-issue.ts issue/PR/评论/搜索 + 页面级合并查询
 * - api-review.ts PR 评审工作流/详情侧栏增强/时间线/commits/check-runs/协作者
 * 本文件仅 re-export（含 github 全量 + graphql 模板），页面 import 面零改动。
 */
export * from "./api-core";
export * from "./api-user";
export * from "./api-repo";
export * from "./api-repo-extra";
export * from "./api-file";
export * from "./api-org";
export * from "./api-issue";
export * from "./api-review";
export * from "./api-discussions";
export * from "./api-search";
export * from "./api-feed-batch";
export * from "./api-insights";
export * from "../restapi";
// 注：graphql 模板不在此 re-export（api-core 已 re-export hasGraphQLErrors/GraphQLResponse；
// 模板由各 api 板块直接从 "../graphql" import），避免 graphqlRequest 与 api-core 同名冲突。
