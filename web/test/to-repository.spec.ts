/**
 * ============================================================================
 * api-repo.toRepository 单元测试 —— GraphQL 仓库节点 → REST 结构映射质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `toRepository` 是 GraphQL 仓库节点 → REST `Repository` 结构的确定性纯函数
 * （20+ 字段映射），是 smart 层 GraphQL 路径的返回契约：
 * - 字段映射：databaseId→id、nameWithOwner→full_name、stargazerCount→stargazers_count、
 *   forkCount→forks_count、watchers.totalCount→subscribers_count、primaryLanguage.name→language 等
 * - 兜底：databaseId null→-1、defaultBranchRef null→"main"、owner 缺失→avatar_url undefined、
 *   parent 缺失→null、licenseInfo null→null、watch/subscription 缺失→null/0
 * - fork 上游 parent：full_name + default_branch（默认 "main"）
 * - repositoryTopics → topics 字符串数组
 *
 * 【测试方式】纯函数单元测试，无任何网络请求（零真实 API 接触，无风控风险）。
 */
import { describe, it, expect } from "vitest";
import { toRepository, type GraphQLRepository } from "@/lib/api-repo";

/** 完整字段夹具（覆盖全部映射路径） */
const fullGql: GraphQLRepository = {
  databaseId: 123,
  name: "puregit",
  nameWithOwner: "evil7/puregit",
  description: "A mini GitHub",
  homepageUrl: "https://git.deepwn.io",
  url: "https://github.com/evil7/puregit",
  owner: { login: "evil7", avatarUrl: "https://avatars/evil7.png" },
  stargazerCount: 42,
  forkCount: 7,
  watchers: { totalCount: 13 },
  viewerSubscription: "SUBSCRIBED",
  viewerHasStarred: true,
  primaryLanguage: { name: "TypeScript" },
  languages: {
    edges: [
      { size: 900, node: { name: "TypeScript" } },
      { size: 100, node: { name: "CSS" } },
    ],
  },
  repositoryTopics: { nodes: [{ topic: { name: "github" } }, { topic: { name: "clone" } }] },
  licenseInfo: { spdxId: "MIT" },
  updatedAt: "2026-08-01T00:00:00Z",
  defaultBranchRef: { name: "main" },
  isPrivate: false,
  isArchived: false,
  isFork: true,
  parent: {
    nameWithOwner: "upstream/puregit",
    defaultBranchRef: { name: "dev" },
  },
  diskUsage: 1234,
  hasIssuesEnabled: true,
  hasDiscussionsEnabled: false,
  hasWikiEnabled: true,
  hasProjectsEnabled: false,
};

describe("toRepository 全字段映射", () => {
  it("完整字段正确映射", () => {
    const r = toRepository(fullGql, "evil7");
    expect(r.id).toBe(123);
    expect(r.name).toBe("puregit");
    expect(r.full_name).toBe("evil7/puregit");
    expect(r.owner).toEqual({ login: "evil7", avatar_url: "https://avatars/evil7.png" });
    expect(r.description).toBe("A mini GitHub");
    expect(r.homepage).toBe("https://git.deepwn.io");
    expect(r.html_url).toBe("https://github.com/evil7/puregit");
    expect(r.stargazers_count).toBe(42);
    expect(r.forks_count).toBe(7);
    expect(r.subscribers_count).toBe(13);
    expect(r.language).toBe("TypeScript");
    expect(r.topics).toEqual(["github", "clone"]);
    expect(r.license).toEqual({ spdx_id: "MIT" });
    expect(r.default_branch).toBe("main");
    expect(r.private).toBe(false);
    expect(r.fork).toBe(true);
    expect(r.parent).toEqual({ full_name: "upstream/puregit", default_branch: "dev" });
    expect(r.archived).toBe(false);
    expect(r.archived_at).toBeNull();
    expect(r.size).toBe(1234);
    expect(r.viewer_has_starred).toBe(true);
    expect(r.has_issues).toBe(true);
    expect(r.has_discussions).toBe(false);
    expect(r.has_wiki).toBe(true);
    expect(r.has_projects).toBe(false);
    expect(r.viewer_subscription).toBe("SUBSCRIBED");
    expect(r.updated_at).toBe("2026-08-01T00:00:00Z");
    expect(r.pushed_at).toBe("2026-08-01T00:00:00Z");
  });
});

describe("toRepository 兜底与缺省", () => {
  it("databaseId null → id 兜底 -1", () => {
    const g: GraphQLRepository = { ...fullGql, databaseId: null };
    expect(toRepository(g, "evil7").id).toBe(-1);
  });

  it("defaultBranchRef null → default_branch 兜底 main", () => {
    const g: GraphQLRepository = { ...fullGql, defaultBranchRef: null };
    expect(toRepository(g, "evil7").default_branch).toBe("main");
  });

  it("owner 缺失 → login 用传入 owner 参数，avatar_url undefined", () => {
    const g: GraphQLRepository = { ...fullGql, owner: undefined };
    expect(toRepository(g, "evil7").owner).toEqual({ login: "evil7", avatar_url: undefined });
  });

  it("parent 缺失 → null（非 fork）", () => {
    const g: GraphQLRepository = { ...fullGql, parent: null };
    expect(toRepository(g, "evil7").parent).toBeNull();
  });

  it("parent 存在但 defaultBranchRef null → default_branch 兜底 main", () => {
    const g: GraphQLRepository = {
      ...fullGql,
      parent: { nameWithOwner: "upstream/puregit", defaultBranchRef: null },
    };
    expect(toRepository(g, "evil7").parent).toEqual({
      full_name: "upstream/puregit",
      default_branch: "main",
    });
  });

  it("licenseInfo null → license null", () => {
    const g: GraphQLRepository = { ...fullGql, licenseInfo: null };
    expect(toRepository(g, "evil7").license).toBeNull();
  });

  it("primaryLanguage null → language null", () => {
    const g: GraphQLRepository = { ...fullGql, primaryLanguage: null };
    expect(toRepository(g, "evil7").language).toBeNull();
  });

  it("watchers 缺失 → subscribers_count 0", () => {
    const g: GraphQLRepository = { ...fullGql, watchers: undefined };
    expect(toRepository(g, "evil7").subscribers_count).toBe(0);
  });

  it("repositoryTopics 缺失 → topics undefined；viewerSubscription 缺失 → null", () => {
    const g: GraphQLRepository = {
      ...fullGql,
      repositoryTopics: undefined,
      viewerSubscription: undefined,
    };
    const r = toRepository(g, "evil7");
    expect(r.topics).toBeUndefined();
    expect(r.viewer_subscription).toBeNull();
  });

  it("languages 缺失 / 空 → 不影响返回（langs 聚合在 smart 层，见 fetchRepositorySmart）", () => {
    const g1: GraphQLRepository = { ...fullGql, languages: undefined };
    expect(() => toRepository(g1, "evil7")).not.toThrow();
    const g2: GraphQLRepository = { ...fullGql, languages: { edges: [] } };
    expect(() => toRepository(g2, "evil7")).not.toThrow();
  });

  it("archivedAt 有值 → archived_at 透传", () => {
    const g: GraphQLRepository = { ...fullGql, archivedAt: "2026-01-01T00:00:00Z" };
    expect(toRepository(g, "evil7").archived_at).toBe("2026-01-01T00:00:00Z");
  });
});
