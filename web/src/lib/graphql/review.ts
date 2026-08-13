/**
 * GraphQL PR 评审与工作流模板（自 graphql/index.ts 拆出）
 * 评论/评审、评审摘要、merge、请求评审、线程解决、时间线、Projects/Development/Lock。
 */

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
