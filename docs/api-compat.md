# API 兼容性对照表单与实施指导（api-compat）

> 权威文档 · API 实施指导
> 目的：**一页审计全部 API 的实现方式**；新增 API / 新页面接入时的**唯一实施指导**。
> 配套：`architecture.md`（架构设计）。本文档为 API 策略（Octokit 统一封装 + 用户可选主模式）的**执行落地表单**。

---

## 1. 分层架构（先看这个，再查表）

```
页面 / 组件
   │  只允许 import "@/lib/api"（smart 层）—— 例外见 §5
   ▼
web/src/lib/api.ts ─── 桶（barrel，17 行）：re-export api 板块 + rest 全量
   ├─ api-core.ts       graphqlRequest 模式包装 + 日志/熔断工具 + hasGraphQLErrors/GraphQLResponse
   ├─ api-user.ts       viewer/账户/邮箱/组织列表/SSH/关注
   ├─ api-repo.ts       仓库详情/创建/star/fork/主题/订阅/删除/计数
   ├─ api-org.ts        用户/组织主页 + 组织详情/更新/成员
  ├─ api-issue.ts      issue/PR + 评论/评审 + 页面级合并查询
  ├─ api-discussions.ts Discussions
  └─ api-search.ts     搜索
web/src/lib/rest.ts ── 桶（17 行）：re-export rest 板块（REST 全量）
   ├─ rest-core.ts      底层（restRequest/githubFetch/typedRequest/ApiError/通用类型）
   ├─ rest-account.ts   账户（emails/SSH/GPG/blocked/saved-replies）
   ├─ rest-user-org.ts  用户主页 + 关注 + 组织
   ├─ rest-repo.ts      仓库浏览/管理 + 代码内容 + Release
   ├─ rest-issue-pr.ts  Issue/PR + 评论 + 类型
   ├─ rest-user-nav.ts  用户导航（Gist/通知/邀请/Feed/搜索）
   ├─ rest-actions.ts   Actions 全家
   └─ rest-discussions.ts Discussions 类型
web/src/lib/graphql.ts ── GraphQL 查询/变更模板（常量，板块可直接 import）
web/src/lib/octokit.ts ── SDK 统一入口（额度跟踪 / 模式熔断 / 响应缓存 / 去重）
web/src/lib/wiki.ts ── Wiki（唯一 selfcode_fetch → worker /$wiki 代理）
worker/src/ ── OAuth2（/$auth/*）+ git 代理 + /$wiki /$raw 代理
```

**三条铁律**：
1. **所有请求都经 octokit SDK**（REST `@octokit/rest`、GraphQL `@octokit/graphql`）——自动额度跟踪；唯一绕过 SDK 的是 `wiki.ts`（worker 代理，不可抗力）。**REST 固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法**（URL 模板/参数编码/返回类型由 SDK 生成代码保证）；仅特殊语义端点（raw Accept / base64 解码 / Link 头分页 / Octokit 无类型化方法的端点）保留 `githubFetch`/`fetchWithTimeout`（`octokit.request` 底层，注释说明理由），**禁止新增手拼 URL 调用**。
2. **双端点（GraphQL+REST 都有）的 API 一律 smart 包装**：页面从 `@/lib/api` import `fetchXxxSmart`。
3. **单端点 API 走 SDK 标准调用**；特殊语义（204/raw Accept/Link 头）集中在 `rest-*.ts` 内注释说明，不扩散到页面。

**文件组织**：
- 原 `github.ts`（2829 行）/ `api.ts`（2362 行）按业务板块拆分为「板块文件 + 桶」；桶 re-export 全部符号，**页面 import 面零改动**。
- **命名**：REST 数据层 = `rest.ts` + `rest-*.ts`（原 `github.ts`/`github-*.ts`，改名消除「github 前缀 = 一切 GitHub 相关」歧义）；smart 层 = `api.ts` + `api-*.ts`；模板 = `graphql.ts`；SDK 基础设施 = `octokit.ts`。
- 新增 API 归属：数据层函数放对应 `rest-*.ts`，smart 包装放对应 `api-*.ts`，GraphQL 模板放 `graphql.ts`。
- 板块文件 >800 行时再拆（`api-issue.ts` 已拆出 `api-discussions.ts`/`api-search.ts`）。

---

## 2. 全量 API 兼容性对照表单

> 列含义：`octokit_graphQL`=有 GraphQL 端点且已接入；`octokit_rest`=有 REST 端点（经 SDK）；`selfcode_fetch`=原生 fetch 绕过 SDK；`worker_proxy`=走 Cloudflare Worker 代理；`already_smart_now`=已做 GraphQL 首选+REST 降级包装。
> `✅`=已实现　`✗`=无此通道　`—`=不适用　`❌`=应做未做（禁）　`⚠️`=有通道但合理保留 REST（理由见 §4）

### 2.1 智能封装层（smart，GraphQL 首选 + REST 降级）—— ✅ 全部就绪

| API 名（smart 入口） | octokit_graphQL | octokit_rest | selfcode_fetch | worker_proxy | already_smart_now |
|---|---|---|---|---|---|
| `fetchViewerSmart` 当前用户画像 | ✅ | ✅ | — | — | ✅ |
| `fetchCurrentUserSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchUserEmailsSmart` / `addUserEmailsSmart` 等 | ✅ | ✅ | — | — | ✅ |
| `fetchUserOrgsSmart` / `fetchOrgMemberships` | ✅ | ✅ | — | — | ✅ |
| `fetchMyReposSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepositorySmart`（含 id/star/watch/features） | ✅ | ✅ | — | — | ✅ |
| `fetchRepositoryIdSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchUserProfileSmart` / `fetchOrgProfileSmart` / `fetchOrgDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `updateUserProfileSmart` / `updateOrganizationSmart` / `createRepositorySmart` | ✅ | ✅ | — | — | ✅ |
| `fetchIssuesSmart` / `fetchIssueDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `createIssueSmart` / `setIssueSubscriptionSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchPullsSmart` / `fetchPullDetailSmart` / `createPullRequestSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchReleasesSmart` / `fetchReleaseDetailSmart` | ✅ | ✅ | — | — | ✅ |
| `isStarredSmart` / `setStarredSmart` / `forkRepositorySmart` | ✅ | ✅ | — | — | ✅ |
| `searchRepositoriesSmart` / `searchUsersSmart` / `searchIssuesSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchDiscussionsSmart` / `fetchDiscussionDetailSmart` / `createDiscussionSmart` / `addDiscussionCommentSmart` | ✅ | ✗（REST 无端点） | — | — | ✅ |
| **A 类整改新增** | | | | | |
| `fetchOrgMembersSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchIssueCommentsSmart` / `addIssueCommentSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchPullReviewCommentsSmart` / `addPullReviewCommentSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchBranchesSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepoLabelsSmart` / `fetchRepoAssigneesSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchSshKeysSmart` / `addSshKeySmart` / `deleteSshKeySmart` | ✅ | ✅ | — | — | ✅ |
| `isFollowingSmart` / `setFollowingSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepoTopicsSmart` / `replaceRepoTopicsSmart` | ✅ | ✅ | — | — | ✅ |
| `fetchRepoSubscriptionSmart` / `setRepoSubscriptionSmart` | ✅ | ✅ | — | — | ✅ |
| `deleteRepositorySmart` | ✅ | ✅ | — | — | ✅ |
| **页面级合并优化** | | | | | |
| `fetchIssueDetailWithCommentsSmart`（Issue 详情+评论单请求） | ✅ | ✅ 分步降级 | — | — | ✅ |
| `fetchPullDetailWithCommentsSmart`（PR 详情+评论单请求） | ✅ | ✅ 分步降级 | — | — | ✅ |
| `fetchReleasesCountSmart`（GraphQL totalCount 替代 Link header） | ✅ | ✅ | — | — | ✅ |
| `fetchLatestReleaseSmart`（About 侧栏 Releases 入口：GraphQL totalCount+nodes(first:1) 一次查询 / REST per_page=1 一次请求） | ✅ | ✅ | — | — | ✅ |
| **B1 评审工作流（2026-08-12 新增）** | | | | | |
| `fetchPullReviewSummarySmart`（reviewDecision+reviews+reviewRequests+mergeable，PR 详情 Reviewers 栏/合并判定） | ✅ | ✅ 降级（reviewDecision 由 reviews 推断） | — | — | ✅ |
| `submitPullReviewSmart`（三态：COMMENT/APPROVE/REQUEST_CHANGES） | ✅ | ✅ 降级 | — | — | ✅ |
| `mergePullRequestSmart`（merge/squash/rebase） | ✅ | ✅ 降级 | — | — | ✅ |
| `requestReviewersSmart`（GraphQL 需 userIds 前置查询；REST 直接 reviewers 数组） | ✅ | ✅ 降级 | — | — | ✅ || `setReviewThreadResolvedSmart`（线程解决/取消解决） | ✅ | ✗（REST 无端点） | — | — | ✅（GraphQL-only） |
| `updatePullRequestStateSmart`（关闭/重新打开） | ✗（需 node id 前置） | ✅ | — | — | ✅（REST） |
| `pulls/update` 更新 PR 标题/body（fetchPullDetail 已含） | ✅ | ✅ | — | — | ✅ |
| **仓库 Overview 增强（2026-08-12 新增）** | | | | | | |
| `fetchRecentBranchesSmart`（Recently touched branches 提示条：refs committedDate 排序取非默认分支；仅登录，失败静默空——GraphQL RefOrderField 仅 ALPHABETICAL/TAG_COMMIT_DATE 无 PUSHED_DATE，故前端排序） | ✅ | ✗（REST branches 无提交时间） | — | — | ✅（GraphQL-only + 静默） || **PR 详情侧栏增强（B1 补 2026-08-12 新增）** | | | | | |
| `setPullLockedSmart`（Lock conversation：GraphQL lockLockable 首选 + REST issues/lock 降级） | ✅ | ✅ | — | — | ✅ |
| `fetchPullProjectsSmart`（侧栏 Projects 只读：projectItems 项目 + Status 字段；GraphQL-only，失败静默空） | ✅ | ✗（REST 无 repo 级 projectsV2 关联） | — | — | ✅（GraphQL-only + 静默） |
| `fetchPullDevelopmentSmart`（侧栏 Development 只读：closingIssuesReferences + linkedBranches；GraphQL-only，失败静默空） | ✅ | ✗（REST 无对应） | — | — | ✅（GraphQL-only + 静默） |
| 侧栏编辑写操作（Assignees add/remove / Labels set-labels / Milestone issues.update） | ✗（需 node id 前置） | ✅ | — | — | ✅（REST） |
| **PR Conversation 时间线（PullTimeline，2026-08-12 新增）** | | | | | | |
| `fetchPullTimelineSmart`（时间线事件混排：timelineItems first:100 覆盖 评论/评审/评审线程/commit/合并/关闭/标签/里程碑/指派/锁定/改题 等 21 类；GraphQL-only，失败返回 null → 页面降级回退「作者正文+评审列表+CommentsSection」） | ✅ | ✗（REST timeline 无对应通道） | — | — | ✅（GraphQL-only + 失败降级） |
### 2.2 保持 REST-only（⚠️ 有 GraphQL 但合理保留 / ✗ 无 GraphQL）—— 全部有据可查

| API 名 | octokit_graphQL | octokit_rest | selfcode_fetch | worker_proxy | already_smart_now | 不可抗力理由（§4） |
|---|---|---|---|---|---|---|
| `fetchCompare`（compare 页/新 PR diff） | ⚠️ | ✅ | — | — | ❌ | 4.1 GraphQL Comparison.files 缺 patch；**`compareCommitsWithBasehead` 类型化方法，basehead 整串传参（跨仓库 `owner:repo:branch` 全冒号格式）** |
| `mergeUpstream`（Sync fork → Update branch） | ✗ | ✅ | — | — | ❌ | GraphQL 无 merge-upstream；**`repos.mergeUpstream` 类型化方法** |
| `updateRepository`（设置页任意字段 PATCH） | ⚠️ | ✅ | — | — | ❌ | 4.2 UpdateRepositoryInput 全字段展开收益低 |
| `fetchGpgKeys`/`addGpgKey`/`deleteGpgKey` | ⚠️ | ✅ | — | — | ❌ | 4.3 GraphQL gpgKey 仅 5 字段，REST 需 emails/subkeys/can_* |
| `blockUser`/`unblockUser` | ⚠️ | ✅ | — | — | ❌ | 4.4 GraphQL 无 block mutation |
| `fetchJobLogs`（Actions 日志） | ✗ | ✅ | — | — | ❌ | 4.5 text/plain 非 JSON；GraphQL 无 actions 通道 |
| Actions 全家（`fetchWorkflows`/`fetchWorkflowRuns`/`fetchWorkflowRunDetail`/`fetchWorkflowRunJobs`/`fetchRunArtifacts`/`dispatchWorkflow`） | ✗ | ✅ | — | — | ❌ | 4.5 GraphQL 无 actions 查询 |
| `fetchFileContent`/`fetchReadme`/`fetchFileTree`/`fetchDirContents`/`fetchLanguages` | ✗ | ✅ | — | — | ❌ | 4.6 raw Accept / 无 GraphQL 等价；`fetchFileContent` 支持 `branch` 参数（默认 HEAD，非默认分支 404 修复）。**REST contents 上限 1MB→100MB**（1MB~100MB 必须 raw Accept，已满足）；smart 层 `fetchFileContentSmart` 分层（登录 GraphQL isTruncated→REST→$raw 保底 / 匿名 REST→raw 直连保底） |
| `fetchRootFiles`（About Resources 根文件探测，git trees 顶层；GraphQL 有 object(expression) tree 等价但 REST 简单） | ⚠️ | ✅ | — | — | ❌ | 4.6 trees 顶层列表，REST 足够 |
| `fetchReleasesCount`/`fetchContributorsCount` | ⚠️ | ✅ | — | — | ❌ | 4.7 Link header 分页计数（releases 可改 GraphQL totalCount，低优先） |
| 通知/邀请（`fetchNotifications`/`markNotificationThreadRead`/`fetchRepoInvitations`/`acceptRepoInvitation`/`declineRepoInvitation`） | ✗ | ✅ | — | — | ❌ | 4.8 GraphQL 无对应 |
| `updateDefaultBranch`（PATCH /user master_branch） | ✗ | ✅ | — | — | ❌ | 4.8 专属字段 |
| `fetchRateLimit` | ✗ | ✅ | — | — | ❌ | 4.8 专属端点 |
| `fetchPullFiles`/`fetchPullCommits`/`fetchPullCheckRuns`/`fetchPullReviewComments`(REST 版) | ✗ | ✅ | — | — | ❌ | 4.5/4.6 无 GraphQL 等价 |
| `transferRepository`/`leaveOrganization`/`updateIssueState`/`updateDefaultBranch` 等写操作 | ⚠️ | ✅ | — | — | ❌ | 4.9 低频管理操作，GraphQL mutation 需 node id 前置查询，收益低 |
| **组织管理（全部固定 REST）** | | | | | | |
| `fetchOrgMembersWithRoles`（成员含角色/2FA，两请求合并） | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL membersWithRole 无角色/2FA 字段；角色=admin 子集合并 |
| `setOrgMemberRole` / `removeOrgMember`（PUT/DELETE memberships） | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无 members 写 mutation |
| `fetchOrgInvitations` / `createOrgInvitation` / `cancelOrgInvitation` | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无 invitations 查询/mutation |
| `fetchOrgTeams` / `createOrgTeam` / `updateOrgTeam` / `deleteOrgTeam` | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无团队 CRUD 等价 |
| `fetchTeamMembers` / `addTeamMember` / `removeTeamMember` | ✗ | ✅ | — | — | ❌ | 4.17 GraphQL 无团队成员管理等价 |
| `updateOrganizationSmart` 成员权限字段（`default_repository_permission` / `members_allowed_repository_creation_type`） | ✗（仅 Profile 字段走 GraphQL） | ✅ | — | — | ⚠️ | 4.17 权限字段仅 REST；smart 检测到权限字段时直接走 REST 分支（避免 GraphQL 成功后静默丢失） |
| `fetchOrgDetailSmart` 权限字段（`default_repository_permission`） | ✗ | ✅ | — | — | ⚠️ | 4.17 GraphQL Organization 无 `defaultRepositoryPermission` 字段（实测 404）；GraphQL 成功后轻量 REST 补丁该字段 |
| `fetchRepoSubscription`/`setRepoSubscription`（REST 版） | ⚠️ | ✅ | — | — | ❌ | smart 已接管，REST 版仅作降级底层 |
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
| **已下线** | | | | | | |
| ~~`fetchRepoProjects`~~（`GET /repos/{o}/{r}/projects`） | ✗ | ~~✅~~ | — | — | — | **legacy Projects REST API 已随 GitHub 官方公告移除（2026-08 实测全 404，CORS 亦异常）**；Projects v2 仅 GraphQL。`RepositoryProject`/`fetchRepoProjects` 已删除 |
| ~~Saved replies 全家~~（`fetchSavedReplies`/`createSavedReply`/`updateSavedReply`/`deleteSavedReply`，`GET/POST/PATCH/DELETE /user/saved_replies`） | ✗ | ~~✅~~ | — | — | — | **GitHub 已移除 Saved replies REST API**（2024-07 官方公告；实测 `docs.github.com/en/rest/users/saved-replies` 文档页与 `api.github.com/user/saved_replies` 均 404）；官方仅保留网页版（github.com/settings/replies）。`SavedReply`/4 函数/页面/侧栏项/i18n 键已删除 |
| **Projects v2（GraphQL only）** | | | | | | |
| `fetchRepoProjectsV2Smart`（仓库 Projects v2 列表） | ✅ 固定 GraphQL | ✗ | — | — | — | **无 REST 等价**（legacy 已下线）；smart 层固定 GraphQL（`REPO_PROJECTS_V2_QUERY`）。**scope 铁律**：GraphQL `projectsV2` 字段运行时**强制要求 `read:project`/`project` scope**（实测，repo 不涵盖！官方 scopes 文档描述有误导）→ 登录 scope 已含（worker `buildGitHubScope`）；查漏补缺基准见 `lib/scopes.ts` |

---

## 3. smart 包装实施模板（新增双端点 API 时照抄）

在 `graphql.ts` 加模板 → `api.ts` 加 smart 函数（GraphQL 首选 try/catch + REST 降级）→ 页面从 `@/lib/api` import。

```ts
// graphql.ts —— 模板
export const XXX_QUERY = /* GraphQL */ `
  query Xxx($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ...按需字段（GraphQL 只取页面用到的，优于 REST 全量）
    }
  }
`;

// api.ts —— smart 函数（模式照抄 fetchIssuesSmart）
export async function fetchXxxSmart(
  owner: string, repo: string, token?: string | null
): Promise<Xxx[]> {
  if (token) {                       // GraphQL 需认证；未登录直接 REST
    try {
      const resp: GraphQLResponse<{ repository: {...} | null }> =
        await graphqlRequest(XXX_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository... // 类型映射（toXxx）
      }
    } catch { /* 网络错误 → 降级 REST */ }
  }
  return fetchXxx(owner, repo, token); // rest.ts REST 底层
}
```

**Mutation 模式**（GraphQL mutation 需 node id 前置查询，见 `setIssueSubscriptionSmart`）：
1. 先 `REPOSITORY_ID_QUERY` / `ISSUE_ID_QUERY` / `USER_ID_QUERY` 查 node id
2. 再发 mutation；失败 `catch` → REST 兜底

---

## 4. 不可抗力清单（保持 REST-only 的理由，审计时先查这里）

| # | API | 理由 |
|---|---|---|
| 4.1 | `fetchCompare` | GraphQL `Comparison.files` 只有 path/additions/deletions，**无 patch 内容**；DiffView 渲染需要 patch。 |
| 4.2 | `updateRepository` | 任意字段 PATCH（description/homepage/default_branch/archived...）；GraphQL `UpdateRepositoryInput` 需全字段展开，映射收益低。 |
| 4.3 | GPG keys | GraphQL `gpgKey` 仅 id/publicKey/email/createdAt/verified；页面需 key_id/emails/can_sign（REST 有）。 |
| 4.4 | block | GraphQL **无 block mutation**（只有 unblock）；unblock 需前置 userId 查询，收益低，一并保持 REST。 |
| 4.5 | Actions / Job 日志 | GraphQL **无 actions 查询通道**；`fetchJobLogs` 是 text/plain 流，非 JSON。 |
| 4.6 | 文件内容 / readme / 树 / 语言 | GraphQL 无 raw content 通道；contents API 需 `application/vnd.github.raw` 自定义 Accept。**修订**：REST contents **上限 100MB**（官方 2022-05 起，1MB~100MB 必须 raw Accept）；GraphQL Blob 仍 ~1MB 截断（**`isTruncated` 必须检查**——>1MB 时 text 非 null 但含部分内容）；官方无分段读取参数——>100MB 仅 git clone/archive 可达。**分层通道**：登录 API smart（GraphQL→REST）→ `$raw` 保底（会话 token 透传）；匿名 REST → raw 直连保底 |
| 4.7 | 计数（Releases/Contributors） | `per_page=1` 读 Link header 末页；releases 计数可改 GraphQL totalCount（低优先 TODO）。 |
| 4.8 | 通知 / 邀请 / default branch / rate_limit | GraphQL 无对应端点或专属字段。（Saved replies 已从本项移除：端点被 GitHub 整体下线，见 §3 已下线表） |
| 4.9 | 低频管理写操作 | mutation 需 node id 前置查询（2 次请求），低频页面收益低，保留 REST 直连。 |
| 4.10 | Wiki | API 无 wiki 端点（实测 404）；前端直连 raw 被墙 → worker `/$wiki` 代理。 |
| 4.11 | `deleteSshKey` | GraphQL 需 node id，REST 数字 id 无法可靠映射到 GraphQL id → smart 函数内部直连 REST（入口统一，避免页面误用）。 |
| 4.12 | 修改用户名（Change username） | `PATCH /user` body **无 login 字段**（仅 name/email/blog/company/location/hireable/bio/twitter/pronouns）；改名走网页内部端点 + 密码验证，API 不可达（C9 调研确认）。 |
| 4.13 | 设置主邮箱（Set as primary） | Emails API 仅 GET/POST/DELETE `/user/emails` + `PATCH /user/email/visibility`（主邮箱**可见性**）；「Make primary」为网页内部端点，API 无公开通道（C9 调研确认）。 |
| 4.14 | 安全公告（Security） | GraphQL **无 security advisory 查询通道**（Repository 对象无相关字段）；REST `GET /repos/{o}/{r}/security-advisories` 公开仓库 published 匿名可读（smart 入口统一）。 |
| 4.15 | contents `new_branch` | **实测**：PUT contents body 带 `new_branch` 返回 201 但**被静默忽略**——提交仍落在 `branch` 指定的原分支（新分支 404）。官方「新建分支提交」是两段式：先 `POST /repos/{o}/{r}/git/refs`（body `{ref: refs/heads/{newBranch}, sha: baseBranch head}`）建分支，再 PUT contents 到新分支（`createBranch` 封装，FileEditorPage PR 模式使用）。 |
| 4.15 | Dependabot / Code scanning / Secret scanning | 需 `security_events` scope（OAuth 未授）+ 高级安全功能；仅 Security 核心（SECURITY.md + advisories）实现，告警 tab 去杂项。 |
| 4.16 | Top committers 聚合 | GraphQL **无「按作者聚合提交数」端点**；`fetchTopCommittersSmart` REST `GET /commits` 分页 2 页抽样聚合（官方 Highcharts 全量统计，简版抽样 top 10 够用，阶段 I1）。 |
| 4.17 | 组织管理（成员角色/2FA、邀请、团队） | GraphQL 无等价（membersWithRole 无角色/2FA；无 members 写 mutation；无 invitations/teams 查询）；仓库创建权限字段 **REST-only**（`Organization` 上 `defaultRepositoryPermission`/`membersAllowedRepositoryCreationType`/`membersCanCreatePublicRepositories`/`membersCanCreatePrivateRepositories` 四候选名均 undefinedField 实测）；REST 实际值含 `"public"`（文档过时仅列 all/private/none）；组织重命名无公开 API（官方 UI 内部端点）。 |
| 4.17 | Pulse 统计卡（GraphQL 可行，smart 双通道） | `fetchPulseStatsSmart` **GraphQL 首选**（`PULSE_STATS_QUERY` 一次请求 6 个 search.issueCount）+ REST `/search/issues` 并行降级——双端点存在，按 smart 规范走 GraphQL。 |

---

## 5. 新增 API / 新页面接入 CheckList

1. **查本表**：目标数据在 2.1（直接用 smart）还是 2.2（REST + 理由）？新增功能先对照 §4 找不可抗力。
2. **双端点** → 走 §3 模板：graphql.ts 模板 + api.ts smart + 页面 `@/lib/api` import。**禁止**页面直接 `@/lib/rest`。
3. **单端点/不可抗力** → `@/lib/rest`：**固定端点一律 `typedRequest` + `octokit.rest.*` 类型化方法**（URL 模板/参数编码 SDK 保证，禁止手拼 URL 的 `githubFetch`/`fetchWithTimeout`）；仅特殊语义端点（raw Accept / base64 解码 / Link 头分页 / Octokit 无类型化方法）可保留底层通道并注释理由。**类型化方法名查证**：`node_modules/.pnpm/@octokit+plugin-rest-endpoi_*/node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/generated/endpoints.js`（或类型定义 method-types.d.ts）grep 端点路径 → 方法名。
4. **204 空响应体**：`typedRequest`/`githubFetch` 已自动处理（空 body 返回 undefined），**无需**再手写 fetchWithTimeout 判定。
5. **Mutation 需 node id**：先查 id（REPOSITORY_ID_QUERY 等）再 mutation，失败降级 REST。
6. **类型映射**：GraphQL 节点 → REST 结构统一在 api.ts 内 `toXxx()` 完成；页面只见 REST 形态。REST 类型化方法返回较宽时用 `typedRequest<T>` 泛型收窄（`as T` 桥接，调用方接口负责语义）。
7. **构建校验**：`pnpm --filter web build`（tsc 全量类型检查）。
8. **文档同步**：新 API 若属「双端点未 smart」或新增不可抗力，更新本表 §2/§4。

---

## 6. 审计速查

- **页面 import 卫生**：grep `from "@/lib/rest"`（页面文件）——只应出现类型 import 与不可抗力函数（§4 清单内）。
- **smart 覆盖率**：grep `fetch\w+Smart`（api.ts）对照 §2.1 清单。
- **裸 fetch**：grep `fetch(`（web/src）——只允许 `wiki.ts`（worker 代理）与 octokit 内部。
- **legacy 端点**：改版前先 curl 实测端点存活（教训：`/repos/{o}/{r}/projects` 已随官方移除公告下线返回 404，页面请求无意义）。
