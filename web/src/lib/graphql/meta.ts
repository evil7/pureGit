/**
 * GraphQL 仓库元数据模板（自 graphql/index.ts 拆出）
 * 分支/labels/milestones/assignees/协作者 + PR commits/check-runs。
 */

// ===== 分支 / labels / assignees / 组织成员（A 类整改） =====

/** 仓库分支列表（refs/heads/*；name 去掉前缀） */
export const REPO_BRANCHES_QUERY = /* GraphQL */ `
  query RepoBranches($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 100, orderBy: { field: ALPHABETICAL, direction: ASC }) {
        nodes {
          name
          target {
            oid
          }
        }
      }
    }
  }
`;

/** 仓库分支分页查询（分支管理页 /branches 用，每页 10 个 + ahead/behind）。
 * - refs(first: 10, after: $after) 游标分页（对齐官方「每页约 10 个、翻页递进加载」，避免一次拉 100 分支压垮 API）
 * - 每分支内联 Ref.compare(headRef: $defaultBranch) 一次拿相对默认分支的 ahead/behind（REST 无批量端点，需逐分支 compare）
 * ⚠️ compare 语义：base=当前分支、head=默认分支 → Comparison.aheadBy=默认分支领先当前分支（=当前分支「落后」），
 *   behindBy=默认分支落后当前分支（=当前分支「领先」）。映射时交换两字段，见 fetchBranchesDetailSmart。 */
export const REPO_BRANCHES_PAGE_QUERY = /* GraphQL */ `
  query RepoBranchesPage($owner: String!, $name: String!, $defaultBranch: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      refs(
        refPrefix: "refs/heads/"
        first: 10
        after: $after
        orderBy: { field: ALPHABETICAL, direction: ASC }
      ) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          name
          target {
            ... on Commit {
              oid
              committedDate
              message
              author {
                name
                avatarUrl
                user {
                  login
                }
              }
            }
          }
          compare(headRef: $defaultBranch) {
            aheadBy
            behindBy
            status
          }
        }
      }
    }
  }
`;

/** 最近推送分支（refs + 每分支最后提交时间；前端按 committedDate 排序取非默认分支）
 * 注：GraphQL RefOrderField 仅 ALPHABETICAL/TAG_COMMIT_DATE（无 PUSHED_DATE），
 * 故取前 100 分支的 committedDate 在前端排序——对 99.9% 仓库足够，超大仓库（千级分支）可能截断但可接受。 */
export const RECENT_BRANCHES_QUERY = /* GraphQL */ `
  query RecentBranches($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        name
      }
      refs(refPrefix: "refs/heads/", first: 100) {
        nodes {
          name
          target {
            ... on Commit {
              committedDate
            }
          }
        }
      }
    }
  }
`;

/** 仓库里程碑（Pulls/Issues 过滤下拉；仅 OPEN 态，与 REST listMilestones state:open 一致） */
export const REPO_MILESTONES_QUERY = /* GraphQL */ `
  query RepoMilestones($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      milestones(states: [OPEN], first: 100) {
        nodes {
          number
          title
          state
          description
        }
      }
    }
  }
`;

/** 仓库 labels */
export const REPO_LABELS_QUERY = /* GraphQL */ `
  query RepoLabels($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      labels(first: 100) {
        nodes {
          id
          name
          color
          description
        }
      }
    }
  }
`;

/** 新建 label（mutation；repositoryId 为仓库 node id，name/color 必填） */
export const CREATE_LABEL_MUTATION = /* GraphQL */ `
  mutation CreateLabel($repositoryId: ID!, $name: String!, $color: String!, $description: String) {
    createLabel(
      input: { repositoryId: $repositoryId, name: $name, color: $color, description: $description }
    ) {
      label {
        id
        name
        color
        description
      }
    }
  }
`;

/** 更新 label（mutation；id 为 label node id） */
export const UPDATE_LABEL_MUTATION = /* GraphQL */ `
  mutation UpdateLabel($id: ID!, $name: String, $color: String, $description: String) {
    updateLabel(input: { id: $id, name: $name, color: $color, description: $description }) {
      label {
        id
        name
        color
        description
      }
    }
  }
`;

/** 删除 label（mutation；id 为 label node id） */
export const DELETE_LABEL_MUTATION = /* GraphQL */ `
  mutation DeleteLabel($id: ID!) {
    deleteLabel(input: { id: $id }) {
      clientMutationId
    }
  }
`;

/** 仓库可指派用户 */
export const REPO_ASSIGNEES_QUERY = /* GraphQL */ `
  query RepoAssignees($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      assignableUsers(first: 100) {
        nodes {
          login
          avatarUrl
        }
      }
    }
  }
`;

/**
 * 仓库过滤下拉复合查询（Pulls/Issues 列表页与新建 Issue 页共用）。
 * 一次 GraphQL 同时拿 labels / milestones / assignableUsers 三个列表 + 前两者的 totalCount
 * （totalCount 直接替代 REST per_page=1 读 Link header 的 fetchRepoLabelCount / fetchRepoMilestoneCount
 * 两个独立请求）——把列表页 5 次请求合并为 1 次，省 4 次网络往返 + 配额。
 */
export const REPO_FILTER_DATA_QUERY = /* GraphQL */ `
  query RepoFilterData($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      labels(first: 100) {
        totalCount
        nodes {
          name
          color
          description
        }
      }
      milestones(states: [OPEN], first: 100) {
        totalCount
        nodes {
          number
          title
          state
          description
        }
      }
      assignableUsers(first: 100) {
        nodes {
          login
          avatarUrl
        }
      }
    }
  }
`;

/** 用户 Star 的仓库列表（StarredRepositories，GraphQL 首选；按最近 star 排序） */
export const STARRED_REPOS_QUERY = /* GraphQL */ `
  query UserStars($login: String!) {
    user(login: $login) {
      starredRepositories(first: 20, orderBy: { field: STARRED_AT, direction: DESC }) {
        totalCount
        nodes {
          databaseId
          name
          nameWithOwner
          description
          url
          stargazerCount
          forkCount
          primaryLanguage {
            name
          }
          isPrivate
          isFork
          parent {
            nameWithOwner
            defaultBranchRef {
              name
            }
            owner {
              login
            }
          }
          updatedAt
        }
      }
    }
  }
`;

/** 组织成员列表（membersWithRole，需 token + 成员可见） */
export const ORG_MEMBERS_QUERY = /* GraphQL */ `
  query OrgMembers($login: String!) {
    organization(login: $login) {
      membersWithRole(first: 50) {
        totalCount
        nodes {
          login
          avatarUrl
          url
        }
      }
    }
  }
`;

// ===== PR commits / CI check-runs / 仓库协作者（GraphQL 主通道补全） =====

/** PR commit 列表（PullRequest.commits → Commit；供 Commits tab，替代 GET /pulls/{n}/commits） */
export const PR_COMMITS_QUERY = /* GraphQL */ `
  query PullCommits($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        commits(first: 100) {
          nodes {
            commit {
              oid
              message
              committedDate
              author {
                name
                email
                date
                user {
                  login
                }
                avatarUrl
              }
              committer {
                user {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** PR head commit 的 CI check-runs（Commit.statusCheckRollup；替代 GET /commits/{sha}/check-runs） */
export const PR_CHECK_RUNS_QUERY = /* GraphQL */ `
  query PullCheckRuns($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          statusCheckRollup {
            contexts(first: 100) {
              nodes {
                ... on CheckRun {
                  status
                  conclusion
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** PR head commit 的 check-run 列表（Checks tab 逐条列出：名字 + 状态 + Details 链接 + workflow 名） */
export const PR_CHECK_RUN_LIST_QUERY = /* GraphQL */ `
  query PullCheckRunList($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          statusCheckRollup {
            contexts(first: 100) {
              nodes {
                ... on CheckRun {
                  name
                  status
                  conclusion
                  detailsUrl
                  checkSuite {
                    workflowRun {
                      workflow {
                        name
                      }
                    }
                  }
                }
                ... on StatusContext {
                  context
                  state
                  description
                  targetUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** commit 关联的 PR（Commit.associatedPullRequests；替代 REST list-pull-requests-associated-with-commit） */
export const COMMIT_ASSOCIATED_PRS_QUERY = /* GraphQL */ `
  query CommitAssociatedPRs($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          associatedPullRequests(first: 10) {
            nodes {
              number
              title
              url
            }
          }
        }
      }
    }
  }
`;

/** commit CI 状态（Commit.statusCheckRollup.state + 各 check 结论；替代 REST get-combined-status-for-ref） */
export const COMMIT_STATUS_QUERY = /* GraphQL */ `
  query CommitStatus($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          statusCheckRollup {
            state
            contexts(first: 100) {
              nodes {
                ... on CheckRun {
                  name
                  status
                  conclusion
                  detailsUrl
                }
                ... on StatusContext {
                  context
                  state
                  description
                  targetUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** commit 评论列表 + commit node id（发表评论用；替代 REST list-comments-for-commit） */
export const COMMIT_COMMENTS_QUERY = /* GraphQL */ `
  query CommitComments($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          id
          comments(first: 100) {
            nodes {
              id
              body
              createdAt
              updatedAt
              author {
                login
                avatarUrl
              }
              url
              reactionGroups {
                content
                reactors {
                  totalCount
                }
                viewerHasReacted
              }
              viewerHasReacted
            }
          }
        }
      }
    }
  }
`;

/** 仓库协作者含权限（Repository.collaborators edges.permission；替代 GET /repos/{o}/{r}/collaborators，
 * reviewer 选人 + 协作者设置页数据源） */
export const REPO_COLLABORATORS_QUERY = /* GraphQL */ `
  query RepoCollaborators($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      collaborators(first: 100) {
        edges {
          permission
          node {
            login
            avatarUrl
          }
        }
      }
    }
  }
`;

/** 组织成员含角色与 2FA（membersWithRole.edges；替代 2 次 GET /orgs/{org}/members 合并） */
export const ORG_MEMBERS_WITH_ROLES_QUERY = /* GraphQL */ `
  query OrgMembersWithRoles($login: String!) {
    organization(login: $login) {
      membersWithRole(first: 100) {
        edges {
          role
          hasTwoFactorEnabled
          node {
            login
            avatarUrl
            url
          }
        }
      }
    }
  }
`;

/** 组织团队列表（Organization.teams；替代 GET /orgs/{org}/teams） */
export const ORG_TEAMS_QUERY = /* GraphQL */ `
  query OrgTeams($login: String!) {
    organization(login: $login) {
      teams(first: 100) {
        nodes {
          id
          databaseId
          name
          slug
          description
          privacy
          members {
            totalCount
          }
        }
      }
    }
  }
`;

/** 团队成员列表（Organization.teams(query:slug) → members；替代 GET /orgs/{org}/teams/{slug}/members） */
export const TEAM_MEMBERS_QUERY = /* GraphQL */ `
  query TeamMembers($login: String!, $slug: String!) {
    organization(login: $login) {
      teams(query: $slug, first: 1) {
        nodes {
          members(first: 100) {
            nodes {
              login
              avatarUrl
              url
            }
          }
        }
      }
    }
  }
`;

/** 关闭 issue（mutation；issueId 为 issue node id） */
export const CLOSE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CloseIssue($issueId: ID!) {
    closeIssue(input: { issueId: $issueId }) {
      issue {
        id
        state
      }
    }
  }
`;

/** 重新打开 issue（mutation） */
export const REOPEN_ISSUE_MUTATION = /* GraphQL */ `
  mutation ReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) {
      issue {
        id
        state
      }
    }
  }
`;

/** 删除仓库（mutation；危险操作，需所有者） */
export const DELETE_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation DeleteRepository($repositoryId: ID!) {
    deleteRepository(input: { repositoryId: $repositoryId }) {
      repository {
        nameWithOwner
      }
    }
  }
`;

/** 删除 issue（mutation；危险操作，需 admin 权限） */
export const DELETE_ISSUE_MUTATION = /* GraphQL */ `
  mutation DeleteIssue($issueId: ID!) {
    deleteIssue(input: { issueId: $issueId }) {
      repository {
        nameWithOwner
      }
    }
  }
`;

/** 置顶 issue（mutation；需 admin + 公开仓库；GraphQL-only 无 REST 端点） */
export const PIN_ISSUE_MUTATION = /* GraphQL */ `
  mutation PinIssue($issueId: ID!) {
    pinIssue(input: { issueId: $issueId }) {
      issue {
        id
      }
    }
  }
`;

/** 取消置顶 issue（mutation） */
export const UNPIN_ISSUE_MUTATION = /* GraphQL */ `
  mutation UnpinIssue($issueId: ID!) {
    unpinIssue(input: { issueId: $issueId }) {
      issue {
        id
      }
    }
  }
`;

/** 转移 issue 到另一仓库（mutation；需 admin；GraphQL-only 无 REST 端点） */
export const TRANSFER_ISSUE_MUTATION = /* GraphQL */ `
  mutation TransferIssue($issueId: ID!, $repositoryId: ID!) {
    transferIssue(input: { issueId: $issueId, repositoryId: $repositoryId }) {
      issue {
        id
        url
      }
    }
  }
`;

// ===== Stargazers / Watchers 列表（GraphQL 连接 cursor 分页）=====

/** 仓库 stargazers 分页查询（cursor 分页；stargazers 连接默认按 starredAt 倒序） */
export const REPO_STARGAZERS_QUERY = /* GraphQL */ `
  query RepoStargazers($owner: String!, $name: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      stargazers(first: $first, after: $after) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          starredAt
          node {
            login
            name
            avatarUrl
          }
        }
      }
    }
  }
`;

/** 仓库 watchers 分页查询（cursor 分页） */
export const REPO_WATCHERS_QUERY = /* GraphQL */ `
  query RepoWatchers($owner: String!, $name: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      watchers(first: $first, after: $after) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            login
            name
            avatarUrl
          }
        }
      }
    }
  }
`;

/** 仓库 forks 分页查询（cursor 分页；orderBy CREATED_AT DESC 对齐 REST sort=newest） */
export const REPO_FORKS_QUERY = /* GraphQL */ `
  query RepoForks($owner: String!, $name: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      forks(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            name
            nameWithOwner
            description
            primaryLanguage {
              name
            }
            stargazerCount
            url
            owner {
              login
              avatarUrl
            }
          }
        }
      }
    }
  }
`;

// ===== Environments（官方 /settings/environments；GraphQL mutation 主通道 + REST 降级）=====

/** 仓库 environments 列表查询（name + node id + databaseId + protection rules 数量 + 置顶） */
export const REPO_ENVIRONMENTS_QUERY = /* GraphQL */ `
  query RepoEnvironments($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      environments(first: 100) {
        nodes {
          id
          databaseId
          name
          isPinned
          protectionRules {
            totalCount
          }
        }
      }
    }
  }
`;

/** 新建 environment（mutation；需 repository node id） */
export const CREATE_ENVIRONMENT_MUTATION = /* GraphQL */ `
  mutation CreateEnvironment($repositoryId: ID!, $name: String!) {
    createEnvironment(input: { repositoryId: $repositoryId, name: $name }) {
      environment {
        id
        databaseId
        name
      }
    }
  }
`;

/** 删除 environment（mutation；需 environment node id） */
export const DELETE_ENVIRONMENT_MUTATION = /* GraphQL */ `
  mutation DeleteEnvironment($id: ID!) {
    deleteEnvironment(input: { id: $id }) {
      clientMutationId
    }
  }
`;
