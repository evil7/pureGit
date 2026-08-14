/**
 * GraphQL 账户/组织/用户模板（自 graphql/index.ts 拆出）
 * viewer orgs/repos/gists、更新用户、SSH/GPG、关注、主题、组织成员/团队等。
 */

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

/** 检测当前用户是否已 fork 某仓库（viewer 的 fork 仓库列表，按 parent.nameWithOwner 匹配）。
 * isFork: true 过滤仅取 fork；parent 取上游 full_name 精确匹配（支持改名 fork 后仍能识别）。 */
export const VIEWER_FORK_DETECT_QUERY = /* GraphQL */ `
  query ViewerForkDetect {
    viewer {
      repositories(first: 100, isFork: true) {
        nodes {
          nameWithOwner
          parent {
            nameWithOwner
          }
        }
        pageInfo {
          hasNextPage
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

/** 当前用户的 Gist 列表（/gists）：viewer.gists 按最近 push 排序，after 游标续接。
 * resourcePath 提取 REST gist id（列表跳转详情需 REST id；GraphQL node id 与 REST id 不同）。
 * privacy: ALL —— Gist 默认 privacy 为 PUBLIC，会漏掉私有 gist（实测 viewer.gists 不传 privacy 仅返回公开）。 */
export const MY_GISTS_QUERY = /* GraphQL */ `
  query MyGists($after: String) {
    viewer {
      gists(
        first: 50
        after: $after
        privacy: ALL
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          resourcePath
          description
          isPublic
          createdAt
          updatedAt
          owner {
            login
            avatarUrl
          }
          comments {
            totalCount
          }
          files(limit: 100) {
            name
            language {
              name
            }
            size
          }
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

// ===== 账户设置补充（SSH/GPG/关注/主题/订阅/删除仓库） =====

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

/** 替换仓库主题（mutation；topicNames 全量替换）。
 * ⚠️ 正确入口是 `updateTopics`（官方 Mutation 无 updateRepositoryTopics 字段），
 * 返回 UpdateTopicsPayload.repository → 再取 repositoryTopics。 */
export const UPDATE_REPOSITORY_TOPICS_MUTATION = /* GraphQL */ `
  mutation UpdateRepositoryTopics($repositoryId: ID!, $topicNames: [String!]!) {
    updateTopics(input: { repositoryId: $repositoryId, topicNames: $topicNames }) {
      repository {
        repositoryTopics(first: 20) {
          nodes {
            topic {
              name
            }
          }
        }
      }
    }
  }
`;
