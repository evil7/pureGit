/**
 * GraphQL Discussions 模板（自 graphql/index.ts 拆出）
 * 讨论列表/搜索/详情 + 创建讨论/评论变更（REST 无 discussion 端点，GraphQL only）。
 */

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

/** 全站搜索讨论（跨仓库；附来源仓库 nameWithOwner，供结果卡片展示来源） */
export const SEARCH_DISCUSSIONS_QUERY = /* GraphQL */ `
  query SearchDiscussions($q: String!, $first: Int!) {
    search(query: $q, type: DISCUSSION, first: $first) {
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
          repository {
            nameWithOwner
          }
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
