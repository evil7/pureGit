/**
 * GraphQL issue / PR / release 查询模板（自 graphql/index.ts 拆出）
 * 列表、详情、详情+评论合并查询、release 列表/详情/计数。
 */

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
          databaseId
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

/** issue 计数（列表分页用）：分页请求（page>1）REST 响应不含总数 → 轻量补查 open/closed 计数供分页器计算总页数 */
export const ISSUE_COUNTS_QUERY = /* GraphQL */ `
  query RepoIssueCounts($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      openCount: issues(states: [OPEN]) {
        totalCount
      }
      closedCount: issues(states: [CLOSED]) {
        totalCount
      }
    }
  }
`;

/** issue 详情 */
export const ISSUE_DETAIL_QUERY = /* GraphQL */ `
  query IssueDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        databaseId
        id
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        body
        locked
        isPinned
        viewerSubscription
        reactionGroups {
          content
          reactors {
            totalCount
          }
          viewerHasReacted
        }
        viewerHasReacted
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

/** Issue 开发关联（issue 侧栏 Development 只读展示：linked branches + 关联 PR；GraphQL-only） */
export const ISSUE_DEVELOPMENT_QUERY = /* GraphQL */ `
  query IssueDevelopment($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
        linkedBranches(first: 10) {
          nodes {
            ref {
              name
            }
          }
        }
        timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  number
                  title
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** PR 计数（列表分页用）：语义与 PULLS_QUERY 的 openCount/closedCount 完全一致（CLOSED+MERGED 合计） */
export const PULL_COUNTS_QUERY = /* GraphQL */ `
  query RepoPullCounts($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      openCount: pullRequests(states: [OPEN]) {
        totalCount
      }
      closedCount: pullRequests(states: [CLOSED, MERGED]) {
        totalCount
      }
    }
  }
`;

/** PR 列表（states: OPEN/CLOSED/MERGED 数组；orderBy 由官方 Sort 菜单驱动）
 * ⚠️ orderBy 参数类型是 IssueOrder（非 PullRequestOrder）：Repository.pullRequests 连接复用了
 * Issue 的排序枚举（PR 是 Issue 子类型），故 $orderField 须声明为 IssueOrderField!。 */
export const PULLS_QUERY = /* GraphQL */ `
  query RepoPulls(
    $owner: String!
    $name: String!
    $states: [PullRequestState!]
    $first: Int!
    $orderField: IssueOrderField!
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
              databaseId
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
        id
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
            databaseId
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
        databaseId
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
        reactionGroups {
          content
          reactors {
            totalCount
          }
          viewerHasReacted
        }
        viewerHasReacted
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
          number
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
          number
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
        # 总评论数（官方字段：issue 评论 + 行内评审评论合计；Conversation tab 计数）
        totalCommentsCount
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
          number
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

/** 添加表情反应（addReaction；subjectId = 任意 Reactable 的 node id——issue/PR/评论/评审/讨论等通用）。
 * 返回 subject 最新 reactionGroups + viewerHasReacted，供 UI 乐观刷新；GraphQL-only（REST 删除需先查 reaction_id，降级收益低）。 */
export const ADD_REACTION_MUTATION = /* GraphQL */ `
  mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
      subject {
        id
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
`;

/** 移除表情反应（removeReaction；content 精确匹配要撤销的那一个表情）。 */
export const REMOVE_REACTION_MUTATION = /* GraphQL */ `
  mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
      subject {
        id
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
`;

/** 创建 release（mutation；repositoryId 为仓库 node id，tagName 必填，draft/prerelease/name/body 可选） */
export const CREATE_RELEASE_MUTATION = /* GraphQL */ `
  mutation CreateRelease($input: CreateReleaseInput!) {
    createRelease(input: $input) {
      release {
        id
        databaseId
        tagName
        name
        description
        url
        isDraft
        isPrerelease
      }
    }
  }
`;

/** 更新 release（mutation；releaseId 为 release node id） */
export const UPDATE_RELEASE_MUTATION = /* GraphQL */ `
  mutation UpdateRelease($input: UpdateReleaseInput!) {
    updateRelease(input: $input) {
      release {
        id
        databaseId
        tagName
        name
        description
        url
        isDraft
        isPrerelease
      }
    }
  }
`;

/** 删除 release（mutation；危险操作，需 admin；不可恢复） */
export const DELETE_RELEASE_MUTATION = /* GraphQL */ `
  mutation DeleteRelease($releaseId: ID!) {
    deleteRelease(input: { releaseId: $releaseId }) {
      release {
        id
      }
    }
  }
`;
