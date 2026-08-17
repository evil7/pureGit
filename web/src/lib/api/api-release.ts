/**
 * GitHub API smart layer - release（自 api-issue.ts / api-repo.ts 拆出）
 * 列表 / 详情 / 最新 / 计数，统一收纳 Release 相关 smart 通道（GraphQL 首选 + REST 降级）。
 */

import { graphqlRequest, hasGraphQLErrors, withRestFallback } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import {
  RELEASES_QUERY,
  RELEASE_DETAIL_QUERY,
  LATEST_RELEASE_QUERY,
  RELEASES_COUNT_QUERY,
  CREATE_RELEASE_MUTATION,
  UPDATE_RELEASE_MUTATION,
  DELETE_RELEASE_MUTATION,
  REPOSITORY_ID_QUERY,
} from "../graphql";
import {
  fetchReleases,
  fetchReleaseDetail,
  fetchLatestRelease,
  fetchReleasesCount,
  createRelease,
  updateRelease,
  deleteRelease,
  uploadReleaseAsset as uploadReleaseAssetRest,
  deleteReleaseAsset,
  updateReleaseAsset,
  generateReleaseNotes,
  ApiError,
} from "../restapi";
import type { Release, ReleaseInput } from "../restapi";
import { uploadReleaseAssetViaProxy } from "../repo/release-proxy";

/** GraphQL release 节点（列表/详情/最新共用；供 api-repo 复合查询与 release 板块共享） */
export interface GraphQLReleaseNode {
  databaseId: number | null;
  id?: string;
  name: string | null;
  tagName: string;
  description: string | null;
  url: string;
  publishedAt: string;
  isDraft: boolean;
  isPrerelease: boolean;
  author: { login: string } | null;
  releaseAssets: {
    nodes: { databaseId?: number; name: string; size: number; downloadUrl: string }[];
  } | null;
}

/** GraphQL release 节点 → REST Release（⚠️ id 用 databaseId，占位 -1 会导致列表 key 重复 + activeId 全命中） */
export function toRelease(g: GraphQLReleaseNode): Release {
  return {
    id: g.databaseId ?? -1,
    tag_name: g.tagName,
    name: g.name,
    body: g.description,
    html_url: g.url,
    published_at: g.publishedAt,
    draft: g.isDraft,
    prerelease: g.isPrerelease,
    author: { login: g.author?.login ?? "ghost" },
    nodeId: g.id,
    assets:
      g.releaseAssets?.nodes.map((a) => ({
        id: a.databaseId,
        name: a.name,
        size: a.size,
        browser_download_url: a.downloadUrl,
      })) ?? [],
  };
}

/** 过滤掉 draft release：官方 releases 主列表只展示 published（draft 在单独 Drafts 视图）。
 *  同时消除「同名 tag 的 draft + published」重复记录（duplicate key 根因）。 */
function publishedOnly(releases: Release[]): Release[] {
  return releases.filter((r) => !r.draft);
}

/** 智能获取 Releases 列表：GraphQL repository.releases 首选（需登录，匿名走 REST 60/h），失败降级 REST。 */
export async function fetchReleasesSmart(
  owner: string,
  repo: string,
  token?: string | null,
  page = 1,
): Promise<Release[]> {
  if (page > 1) {
    return publishedOnly(await fetchReleases(owner, repo, 20, token, page));
  }
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { releases: { nodes: GraphQLReleaseNode[] } } | null;
      }> = await graphqlRequest(RELEASES_QUERY, { owner, name: repo, first: 20 }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const releases = publishedOnly(resp.data.repository.releases.nodes.map(toRelease));
        // GraphQL ReleaseAsset 无 digest 字段（红线例外）→ REST 补全 SHA256
        return backfillDigests(releases, () => fetchReleases(owner, repo, 100, token));
      }
      // GraphQL 失败 → 熔断降级 REST
      const rest = await withRestFallback(
        () => fetchReleases(owner, repo, 20, token),
        "fetchReleasesSmart",
        resp,
      );
      return publishedOnly(rest);
    } catch {
      // 网络层错误 → 熔断降级 REST
      const rest = await withRestFallback(
        () => fetchReleases(owner, repo, 20, token),
        "fetchReleasesSmart",
        undefined,
      );
      return publishedOnly(rest);
    }
  }
  // 匿名强制 REST
  return publishedOnly(await fetchReleases(owner, repo, 20, token));
}

/** 智能获取 Draft releases（草稿管理视图；仅登录态——REST listReleases 含 draft，匿名不返回）。
 *  draft 通常极少，一次 per_page=100 全量拉取后前端过滤，不分页。 */
export async function fetchDraftReleasesSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<Release[]> {
  if (!token) return [];
  const all = await fetchReleases(owner, repo, 100, token);
  return all.filter((r) => r.draft);
}

/** 智能获取最新 Release + 总数（About 侧栏 Releases 分区入口）：GraphQL totalCount+nodes(first:1)
 * 一次查询首选（需登录），失败降级 REST per_page=1（body[0]=最新，Link header=总数）。 */
export async function fetchLatestReleaseSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ count: number; latest: Release | null }> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: {
          releases: { totalCount: number; nodes: GraphQLReleaseNode[] };
        } | null;
      }> = await graphqlRequest(LATEST_RELEASE_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        const rel = resp.data.repository.releases;
        return { count: rel.totalCount, latest: rel.nodes[0] ? toRelease(rel.nodes[0]) : null };
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchLatestRelease(owner, repo, token),
        "fetchLatestReleaseSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchLatestRelease(owner, repo, token),
        "fetchLatestReleaseSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchLatestRelease(owner, repo, token);
}

/** 智能获取 Release 详情：GraphQL release(tagName) 首选，失败降级 REST。 */
export async function fetchReleaseDetailSmart(
  owner: string,
  repo: string,
  tag: string,
  token?: string | null,
): Promise<Release> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { release: GraphQLReleaseNode | null } | null;
      }> = await graphqlRequest(RELEASE_DETAIL_QUERY, { owner, name: repo, tagName: tag }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository?.release) {
        const rel = toRelease(resp.data.repository.release);
        // GraphQL ReleaseAsset 无 digest 字段（红线例外）→ REST 补全 SHA256
        const [backfilled] = await backfillDigests([rel], () =>
          fetchReleaseDetail(owner, repo, tag, token).then((r) => [r]),
        );
        return backfilled;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleaseDetail(owner, repo, tag, token),
        "fetchReleaseDetailSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleaseDetail(owner, repo, tag, token),
        "fetchReleaseDetailSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchReleaseDetail(owner, repo, tag, token);
}

/**
 * REST 补全 asset digest（SHA256）：GraphQL 的 ReleaseAsset 类型无 digest 字段（红线例外），
 * 登录态走 GraphQL 主通道后，用 REST 通道拉一次同源数据合并 digest；
 * 失败/无匹配时静默降级（digest 缺失 → 页面显示占位）。
 */
async function backfillDigests(
  releases: Release[],
  restFetch: () => Promise<Release[]>,
): Promise<Release[]> {
  const withAssets = releases.filter((r) => r.assets.length > 0);
  if (withAssets.length === 0) return releases;
  try {
    const rest = await restFetch();
    const byTag = new Map(rest.map((r) => [r.tag_name, r]));
    return releases.map((r) => {
      const src = byTag.get(r.tag_name);
      if (!src) return r;
      return {
        ...r,
        assets: r.assets.map((a) => {
          const m = src.assets.find((sa) => sa.name === a.name);
          return m?.digest ? { ...a, digest: m.digest } : a;
        }),
      };
    });
  } catch {
    return releases;
  }
}

/** 智能获取 Releases 计数：GraphQL totalCount 首选（需登录），失败降级 REST。 */
export async function fetchReleasesCountSmart(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<number> {
  if (token) {
    try {
      const resp: GraphQLResponse<{
        repository: { releases: { totalCount: number } } | null;
      }> = await graphqlRequest(RELEASES_COUNT_QUERY, { owner, name: repo }, token);
      if (!hasGraphQLErrors(resp) && resp.data?.repository) {
        return resp.data.repository.releases.totalCount;
      }
      // GraphQL 失败 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleasesCount(owner, repo, token),
        "fetchReleasesCountSmart",
        resp,
      );
    } catch {
      // 网络层错误 → 熔断降级 REST
      return withRestFallback(
        () => fetchReleasesCount(owner, repo, token),
        "fetchReleasesCountSmart",
        undefined,
      );
    }
  }
  // 匿名强制 REST
  return fetchReleasesCount(owner, repo, token);
}

// ===== 写操作：发布/编辑/删除 release + 资产 + notes（GraphQL 首选 + REST 降级；上传/删除资产/生成 notes 为 REST-only） =====

/** ReleaseInput → GraphQL CreateReleaseInput/UpdateReleaseInput（snake → camel） */
function toGraphQLReleaseInput(input: ReleaseInput) {
  return {
    tagName: input.tag_name,
    name: input.name,
    body: input.body,
    draft: input.draft,
    prerelease: input.prerelease,
    targetCommitish: input.target_commitish,
  };
}

/** 发布 release：GraphQL createRelease 首选（需仓库 node id），失败降级 REST。返回新 release tag_name。 */
export async function createReleaseSmart(
  owner: string,
  repo: string,
  input: ReleaseInput,
  token: string,
): Promise<string> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => (await createRelease(owner, repo, input, token)).tag_name,
      "createReleaseSmart",
      gqlResp,
    );
  try {
    const idResp: GraphQLResponse<{ repository: { id: string } | null }> = await graphqlRequest(
      REPOSITORY_ID_QUERY,
      { owner, name: repo },
      token,
    );
    const repositoryId = idResp.data?.repository?.id;
    if (repositoryId && !hasGraphQLErrors(idResp)) {
      const mutResp: GraphQLResponse<{
        createRelease: { release: { tagName: string } | null } | null;
      }> = await graphqlRequest(
        CREATE_RELEASE_MUTATION,
        { input: { repositoryId, ...toGraphQLReleaseInput(input) } },
        token,
      );
      const tagName = mutResp.data?.createRelease?.release?.tagName;
      if (tagName && !hasGraphQLErrors(mutResp)) return tagName;
      return fromRest(mutResp);
    }
    return fromRest(idResp);
  } catch {
    return fromRest(undefined);
  }
}

/** 编辑 release：GraphQL updateRelease 首选（需 release node id），失败降级 REST（数字 id）。 */
export async function updateReleaseSmart(
  owner: string,
  repo: string,
  release: { nodeId?: string; id: number },
  input: ReleaseInput,
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      async () => {
        await updateRelease(owner, repo, release.id, input, token);
      },
      "updateReleaseSmart",
      gqlResp,
    );
  if (release.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        UPDATE_RELEASE_MUTATION,
        { input: { releaseId: release.nodeId, ...toGraphQLReleaseInput(input) } },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

/** 删除 release：GraphQL deleteRelease 首选（需 release node id），失败降级 REST（数字 id）；不可恢复。 */
export async function deleteReleaseSmart(
  owner: string,
  repo: string,
  release: { nodeId?: string; id: number },
  token: string,
): Promise<void> {
  const fromRest = (gqlResp?: GraphQLResponse<unknown>) =>
    withRestFallback(
      () => deleteRelease(owner, repo, release.id, token),
      "deleteReleaseSmart",
      gqlResp,
    );
  if (release.nodeId) {
    try {
      const mutResp: GraphQLResponse<unknown> = await graphqlRequest(
        DELETE_RELEASE_MUTATION,
        { releaseId: release.nodeId },
        token,
      );
      if (!hasGraphQLErrors(mutResp)) return;
      return fromRest(mutResp);
    } catch {
      return fromRest(undefined);
    }
  }
  return fromRest(undefined);
}

// 删除资产、更新资产、自动生成 notes：GraphQL 无适配 → REST-only（红线例外），直接透传 REST 函数。
export { deleteReleaseAsset, updateReleaseAsset, generateReleaseNotes };

/**
 * 上传 release 资产（smart）：REST 直连 uploads.github.com 首选，网络不可达时降级 Worker /$release/upload 代理。
 * 业务错误（4xx，如 release_id 不存在 / 校验失败）不降级直接抛；仅网络层错误（fetch failed / 超时）触发代理降级。
 */
export async function uploadReleaseAsset(
  owner: string,
  repo: string,
  releaseId: number,
  name: string,
  data: string | ArrayBuffer,
  token: string,
): Promise<void> {
  try {
    await uploadReleaseAssetRest(owner, repo, releaseId, name, data, token);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    await uploadReleaseAssetViaProxy(owner, repo, releaseId, name, data, token);
  }
}
