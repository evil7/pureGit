/**
 * GitHub GraphQL 请求模板 - Projects v2 板块
 *
 * Projects v2 全部查询/变更模板（legacy REST 已下线，仅 GraphQL 可用）。
 * 覆盖：仓库项目列表、新建/链接/删除、详情看板（字段 + items 分页）、
 * 字段（列）管理、item 字段值与位置更新、draft/现有 issue/PR 的添加与移除。
 */

/** 仓库 Projects v2 列表（额外取 repository.id / owner.id 供新建/链接 mutation 入参 + items 总数） */
export const REPO_PROJECTS_V2_QUERY = /* GraphQL */ `
  query RepoProjectsV2($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      id
      owner {
        id
        login
      }
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
          items {
            totalCount
          }
        }
      }
    }
  }
`;

/** 新建 project（owner 下创建，可选直接链接到 repo；需 owner 权限 + 可选 repo admin） */
export const CREATE_PROJECT_V2_MUTATION = /* GraphQL */ `
  mutation CreateProjectV2($ownerId: ID!, $title: String!, $repositoryId: ID) {
    createProjectV2(input: { ownerId: $ownerId, title: $title, repositoryId: $repositoryId }) {
      projectV2 {
        id
        title
        number
        url
      }
    }
  }
`;

/** 链接已有 project 到仓库（需 repo admin + project admin） */
export const LINK_PROJECT_V2_TO_REPOSITORY_MUTATION = /* GraphQL */ `
  mutation LinkProjectV2ToRepository($projectId: ID!, $repositoryId: ID!) {
    linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
      repository {
        id
      }
    }
  }
`;

/** 按 owner login + number 解析 project node id（org 与 user 二选一命中） */
export const PROJECT_V2_BY_OWNER_QUERY = /* GraphQL */ `
  query ProjectV2ByOwner($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        id
      }
    }
    user(login: $login) {
      projectV2(number: $number) {
        id
      }
    }
  }
`;

/** 单个 project 详情（看板视图：标题 + 字段 options + items 卡片）。
 * fields 里的 single-select 字段 = 看板列字段（Status）；items 的 fieldValues
 * 关联该字段的 optionId 决定所属列。org/user 二选一命中（project 属 owner 级）。 */
export const PROJECT_V2_DETAIL_QUERY = /* GraphQL */ `
  query ProjectV2Detail($login: String!, $number: Int!, $itemsFirst: Int!, $itemsAfter: String) {
    organization(login: $login) {
      projectV2(number: $number) {
        ...ProjectV2DetailFields
      }
    }
    user(login: $login) {
      projectV2(number: $number) {
        ...ProjectV2DetailFields
      }
    }
  }

  fragment ProjectV2DetailFields on ProjectV2 {
    id
    title
    number
    shortDescription
    closed
    public
    readme
    url
    viewerCanUpdate
    fields(first: 50) {
      nodes {
        ... on ProjectV2Field {
          id
          name
          dataType
        }
        ... on ProjectV2SingleSelectField {
          id
          name
          dataType
          options {
            id
            name
            color
            description
          }
        }
        ... on ProjectV2MultiSelectField {
          id
          name
          dataType
          multiSelectOptions {
            id
            name
            color
          }
        }
        ... on ProjectV2IterationField {
          id
          name
          dataType
        }
      }
    }
    items(first: $itemsFirst, after: $itemsAfter) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...ProjectV2ItemFields
      }
    }
  }

  fragment ProjectV2ItemFields on ProjectV2Item {
    id
    type
    isArchived
    content {
      ... on Issue {
        title
        number
        url
      }
      ... on PullRequest {
        title
        number
        url
      }
      ... on DraftIssue {
        title
      }
    }
    fieldValues(first: 50) {
      nodes {
        ... on ProjectV2ItemFieldTextValue {
          field {
            ... on ProjectV2Field {
              id
            }
          }
          text
        }
        ... on ProjectV2ItemFieldNumberValue {
          field {
            ... on ProjectV2Field {
              id
            }
          }
          number
        }
        ... on ProjectV2ItemFieldDateValue {
          field {
            ... on ProjectV2Field {
              id
            }
          }
          date
        }
        ... on ProjectV2ItemFieldSingleSelectValue {
          field {
            ... on ProjectV2SingleSelectField {
              id
            }
          }
          optionId
        }
        ... on ProjectV2ItemFieldMultiSelectValue {
          field {
            ... on ProjectV2MultiSelectField {
              id
            }
          }
          options {
            id
            name
            color
          }
        }
        ... on ProjectV2ItemFieldIterationValue {
          field {
            ... on ProjectV2IterationField {
              id
            }
          }
          iterationId
          title
        }
      }
    }
  }
`;

/** 续接 project items（分页 LoadMore；复用 ProjectV2ItemFields fragment） */
export const PROJECT_V2_ITEMS_QUERY = /* GraphQL */ `
  query ProjectV2Items($login: String!, $number: Int!, $itemsFirst: Int!, $itemsAfter: String) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: $itemsFirst, after: $itemsAfter) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...ProjectV2ItemFields
          }
        }
      }
    }
    user(login: $login) {
      projectV2(number: $number) {
        items(first: $itemsFirst, after: $itemsAfter) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...ProjectV2ItemFields
          }
        }
      }
    }
  }
`;

/** 更新 item 字段值（拖拽换列 = 更新 status 单选框字段；需 project write 权限） */
export const UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_MUTATION = /* GraphQL */ `
  mutation UpdateProjectV2ItemFieldValue(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
    $optionId: String
  ) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

/** 更新 item 任意字段值（抽屉编辑：text/number/date/single/multi/iteration 按需传其一） */
export const UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_GENERIC_MUTATION = /* GraphQL */ `
  mutation UpdateProjectV2ItemFieldValueGeneric(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
    $text: String
    $number: Float
    $date: Date
    $singleSelectOptionId: String
    $multiSelectOptionIds: [String!]
    $iterationId: String
  ) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: {
          text: $text
          number: $number
          date: $date
          singleSelectOptionId: $singleSelectOptionId
          multiSelectOptionIds: $multiSelectOptionIds
          iterationId: $iterationId
        }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

/** 更新 item 位置（列内拖拽排序；afterId 为空 = 移到列首；需 project write 权限） */
export const UPDATE_PROJECT_V2_ITEM_POSITION_MUTATION = /* GraphQL */ `
  mutation UpdateProjectV2ItemPosition($projectId: ID!, $itemId: ID!, $afterId: ID) {
    updateProjectV2ItemPosition(
      input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }
    ) {
      items {
        totalCount
      }
    }
  }
`;

/** 更新 project 元信息（标题/描述/readme/关闭/公开；仅传需要变更的字段） */
export const UPDATE_PROJECT_V2_MUTATION = /* GraphQL */ `
  mutation UpdateProjectV2(
    $projectId: ID!
    $title: String
    $shortDescription: String
    $readme: String
    $closed: Boolean
    $public: Boolean
  ) {
    updateProjectV2(
      input: {
        projectId: $projectId
        title: $title
        shortDescription: $shortDescription
        readme: $readme
        closed: $closed
        public: $public
      }
    ) {
      projectV2 {
        id
        title
        number
      }
    }
  }
`;

/** 删除 project（不可恢复） */
export const DELETE_PROJECT_V2_MUTATION = /* GraphQL */ `
  mutation DeleteProjectV2($projectId: ID!) {
    deleteProjectV2(input: { projectId: $projectId }) {
      projectV2 {
        id
      }
    }
  }
`;

/** 添加 draft issue 到 project（title 必填；body 可选） */
export const ADD_PROJECT_V2_DRAFT_ISSUE_MUTATION = /* GraphQL */ `
  mutation AddProjectV2DraftIssue($projectId: ID!, $title: String!, $body: String) {
    addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
      projectItem {
        id
      }
    }
  }
`;

/** 添加现有 issue/PR 到 project（contentId = issue/PR 的 node id） */
export const ADD_PROJECT_V2_ITEM_BY_ID_MUTATION = /* GraphQL */ `
  mutation AddProjectV2ItemById($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item {
        id
      }
    }
  }
`;

/** 从 project 移除 item（非删除 issue/PR 本身） */
export const DELETE_PROJECT_V2_ITEM_MUTATION = /* GraphQL */ `
  mutation DeleteProjectV2Item($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
    }
  }
`;

/** 更新 project 字段（列）：改名 / 覆盖 single-select 选项（增删选项、改名、改颜色、改描述） */
export const UPDATE_PROJECT_V2_FIELD_MUTATION = /* GraphQL */ `
  mutation UpdateProjectV2Field(
    $fieldId: ID!
    $name: String
    $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]
  ) {
    updateProjectV2Field(
      input: { fieldId: $fieldId, name: $name, singleSelectOptions: $singleSelectOptions }
    ) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options {
            id
            name
            color
            description
          }
        }
      }
    }
  }
`;

/** 按仓库 + number 解析 issue/PR 的 node id（用于 addProjectV2ItemById）
 * 用 Repository.issueOrPullRequest 联合字段（单一字段同时命中 issue/PR），
 * 避免同时查 issue(number)+pullRequest(number) 时另一字段抛“Could not resolve”字段级错误。 */
export const REPOSITORY_ISSUE_PR_QUERY = /* GraphQL */ `
  query RepositoryIssuePr($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issueOrPullRequest(number: $number) {
        ... on Issue {
          id
        }
        ... on PullRequest {
          id
        }
      }
    }
  }
`;

/** 新建 project 字段（列）：单选框类型 + 初始选项（至少一个） */
export const CREATE_PROJECT_V2_FIELD_MUTATION = /* GraphQL */ `
  mutation CreateProjectV2Field(
    $projectId: ID!
    $name: String!
    $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]!
  ) {
    createProjectV2Field(
      input: {
        projectId: $projectId
        dataType: SINGLE_SELECT
        name: $name
        singleSelectOptions: $singleSelectOptions
      }
    ) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
        }
      }
    }
  }
`;

/** 删除 project 字段（列） */
export const DELETE_PROJECT_V2_FIELD_MUTATION = /* GraphQL */ `
  mutation DeleteProjectV2Field($fieldId: ID!) {
    deleteProjectV2Field(input: { fieldId: $fieldId }) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
        }
      }
    }
  }
`;
