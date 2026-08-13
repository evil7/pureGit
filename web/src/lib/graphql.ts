/**
 * GitHub GraphQL 请求模板库 + 客户端（@octokit/graphql · v0.0.1 设计调整）
 *
 * 架构：**GraphQL 唯一主通道**（登录态全部经 GraphQL；失败 → withRestFallback 熔断降级 REST）。
 * 本模块职责：
 * - **请求模板库**：查询/变更模板常量（路径参数 → 变量，如 PULLS_QUERY + {owner, name, states...}），
 *   板块（api-*.ts）直接 import 模板名，不手拼查询字符串
 * - **客户端**：graphqlRequest<T> 经 SDK 发出（自动标准请求头 + 响应头额度跟踪 octokit.ts）
 * - 保持 GraphQLResponse / hasGraphQLErrors 契约（api.ts 依赖）
 * - 匿名强制 REST：token 为空时由 api-core.ts 短路，本模块不发出 GraphQL
 */
import { createGraphqlClient } from "./octokit";

/** GraphQL 响应包装（保持旧契约） */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; path?: (string | number)[] }[];
}

/**
 * 执行 GraphQL 请求（query 或 mutation），经 @octokit/graphql。
 * 返回 GraphQLResponse 形态：HTTP 错误（4xx/5xx）抛错（api.ts 捕获降级）；
 * GraphQL errors 字段正常返回（调用方 hasGraphQLErrors 判断）。
 */
export async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string | null,
): Promise<GraphQLResponse<T>> {
  // 匿名强制 REST（实测）：GitHub GraphQL 端点匿名请求恒 403。
  // 未登录（token 为空）一律短路返回 errors → smart 层 hasGraphQLErrors 自动降级 REST，
  // 任何调用方（api-*.ts smart 层 / repo-raw.ts）匿名时都不再发出 GraphQL 请求
  if (!token) {
    return { errors: [{ message: "GraphQL requires authentication (anonymous → REST)" }] };
  }
  const client = createGraphqlClient(token);
  // @octokit/graphql：成功返回 data；GraphQL errors 抛 GraphqlResponseError（带 data/errors）
  try {
    const data = await client<T>(query, variables);
    return { data };
  } catch (e) {
    const err = e as {
      name?: string;
      data?: unknown;
      errors?: { message: string; path?: (string | number)[] }[];
      status?: number;
    };
    // GraphQL 层错误（errors 数组）→ 包装为 GraphQLResponse（不抛，供 hasGraphQLErrors）
    if (err && Array.isArray(err.errors) && err.errors.length > 0) {
      return { data: err.data as T | undefined, errors: err.errors };
    }
    throw e; // 网络错误/HTTP 错误原样抛出
  }
}

/** 校验 GraphQL 响应是否有错误 */
export function hasGraphQLErrors<T>(resp: GraphQLResponse<T>): boolean {
  return Boolean(resp.errors && resp.errors.length > 0);
}

// ===== 常用 GraphQL 查询（按需取字段） =====

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

/** 仓库 Projects v2 列表（legacy REST 已下线，仅 GraphQL 可用；repo scope 已涵盖） */
export const REPO_PROJECTS_V2_QUERY = /* GraphQL */ `
  query RepoProjectsV2($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      projectsV2(first: $first) {
        totalCount
        nodes {
          id
          title
          number
          shortDescription
          url
          closed
          updatedAt
          public
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
 * 扩展：membersWithRole.totalCount（成员数，需认证）、
 * publicRepos（visibility:PUBLIC）、repositories.totalCount（权限内总数）。
 * 注：Organization 无公开 members 字段（仅 membersWithRole），匿名 GraphQL 跳过 → REST 降级无成员数。 */
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
      membersWithRole {
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

// ===== 仓库内 issue / PR / release（GraphQL 首选，REST 降级） =====

/** issue 列表（states: OPEN/CLOSED 数组；GraphQL 天然排除 PR，免 REST 过滤） */
export const ISSUES_QUERY = /* GraphQL */ `
  query RepoIssues($owner: String!, $name: String!, $states: [IssueState!], $first: Int!) {
    repository(owner: $owner, name: $name) {
      openCount: issues(states: [OPEN]) {
        totalCount
      }
      closedCount: issues(states: [CLOSED]) {
        totalCount
      }
      issues(first: $first, states: $states, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          number
          title
          state
          url
          createdAt
          updatedAt
          closedAt
          body
          author {
            login
          }
          comments {
            totalCount
          }
          labels(first: 10) {
            nodes {
              name
              color
            }
          }
          assignees(first: 10) {
            nodes {
              login
              avatarUrl
            }
          }
          milestone {
            title
          }
        }
      }
    }
  }
`;

/** issue 详情 */
export const ISSUE_DETAIL_QUERY = /* GraphQL */ `
  query IssueDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        viewerSubscription
        author {
          login
          avatarUrl
        }
        comments {
          totalCount
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        milestone {
          title
        }
      }
    }
  }
`;

/** PR 列表（states: OPEN/CLOSED/MERGED 数组；orderBy 由官方 Sort 菜单驱动） */
export const PULLS_QUERY = /* GraphQL */ `
  query RepoPulls(
    $owner: String!
    $name: String!
    $states: [PullRequestState!]
    $first: Int!
    $orderField: PullRequestOrderField!
    $orderDir: OrderDirection!
  ) {
    repository(owner: $owner, name: $name) {
      openCount: pullRequests(states: [OPEN]) {
        totalCount
      }
      closedCount: pullRequests(states: [CLOSED, MERGED]) {
        totalCount
      }
      pullRequests(
        first: $first
        states: $states
        orderBy: { field: $orderField, direction: $orderDir }
      ) {
        nodes {
          databaseId
          number
          title
          state
          url
          createdAt
          updatedAt
          body
          mergedAt
          isDraft
          author {
            login
            avatarUrl
          }
          comments {
            totalCount
          }
          reviews {
            totalCount
          }
          reviewThreads {
            totalCount
          }
          closingIssuesReferences {
            totalCount
          }
          commits {
            totalCount
          }
          additions
          deletions
          changedFiles
          headRefName
          baseRefName
          headRefOid
          baseRefOid
          headRepositoryOwner {
            login
          }
          baseRepository {
            owner {
              login
            }
          }
          labels(first: 10) {
            nodes {
              name
              color
            }
          }
          assignees(first: 10) {
            nodes {
              login
              avatarUrl
            }
          }
          milestone {
            title
          }
        }
      }
    }
  }
`;

/** PR 详情 */
export const PULL_DETAIL_QUERY = /* GraphQL */ `
  query PullDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        viewerSubscription
        mergedAt
        isDraft
        author {
          login
          avatarUrl
        }
        comments {
          totalCount
        }
        commits {
          totalCount
        }
        additions
        deletions
        changedFiles
        headRefName
        headRefOid
        baseRefName
        baseRefOid
        headRepositoryOwner {
          login
        }
        baseRepository {
          owner {
            login
          }
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        milestone {
          title
        }
      }
    }
  }
`;

/** Releases 列表（按创建时间倒序） */
export const RELEASES_QUERY = /* GraphQL */ `
  query RepoReleases($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      releases(first: $first, orderBy: { field: CREATED_AT, direction: DESC }) {
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
          releaseAssets(first: 20) {
            nodes {
              name
              size
              downloadUrl
            }
          }
        }
      }
    }
  }
`;

/** Release 详情（按 tag 精确匹配） */
export const RELEASE_DETAIL_QUERY = /* GraphQL */ `
  query ReleaseDetail($owner: String!, $name: String!, $tagName: String!) {
    repository(owner: $owner, name: $name) {
      release(tagName: $tagName) {
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
        releaseAssets(first: 20) {
          nodes {
            name
            size
            downloadUrl
          }
        }
      }
    }
  }
`;

/** Releases 计数（totalCount，轻量；替代 REST Link header 计数 hack） */
export const RELEASES_COUNT_QUERY = /* GraphQL */ `
  query ReleasesCount($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      releases {
        totalCount
      }
    }
  }
`;

/** 最新 Release + 总数（About 侧栏 Releases 分区入口；totalCount + nodes(first:1) 一次查询） */
export const LATEST_RELEASE_QUERY = /* GraphQL */ `
  query LatestRelease($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
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

// ===== 详情页合并查询（单次多节点嵌套，替代 detail+comments 两请求） =====

/** Issue 详情 + 评论（一次 GraphQL 请求完成；REST 降级时仍分步） */
export const ISSUE_DETAIL_WITH_COMMENTS_QUERY = /* GraphQL */ `
  query IssueDetailWithComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        viewerSubscription
        author {
          login
          avatarUrl
        }
        comments(first: 100, orderBy: { field: UPDATED_AT, direction: ASC }) {
          totalCount
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
          }
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        milestone {
          title
        }
      }
    }
  }
`;

/** PR 详情 + 评论（一次 GraphQL 请求完成；REST 降级时仍分步） */
export const PULL_DETAIL_WITH_COMMENTS_QUERY = /* GraphQL */ `
  query PullDetailWithComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        viewerSubscription
        mergedAt
        isDraft
        author {
          login
          avatarUrl
        }
        comments(first: 100, orderBy: { field: UPDATED_AT, direction: ASC }) {
          totalCount
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
          }
        }
        commits {
          totalCount
        }
        additions
        deletions
        changedFiles
        headRefName
        headRefOid
        baseRefName
        baseRefOid
        headRepositoryOwner {
          login
        }
        baseRepository {
          owner {
            login
          }
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        milestone {
          title
        }
      }
    }
  }
`;

/**
 * PR 详情完整复合查询（detail + comments + reviewSummary 一次 GraphQL 请求）。
 * 在 PULL_DETAIL_WITH_COMMENTS_QUERY 基础上并入评审摘要字段（id/reviewDecision/mergeable/reviews/reviewRequests），
 * 替代 PullDetailPage 原先 fetchPullDetailWithCommentsSmart + fetchPullReviewSummarySmart 两次请求——
 * 省一次网络往返 + 配额；timeline（timelineItems 巨大且失败语义独立）保持独立查询。
 */
export const PULL_DETAIL_FULL_QUERY = /* GraphQL */ `
  query PullDetailFull($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        viewerSubscription
        mergedAt
        isDraft
        author {
          login
          avatarUrl
        }
        comments(first: 100, orderBy: { field: UPDATED_AT, direction: ASC }) {
          totalCount
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
          }
        }
        commits {
          totalCount
        }
        additions
        deletions
        changedFiles
        headRefName
        headRefOid
        baseRefName
        baseRefOid
        headRepositoryOwner {
          login
        }
        baseRepository {
          owner {
            login
          }
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        milestone {
          title
        }
        # 评审摘要（Reviewers 栏 / 合并判定 / merge-rebase 操作 node id）
        reviewDecision
        mergeable
        reviews(first: 20) {
          nodes {
            id
            state
            body
            submittedAt
            author {
              login
              avatarUrl
            }
          }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User {
                login
                avatarUrl
              }
              ... on Team {
                name
              }
            }
          }
        }
      }
    }
  }
`;

// ===== Discussions（GraphQL only——REST 无 discussion 端点） =====

/** 讨论列表：discussions + categories + pinned + codeOfConduct（Most helpful 用最近讨论的评论作者聚合） */
export const DISCUSSIONS_QUERY = /* GraphQL */ `
  query RepoDiscussions(
    $owner: String!
    $name: String!
    $first: Int!
    $after: String
    $categoryId: ID
    $states: [DiscussionState!]
    $orderBy: DiscussionOrder!
  ) {
    repository(owner: $owner, name: $name) {
      discussions(
        first: $first
        after: $after
        orderBy: $orderBy
        categoryId: $categoryId
        states: $states
      ) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          number
          title
          createdAt
          category {
            id
            name
            emoji
          }
          author {
            login
            avatarUrl
          }
          answerChosenAt
          comments(first: 10) {
            totalCount
            nodes {
              author {
                login
              }
            }
          }
          upvoteCount
        }
      }
      discussionCategories(first: 30) {
        nodes {
          id
          name
          emoji
          description
        }
      }
      pinnedDiscussions(first: 5) {
        nodes {
          discussion {
            number
            title
            createdAt
            category {
              id
              name
              emoji
            }
            author {
              login
              avatarUrl
            }
            answerChosenAt
            comments(first: 10) {
              totalCount
              nodes {
                author {
                  login
                }
              }
            }
            upvoteCount
          }
        }
      }
      codeOfConduct {
        name
        url
      }
    }
  }
`;

/** 讨论搜索（GraphQL search 端点 type: DISCUSSION；搜索语法解析后拼 query） */
export const DISCUSSION_SEARCH_QUERY = /* GraphQL */ `
  query DiscussionSearch($query: String!, $first: Int!) {
    search(query: $query, type: DISCUSSION, first: $first) {
      discussionCount
      nodes {
        ... on Discussion {
          number
          title
          createdAt
          category {
            id
            name
            emoji
          }
          author {
            login
            avatarUrl
          }
          answerChosenAt
          comments {
            totalCount
          }
          upvoteCount
        }
      }
    }
  }
`;

/** 讨论详情（主帖 + 评论 + 回复数） */
export const DISCUSSION_DETAIL_QUERY = /* GraphQL */ `
  query DiscussionDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      discussion(number: $number) {
        id
        number
        title
        body
        createdAt
        updatedAt
        locked
        category {
          id
          name
          emoji
          description
        }
        author {
          login
          avatarUrl
        }
        answerChosenAt
        upvoteCount
        comments(first: 50) {
          totalCount
          nodes {
            id
            body
            createdAt
            author {
              login
              avatarUrl
            }
            isAnswer
            replies(first: 20) {
              totalCount
              nodes {
                id
                body
                createdAt
                author {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** 新建讨论（mutation） */
export const CREATE_DISCUSSION_MUTATION = /* GraphQL */ `
  mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(
      input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }
    ) {
      discussion {
        number
      }
    }
  }
`;

/** 发表讨论评论（mutation） */
export const ADD_DISCUSSION_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment {
        id
        body
        createdAt
        author {
          login
          avatarUrl
        }
        isAnswer
        replies {
          totalCount
        }
      }
    }
  }
`;

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
      }
    }
  }
`;

/** 搜索 issue/PR（跨仓库） */
export const SEARCH_ISSUES_QUERY = /* GraphQL */ `
  query SearchIssues($q: String!, $first: Int!) {
    search(query: $q, type: ISSUE, first: $first) {
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
    }
  }
`;

/** Insights Pulse 统计（一次 GraphQL 请求并行 6 个 issueCount，官方 Pulse Overview 卡语义）
 * 日期 qualifier（>=since）与 REST 语法一致；GraphQL 不可用/报错时 smart 层降级 REST /search 并行。 */
export const PULSE_STATS_QUERY = /* GraphQL */ `
  query PulseStats($repo: String!, $since: String!) {
    activePrs: search(query: "repo:$repo is:pr is:open", type: ISSUE) {
      issueCount
    }
    activeIssues: search(query: "repo:$repo is:issue is:open", type: ISSUE) {
      issueCount
    }
    mergedPrs: search(query: "repo:$repo is:pr is:merged merged:>=$since", type: ISSUE) {
      issueCount
    }
    openPrs: search(query: "repo:$repo is:pr is:open", type: ISSUE) {
      issueCount
    }
    closedIssues: search(query: "repo:$repo is:issue is:closed closed:>=$since", type: ISSUE) {
      issueCount
    }
    newIssues: search(query: "repo:$repo is:issue created:>=$since", type: ISSUE) {
      issueCount
    }
  }
`;

// ===== 账户设置（需 token）=====

/** 当前用户所属组织列表（需 token） */
export const VIEWER_ORGS_QUERY = /* GraphQL */ `
  query ViewerOrgs {
    viewer {
      organizations(first: 50) {
        nodes {
          login
          name
          avatarUrl
          description
        }
      }
    }
  }
`;

/** 当前用户仓库（需 token，按最近更新时间排序，含私有仓库） */
export const VIEWER_REPOS_QUERY = /* GraphQL */ `
  query ViewerRepos($after: String) {
    viewer {
      repositories(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
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
          diskUsage
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

/** 更新当前用户公开资料（mutation，需 token） */
export const UPDATE_USER_MUTATION = /* GraphQL */ `
  mutation UpdateUser($input: UpdateUserProfileInput!) {
    updateUser(input: $input) {
      user {
        login
        name
        bio
        company
        location
        websiteUrl
        pronouns
      }
    }
  }
`;

/** 创建仓库（mutation，需 token；GraphQL 首选，REST POST /user/repos 降级） */
export const CREATE_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation CreateRepository($input: CreateRepositoryInput!) {
    createRepository(input: $input) {
      repository {
        name
        nameWithOwner
        description
        url
        isPrivate
        defaultBranchRef {
          name
        }
      }
    }
  }
`;

/** 更新仓库基本信息（mutation；仅 name/description/homepageUrl/has*Enabled 字段——
 * private/visibility 与 default_branch 无 GraphQL 通道，由 updateRepositorySmart 的 hybrid 增补 REST 处理） */
export const UPDATE_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation UpdateRepository(
    $repositoryId: ID!
    $name: String
    $description: String
    $homepageUrl: URI
    $hasIssuesEnabled: Boolean
    $hasDiscussionsEnabled: Boolean
    $hasWikiEnabled: Boolean
    $hasProjectsEnabled: Boolean
  ) {
    updateRepository(
      input: {
        repositoryId: $repositoryId
        name: $name
        description: $description
        homepageUrl: $homepageUrl
        hasIssuesEnabled: $hasIssuesEnabled
        hasDiscussionsEnabled: $hasDiscussionsEnabled
        hasWikiEnabled: $hasWikiEnabled
        hasProjectsEnabled: $hasProjectsEnabled
      }
    ) {
      repository {
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
        primaryLanguage {
          name
        }
        updatedAt
        defaultBranchRef {
          name
        }
        isPrivate
        isArchived
        hasIssuesEnabled
        hasDiscussionsEnabled
        hasWikiEnabled
        hasProjectsEnabled
      }
    }
  }
`;

/** 归档仓库（mutation；仓库可见性/归档 GraphQL 无统一 PATCH，归档走独立 mutation） */
export const ARCHIVE_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation ArchiveRepository($repositoryId: ID!) {
    archiveRepository(input: { repositoryId: $repositoryId }) {
      repository {
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
        primaryLanguage {
          name
        }
        updatedAt
        defaultBranchRef {
          name
        }
        isPrivate
        isArchived
        hasIssuesEnabled
        hasDiscussionsEnabled
        hasWikiEnabled
        hasProjectsEnabled
      }
    }
  }
`;

/** 取消归档仓库（mutation） */
export const UNARCHIVE_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation UnarchiveRepository($repositoryId: ID!) {
    unarchiveRepository(input: { repositoryId: $repositoryId }) {
      repository {
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
        primaryLanguage {
          name
        }
        updatedAt
        defaultBranchRef {
          name
        }
        isPrivate
        isArchived
        hasIssuesEnabled
        hasDiscussionsEnabled
        hasWikiEnabled
        hasProjectsEnabled
      }
    }
  }
`;

/** 创建 PR（mutation；repositoryId 为 base 仓库 id，headRepositoryId 为跨仓库 head 仓库 id） */
export const CREATE_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation CreatePullRequest(
    $repositoryId: ID!
    $baseRefName: String!
    $headRefName: String!
    $headRepositoryId: ID
    $title: String!
    $body: String
  ) {
    createPullRequest(
      input: {
        repositoryId: $repositoryId
        baseRefName: $baseRefName
        headRefName: $headRefName
        headRepositoryId: $headRepositoryId
        title: $title
        body: $body
      }
    ) {
      pullRequest {
        number
      }
    }
  }
`;

/** 创建 PR 跨仓库前置查询（base + head 两个仓库 node id；head 为 fork owner 同名仓库，
 * 与 REST head "username:branch" 语义一致——fork 同 network 同名） */
export const CREATE_PULL_REQUEST_IDS_QUERY = /* GraphQL */ `
  query CreatePullRequestIds($owner: String!, $name: String!, $headOwner: String!) {
    base: repository(owner: $owner, name: $name) {
      id
    }
    head: repository(owner: $headOwner, name: $name) {
      id
    }
  }
`;

/** 更新组织资料（mutation，需 token + admin:org；GraphQL 首选，REST PATCH /orgs/{org} 降级） */
export const UPDATE_ORG_MUTATION = /* GraphQL */ `
  mutation UpdateOrg($input: UpdateOrganizationInput!) {
    updateOrganization(input: $input) {
      organization {
        id
        login
        name
        description
        websiteUrl
        location
        email
        avatarUrl
      }
    }
  }
`;

// ===== 评论 / 评审（A 类整改：GraphQL 首选 + REST 降级） =====

/** issue/PR 评论列表（按时间正序，同 REST） */
export const ISSUE_COMMENTS_QUERY = /* GraphQL */ `
  query IssueComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(first: 100, orderBy: { field: UPDATED_AT, direction: ASC }) {
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
          }
        }
      }
    }
  }
`;

/** 发表评论（subjectId = issue/PR 的 GraphQL node id；通用 addComment mutation） */
export const ADD_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge {
        node {
          id
          body
          createdAt
          updatedAt
          author {
            login
            avatarUrl
          }
          url
        }
      }
    }
  }
`;

/** PR 行内评审评论（reviewThreads 聚合；position/originalPosition 推断 side） */
export const PULL_REVIEW_COMMENTS_QUERY = /* GraphQL */ `
  query PullReviewComments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 20) {
              nodes {
                id
                body
                createdAt
                path
                line
                position
                originalPosition
                author {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** 发表 PR 行内评审评论（需 pullRequestId；side 传 CommentSide: LEFT/RIGHT） */
export const ADD_PULL_REVIEW_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddPullRequestReviewComment(
    $pullRequestId: ID!
    $body: String!
    $path: String!
    $line: Int!
    $side: CommentSide
  ) {
    addPullRequestReviewComment(
      input: { pullRequestId: $pullRequestId, body: $body, path: $path, line: $line, side: $side }
    ) {
      comment {
        id
        body
        createdAt
        path
        line
        author {
          login
          avatarUrl
        }
      }
    }
  }
`;

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

/** 仓库 labels */
export const REPO_LABELS_QUERY = /* GraphQL */ `
  query RepoLabels($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      labels(first: 100) {
        nodes {
          name
          color
          description
        }
      }
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
        nodes {
          login
          avatarUrl
          url
        }
      }
    }
  }
`;

// ===== 账户设置补充（SSH/GPG/关注/主题/订阅/删除仓库） =====

/** 当前用户 SSH keys */
export const VIEWER_SSH_KEYS_QUERY = /* GraphQL */ `
  query ViewerSshKeys {
    viewer {
      sshKeys(first: 50) {
        nodes {
          id
          key
          title
          createdAt
          verified
          readOnly
        }
      }
    }
  }
`;

/** 新增 SSH key（mutation） */
export const CREATE_SSH_KEY_MUTATION = /* GraphQL */ `
  mutation CreateSshKey($title: String!, $key: String!) {
    createSshKey(input: { title: $title, key: $key }) {
      key {
        id
        key
        title
        createdAt
        verified
        readOnly
      }
    }
  }
`;

/** 删除 SSH key（mutation；删除后不可恢复） */
export const DELETE_SSH_KEY_MUTATION = /* GraphQL */ `
  mutation DeleteSshKey($keyId: ID!) {
    deleteSshKey(input: { keyId: $keyId }) {
      deletedKeyId
    }
  }
`;

/** 当前用户 GPG keys */
export const VIEWER_GPG_KEYS_QUERY = /* GraphQL */ `
  query ViewerGpgKeys {
    viewer {
      gpgKeys(first: 50) {
        nodes {
          id
          publicKey
          email
          createdAt
          verified
        }
      }
    }
  }
`;

/** 新增 GPG key（mutation） */
export const CREATE_GPG_KEY_MUTATION = /* GraphQL */ `
  mutation CreateGpgKey($armoredPublicKey: String!) {
    createGpgKey(input: { armoredPublicKey: $armoredPublicKey }) {
      gpgKey {
        id
        publicKey
        email
        createdAt
        verified
      }
    }
  }
`;

/** 删除 GPG key（mutation） */
export const DELETE_GPG_KEY_MUTATION = /* GraphQL */ `
  mutation DeleteGpgKey($gpgKeyId: ID!) {
    deleteGpgKey(input: { gpgKeyId: $gpgKeyId }) {
      deletedKeyId
    }
  }
`;

/** 是否已关注某用户（user.viewerIsFollowing —— viewer 是否关注该用户，需 token）
 * 修复：原 viewer.isFollowing 字段不存在（schema 实测 error：
 * Field 'isFollowing' doesn't exist on type 'User'），正确字段为 User.viewerIsFollowing。 */
export const IS_FOLLOWING_QUERY = /* GraphQL */ `
  query IsFollowing($login: String!) {
    user(login: $login) {
      viewerIsFollowing
    }
  }
`;

/** 查询用户 GraphQL node id（follow/unfollow/block 等 mutation 前置） */
export const USER_ID_QUERY = /* GraphQL */ `
  query UserId($login: String!) {
    user(login: $login) {
      id
    }
  }
`;

/** 关注用户（mutation） */
export const FOLLOW_USER_MUTATION = /* GraphQL */ `
  mutation FollowUser($userId: ID!) {
    followUser(input: { userId: $userId }) {
      user {
        id
      }
    }
  }
`;

/** 取关用户（mutation） */
export const UNFOLLOW_USER_MUTATION = /* GraphQL */ `
  mutation UnfollowUser($userId: ID!) {
    unfollowUser(input: { userId: $userId }) {
      user {
        id
      }
    }
  }
`;

/** 仓库主题（独立轻量查询；REPOSITORY_QUERY 已含同字段） */
export const REPO_TOPICS_QUERY = /* GraphQL */ `
  query RepoTopics($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      repositoryTopics(first: 20) {
        nodes {
          topic {
            name
          }
        }
      }
    }
  }
`;

/** 替换仓库主题（mutation；topicNames 全量替换） */
export const UPDATE_REPOSITORY_TOPICS_MUTATION = /* GraphQL */ `
  mutation UpdateRepositoryTopics($repositoryId: ID!, $topicNames: [String!]!) {
    updateRepositoryTopics(input: { repositoryId: $repositoryId, topicNames: $topicNames }) {
      repositoryTopics(first: 20) {
        nodes {
          topic {
            name
          }
        }
      }
    }
  }
`;

// ===== PR 评审工作流（B1：reviewDecision / reviews / 三态提交 / 请求评审者 / 线程解决）=====

/** PR 评审摘要（reviewDecision + 已提交评审 + 请求的评审者 + mergeable；PR 详情页 Reviewers 栏与合并判定） */
export const PULL_REVIEW_SUMMARY_QUERY = /* GraphQL */ `
  query PullReviewSummary($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        reviewDecision
        mergeable
        reviews(first: 20) {
          nodes {
            id
            state
            body
            submittedAt
            author {
              login
              avatarUrl
            }
          }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User {
                login
                avatarUrl
              }
              ... on Team {
                name
              }
            }
          }
        }
      }
    }
  }
`;

/** 提交评审（三态：COMMENT/APPROVE/REQUEST_CHANGES；addPullRequestReview 带 event 直接完成——submitPullRequestReview 仅提交挂起评审，不适合单次三态） */
export const ADD_PULL_REQUEST_REVIEW_MUTATION = /* GraphQL */ `
  mutation AddPullRequestReview(
    $pullRequestId: ID!
    $event: PullRequestReviewEvent!
    $body: String
  ) {
    addPullRequestReview(input: { pullRequestId: $pullRequestId, event: $event, body: $body }) {
      pullRequestReview {
        id
        state
        body
        submittedAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`;

/** 合并 PR（GraphQL 合并；mergeMethod: MERGE/SQUASH/REBASE） */
export const MERGE_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation MergePullRequest(
    $pullRequestId: ID!
    $commitHeadline: String
    $commitBody: String
    $mergeMethod: PullRequestMergeMethod!
  ) {
    mergePullRequest(
      input: {
        pullRequestId: $pullRequestId
        commitHeadline: $commitHeadline
        commitBody: $commitBody
        mergeMethod: $mergeMethod
      }
    ) {
      pullRequest {
        id
        state
        mergedAt
      }
    }
  }
`;

/** 请求评审者（mutation；requestReviewerIds 为 User/Team 的 node id 数组） */
export const REQUEST_REVIEWS_MUTATION = /* GraphQL */ `
  mutation RequestReviews($pullRequestId: ID!, $userIds: [ID!]) {
    requestReviews(input: { pullRequestId: $pullRequestId, userIds: $userIds, union: true }) {
      pullRequest {
        id
      }
    }
  }
`;

/** 解决评审线程（mutation；threadId 为 reviewThread node id） */
export const RESOLVE_REVIEW_THREAD_MUTATION = /* GraphQL */ `
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`;

/** 取消解决评审线程（mutation） */
export const UNRESOLVE_REVIEW_THREAD_MUTATION = /* GraphQL */ `
  mutation UnresolveReviewThread($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`;

// ===== PR Conversation 时间线（第二步：PullTimeline 复刻官方 TimelineItem） =====

/** PR 时间线（timelineItems 正序；核心事件类型 fragment——评论/评审/评审线程/commit/合并/关闭/标签/里程碑/指派/锁定/改题/重新打开）
 * 官方 Conversation 自上而下时间递增；PullRequestReviewThread 含行内评论线程（path + lines + comments + isResolved）。 */
export const PR_TIMELINE_QUERY = /* GraphQL */ `
  query PullTimeline($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        timelineItems(first: 100) {
          nodes {
            __typename
            ... on IssueComment {
              id
              author {
                login
                avatarUrl
              }
              createdAt
              body
            }
            ... on PullRequestReview {
              id
              author {
                login
                avatarUrl
              }
              createdAt
              submittedAt
              state
              body
            }
            ... on PullRequestReviewThread {
              id
              isResolved
              path
              line
              originalLine
              startLine
              comments(first: 20) {
                nodes {
                  id
                  author {
                    login
                    avatarUrl
                  }
                  createdAt
                  body
                }
              }
            }
            ... on PullRequestCommit {
              id
              commit {
                oid
                messageHeadline
                committedDate
                author {
                  user {
                    login
                    avatarUrl
                  }
                  name
                }
              }
            }
            ... on MergedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              mergeRefName
            }
            ... on ClosedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on ReopenedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on AssignedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              assignee {
                ... on User {
                  login
                }
              }
            }
            ... on UnassignedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              assignee {
                ... on User {
                  login
                }
              }
            }
            ... on LabeledEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              label {
                name
                color
              }
            }
            ... on UnlabeledEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              label {
                name
                color
              }
            }
            ... on MilestonedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              milestoneTitle
            }
            ... on DemilestonedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              milestoneTitle
            }
            ... on ReviewRequestedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on ReviewRequestRemovedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on LockedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on UnlockedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on RenamedTitleEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
              previousTitle
              currentTitle
            }
            ... on HeadRefForcePushedEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
            ... on ReadyForReviewEvent {
              id
              actor {
                login
                avatarUrl
              }
              createdAt
            }
          }
        }
      }
    }
  }
`;

// ===== PR 详情侧栏增强（B1 补：Projects / Development / Lock） =====

/** PR 关联 ProjectsV2（侧栏 Projects 只读展示：项目 + 字段状态；GraphQL-only——REST 无 repo 级 projectsV2 关联） */
export const PR_PROJECTS_QUERY = /* GraphQL */ `
  query PullProjects($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        projectItems(first: 20) {
          nodes {
            id
            project {
              number
              title
              url
              public
            }
            fieldValueByName(name: "Status") {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
`;

/** PR 开发关联（侧栏 Development 只读展示：关联 issue/PR + linked branches；GraphQL-only） */
export const PR_DEVELOPMENT_QUERY = /* GraphQL */ `
  query PullDevelopment($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        closingIssuesReferences(first: 10) {
          nodes {
            number
            title
            state
            url
          }
        }
      }
    }
  }
`;

/** 锁定对话（mutation；lockableId 为 issue/PR node id） */
export const LOCK_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation LockPullRequest($lockableId: ID!) {
    lockLockable(input: { lockableId: $lockableId }) {
      lockedRecord {
        ... on PullRequest {
          id
          locked
        }
        ... on Issue {
          id
          locked
        }
      }
    }
  }
`;

/** 解锁对话（mutation） */
export const UNLOCK_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation UnlockPullRequest($lockableId: ID!) {
    unlockLockable(input: { lockableId: $lockableId }) {
      unlockedRecord {
        ... on PullRequest {
          id
          locked
        }
        ... on Issue {
          id
          locked
        }
      }
    }
  }
`;

/** 关闭 PR（mutation；pullRequestId 为 PR node id） */
export const CLOSE_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation ClosePullRequest($pullRequestId: ID!) {
    closePullRequest(input: { pullRequestId: $pullRequestId }) {
      pullRequest {
        id
        state
      }
    }
  }
`;

/** 重新打开 PR（mutation） */
export const REOPEN_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation ReopenPullRequest($pullRequestId: ID!) {
    reopenPullRequest(input: { pullRequestId: $pullRequestId }) {
      pullRequest {
        id
        state
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
