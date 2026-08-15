/**
 * GraphQL 常用查询模板（自 graphql/index.ts 拆出）
 * 仓库统计/最新提交/仓库详情/Viewer/Issue id/用户与组织主页/用户与组织仓库列表等通用查询。
 */

// ===== 常用 GraphQL 查询（按需取字段） =====

/** 仓库统计（footer 本项目 star/fork 数；轻量查询，仅取计数） */
export const REPO_STATS_QUERY = /* GraphQL */ `
  query RepoStats($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      stargazerCount
      forkCount
    }
  }
`;

/** 仓库最新提交（文件列表顶部提交信息行）。
 * 用 object(expression) 解析任意 git 表达式（branch/HEAD/tag/SHA），等价 REST listCommits(sha) 语义。 */
export const LATEST_COMMIT_QUERY = /* GraphQL */ `
  query LatestCommit($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          oid
          message
          committedDate
          author {
            avatarUrl
            user {
              login
            }
          }
        }
      }
    }
  }
`;

/**
 * 仓库代码首页复合查询——分支列表 + 最新提交（一次 GraphQL 两个字段）。
 * refs（REPO_BRANCHES_QUERY 语义）+ object(expression)（LATEST_COMMIT_QUERY 语义），
 * 替代 RepoActionBar 的 fetchBranchesSmart + LatestCommitLine 的 fetchLatestCommitSmart 两次请求。
 */
export const REPO_HEADER_QUERY = /* GraphQL */ `
  query RepoHeader($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 100, orderBy: { field: ALPHABETICAL, direction: ASC }) {
        nodes {
          name
          target {
            oid
          }
        }
      }
      object(expression: $expression) {
        ... on Commit {
          oid
          message
          committedDate
          author {
            avatarUrl
            user {
              login
            }
          }
        }
      }
    }
  }
`;

/** 指定文件的最近提交（blob 文件头 commit 信息）。
 * object(expression: $expression) 传 **branch（HEAD）** 返回 Commit → history(path, first:1)
 * 过滤该文件路径，等价 REST listCommits(sha, path) 语义。
 * ⚠️ expression 必须传 branch（非 `branch:path`）——`branch:path` 返回 Blob 而非 Commit，
 * `... on Commit` 不命中会导致静默降级 REST（2026-08-14 修正）。 */
export const FILE_COMMIT_QUERY = /* GraphQL */ `
  query FileCommit($owner: String!, $name: String!, $expression: String!, $path: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          history(path: $path, first: 1) {
            nodes {
              oid
              message
              committedDate
              author {
                avatarUrl
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

/** 指定文件的提交历史（blob 文件 History 页）
 * object(expression: branch).history(path, first, after) 分页；等价 REST listCommits(sha, path) 语义。
 * expression 必须传 branch（非 `branch:path`）——`branch:path` 返回 Blob 而非 Commit（同 FILE_COMMIT_QUERY）。 */
export const FILE_HISTORY_QUERY = /* GraphQL */ `
  query FileHistory(
    $owner: String!
    $name: String!
    $expression: String!
    $path: String!
    $first: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Commit {
          history(path: $path, first: $first, after: $after) {
            nodes {
              oid
              message
              committedDate
              author {
                name
                avatarUrl
                user {
                  login
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  }
`;

/** 仓库信息（按需字段，优于 REST 全量返回） */
export const REPOSITORY_QUERY = /* GraphQL */ `
  query Repository($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      databaseId
      name
      nameWithOwner
      description
      homepageUrl
      url
      owner {
        login
        avatarUrl
      }
      stargazerCount
      forkCount
      watchers {
        totalCount
      }
      viewerSubscription
      viewerHasStarred
      viewerPermission
      primaryLanguage {
        name
      }
      languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
        edges {
          size
          node {
            name
          }
        }
      }
      repositoryTopics(first: 20) {
        nodes {
          topic {
            name
          }
        }
      }
      licenseInfo {
        spdxId
      }
      updatedAt
      defaultBranchRef {
        name
      }
      isPrivate
      isArchived
      archivedAt
      isFork
      parent {
        nameWithOwner
        defaultBranchRef {
          name
        }
      }
      hasIssuesEnabled
      hasDiscussionsEnabled
      hasWikiEnabled
      hasProjectsEnabled
      # tab 计数（官方 RepoHeader：Issues/PRs 显示 open 数；并入仓库查询一次拿全，零额外请求）
      openIssues: issues(states: [OPEN]) {
        totalCount
      }
      openPullRequests: pullRequests(states: [OPEN]) {
        totalCount
      }
    }
  }
`;

/**
 * 仓库主页复合查询（Repository + 最新 release 合并）：
 * 一次 GraphQL 请求同时取仓库元数据（REPOSITORY_QUERY 全部字段）与最新 release 总数/节点，
 * 替代 RepoLayout 原先 fetchRepositorySmart + fetchLatestReleaseSmart 两次请求——省一次网络往返 + 配额。
 */
export const REPO_WITH_RELEASES_QUERY = /* GraphQL */ `
  query RepoWithReleases($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      databaseId
      name
      nameWithOwner
      description
      homepageUrl
      url
      owner {
        login
        avatarUrl
      }
      stargazerCount
      forkCount
      watchers {
        totalCount
      }
      viewerSubscription
      viewerHasStarred
      viewerPermission
      primaryLanguage {
        name
      }
      languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
        edges {
          size
          node {
            name
          }
        }
      }
      repositoryTopics(first: 20) {
        nodes {
          topic {
            name
          }
        }
      }
      licenseInfo {
        spdxId
      }
      updatedAt
      defaultBranchRef {
        name
      }
      isPrivate
      isArchived
      archivedAt
      isFork
      parent {
        nameWithOwner
        defaultBranchRef {
          name
        }
      }
      hasIssuesEnabled
      hasDiscussionsEnabled
      hasWikiEnabled
      hasProjectsEnabled
      openIssues: issues(states: [OPEN]) {
        totalCount
      }
      openPullRequests: pullRequests(states: [OPEN]) {
        totalCount
      }
      # 最新 release + 总数（About 侧栏 Releases 入口；与 Repository 合并省一次往返）
      releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
        totalCount
        nodes {
          databaseId
          name
          tagName
          description
          url
          publishedAt
          isDraft
          isPrerelease
          author {
            login
          }
        }
      }
    }
  }
`;

/** 当前用户（GraphQL，需 token；含账户设置所需字段） */
export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      login
      name
      avatarUrl
      bio
      company
      location
      websiteUrl
      email
      pronouns
    }
  }
`;

/** star 仓库（mutation，需 token） */
export const ADD_STAR_MUTATION = /* GraphQL */ `
  mutation AddStar($id: ID!) {
    addStar(input: { starrableId: $id }) {
      starrable {
        stargazerCount
      }
    }
  }
`;

/** unstar 仓库（mutation，需 token） */
export const REMOVE_STAR_MUTATION = /* GraphQL */ `
  mutation RemoveStar($id: ID!) {
    removeStar(input: { starrableId: $id }) {
      starrable {
        stargazerCount
      }
    }
  }
`;

/** 查询仓库 GraphQL node id（用于 star / 创建 issue 等 mutation） */
export const REPOSITORY_ID_QUERY = /* GraphQL */ `
  query RepositoryId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
    }
  }
`;

/** 查询 issue GraphQL node id（用于 updateSubscription mutation） */
export const ISSUE_ID_QUERY = /* GraphQL */ `
  query IssueId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
      }
    }
  }
`;

/** 订阅 / 取消订阅 issue（mutation，需 token；state: SUBSCRIBED/UNSUBSCRIBED/IGNORED） */
export const UPDATE_ISSUE_SUBSCRIPTION_MUTATION = /* GraphQL */ `
  mutation UpdateIssueSubscription($id: ID!, $state: SubscriptionState!) {
    updateSubscription(input: { subscribableId: $id, state: $state }) {
      subscribable {
        id
      }
    }
  }
`;

/** 创建 issue（mutation，需 token；repositoryId 需先查 REPOSITORY_ID_QUERY） */
export const CREATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String) {
    createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
      issue {
        number
        title
        url
      }
    }
  }
`;

/** 用户主页（公开数据，GraphQL 首选；repositories 按最近推送排序）
 * 扩展：status（用户状态）、pronouns（代词）、organizations（加入的组织）、
 * publicRepos（visibility:PUBLIC totalCount，任何权限下都是公开数）、repositories.totalCount（权限内总数）。
 * Achievements/Highlights 无公开 API（官方仅 SSR HTML），省略（用户确认）。 */
export const USER_PROFILE_QUERY = /* GraphQL */ `
  query UserProfile($login: String!) {
    user(login: $login) {
      login
      name
      avatarUrl
      bio
      company
      location
      websiteUrl
      pronouns
      status {
        emoji
        message
      }
      followers {
        totalCount
      }
      following {
        totalCount
      }
      viewerIsFollowing
      organizations(first: 6) {
        nodes {
          avatarUrl
          login
        }
      }
      starredRepositories {
        totalCount
      }
      publicRepos: repositories(visibility: PUBLIC) {
        totalCount
      }
      repositories(first: 20, orderBy: { field: PUSHED_AT, direction: DESC }) {
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
        pageInfo {
          endCursor
          hasNextPage
        }
      }
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
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
  }
`;

/** 组织主页（公开数据，GraphQL 首选）
 * 扩展：publicRepos（visibility:PUBLIC）、repositories.totalCount（权限内总数）、viewerCanAdminister。
 * 收敛：成员数据（membersWithRole）需 read:org 权限，对启用 OAuth App 访问限制的第三方组织
 * 会 403 导致整查询降级 → 移出主查询，改由 People tab 独立请求（fetchOrgMembersSmart）按权限按需拉取。 */
export const ORG_PROFILE_QUERY = /* GraphQL */ `
  query OrgProfile($login: String!) {
    organization(login: $login) {
      login
      name
      avatarUrl
      description
      location
      websiteUrl
      publicRepos: repositories(visibility: PUBLIC) {
        totalCount
      }
      viewerCanAdminister
      repositories(first: 20, orderBy: { field: PUSHED_AT, direction: DESC }) {
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
        pageInfo {
          endCursor
          hasNextPage
        }
      }
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
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
  }
`;

/** 用户仓库分页续接（主页 Repositories 翻页；after 游标续接，REST page 分页的 GraphQL 等价） */
export const USER_REPOS_QUERY = /* GraphQL */ `
  query UserRepos($login: String!, $after: String) {
    user(login: $login) {
      repositories(first: 20, after: $after, orderBy: { field: PUSHED_AT, direction: DESC }) {
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
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

/** 组织仓库全量（组织设置「仓库」列表：first:100 一次取全，含 diskUsage 大小） */
export const ORG_REPOS_ALL_QUERY = /* GraphQL */ `
  query OrgReposAll($login: String!) {
    organization(login: $login) {
      repositories(first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          databaseId
          name
          nameWithOwner
          description
          homepageUrl
          url
          stargazerCount
          forkCount
          primaryLanguage {
            name
          }
          licenseInfo {
            spdxId
          }
          updatedAt
          defaultBranchRef {
            name
          }
          isPrivate
          isFork
          parent {
            nameWithOwner
            defaultBranchRef {
              name
            }
          }
          diskUsage
        }
      }
    }
  }
`;

/** 组织仓库分页续接（主页 Repositories 翻页；after 游标续接） */
export const ORG_REPOS_QUERY = /* GraphQL */ `
  query OrgRepos($login: String!, $after: String) {
    organization(login: $login) {
      repositories(first: 20, after: $after, orderBy: { field: PUSHED_AT, direction: DESC }) {
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
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;
