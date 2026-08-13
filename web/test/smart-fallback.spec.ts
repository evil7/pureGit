/**
 * ============================================================================
 * api-repo smart 降级决策 单元测试 —— GraphQL 首选 / REST 降级 通路质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * smart 层核心架构承诺（api-compat.md §2）：双端点 API 一律「GraphQL 首选 + REST 自动降级」。
 * 本次覆盖 api-repo 的三个代表性决策函数：
 * - fetchRepositorySmart：token 空 → 直 REST；GraphQL 成功 → GraphQL 结果（REST 不调）；
 *   GraphQL errors / 异常 / repository=null → 降级 REST
 * - createRepositorySmart：组织仓库 → 直 REST（GraphQL 需 ownerId 复杂）；个人 → GraphQL 首选，
 *   errors/异常 → 降级 REST
 * - createIssueSmart：带 labels/assignees → 直 REST（需节点 ID 查询成本高）；否则 GraphQL 首选
 *   （先查 repositoryId，再 createIssue），任一步失败 → 降级 REST
 *
 * 【测试方式与风控红线】
 * 全部 mock：graphqlRequest（api-core）与 rest 层函数（fetchRepository 等）均为 vi.fn()。
 * **本文件零真实网络请求**——不触发任何真实 GitHub API 调用，无风控/封号风险。
 * 透传胶水（直接调 rest 并原样返回的薄封装）不属于本文件范围（低价值，TS 已保证）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

vi.mock("@/lib/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rest")>();
  return {
    ...actual,
    fetchRepository: vi.fn(),
    fetchLanguages: vi.fn(),
    fetchOpenPullsCount: vi.fn(),
    fetchLatestRelease: vi.fn(),
    createRepository: vi.fn(),
    createIssue: vi.fn(),
    fetchDirContents: vi.fn(),
    fetchReadme: vi.fn(),
  };
});

vi.mock("@/lib/raw-proxy", () => ({
  fetchRawContentSmart: vi.fn(),
}));

import {
  fetchRepositorySmart,
  fetchRepoHomeSmart,
  createRepositorySmart,
  createIssueSmart,
  fetchDirContentsSmart,
  fetchReadmeSmart,
} from "@/lib/api-repo";
import { graphqlRequest } from "@/lib/api-core";
import {
  fetchRepository,
  fetchLanguages,
  fetchOpenPullsCount,
  fetchLatestRelease,
  createRepository,
  createIssue,
  fetchDirContents,
  fetchReadme,
  type Repository,
} from "@/lib/rest";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchRepository = vi.mocked(fetchRepository);
const mockFetchLanguages = vi.mocked(fetchLanguages);
const mockFetchOpenPullsCount = vi.mocked(fetchOpenPullsCount);
const mockFetchLatestRelease = vi.mocked(fetchLatestRelease);
const mockCreateRepository = vi.mocked(createRepository);
const mockCreateIssue = vi.mocked(createIssue);
const mockFetchDirContents = vi.mocked(fetchDirContents);
const mockFetchReadme = vi.mocked(fetchReadme);

/** 最小 REST Repository 夹具（REST 降级路径返回值） */
const restRepo: Repository = {
  id: 1,
  name: "puregit",
  full_name: "evil7/puregit",
  owner: { login: "evil7" },
  description: null,
  homepage: null,
  private: false,
  html_url: "https://github.com/evil7/puregit",
  default_branch: "main",
  fork: false,
  updated_at: "2026-08-01T00:00:00Z",
  pushed_at: "2026-08-01T00:00:00Z",
  stargazers_count: 0,
  forks_count: 0,
  language: null,
};

/** createRepository REST 返回夹具（完整 Repository） */
const createdRepo: Repository = {
  ...restRepo,
  name: "newrepo",
  full_name: "evil7/newrepo",
};

/** GraphQL 成功响应夹具（repository 完整节点） */
const gqlOk = {
  data: {
    repository: {
      databaseId: 123,
      name: "puregit",
      nameWithOwner: "evil7/puregit",
      description: null,
      homepageUrl: null,
      url: "https://github.com/evil7/puregit",
      owner: { login: "evil7", avatarUrl: null },
      stargazerCount: 42,
      forkCount: 7,
      watchers: { totalCount: 13 },
      viewerSubscription: null,
      viewerHasStarred: false,
      primaryLanguage: { name: "TypeScript" },
      languages: { edges: [{ size: 900, node: { name: "TypeScript" } }] },
      repositoryTopics: { nodes: [] },
      licenseInfo: null,
      updatedAt: "2026-08-01T00:00:00Z",
      defaultBranchRef: { name: "main" },
      isPrivate: false,
      isArchived: false,
      isFork: false,
      parent: null,
      diskUsage: null,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchRepository.mockResolvedValue(restRepo);
  mockFetchDirContents.mockResolvedValue([]);
  mockFetchReadme.mockResolvedValue(null);
  mockFetchLanguages.mockResolvedValue({});
  // 默认 null（REST 降级时 data 保持 restRepo 原样，`toBe(restRepo)` 断言不受影响）
  mockFetchOpenPullsCount.mockResolvedValue(null);
  mockCreateRepository.mockResolvedValue(createdRepo);
  mockCreateIssue.mockResolvedValue({ number: 101 } as never);
  mockFetchLatestRelease.mockResolvedValue({ count: 0, latest: null });
});

describe("fetchRepositorySmart（仓库信息 GraphQL 首选 + REST 降级）", () => {
  it("token 为空 → 直 REST（GraphQL 不调用）", async () => {
    const r = await fetchRepositorySmart("evil7", "puregit", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchRepository).toHaveBeenCalledWith("evil7", "puregit", undefined);
    expect(mockFetchLanguages).toHaveBeenCalled();
    // REST 降级补查 pulls 计数（open_issues_count 含 PRs 不能拆分）
    expect(mockFetchOpenPullsCount).toHaveBeenCalledWith("evil7", "puregit", undefined);
    expect(r.data).toBe(restRepo);
  });

  it("GraphQL 成功 → 返回 GraphQL 结果（REST 不调用），含 tab 计数", async () => {
    mockGraphql.mockResolvedValue({
      ...gqlOk,
      data: {
        repository: {
          ...gqlOk.data.repository,
          openIssues: { totalCount: 5 },
          openPullRequests: { totalCount: 3 },
        },
      },
    } as never);
    const r = await fetchRepositorySmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).not.toHaveBeenCalled();
    expect(r.data.id).toBe(123);
    expect(r.data.full_name).toBe("evil7/puregit");
    expect(r.langs).toEqual({ TypeScript: 900 });
    // tab 计数（openIssues/openPullRequests totalCount → open_*_count）
    expect(r.data.open_issues_count).toBe(5);
    expect(r.data.open_pulls_count).toBe(3);
  });

  it("GraphQL 返回 errors → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    const r = await fetchRepositorySmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).toHaveBeenCalled();
    expect(r.data).toBe(restRepo);
  });

  it("GraphQL 抛异常 → 降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    const r = await fetchRepositorySmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).toHaveBeenCalled();
    expect(r.data).toBe(restRepo);
  });

  it("GraphQL repository 为 null（仓库不存在/无权限）→ 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: null } } as never);
    const r = await fetchRepositorySmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).toHaveBeenCalled();
    expect(r.data).toBe(restRepo);
  });
});

describe("createRepositorySmart（组织直 REST / 个人 GraphQL 首选降级）", () => {
  it("组织仓库（owner ≠ login）→ 直 REST（GraphQL 不调用）", async () => {
    const r = await createRepositorySmart("gho_x", { name: "newrepo", owner: "acme" }, "alice");
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockCreateRepository).toHaveBeenCalled();
    expect(r).toEqual({ name: "newrepo", full_name: "evil7/newrepo" });
  });

  it("个人仓库 + GraphQL 成功 → GraphQL 结果（REST 不调用）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        createRepository: { repository: { name: "newrepo", nameWithOwner: "alice/newrepo" } },
      },
    } as never);
    const r = await createRepositorySmart("gho_x", { name: "newrepo" }, "alice");
    expect(mockCreateRepository).not.toHaveBeenCalled();
    expect(r).toEqual({ name: "newrepo", full_name: "alice/newrepo" });
  });

  it("个人仓库 + GraphQL errors → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "denied" }] } as never);
    const r = await createRepositorySmart("gho_x", { name: "newrepo" }, "alice");
    expect(mockCreateRepository).toHaveBeenCalled();
    expect(r).toEqual({ name: "newrepo", full_name: "evil7/newrepo" });
  });

  it("个人仓库 + GraphQL 抛异常 → 降级 REST", async () => {
    mockGraphql.mockRejectedValue(new Error("network"));
    const r = await createRepositorySmart("gho_x", { name: "newrepo" }, "alice");
    expect(mockCreateRepository).toHaveBeenCalled();
    expect(r).toEqual({ name: "newrepo", full_name: "evil7/newrepo" });
  });
});

describe("createIssueSmart（带标签直 REST / 无标签 GraphQL 首选降级）", () => {
  it("带 labels → 直 REST（GraphQL 不调用）", async () => {
    const number = await createIssueSmart("gho_x", "evil7", "puregit", {
      title: "Bug",
      labels: ["bug"],
    });
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockCreateIssue).toHaveBeenCalled();
    expect(number).toBe(101);
  });

  it("带 assignees → 直 REST", async () => {
    const number = await createIssueSmart("gho_x", "evil7", "puregit", {
      title: "Bug",
      assignees: ["alice"],
    });
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockCreateIssue).toHaveBeenCalled();
    expect(number).toBe(101);
  });

  it("无标签 + repositoryId 查询成功 + createIssue 成功 → GraphQL 路径返回 number（REST 不调用）", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_123" } } } as never)
      .mockResolvedValueOnce({ data: { createIssue: { issue: { number: 7 } } } } as never);
    const number = await createIssueSmart("gho_x", "evil7", "puregit", { title: "Bug" });
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(mockGraphql).toHaveBeenCalledTimes(2);
    expect(number).toBe(7);
  });

  it("无标签 + repositoryId 查询失败（null）→ 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: null } } as never);
    const number = await createIssueSmart("gho_x", "evil7", "puregit", { title: "Bug" });
    expect(mockCreateIssue).toHaveBeenCalled();
    expect(number).toBe(101);
  });

  it("无标签 + createIssue mutation errors → 降级 REST", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_123" } } } as never)
      .mockResolvedValueOnce({ errors: [{ message: "no permission" }] } as never);
    const number = await createIssueSmart("gho_x", "evil7", "puregit", { title: "Bug" });
    expect(mockCreateIssue).toHaveBeenCalled();
    expect(number).toBe(101);
  });

  it("无标签 + createIssue mutation 抛异常 → 降级 REST", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_123" } } } as never)
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const number = await createIssueSmart("gho_x", "evil7", "puregit", { title: "Bug" });
    expect(mockCreateIssue).toHaveBeenCalled();
    expect(number).toBe(101);
  });
});

describe("fetchRepoHomeSmart（仓库主页复合查询：Repository + 最新 release 一次 GraphQL）", () => {
  it("token 空 → 直 REST 分步（GraphQL 不调用，含 releases 计数/最新）", async () => {
    mockFetchLatestRelease.mockResolvedValue({ count: 3, latest: null });
    const r = await fetchRepoHomeSmart("evil7", "puregit", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchRepository).toHaveBeenCalledWith("evil7", "puregit", undefined);
    expect(mockFetchLatestRelease).toHaveBeenCalledWith("evil7", "puregit", undefined);
    expect(r.data).toBe(restRepo);
    expect(r.releasesCount).toBe(3);
    expect(r.latestRelease).toBeNull();
  });

  it("GraphQL 成功 → 一次查询返回仓库 + releases（REST 不调用）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          ...gqlOk.data.repository,
          openIssues: { totalCount: 5 },
          openPullRequests: { totalCount: 3 },
          releases: {
            totalCount: 12,
            nodes: [
              {
                databaseId: 9001,
                name: "v1.0.0",
                tagName: "v1.0.0",
                description: "first",
                url: "https://github.com/evil7/puregit/releases/tag/v1.0.0",
                publishedAt: "2026-08-01T00:00:00Z",
                isDraft: false,
                isPrerelease: false,
                author: { login: "evil7" },
              },
            ],
          },
        },
      },
    } as never);
    const r = await fetchRepoHomeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).not.toHaveBeenCalled();
    expect(mockFetchLatestRelease).not.toHaveBeenCalled();
    expect(r.data.id).toBe(123);
    expect(r.langs).toEqual({ TypeScript: 900 });
    expect(r.releasesCount).toBe(12);
    expect(r.latestRelease?.tag_name).toBe("v1.0.0");
  });

  it("GraphQL errors → 降级 REST 分步（含 releases）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    mockFetchLatestRelease.mockResolvedValue({ count: 1, latest: null });
    const r = await fetchRepoHomeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).toHaveBeenCalled();
    expect(mockFetchLatestRelease).toHaveBeenCalled();
    expect(r.data).toBe(restRepo);
    expect(r.releasesCount).toBe(1);
  });

  it("GraphQL 抛异常 → 降级 REST 分步", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    const r = await fetchRepoHomeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchRepository).toHaveBeenCalled();
    expect(mockFetchLatestRelease).toHaveBeenCalled();
    expect(r.data).toBe(restRepo);
  });
});

describe("fetchDirContentsSmart（目录列举 GraphQL Tree.entries 主通道 + REST 熔断）", () => {
  it("token 空 → 直 REST（GraphQL 不调用）", async () => {
    const entries = [{ name: "src", path: "src", type: "dir" as const, size: 0 }];
    mockFetchDirContents.mockResolvedValue(entries);
    const r = await fetchDirContentsSmart("evil7", "puregit", "", "HEAD", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchDirContents).toHaveBeenCalledWith("evil7", "puregit", "", "HEAD", undefined);
    expect(r).toEqual(entries);
  });

  it("GraphQL 成功 → Tree.entries 转 DirEntry（REST 不调用），type tree→dir", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          object: {
            entries: [
              { name: "src", path: "src", type: "tree", size: null },
              { name: "index.ts", path: "index.ts", type: "blob", size: 42 },
            ],
          },
        },
      },
    } as never);
    const r = await fetchDirContentsSmart("evil7", "puregit", "", "HEAD", "gho_x");
    expect(mockFetchDirContents).not.toHaveBeenCalled();
    expect(r).toEqual([
      { name: "src", path: "src", type: "dir", size: 0 },
      { name: "index.ts", path: "index.ts", type: "file", size: 42 },
    ]);
  });

  it("GraphQL errors → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    mockFetchDirContents.mockResolvedValue([{ name: "a", path: "a", type: "file", size: 1 }]);
    const r = await fetchDirContentsSmart("evil7", "puregit", "", "HEAD", "gho_x");
    expect(mockFetchDirContents).toHaveBeenCalled();
    expect(r).toEqual([{ name: "a", path: "a", type: "file", size: 1 }]);
  });

  it("GraphQL 抛异常 → 熔断降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    await fetchDirContentsSmart("evil7", "puregit", "", "HEAD", "gho_x");
    expect(mockFetchDirContents).toHaveBeenCalled();
  });
});

describe("fetchReadmeSmart（README 定位 + 内容 GraphQL 主通道 + REST 熔断）", () => {
  it("token 空 → 直 REST（GraphQL 不调用）", async () => {
    await fetchReadmeSmart("evil7", "puregit", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchReadme).toHaveBeenCalledWith("evil7", "puregit", undefined, "");
  });

  it("GraphQL 成功 + 无 README 条目 → 返回 null（REST 不调用）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          object: { entries: [{ name: "index.ts", path: "index.ts", type: "blob" }] },
        },
      },
    } as never);
    const r = await fetchReadmeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchReadme).not.toHaveBeenCalled();
    expect(r).toBeNull();
  });

  it("GraphQL 成功 + 有 README → 定位并取内容（REST 不调用）", async () => {
    // 第 1 次 graphqlRequest：TREE_ENTRIES_QUERY 定位 README；第 2 次（fetchFileContentSmart）：FILE_RAW_QUERY 拿 blob
    mockGraphql
      .mockResolvedValueOnce({
        data: {
          repository: {
            object: { entries: [{ name: "README.md", path: "README.md", type: "blob" }] },
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: { repository: { object: { text: "hello readme", isTruncated: false } } },
      } as never);
    const r = await fetchReadmeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchReadme).not.toHaveBeenCalled();
    expect(r?.path).toBe("README.md");
    expect(r?.content).toBe("hello readme");
    expect(r?.rawBase).toBe("https://raw.githubusercontent.com/evil7/puregit/HEAD");
  });

  it("GraphQL errors → 熔断降级 REST（自动定位）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    mockFetchReadme.mockResolvedValue({
      content: "rest readme",
      path: "README.md",
      rawBase: "https://raw.githubusercontent.com/evil7/puregit/HEAD",
    });
    const r = await fetchReadmeSmart("evil7", "puregit", "gho_x");
    expect(mockFetchReadme).toHaveBeenCalled();
    expect(r?.content).toBe("rest readme");
  });
});
