/**
 * GraphQL 搜索模板（自 graphql/index.ts 拆出）
 * SEARCH_REPOS/USERS/ISSUES/PULLS/DISCUSSIONS + Pulse 统计。
 */

// ===== 搜索（GraphQL search，登录时首选，降级 REST /search） =====

/** 搜索仓库 */
export const SEARCH_REPOS_QUERY = /* GraphQL */ `
  query SearchRepos($q: String!, $first: Int!) {
    search(query: $q, type: REPOSITORY, first: $first) {
      repositoryCount
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
          updatedAt
          isPrivate
        }
      }
    }
  }
`;

/** 搜索用户 */
export const SEARCH_USERS_QUERY = /* GraphQL */ `
  query SearchUsers($q: String!, $first: Int!) {
    search(query: $q, type: USER, first: $first) {
      userCount
      nodes {
        ... on User {
          login
          name
          avatarUrl
          bio
        }
        ... on Organization {
          login
          name
          avatarUrl
          description
        }
      }
    }
  }
`;

/** 搜索 issue/PR（跨仓库；after 游标续接供「我的 issues」列表用） */
export const SEARCH_ISSUES_QUERY = /* GraphQL */ `
  query SearchIssues($q: String!, $first: Int!, $after: String) {
    search(query: $q, type: ISSUE, first: $first, after: $after) {
      issueCount
      nodes {
        ... on Issue {
          number
          title
          url
          state
          createdAt
          closedAt
          comments {
            totalCount
          }
          author {
            login
          }
          labels(first: 10) {
            nodes {
              name
              color
            }
          }
          repository {
            nameWithOwner
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

/** 用户级 PR 列表（/pulls/{nav}）：search is:pr + qualifier。
 * ⚠️ search type: ISSUE 搜 is:pr 返回 PullRequest 节点（PullRequest 非 Issue 子类型），
 * 故须 `... on PullRequest` 内联片段（`... on Issue` 不匹配 PR，节点会变空对象）。 */
export const SEARCH_PULLS_QUERY = /* GraphQL */ `
  query SearchPulls($q: String!, $first: Int!) {
    search(query: $q, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          databaseId
          number
          title
          url
          state
          createdAt
          updatedAt
          closedAt
          comments {
            totalCount
          }
          author {
            login
            avatarUrl
          }
          labels(first: 10) {
            nodes {
              name
              color
            }
          }
          repository {
            nameWithOwner
          }
        }
      }
    }
  }
`;

/** Insights Pulse 统计（一次 GraphQL 请求并行 6 个 issueCount，官方 Pulse Overview 卡语义）
 * 日期 qualifier（>=since）与 REST 语法一致；GraphQL 不可用/报错时 smart 层降级 REST /search 并行。 */
export const PULSE_STATS_QUERY = /* GraphQL */ `
  query PulseStats(
    $activePrsQ: String!
    $activeIssuesQ: String!
    $mergedPrsQ: String!
    $openPrsQ: String!
    $closedIssuesQ: String!
    $newIssuesQ: String!
  ) {
    activePrs: search(query: $activePrsQ, type: ISSUE) {
      issueCount
    }
    activeIssues: search(query: $activeIssuesQ, type: ISSUE) {
      issueCount
    }
    mergedPrs: search(query: $mergedPrsQ, type: ISSUE) {
      issueCount
    }
    openPrs: search(query: $openPrsQ, type: ISSUE) {
      issueCount
    }
    closedIssues: search(query: $closedIssuesQ, type: ISSUE) {
      issueCount
    }
    newIssues: search(query: $newIssuesQ, type: ISSUE) {
      issueCount
    }
  }
`;
