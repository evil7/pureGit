# API 兼容性对照表单与实施指导（api-compat）

> 权威文档 · API 实施指导。**一页审计全部 API 实现方式**；新增 API / 新页面接入的唯一实施指导（§0 准则先读）。配套 `architecture.md`。

---

## 0. 智能熔断接口开发准则（先读）

通道铁律 + 四分类判断 + 实施顺序；新增/修改任何 API 接入前必读。

### 0.1 通道铁律（三则）

1. **登录态强制 GraphQL 唯一主通道（不评估收益/复杂度）**：凡有 GraphQL 适配的双端点 API，登录时一律走 GraphQL（smart 函数 = GraphQL 请求模板 + 路径参数变量）。**「收益低 / 繁琐 / 复杂度高」不构成例外**。
2. **匿名态强制 REST**：GraphQL 匿名恒 403（实测），匿名时 smart 层短路走 REST 数据层。
3. **唯一例外 = GraphQL 无适配**：schema 无对应字段/端点/能力 → 保留 REST（登记 §4 不可抗力清单）。

### 0.2 实施逻辑（判断一个 API 走哪条通道）

1. **查 schema（用 apiidx 工具）**：`apiidx rest <关键词>` 定位 REST 端点 → `apiidx gql type <Type>` / `gql field <Type.field>` 递进确认有无 GraphQL 等价（**必须递进到嵌套 / Connection 字段**——根字段列表不含嵌套等价）。
2. **四分类**：
   - **有 GraphQL 适配** → smart 化（登录 GraphQL 主通道 + `withRestFallback` 熔断降级；匿名短路 REST）；
   - **无 GraphQL 适配** → 保留 REST，登记 §4 不可抗力；
   - **GraphQL-only**（REST 无端点）→ 固定 GraphQL（匿名自然降级到空/降级路径）；
   - **部分适配（hybrid）** → GraphQL 主通道处理有适配字段 + REST 增补无适配字段，熔断全 REST（如 `updateRepositorySmart`：name/description/homepage/has_* + archived 走 GraphQL，private/default_branch 无 mutation 走 REST 增补）。
3. **对等关系由人主观判断**：工具只提供「有没有 GraphQL 等价」的事实，不强制「配不配」的结论；对等结论沉淀于本表（§2 / §4）。

### 0.3 实施顺序

1. GraphQL 模板（`graphql.ts` 模板 + 路径参数变量）
2. smart 函数（登录 GraphQL 唯一实现 + 匿名短路 REST + `withRestFallback` 降级）
3. 页面从 `@/lib/api` import（**禁止**页面直接 `@/lib/rest`）
4. 补 smart 降级决策单测 + 门禁（`pnpm lint` / `format:check` / `test` / `--filter web build`）
5. 同步 `api-compat.md`（§2 对照表 + §4 不可抗力）

### 0.4 注意事项

- **判断「无适配」必须递进到嵌套字段**：如 `list-contributors` 的 GraphQL 等价不在根字段（`Repository` 类型无 `contributors` 字段），需 `gql type Repository` 枚举确认。
- **GraphQL 能力缺失 ≠ 无适配**：如 `git/get-tree` 有 `Tree.entries` 但**无 `recursive` 参数**（全量树 GraphQL 需 N+1 逐层下钻）——属「能力缺失」，仍保留 REST（§4.6）。
- **匿名强制 REST 是硬约束非降级**：smart 函数 `if (!token) return fetchXxx(...)` 短路，绝不发起 GraphQL（不消耗配额、不产生 403 噪音）。
- **熔断降级复用不废弃**：rest 层代码继续用于匿名直连 + 降级链（`withRestFallback` 包装）。
- **REST 固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法**；仅特殊语义端点（raw Accept / base64 / Link 头 / 无类型化方法）保留底层通道并注释理由。

---

## 1. 分层架构（先看这个，再查表）

```
页面 / 组件
   │  只允许 import "@/lib/api"（smart 层）—— 例外见 §5
   ▼
web/src/lib/api.ts ─── 桶（barrel）：re-export api 板块 + rest 全量
   ├─ api-core.ts       graphqlRequest GraphQL 唯一通道包装 + 日志/熔断工具 + hasGraphQLErrors/GraphQLResponse
   ├─ api-user.ts       viewer/账户/邮箱/组织列表/SSH/关注
   ├─ api-repo.ts       仓库详情/创建/star/fork/主题/订阅/删除/计数
   ├─ api-org.ts        用户/组织主页 + 组织详情/更新/成员
  ├─ api-issue.ts      issue/PR + 评论/评审 + 页面级合并查询
  ├─ api-discussions.ts Discussions
  └─ api-search.ts     搜索
web/src/lib/rest.ts ── 桶（barrel）：re-export rest 板块（REST 全量，匿名直连 + 保留 REST 路由）
   ├─ rest-core.ts      底层（restRequest/githubFetch/typedRequest/ApiError/通用类型）
   ├─ rest-account.ts   账户（emails/SSH/GPG/blocked）
   ├─ rest-user-org.ts  用户主页 + 关注 + 组织
   ├─ rest-repo.ts      仓库浏览/管理 + 代码内容 + Release
   ├─ rest-issue-pr.ts  Issue/PR + 评论 + 类型
   ├─ rest-user-nav.ts  用户导航（Gist/通知/邀请/Feed/搜索）
   ├─ rest-actions.ts   Actions 全家
   └─ rest-discussions.ts Discussions 类型
web/src/lib/graphql.ts ── GraphQL 请求模板库（模板常量 + 路径参数变量组装，集中管理）
web/src/lib/octokit.ts ── SDK 统一入口（额度跟踪 / 熔断 cooldown / 响应缓存 / 去重）
web/src/lib/wiki.ts ── Wiki（唯一 selfcode_fetch → worker /$wiki 代理）
worker/src/ ── OAuth2（/$auth/*）+ git 代理 + /$wiki /$raw 代理
```

**文件组织**：
- **命名**：REST 数据层 = `rest.ts` + `rest-*.ts`（匿名直连 + 保留 REST 路由）；smart 层 = `api.ts` + `api-*.ts`；GraphQL 请求模板 = `graphql.ts`；SDK 基础设施 = `octokit.ts`。
- **新增 API 归属**：GraphQL 模板放 `graphql.ts`，smart 包装放对应 `api-*.ts`，匿名/保留 REST 放对应 `rest-*.ts`。
- 板块文件 >800 行时再拆。

---

## 2. 全量 API 兼容性对照表单

> 列含义：`octokit_graphQL`=有 GraphQL 端点且已接入（**主通道**）；`octokit_rest`=有 REST 端点（经 SDK，**匿名直连 / 熔断降级复用 / 保留 REST 路由**）；`selfcode_fetch`=原生 fetch 绕过 SDK；`worker_proxy`=走 Cloudflare Worker 代理；`already_smart_now`=已做 **GraphQL 唯一主通道 + REST 熔断降级（withRestFallback）** 包装。
> `✅`=已实现　`✗`=无此通道　`—`=不适用　`❌`=应做未做（禁）　`⚠️`=有通道但合理保留 REST（理由见 §4）

### 2.1 智能封装层（smart，GraphQL 唯一主通道 + REST 熔断降级）—— ✅ 全部就绪

| API 名（smart 入口） | octokit_graphQL | octokit_rest | selfcode_fetch | worker_proxy | already_smart_now |
|---|---|---|---|---|---|
| `fetchViewerSmart` 当前用户画像 | ✅ | ✅ | — | — | ✅ |
| `fetchCurrentUserSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchUserEmailsSmart` / `addUserEmailsSmart` 等 | ✅ | ✅ | — | — | ✅ |
| `fetchUserOrgsSmart` / `fetchOrgMemberships` | ✅ | ✅ | — | — | ✅ |
| `fetchMyReposSmart`（游标分页：viewer.repositories(after) + pageInfo） | ✅ | ✅ | — | — | ✅ |
| `fetchProfileReposSmart`（用户/组织主页仓库翻页游标续接：user/org.repositories(after)） | ✅ | ✅ | — | — | ✅ |
| `fetchRepositorySmart`（含 id/star/watch/features） | ✅ | ✅ | — | — | ✅ |
| `fetchRepositoryIdSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchUserProfileSmart` / `fetchOrgProfileSmart` / `fetchOrgDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `updateUserProfileSmart` / `updateOrganizationSmart` / `createRepositorySmart` | ✅ | ✅ | — | — | ✅ |
| `fetchIssuesSmart` / `fetchIssueDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `createIssueSmart` / `setIssueSubscriptionSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchPullsSmart` / `fetchPullDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `createPullRequestSmart`（同仓库 GraphQL mutation / 跨仓库复合查询双 id） | ✅ | ✅ 降级 | — | — | ✅ |
| `updateRepositorySmart`（hybrid：name/description/homepage/has_* + archived 走 GraphQL，private/default_branch 增补 REST） | ✅ | ✅ 增补 | — | — | ✅ |
| `fetchReleasesSmart` / `fetchReleaseDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `isStarredSmart` / `setStarredSmart` | ✅ | ✅ | — | — | ✅ |
| `forkRepositorySmart`（fork 无 GraphQL mutation） | ✗ | ✅ | — | — | ✅（REST-only） |
| `searchRepositoriesSmart` / `searchUsersSmart` / `searchIssuesSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchDiscussionsSmart` / `fetchDiscussionDetailSmart` / `createDiscussionSmart` / `addDiscussionCommentSmart` | ✅ | ✗（REST 无端点） | — | — | ✅ |
| `fetchOrgMembersSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchIssueCommentsSmart` / `addIssueCommentSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchPullReviewCommentsSmart` / `addPullReviewCommentSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchBranchesSmart` | ✅ | ✅ | — | — | ✅ |
| `updateIssueStateSmart`（关闭/重开 issue；GraphQL closeIssue/reopenIssue 需 ISSUE_ID 前置） | ✅ | ✅ 降级 | — | — | ✅ |
| `fetchDirContentsSmart` / `fetchReadmeSmart`（目录列举 / README 定位，GraphQL Tree.entries + blob 主通道） | ✅ | ✅ | — | — | ✅ |
| `fetchRootFilesSmart`（About Resources 根文件探测，GraphQL Tree.entries 单层） | ✅ | ✅ 降级 | — | — | ✅ |
| `fetchRepoLabelsSmart` / `fetchRepoAssigneesSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchSshKeysSmart` / `addSshKeySmart` / `deleteSshKeySmart` | ✅ | ✅ | — | — | ✅ |
| `isFollowingSmart` / `setFollowingSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepoTopicsSmart` / `replaceRepoTopicsSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepoSubscriptionSmart` / `setRepoSubscriptionSmart` | ✅ | ✅ | — | — | ✅ |
| `deleteRepositorySmart` | ✅ | ✅ | — | — | ✅ |
| **页面级复合查询（一次 GraphQL 聚合多字段）** | | | | | |
| `fetchIssueDetailWithCommentsSmart`（Issue 详情+评论单请求） | ✅ | ✅ 分步降级 | — | — | ✅ |
| `fetchPullDetailWithCommentsSmart`（PR 详情+评论单请求） | ✅ | ✅ 分步降级 | — | — | ✅ |
| `fetchPullDetailFullSmart`（PR 详情完整复合：detail+comments+reviewSummary 一次查询，替代详情页 detail+comments 与 reviewSummary 两次请求；timeline 保持独立） | ✅ | ✅ 分步降级 | — | — | ✅ |
| `fetchReleasesCountSmart`（GraphQL totalCount 替代 Link header） | ✅ | ✅ | — | — | ✅ |
| `fetchLatestReleaseSmart`（About 侧栏 Releases 入口：GraphQL totalCount+nodes(first:1) 一次查询 / REST per_page=1 一次请求） | ✅ | ✅ | — | — | ✅（已被 fetchRepoHomeSmart 合并替代，保留独立入口） |
| `fetchRepoHomeSmart`（仓库主页复合查询：REPO_WITH_RELEASES_QUERY 一次取仓库元数据 + languages + tab 计数 + releases 总数/最新，替代 Repository + LatestRelease 两次请求） | ✅ | ✅ 分步降级 | — | — | ✅ |
| **评审工作流** | | | | | |
| `fetchPullReviewSummarySmart`（reviewDecision+reviews+reviewRequests+mergeable，PR 详情 Reviewers 栏/合并判定） | ✅ | ✅ 降级（reviewDecision 由 reviews 推断；reviewRequests 经 list-requested-reviewers 补全） | — | — | ✅ |
| `submitPullReviewSmart`（三态：COMMENT/APPROVE/REQUEST_CHANGES） | ✅ | ✅ 降级 | — | — | ✅ |
| `mergePullRequestSmart`（merge/squash/rebase） | ✅ | ✅ 降级 | — | — | ✅ |
| `requestReviewersSmart`（GraphQL 需 userIds 前置查询；REST 直接 reviewers 数组） | ✅ | ✅ 降级 | — | — | ✅ |
| `setReviewThreadResolvedSmart`（线程解决/取消解决） | ✅ | ✗（REST 无端点） | — | — | ✅（GraphQL-only） |
| `updatePullRequestStateSmart`（关闭/重新打开；GraphQL closePullRequest/reopenPullRequest 需 pullRequestId） | ✅ | ✅ 降级 | — | — | ✅ |
| `pulls/update` 更新 PR 标题/body（fetchPullDetail 已含） | ✅ | ✅ | — | — | ✅ |
| **仓库 Overview** | | | | | |
| `fetchRecentBranchesSmart`（Recently touched branches 提示条：refs committedDate 排序取非默认分支；仅登录，失败静默空——GraphQL RefOrderField 仅 ALPHABETICAL/TAG_COMMIT_DATE 无 PUSHED_DATE，故前端排序） | ✅ | ✗（REST branches 无提交时间） | — | — | ✅（GraphQL-only + 静默） |
| **PR 详情侧栏** | | | | | |
| `setPullLockedSmart`（Lock conversation：GraphQL lockLockable 首选 + REST issues/lock 降级） | ✅ | ✅ | — | — | ✅ |
| `fetchPullProjectsSmart`（侧栏 Projects 只读：projectItems 项目 + Status 字段；GraphQL-only，失败静默空） | ✅ | ✗（REST 无 repo 级 projectsV2 关联） | — | — | ✅（GraphQL-only + 静默） |
| `fetchPullDevelopmentSmart`（侧栏 Development 只读：closingIssuesReferences 关联 issue；PullRequest 无 linkedBranches 字段→关联分支不可得恒空；GraphQL-only，失败静默空） | ✅ | ✗（REST 无对应） | — | — | ✅（GraphQL-only + 静默） |
| 侧栏编辑写操作（Assignees add/remove / Labels set-labels / Milestone issues.update） | ✗（需 node id 前置） | ✅ | — | — | ✅（REST） |
| **PR Conversation 时间线** | | | | | |
| `fetchPullTimelineSmart`（时间线事件混排：timelineItems first:100 覆盖 评论/评审/评审线程/commit/合并/关闭/标签/里程碑/指派/锁定/改题 等 21 类；GraphQL-only，失败返回 null → 页面降级回退「作者正文+评审列表+CommentsSection」） | ✅ | ✗（REST timeline 无对应通道） | — | — | ✅（GraphQL-only + 失败降级） |
| **Insights Pulse** | | | | | |
| `fetchPulseStatsSmart`（Pulse 统计卡：6 个 issueCount 一次 GraphQL） | ✅ | ✅ 降级（REST 并行 6 search） | — | — | ✅ |
| `fetchTopCommittersSmart`（Top committers：GraphQL Commit.history 抽样 + 前端聚合计数） | ✅ | ✅ 降级（REST 分页 2 页） | — | — | ✅ |
| **用户级列表（我的 issues / PR / Gists / 组织仓库）** | | | | | |
| `fetchMyIssuesSmart`（我的 issues：viewer.issues(filterBy) 游标分页；assigned/created/mentioned → filterBy assignee/createdBy/mentioned=@me，recent → 无过滤） | ✅ | ✅ 降级 | — | — | ✅ |
| `fetchMyPullsSmart`（我的 PR：search is:pr + qualifier；`... on PullRequest` 片段——PullRequest 非 Issue 子类型，`... on Issue` 不匹配；page>1 分页走 REST） | ✅ | ✅ 降级 | — | — | ✅ |
| `fetchMyGistsSmart`（我的 Gists：viewer.gists 游标分页；resourcePath 提取 REST gist id——GraphQL node id ≠ REST id，详情页 fetchGistDetail 需 REST id） | ✅ | ✅ 降级 | — | — | ✅ |
| `fetchOrgReposSmart`（组织仓库全量：organization.repositories(first:100) 含 diskUsage 大小） | ✅ | ✅ 降级 | — | — | ✅ |
### 2.2 保持 REST-only（⚠️ 有 GraphQL 但合理保留 / ✗ 无 GraphQL）—— 全部有据可查

| API 名 | octokit_graphQL | octokit_rest | selfcode_fetch | worker_proxy | already_smart_now | 不可抗力理由（§4） |
|---|---|---|---|---|---|---|
| `fetchCompare`（compare 页/新 PR diff） | ⚠️ | ✅ | — | — | ❌ | 4.1 GraphQL Comparison.files 缺 patch；**`compareCommitsWithBasehead` 类型化方法，basehead 整串传参（跨仓库 `owner:repo:branch` 全冒号格式）** |
| `mergeUpstream`（Sync fork → Update branch） | ✗ | ✅ | — | — | ❌ | GraphQL 无 merge-upstream；**`repos.mergeUpstream` 类型化方法** |
| `fetchGpgKeys`/`addGpgKey`/`deleteGpgKey` | ✗ | ✅ | — | — | ❌ | 4.3 GraphQL 无 gpgKeys 字段 / GpgKey 类型不存在 |
| `blockUser`/`unblockUser` | ⚠️ | ✅ | — | — | ❌ | 4.4 GraphQL 无 block mutation |
| `fetchJobLogs`（Actions 日志） | ✗ | ✅ | — | — | ❌ | 4.5 text/plain 非 JSON；GraphQL 碎片节点缺 jobs/logs |
| Actions 全家（`fetchWorkflows`/`fetchWorkflowRuns`/`fetchWorkflowRunDetail`/`fetchWorkflowRunJobs`/`fetchRunArtifacts`/`dispatchWorkflow`） | 🧩 碎片 | ✅ | — | — | ❌ | 4.5 碎片节点（Workflow/WorkflowRun），缺 `Repository.workflows` 列表入口 + jobs/logs/artifacts/dispatch |
| `fetchFileTree`/`fetchLanguages`/`fetchFileContent`(REST 版) | ✗ | ✅ | — | — | ❌ | 4.6 无 GraphQL 等价 / raw Accept；`fetchFileContent` 支持 `branch` 参数（默认 HEAD，非默认分支 404 修复）。**REST contents 上限 1MB→100MB**（1MB~100MB 必须 raw Accept）；smart 层 `fetchFileContentSmart` 分层（登录 GraphQL isTruncated→REST→$raw 保底 / 匿名 REST→raw 直连保底）；目录列举 / README 走 GraphQL 主通道（fetchDirContentsSmart / fetchReadmeSmart，见 §2.1） |
| `fetchContributorsCount` | ✗ | ✅ | — | — | ❌ | 4.7 Link header 分页计数（contributors 无 GraphQL totalCount 等价；releases 计数走 GraphQL，见 §2.1 fetchReleasesCountSmart） |
| 通知/邀请（`fetchNotifications`/`markNotificationThreadRead`/`fetchRepoInvitations`/`acceptRepoInvitation`/`declineRepoInvitation`） | ✗ | ✅ | — | — | ❌ | 4.8 GraphQL 无对应 |
| `updateDefaultBranch`（PATCH /user master_branch） | ✗ | ✅ | — | — | ❌ | 4.8 专属字段 |
| `fetchRateLimit` | ✗ | ✅ | — | — | ❌ | 4.8 专属端点 |
| `fetchPullFiles`/`fetchPullCommits`/`fetchPullCheckRuns`/`fetchPullReviewComments`(REST 版) | ✗ | ✅ | — | — | ❌ | 4.5/4.6 无 GraphQL 等价 |
| `transferRepository`/`leaveOrganization` | ✗ | ✅ | — | — | ❌ | 4.9 GraphQL 无 transferRepository/leaveOrganization mutation |
| **组织管理（全部固定 REST）** | | | | | | |
| `fetchOrgMembersWithRoles`（成员含角色/2FA，两请求合并） | ⚠️ 可迁 | ✅ | — | — | ❌ 待迁 | 4.17 OrganizationMemberEdge 有 role + hasTwoFactorEnabled（旧判断「无角色/2FA」有误） |
| `setOrgMemberRole` / `removeOrgMember`（PUT/DELETE memberships） | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无 members 写 mutation |
| `fetchOrgInvitations` / `createOrgInvitation` / `cancelOrgInvitation` | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无 invitations 查询/mutation |
| `fetchOrgTeams`（列表读） / `createOrgTeam` / `updateOrgTeam` / `deleteOrgTeam`（写） | ⚠️ 读可迁 | ✅ | — | — | ❌ 待迁 | 4.17 Organization.teams 可读；写无 createTeam/deleteTeam/updateTeam mutation |
| `fetchTeamMembers`（读） / `addTeamMember` / `removeTeamMember`（写） | ⚠️ 读可迁 | ✅ | — | — | ❌ 待迁 | 4.17 Team.members 可读；写无 addTeamMember/removeTeamMember mutation |
| `updateOrganizationSmart` 成员权限字段（`default_repository_permission` / `members_allowed_repository_creation_type`） | ✗（仅 Profile 字段走 GraphQL） | ✅ | — | — | ⚠️ | 4.17 权限字段仅 REST；smart 检测到权限字段时直接走 REST 分支（避免 GraphQL 成功后静默丢失） |
| `fetchOrgDetailSmart` 权限字段（`default_repository_permission`） | ✗ | ✅ | — | — | ⚠️ | 4.17 GraphQL Organization 无 `defaultRepositoryPermission` 字段（实测 404）；GraphQL 成功后轻量 REST 补丁该字段 |
| **Wiki** | | | | | | |
| `fetchWikiPage`（读） | ✗ | ✗ | ✅ | ✅ `/$wiki/{o}/{r}/{p}` | ❌ | 4.10 API 无 wiki 端点 + raw 被墙，worker 代理唯一解；**写**：无官方 API，仅 git 协议 push `.wiki.git` → 走本项目 git 镜像代理（`git-proxy.ts` 正则天然匹配 `pureGit.wiki.git`） |
| **Raw 代理** | | | | | | |
| `fetchRawSmart`/`rawUrlToProxy`/`rawImgFallbackSrc` | ✗ | ✗ | ✅ 直连优先 | ✅ `/$raw/{o}/{r}/{ref}/{p}` | ❌ | raw.githubusercontent.com 直连（CORS 可用时）→ 失败自动降级 `/$raw` 代理（README 图片等，MarkdownView onError 触发）；代理上游白名单仅 raw，匿名闸 `PROXY_ALLOW_ANON` |
| **Worker 端** | | | | | | |
| `/$auth/login` `/$auth/callback` `/$auth/pat` `/$auth/session`（GET 恢复 / **POST 补全用户元数据，worker 用 token 验证身份防伪造**） `/$auth/logout` `/$auth/prefs`（KV 键 `prefs:{userId}`） `/$auth/revoke` | — | — | — | ✅ | — | worker 专属 |
| `/$healthz`（健康检查探活；通用在线探活（外部监控/浏览器调试），无条件轻量 JSON） | — | — | — | ✅ | — | worker 专属 |
| git 镜像端点代理（clone/pull/push） | — | — | — | ✅ | — | worker 专属 |
| **已下线** | | | | | | |
| ~~`/$debug/session` 身份校验 API~~ | — | — | — | ~~✅~~ | — | **已删除**：`/$debug` 为纯前端路由（`web/src/App.tsx` lazy 页），worker 完全不参与，`DEBUG_ROUTE_ENABLE` 环境变量一并移除；调试页前端直连 api.github.com（复用主站会话 token 或匿名） |
| ~~`fetchRepoProjects`~~（`GET /repos/{o}/{r}/projects`） | ✗ | ~~✅~~ | — | — | — | **legacy Projects REST API 已随 GitHub 官方公告移除（2026-08 实测全 404，CORS 亦异常）**；Projects v2 仅 GraphQL。`RepositoryProject`/`fetchRepoProjects` 已删除 |
| ~~Saved replies 全家~~（`fetchSavedReplies`/`createSavedReply`/`updateSavedReply`/`deleteSavedReply`，`GET/POST/PATCH/DELETE /user/saved_replies`） | ✗ | ~~✅~~ | — | — | — | **GitHub 已移除 Saved replies REST API**（2024-07 官方公告）；官方仅保留网页版（github.com/settings/replies）。`SavedReply`/4 函数/页面/侧栏项/i18n 键已删除 |
| **Projects v2（GraphQL only）** | | | | | | |
| `fetchRepoProjectsV2Smart`（仓库 Projects v2 列表） | ✅ 固定 GraphQL | ✗ | — | — | — | **无 REST 等价**（legacy 已下线）；smart 层固定 GraphQL（`REPO_PROJECTS_V2_QUERY`）。**scope 铁律**：GraphQL `projectsV2` 字段运行时**强制要求 `read:project`/`project` scope**（实测，repo 不涵盖！官方 scopes 文档描述有误导）→ 登录 scope 已含（worker `buildGitHubScope`）；查漏补缺基准见 `lib/scopes.ts` |

---

## 3. smart 包装实施模板（新增双端点 API 时照抄）

在 `graphql.ts` 加模板（路径参数 → 变量）→ `api.ts` 加 smart 函数（**GraphQL 唯一实现 + withRestFallback 降级**）→ 页面从 `@/lib/api` import。

```ts
// graphql.ts —— 请求模板（路径参数 :owner/:repo → 变量 $owner/$name）
export const XXX_QUERY = /* GraphQL */ `
  query Xxx($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ...按需字段（GraphQL 只取页面用到的，优于 REST 全量）
    }
  }
`;

// api.ts —— smart 函数（GraphQL 唯一主通道；匿名短路 REST；失败 withRestFallback 降级）
export async function fetchXxxSmart(
  owner: string, repo: string, token?: string | null
): Promise<Xxx[]> {
  if (!token) {
    // 匿名强制 REST（GraphQL 匿名恒 403）——REST 数据层保留的唯一原因
    return fetchXxx(owner, repo, token);
  }
  const resp: GraphQLResponse<{ repository: { ... } | null }> =
    await graphqlRequest(XXX_QUERY, { owner, name: repo }, token);
  if (!hasGraphQLErrors(resp) && resp.data?.repository) {
    return resp.data.repository...; // 类型映射（toXxx）
  }
  // GraphQL 失败 → withRestFallback 熔断降级 REST（复用 rest 层；日志 ↪ 标记）
  return withRestFallback(() => fetchXxx(owner, repo, token), "fetchXxxSmart", resp);
}
```

**Mutation 模式**（GraphQL mutation 需 node id 前置查询，见 `setIssueSubscriptionSmart`）：
1. 先 `REPOSITORY_ID_QUERY` / `ISSUE_ID_QUERY` / `USER_ID_QUERY` 查 node id
2. 再发 mutation；失败 → `withRestFallback` 降级 REST（复用 rest 层）

---

## 4. 不可抗力清单（GraphQL 无适配 → 保持 REST；审计时先查这里）

> 本节仅登记 **GraphQL 无适配**（schema 无对应字段/端点/能力）的 REST 保留项；有 GraphQL 适配的 API 见 §2.1。

| # | API | 理由 |
|---|---|---|
| 4.1 | `fetchCompare` | GraphQL `Comparison.files` 只有 path/additions/deletions，**无 patch 内容**；DiffView 渲染需要 patch。 |
| 4.2 | `updateRepository` | GraphQL 有 `updateRepository` mutation（name/description/homepageUrl/has*Enabled）+ 独立 archiveRepository/unarchiveRepository；但 **private（可见性）与 default_branch 无 GraphQL mutation**——走 hybrid（updateRepositorySmart：可 GraphQL 字段走 mutation，private/default_branch 增补 REST，熔断全 REST）。 |
| 4.3 | GPG keys | GraphQL **无 gpgKeys 字段 / GpgKey 类型不存在**（`Viewer` / `Repository` 均无，apiidx 实测）；REST 有完整 emails/subkeys/can_* 字段。 |
| 4.4 | block / unblock | GraphQL **无 block mutation**（仅 unblock）；block 保留 REST。 |
| 4.5 | Actions / Job 日志 | GraphQL **仅碎片节点**（`Workflow`/`WorkflowRun`/`WorkflowRunFile`，经 `CheckSuite.workflowRun` 到达，`Workflow.runs` 列 runs），但**缺 `Repository.workflows` 列表入口、jobs/logs/artifacts 查询、dispatch mutation** → 无法替代 REST Actions 全家；`fetchJobLogs` 是 text/plain 流，非 JSON。 |
| 4.6 | 文件内容 / 树 / 语言 | GraphQL 无 raw content 通道；contents API 需 `application/vnd.github.raw` 自定义 Accept。REST contents **上限 100MB**（1MB~100MB 必须 raw Accept）；GraphQL Blob 仍 ~1MB 截断（**`isTruncated` 必须检查**——>1MB 时 text 非 null 但含部分内容）；官方无分段读取参数——>100MB 仅 git clone/archive 可达。**分层通道**：登录 API smart（GraphQL→REST）→ `$raw` 保底（会话 token 透传）；匿名 REST → raw 直连保底。目录列举 / README 走 GraphQL 主通道（Tree.entries + blob 有等价）；文件树 get-tree recursive 保留 REST（`Tree.entries` 无递归参数，全量树需 N+1 逐层下钻，大仓库退化） |
| 4.7 | 计数（Contributors） | `per_page=1` 读 Link header 末页；releases 计数走 GraphQL totalCount（`fetchReleasesCountSmart`），仅 contributors 保留 Link header。 |
| 4.8 | 通知 / 邀请 / default branch / rate_limit | GraphQL 无对应端点或专属字段。 |
| 4.9 | 低频管理写操作（transferRepository / leaveOrganization） | GraphQL **无对应 mutation**（transferRepository/leaveOrganization 均无）。 |
| 4.10 | Wiki | API 无 wiki 端点（实测 404）；前端直连 raw 被墙 → worker `/$wiki` 代理。 |
| 4.11 | `deleteSshKey` | GraphQL 需 node id，REST 数字 id 无法可靠映射到 GraphQL id → smart 函数内部直连 REST（入口统一，避免页面误用）。 |
| 4.12 | 修改用户名（Change username） | `PATCH /user` body **无 login 字段**（仅 name/email/blog/company/location/hireable/bio/twitter/pronouns）；改名走网页内部端点 + 密码验证，API 不可达（C9 调研确认）。 |
| 4.13 | 设置主邮箱（Set as primary） | Emails API 仅 GET/POST/DELETE `/user/emails` + `PATCH /user/email/visibility`（主邮箱**可见性**）；「Make primary」为网页内部端点，API 无公开通道（C9 调研确认）。 |
| 4.14 | 安全公告（Security） | `SecurityAdvisory` 类型存在（ghsaId/databaseId/cvss/cwes/description），但 **`Repository.securityAdvisories` 入口不存在**（apiidx 实测）→ 入口不清晰，维持 REST `GET /repos/{o}/{r}/security-advisories`（公开仓库 published 匿名可读）。 |
| 4.15 | contents `new_branch` | **实测**：PUT contents body 带 `new_branch` 返回 201 但**被静默忽略**——提交仍落在 `branch` 指定的原分支（新分支 404）。官方「新建分支提交」是两段式：先建分支再提交（`createBranch` 封装，FileEditorPage PR 模式使用）。**注**：GraphQL 有 `createRef` mutation（等价 POST git/refs 建分支）与 `createCommitOnBranch`（写文件，需 expectedHeadOid+FileChanges，比 REST contents 复杂）——「建分支/写文件」严格说有 GraphQL 通道，属 §4.18 待评估项而非绝对无适配。 |
| 4.16 | Dependabot / Code scanning / Secret scanning | 需 `security_events` scope（OAuth 未授）+ 高级安全功能；仅 Security 核心（SECURITY.md + advisories）实现，告警 tab 去杂项。 |
| 4.17 | 组织管理（成员角色/2FA、邀请、团队） | **读可迁、写维持 REST**（apiidx 实测修正）：① 成员含角色/2FA **可迁**——`Organization.membersWithRole` 的 `OrganizationMemberEdge.role` + `hasTwoFactorEnabled` 字段存在（旧判断「无角色/2FA 字段」有误）；② 团队列表/成员读 **可迁**——`Organization.teams` → `Team.members`/`Team.repositories`；③ **写维持 REST**——createTeam/deleteTeam/updateTeam/addTeamMember/removeTeamMember、members 写、invitations 查询/mutation 均无 GraphQL mutation。仓库创建权限字段 **REST-only**（`Organization` 上四候选名均 undefinedField 实测）；组织重命名无公开 API。 |
| 4.18 | 建分支 / 写文件内容 | GraphQL **有 mutation 但复杂度高**：`createRef`/`updateRef`/`deleteRef`（=建分支，等价 POST git/refs）、`createCommitOnBranch`（=写文件，需 `expectedHeadOid` + `FileChanges`（逐文件 base64 内容）+ `message`，需自行构造 git tree/blob/commit 链，REST `PUT /contents` 封装了全流程）。当前维持 REST（`createBranch`/`updateFileContent`），属「复杂度」待评估项而非「无适配」。 |

---

## 4.5 官方 GraphQL 主题 → 入口映射（语义搜索补全）

> **背景**：官方 GraphQL 文档按主题组织（`docs.github.com/en/graphql/reference` 共 33 类：Actions/Teams/Orgs/Git/...），但主题的**实际 GraphQL 入口名常与主题词不对应**（如 Actions 的入口是 `Workflow`/`WorkflowRun` 而非 `"actions"`，Teams 的入口在 `Organization.teams` 而非根字段）。`apiidx gql search` 只搜根字段名/描述，语义搜索搜不到这些「名字对不上」的入口。
> **工具补全**：`apiidx.mjs` 内置 `GQL_TOPICS` 映射表 + `gql topic <关键词>` 子命令；`gql search` 无命中时自动提示主题映射。**判断 GraphQL 有无适配前，先用 `gql topic` 查主题入口，勿凭语义搜索「搜不到」即判「无适配」。**

| 主题 | 关键词 | 实际入口（类型/字段） | 能力评估 |
|---|---|---|---|
| Actions | actions / workflow / ci | `Workflow` / `WorkflowRun` / `WorkflowRunFile`（经 `CheckSuite.workflowRun` 到达） | 🧩 碎片：缺 `Repository.workflows` 列表入口、jobs/logs/artifacts、dispatch → 维持 REST |
| Teams | teams / team / 团队 | `Organization.teams` → `Team.members` / `Team.repositories` | 🧩 读可迁、写无 mutation → 写维持 REST |
| Orgs | org member / member role / 成员 / 角色 / 2fa | `Organization.membersWithRole` → `OrganizationMemberEdge.role` / `hasTwoFactorEnabled` | ✅ 成员含角色/2FA 可迁 |
| Git | git / branch / ref / 分支 / 写文件 / commit | `createRef` / `updateRef` / `deleteRef` / `createCommitOnBranch` | ⚠️ 建分支/写文件有 mutation 但复杂（需 FileChanges 树） |
| Activity | notification / 通知 / feed / 动态 | — | ✗ `Viewer.notifications` 不存在 → 维持 REST |
| Users | gpg / ssh key / 公钥 | — | ✗ 无 `gpgKeys` 字段 / `GpgKey` 类型 → 维持 REST |
| Security Advisories | security advisory / ghsa / 漏洞 | `SecurityAdvisory`（ghsaId/databaseId/cvss/cwes） | ⚠️ 类型存在但 `Repository.securityAdvisories` 入口不存在 → 维持 REST |
| Checks | check run / check suite / ci status | `CheckSuite` / `CheckRun`（`Commit.statusCheckRollup`） | ✅ 有入口（项目当前走 REST check-runs） |
| Issues / Pulls / Discussions / Gists / Releases / Search / Repos / Users / Projects / Branches / Commits / Packages / Dependabot / Deploy Keys / Deployments / Apps / Reactions / Licenses / Sponsors / Dependency Graph / Meta / Migrations / Enterprise Admin | — | 见 `gql topic <主题>`（入口清晰，已按 §0.2 四分类正常处置） | ✅ 入口清晰 |

---

## 5. 新增 API / 新页面接入 CheckList

1. **先读 §0 准则**：判断目标 API 属「有 GraphQL 适配」（smart 化：登录 GraphQL 主通道 + 匿名 REST + withRestFallback 降级）还是「无 GraphQL 适配」（§4 不可抗力）还是「GraphQL-only」。用 `apiidx gql topic <主题>` 查主题入口映射（§4.5）+ `rest` + `gql type/field` 递进确认——**勿凭语义搜索「搜不到」即判「无适配」**。
2. **双端点** → 走 §3 模板：**graphql.ts 请求模板（路径参数 → 变量）+ api.ts smart（GraphQL 唯一实现 + withRestFallback 降级）** + 页面 `@/lib/api` import。**禁止**页面直接 `@/lib/rest`。
3. **匿名/单端点/不可抗力** → `@/lib/rest`：**固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法**（URL 模板/参数编码 SDK 保证，禁止手拼 URL 的 `githubFetch`/`fetchWithTimeout`）；仅特殊语义端点（raw Accept / base64 解码 / Link 头分页 / Octokit 无类型化方法）可保留底层通道并注释理由。**类型化方法名查证**：`node_modules/.pnpm/@octokit+plugin-rest-endpoi_*/node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/generated/endpoints.js`（或类型定义 method-types.d.ts）grep 端点路径 → 方法名。
4. **204 空响应体**：`typedRequest`/`githubFetch` 已自动处理（空 body 返回 undefined），**无需**再手写 fetchWithTimeout 判定。
5. **Mutation 需 node id**：先查 id（REPOSITORY_ID_QUERY 等）再 mutation，失败 → `withRestFallback` 降级 REST（复用 rest 层）。
6. **类型映射**：GraphQL 节点 → REST 结构统一在 api.ts 内 `toXxx()` 完成；页面只见 REST 形态。REST 类型化方法返回较宽时用 `typedRequest<T>` 泛型收窄（`as T` 桥接，调用方接口负责语义）。
7. **构建校验**：`pnpm --filter web build`（tsc 全量类型检查）。
8. **文档同步**：新 API 若属「双端点未 smart」或新增不可抗力，更新本表 §2/§4；REST 熔断降级（withRestFallback）覆盖情况同步标注。

---

## 6. 审计速查

- **页面 import 卫生**：grep `from "@/lib/rest"`（页面文件）——只应出现类型 import、匿名直连与不可抗力函数（§4 清单内）。
- **smart 覆盖率**：grep `fetch\w+Smart`（api.ts）对照 §2.1 清单。
- **裸 fetch**：grep `fetch(`（web/src）——只允许 `wiki.ts`（worker 代理）与 octokit 内部。
- **REST 降级覆盖**：grep `withRestFallback`（api-*.ts）——对照 §2.1 清单确认降级链覆盖度；未覆盖的路由补 withRestFallback。
- **legacy 端点**：改版前先 curl 实测端点存活（教训：`/repos/{o}/{r}/projects` 已随官方移除公告下线返回 404，页面请求无意义）。
