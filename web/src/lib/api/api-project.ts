/**
 * GitHub API smart layer - Projects v2 板块（自 api-repo-extra.ts 拆出）
 *
 * 覆盖 Projects v2 的完整数据访问：仓库项目列表、新建/链接/删除、详情看板、
 * 字段（列）管理、item 字段值与位置更新、draft/现有 issue/PR 的添加与移除。
 * Projects v2 legacy REST 已下线，本板块全部直连 GraphQL（无 REST 降级）。
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  REPO_PROJECTS_V2_QUERY,
  CREATE_PROJECT_V2_MUTATION,
  LINK_PROJECT_V2_TO_REPOSITORY_MUTATION,
  PROJECT_V2_BY_OWNER_QUERY,
  PROJECT_V2_DETAIL_QUERY,
  PROJECT_V2_ITEMS_QUERY,
  UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_MUTATION,
  UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_GENERIC_MUTATION,
  UPDATE_PROJECT_V2_ITEM_POSITION_MUTATION,
  UPDATE_PROJECT_V2_MUTATION,
  DELETE_PROJECT_V2_MUTATION,
  ADD_PROJECT_V2_DRAFT_ISSUE_MUTATION,
  ADD_PROJECT_V2_ITEM_BY_ID_MUTATION,
  DELETE_PROJECT_V2_ITEM_MUTATION,
  UPDATE_PROJECT_V2_FIELD_MUTATION,
  CREATE_PROJECT_V2_FIELD_MUTATION,
  DELETE_PROJECT_V2_FIELD_MUTATION,
  REPOSITORY_ISSUE_PR_QUERY,
} from "../graphql";

/** 仓库 Projects v2 列表项（GraphQL projectsV2 节点） */
export interface RepoProjectV2 {
  id: string;
  title: string;
  number: number;
  shortDescription: string | null;
  url: string;
  closed: boolean;
  updatedAt: string;
  public: boolean;
  /** items 连接（总数；done 计数由前端按需另查） */
  items: { totalCount: number };
}

/** 仓库 Projects v2 列表 + 新建/链接所需上下文（repositoryId/ownerId） */
export interface RepoProjectsV2Context {
  projects: RepoProjectV2[];
  repositoryId: string | null;
  ownerId: string | null;
}

/**
 * 获取仓库 Projects v2 列表（固定 GraphQL——无 REST 等价，smart 层直连 GraphQL）。
 * 未登录/失败抛错（页面按需处理）；匿名强制 REST 的短路由 graphqlRequest 处理。
 */
export async function fetchRepoProjectsV2Smart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoProjectsV2Context> {
  const resp: GraphQLResponse<{
    repository: {
      id: string;
      owner: { id: string; login: string };
      projectsV2: { nodes: RepoProjectV2[] } | null;
    } | null;
  }> = await graphqlRequest(REPO_PROJECTS_V2_QUERY, { owner, name: repo, first: 50 }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.repository?.projectsV2) {
    throw new Error(resp.errors?.[0]?.message ?? "Projects v2 query failed");
  }
  const repository = resp.data.repository;
  return {
    projects: repository.projectsV2?.nodes ?? [],
    repositoryId: repository.id ?? null,
    ownerId: repository.owner?.id ?? null,
  };
}

/** 新建 project（owner 下创建并链接到 repo；需 token + owner/repo admin 权限） */
export async function createProjectV2Smart(
  ownerId: string,
  title: string,
  repositoryId: string | null,
  token: string,
): Promise<{ id: string; title: string; number: number; url: string }> {
  const resp: GraphQLResponse<{
    createProjectV2: { projectV2: { id: string; title: string; number: number; url: string } };
  }> = await graphqlRequest(CREATE_PROJECT_V2_MUTATION, { ownerId, title, repositoryId }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.createProjectV2?.projectV2) {
    throw new Error(resp.errors?.[0]?.message ?? "Create project failed");
  }
  return resp.data.createProjectV2.projectV2;
}

/** 链接已有 project 到仓库（需 repo admin + project admin） */
export async function linkProjectV2ToRepositorySmart(
  projectId: string,
  repositoryId: string,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{ linkProjectV2ToRepository: { repository: { id: string } } }> =
    await graphqlRequest(
      LINK_PROJECT_V2_TO_REPOSITORY_MUTATION,
      { projectId, repositoryId },
      token,
    );
  if (hasGraphQLErrors(resp) || !resp.data?.linkProjectV2ToRepository) {
    throw new Error(resp.errors?.[0]?.message ?? "Link project failed");
  }
}

/** 按 owner login + number 解析 project node id（org/user 二选一；未命中返回 null） */
export async function resolveProjectV2NodeId(
  login: string,
  number: number,
  token: string,
): Promise<string | null> {
  const resp: GraphQLResponse<{
    organization: { projectV2: { id: string } | null } | null;
    user: { projectV2: { id: string } | null } | null;
  }> = await graphqlRequest(PROJECT_V2_BY_OWNER_QUERY, { login, number }, token);
  return resp.data?.organization?.projectV2?.id ?? resp.data?.user?.projectV2?.id ?? null;
}

// ===== Project 详情（看板视图：列 = Status 单选框 options，卡片 = item content，拖拽 = 字段值/位置更新）=====

/** 看板列（Status 单选框的一个 option） */
export interface ProjectV2Column {
  optionId: string;
  name: string;
  color: string;
  description: string;
  items: ProjectV2Card[];
}

/** 字段选项（single/multi select 共用） */
export interface ProjectV2FieldOption {
  id: string;
  name: string;
  color: string;
}

/** 字段定义（列/自定义字段元信息，供抽屉遍历编辑） */
export interface ProjectV2FieldDef {
  id: string;
  name: string;
  dataType: string;
  options: ProjectV2FieldOption[];
}

/** item 单个字段值（按字段类型对应其一；仅可编辑类型） */
export interface ProjectV2FieldValue {
  fieldId: string;
  text: string | null;
  number: number | null;
  date: string | null;
  /** single-select 选中项 id */
  optionId: string | null;
  /** multi-select 选中项 ids */
  optionIds: string[];
  /** iteration 选中项 */
  iterationId: string | null;
  iterationTitle: string | null;
}

/** 看板卡片（item 内容：issue/PR/draft） */
export interface ProjectV2Card {
  itemId: string;
  type: string;
  title: string;
  number: number | null;
  url: string | null;
  isArchived: boolean;
  /** status 字段的 optionId（用于分列；null = 未设置 status） */
  statusOptionId: string | null;
  /** 全部可编辑字段值（抽屉展示/编辑） */
  fieldValues: ProjectV2FieldValue[];
}

/** 单个 project 详情（看板视图上下文） */
export interface ProjectV2Detail {
  projectId: string;
  title: string;
  number: number;
  shortDescription: string | null;
  closed: boolean;
  public: boolean;
  readme: string | null;
  url: string;
  viewerCanUpdate: boolean;
  /** 看板列字段（Status single-select 字段，含 id 供拖拽更新用） */
  statusFieldId: string | null;
  statusFieldName: string | null;
  columns: ProjectV2Column[];
  /** 所有字段定义（含 id/dataType/options，供抽屉遍历） */
  fields: ProjectV2FieldDef[];
  /** 未设置 status（或 status 不在 options 内）的项 */
  orphans: ProjectV2Card[];
  /** 总 items 数（含未分列项） */
  totalCount: number;
  /** 是否有更多 items（分页） */
  hasNextItems: boolean;
  endCursor: string | null;
}

/** items 连接节点（详情/续接查询共用） */
interface ProjectV2ItemNode {
  id: string;
  type: string;
  isArchived: boolean;
  content: { title?: string; number?: number | null; url?: string | null } | null;
  fieldValues: {
    nodes: ProjectV2FieldValueNode[];
  };
}

/** item 字段值原始节点（union 各类型内联片段合并形状） */
interface ProjectV2FieldValueNode {
  field: { id: string } | null;
  text: string | null;
  number: number | null;
  date: string | null;
  optionId: string | null;
  options: { id: string; name: string; color: string }[] | null;
  iterationId: string | null;
  title: string | null;
}

/** 原始 GraphQL 节点（详情查询返回形状） */
interface ProjectV2DetailNode {
  id: string;
  title: string;
  number: number;
  shortDescription: string | null;
  closed: boolean;
  public: boolean;
  readme: string | null;
  url: string;
  viewerCanUpdate: boolean;
  fields: {
    nodes: ProjectV2FieldDefNode[];
  };
  items: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProjectV2ItemNode[];
  };
}

/** 字段定义原始节点（union 各类型内联片段合并形状） */
interface ProjectV2FieldDefNode {
  id: string;
  name: string;
  dataType: string;
  options: { id: string; name: string; color: string; description: string }[] | null;
  multiSelectOptions: { id: string; name: string; color: string }[] | null;
}

/** 解析单个 item 字段值 → 统一值结构 */
function toFieldValue(fv: ProjectV2FieldValueNode): ProjectV2FieldValue {
  return {
    fieldId: fv.field?.id ?? "",
    text: fv.text ?? null,
    number: fv.number ?? null,
    date: fv.date ?? null,
    optionId: fv.optionId ?? null,
    optionIds: (fv.options ?? []).map((o) => o.id),
    iterationId: fv.iterationId ?? null,
    iterationTitle: fv.title ?? null,
  };
}

/** 解析单个 item → 卡片（携带 status optionId 供分列 + 全字段值供抽屉） */
function toCard(it: ProjectV2ItemNode, statusFieldId: string | null): ProjectV2Card {
  const fieldValues = (it.fieldValues?.nodes ?? []).filter((fv) => fv.field?.id).map(toFieldValue);
  let statusOptionId: string | null = null;
  for (const fv of fieldValues) {
    if (fv.fieldId === statusFieldId) {
      statusOptionId = fv.optionId;
      break;
    }
  }
  return {
    itemId: it.id,
    type: it.type,
    title: it.content?.title ?? "",
    number: it.content?.number ?? null,
    url: it.content?.url ?? null,
    isArchived: it.isArchived,
    statusOptionId,
    fieldValues,
  };
}

/** 从 GraphQL 节点解析看板列（Status 字段 options）+ 卡片分列 */
function toProjectV2Detail(node: ProjectV2DetailNode): ProjectV2Detail {
  // 所有字段定义（含 dataType/options，抽屉遍历用）
  const fields: ProjectV2FieldDef[] = (node.fields?.nodes ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    dataType: f.dataType,
    options: f.options ?? f.multiSelectOptions ?? [],
  }));

  // 看板列字段：fields 里第一个 single-select 字段（默认 Status）
  const statusField = (node.fields?.nodes ?? []).find((f) => f.options) ?? null;

  const columns: ProjectV2Column[] = (statusField?.options ?? []).map((o) => ({
    optionId: o.id,
    name: o.name,
    color: o.color,
    description: o.description ?? "",
    items: [],
  }));
  const colIndex = new Map(columns.map((c, i) => [c.optionId, i]));
  const orphans: ProjectV2Card[] = [];

  for (const it of node.items?.nodes ?? []) {
    const card = toCard(it, statusField?.id ?? null);
    const idx = card.statusOptionId ? colIndex.get(card.statusOptionId) : undefined;
    if (idx !== undefined) columns[idx].items.push(card);
    else orphans.push(card);
  }

  return {
    projectId: node.id,
    title: node.title,
    number: node.number,
    shortDescription: node.shortDescription,
    closed: node.closed,
    public: node.public,
    readme: node.readme,
    url: node.url,
    viewerCanUpdate: node.viewerCanUpdate,
    statusFieldId: statusField?.id ?? null,
    statusFieldName: statusField?.name ?? null,
    columns,
    fields,
    orphans,
    totalCount: node.items?.totalCount ?? 0,
    hasNextItems: node.items?.pageInfo?.hasNextPage ?? false,
    endCursor: node.items?.pageInfo?.endCursor ?? null,
  };
}

/** 获取单个 project 详情（看板视图；org/user 二选一命中；需 token） */
export async function fetchProjectV2DetailSmart(
  login: string,
  number: number,
  token: string,
): Promise<ProjectV2Detail> {
  const resp: GraphQLResponse<{
    organization: { projectV2: ProjectV2DetailNode | null } | null;
    user: { projectV2: ProjectV2DetailNode | null } | null;
  }> = await graphqlRequest(PROJECT_V2_DETAIL_QUERY, { login, number, itemsFirst: 100 }, token);
  // org/user 二选一：单侧（非 org 或非 user）解析报错属预期，取另一侧有效节点
  const node = resp.data?.organization?.projectV2 ?? resp.data?.user?.projectV2;
  if (!node) {
    throw new Error(resp.errors?.[0]?.message ?? "Project not found");
  }
  return toProjectV2Detail(node);
}

/** 续接 project items（分页 LoadMore）；返回解析好的新卡片 + 分页游标 */
export async function fetchProjectV2ItemsSmart(
  login: string,
  number: number,
  after: string,
  statusFieldId: string | null,
  token: string,
): Promise<{ cards: ProjectV2Card[]; hasNextPage: boolean; endCursor: string | null }> {
  const resp: GraphQLResponse<{
    organization: { projectV2: { items: ProjectV2DetailNode["items"] } | null } | null;
    user: { projectV2: { items: ProjectV2DetailNode["items"] } | null } | null;
  }> = await graphqlRequest(
    PROJECT_V2_ITEMS_QUERY,
    { login, number, itemsFirst: 100, itemsAfter: after },
    token,
  );
  const items = resp.data?.organization?.projectV2?.items ?? resp.data?.user?.projectV2?.items;
  if (!items) {
    throw new Error(resp.errors?.[0]?.message ?? "Project items not found");
  }
  return {
    cards: (items.nodes ?? []).map((it) => toCard(it, statusFieldId)),
    hasNextPage: items.pageInfo?.hasNextPage ?? false,
    endCursor: items.pageInfo?.endCursor ?? null,
  };
}

/** project 元信息补丁（标题/描述/readme/关闭/公开，仅传需要变更的字段） */
export interface ProjectV2Patch {
  title?: string;
  shortDescription?: string | null;
  readme?: string | null;
  closed?: boolean;
  public?: boolean;
}

/** 更新 project 元信息（标题/描述/readme/关闭/公开；需 project write） */
export async function updateProjectV2Smart(
  projectId: string,
  patch: ProjectV2Patch,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    updateProjectV2: { projectV2: { id: string } };
  }> = await graphqlRequest(UPDATE_PROJECT_V2_MUTATION, { projectId, ...patch }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.updateProjectV2?.projectV2) {
    throw new Error(resp.errors?.[0]?.message ?? "Update project failed");
  }
}

/** 删除 project（不可恢复；需 project write） */
export async function deleteProjectV2Smart(projectId: string, token: string): Promise<void> {
  const resp: GraphQLResponse<{ deleteProjectV2: { projectV2: { id: string } } }> =
    await graphqlRequest(DELETE_PROJECT_V2_MUTATION, { projectId }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.deleteProjectV2?.projectV2) {
    throw new Error(resp.errors?.[0]?.message ?? "Delete project failed");
  }
}

/** 单选框选项补丁（更新字段时覆盖整个选项列表；id 保留已有选项身份，新增项省略 id） */
export interface ProjectV2OptionPatch {
  id?: string | null;
  name: string;
  color: string;
  description: string;
}

/**
 * 更新 project 字段（列）：改名 + 覆盖 single-select 选项（增删/改名/改颜色/改描述）。
 * 注意：singleSelectOptions 为整体覆盖，调用方需传完整目标列表（含保留项 id）。
 */
export async function updateProjectV2FieldSmart(
  fieldId: string,
  patch: { name?: string; options?: ProjectV2OptionPatch[] },
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    updateProjectV2Field: { projectV2Field: { id: string } | null };
  }> = await graphqlRequest(
    UPDATE_PROJECT_V2_FIELD_MUTATION,
    { fieldId, name: patch.name, singleSelectOptions: patch.options },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.updateProjectV2Field?.projectV2Field) {
    throw new Error(resp.errors?.[0]?.message ?? "Update field failed");
  }
}

/** 新建 project 字段（列）：单选框类型 + 初始选项；新增选项无需 id */
export async function createProjectV2FieldSmart(
  projectId: string,
  name: string,
  options: ProjectV2OptionPatch[],
  token: string,
): Promise<void> {
  const singleSelectOptions = options.map((o) => ({
    name: o.name,
    color: o.color,
    description: o.description,
  }));
  const resp: GraphQLResponse<{
    createProjectV2Field: { projectV2Field: { id: string } | null };
  }> = await graphqlRequest(
    CREATE_PROJECT_V2_FIELD_MUTATION,
    { projectId, name, singleSelectOptions },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.createProjectV2Field?.projectV2Field) {
    throw new Error(resp.errors?.[0]?.message ?? "Create field failed");
  }
}

/** 删除 project 字段（列；不可恢复，含其所有 item 上的该字段值） */
export async function deleteProjectV2FieldSmart(fieldId: string, token: string): Promise<void> {
  const resp: GraphQLResponse<{
    deleteProjectV2Field: { projectV2Field: { id: string } | null };
  }> = await graphqlRequest(DELETE_PROJECT_V2_FIELD_MUTATION, { fieldId }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.deleteProjectV2Field?.projectV2Field) {
    throw new Error(resp.errors?.[0]?.message ?? "Delete field failed");
  }
}

/** 添加 draft issue 到 project（title 必填；body 可选；需 project write） */
export async function addProjectV2DraftIssueSmart(
  projectId: string,
  title: string,
  body: string,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    addProjectV2DraftIssue: { projectItem: { id: string } };
  }> = await graphqlRequest(
    ADD_PROJECT_V2_DRAFT_ISSUE_MUTATION,
    { projectId, title, body: body || null },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.addProjectV2DraftIssue?.projectItem) {
    throw new Error(resp.errors?.[0]?.message ?? "Add draft issue failed");
  }
}

/** 添加现有 issue/PR 到 project（contentId = issue/PR node id；需 project write） */
export async function addProjectV2ItemByIdSmart(
  projectId: string,
  contentId: string,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{ addProjectV2ItemById: { item: { id: string } } }> =
    await graphqlRequest(ADD_PROJECT_V2_ITEM_BY_ID_MUTATION, { projectId, contentId }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.addProjectV2ItemById?.item) {
    throw new Error(resp.errors?.[0]?.message ?? "Add item failed");
  }
}

/** 从 project 移除 item（非删除 issue/PR 本身；需 project write） */
export async function deleteProjectV2ItemSmart(
  projectId: string,
  itemId: string,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{ deleteProjectV2Item: { deletedItemId: string | null } }> =
    await graphqlRequest(DELETE_PROJECT_V2_ITEM_MUTATION, { projectId, itemId }, token);
  if (hasGraphQLErrors(resp) || resp.data?.deleteProjectV2Item?.deletedItemId == null) {
    throw new Error(resp.errors?.[0]?.message ?? "Delete item failed");
  }
}

/** 按仓库 + number 解析 issue/PR 的 node id（issue 优先，否则 PR；未命中返回 null） */
export async function resolveIssuePrNodeId(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<string | null> {
  const resp: GraphQLResponse<{
    repository: {
      issueOrPullRequest: { id: string } | null;
    } | null;
  }> = await graphqlRequest(REPOSITORY_ISSUE_PR_QUERY, { owner, name: repo, number }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.repository) return null;
  return resp.data.repository.issueOrPullRequest?.id ?? null;
}

/** 更新 item 字段值（拖拽换列 = 更新 Status 单选框；需 project write） */
export async function updateProjectV2ItemFieldValueSmart(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string | null,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
  }> = await graphqlRequest(
    UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_MUTATION,
    { projectId, itemId, fieldId, optionId },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.updateProjectV2ItemFieldValue) {
    throw new Error(resp.errors?.[0]?.message ?? "Update item field value failed");
  }
}

/** 抽屉编辑 item 字段值补丁（按字段类型传对应项；其余为 null 保持不更新） */
export interface ProjectV2ItemFieldPatch {
  text?: string | null;
  number?: number | null;
  date?: string | null;
  singleSelectOptionId?: string | null;
  multiSelectOptionIds?: string[] | null;
  iterationId?: string | null;
}

/** 更新 item 任意字段值（抽屉编辑：text/number/date/single/multi/iteration 其一） */
export async function updateProjectV2ItemFieldValueGenericSmart(
  projectId: string,
  itemId: string,
  fieldId: string,
  patch: ProjectV2ItemFieldPatch,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
  }> = await graphqlRequest(
    UPDATE_PROJECT_V2_ITEM_FIELD_VALUE_GENERIC_MUTATION,
    {
      projectId,
      itemId,
      fieldId,
      text: patch.text,
      number: patch.number,
      date: patch.date,
      singleSelectOptionId: patch.singleSelectOptionId,
      multiSelectOptionIds: patch.multiSelectOptionIds,
      iterationId: patch.iterationId,
    },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.updateProjectV2ItemFieldValue) {
    throw new Error(resp.errors?.[0]?.message ?? "Update item field value failed");
  }
}

/** 更新 item 位置（列内拖拽排序；afterId 空 = 移到列首；需 project write） */
export async function updateProjectV2ItemPositionSmart(
  projectId: string,
  itemId: string,
  afterId: string | null,
  token: string,
): Promise<void> {
  const resp: GraphQLResponse<{
    updateProjectV2ItemPosition: { items: { totalCount: number } };
  }> = await graphqlRequest(
    UPDATE_PROJECT_V2_ITEM_POSITION_MUTATION,
    { projectId, itemId, afterId },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.updateProjectV2ItemPosition) {
    throw new Error(resp.errors?.[0]?.message ?? "Update item position failed");
  }
}
