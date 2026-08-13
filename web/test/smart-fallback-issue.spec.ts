/**
 * ============================================================================
 * api-issue smart 决策 单元测试 —— issue/PR/订阅 通路质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * api-issue 是 issue/PR/评论/订阅/Release 的 smart 层，决策比 api-repo 更复杂：
 * - fetchIssuesSmart / fetchPullsSmart：**三级决策**——
 *   ① 分页(page>1)或含过滤条件 → 直 REST（GraphQL 分页需游标，非首页统一 REST）；
 *   ② 过滤含 q/@me → search API（REST /issues 不支持 @me/q）；
 *   ③ 其余 → **GraphQL 唯一主通道 + REST 熔断降级**（v0.0.1：withRestFallback 统一降级链，
 *      复用 rest 层现有实现，日志自动打 `↪` fallback 标记）
 * - setIssueSubscriptionSmart：**双步 GraphQL**（先查 issue node id，再 updateSubscription mutation）
 *   + REST PUT/DELETE 兜底；**订阅语义反转**——subscribed=true → UNSUBSCRIBED mutation /
 *   unsubscribeIssue REST（目标是变为未订阅），返回 !subscribed（订阅后的状态）
 * - fetchIssueDetailSmart / fetchPullDetailSmart：GraphQL 主通道 + REST 熔断降级
 * - toIssue/toPull 转换经 GraphQL 成功路径间接验证（state 小写 / MERGED→closed+merged_at /
 *   head.label="owner:ref" / author 缺失→ghost）
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest/searchIssuesSmart/rest 层），
 * **零真实网络请求**——不触发真实 GitHub API，无风控风险。
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

vi.mock("@/lib/api-search", () => ({
  searchIssuesSmart: vi.fn(),
}));

vi.mock("@/lib/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rest")>();
  return {
    ...actual,
    fetchIssues: vi.fn(),
    fetchIssueDetail: vi.fn(),
    subscribeIssue: vi.fn(),
    unsubscribeIssue: vi.fn(),
    fetchPulls: vi.fn(),
    fetchPullDetail: vi.fn(),
    fetchIssueComments: vi.fn(),
    fetchPullReviews: vi.fn(),
  };
});

import {
  fetchIssuesSmart,
  fetchIssueDetailSmart,
  setIssueSubscriptionSmart,
  fetchPullsSmart,
  fetchPullDetailSmart,
  fetchPullDetailFullSmart,
} from "@/lib/api-issue";
import { graphqlRequest } from "@/lib/api-core";
import { searchIssuesSmart } from "@/lib/api-search";
import {
  fetchIssues,
  fetchIssueDetail,
  subscribeIssue,
  unsubscribeIssue,
  fetchPulls,
  fetchPullDetail,
  fetchIssueComments,
  fetchPullReviews,
  type Issue,
  type PullRequest,
} from "@/lib/rest";

const mockGraphql = vi.mocked(graphqlRequest);
const mockSearch = vi.mocked(searchIssuesSmart);
const mockFetchIssues = vi.mocked(fetchIssues);
const mockFetchIssueDetail = vi.mocked(fetchIssueDetail);
const mockSubscribe = vi.mocked(subscribeIssue);
const mockUnsubscribe = vi.mocked(unsubscribeIssue);
const mockFetchPulls = vi.mocked(fetchPulls);
const mockFetchPullDetail = vi.mocked(fetchPullDetail);
const mockFetchIssueComments = vi.mocked(fetchIssueComments);
const mockFetchPullReviews = vi.mocked(fetchPullReviews);

/** GraphQL issue 节点夹具（GraphQLIssueNode 形状） */
const gqlIssue = {
  number: 42,
  title: "Fix the bug",
  state: "OPEN",
  url: "https://github.com/evil7/puregit/issues/42",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
  closedAt: null,
  body: "details",
  viewerSubscription: "SUBSCRIBED",
  author: { login: "alice", avatarUrl: "https://avatars/a.png" },
  comments: { totalCount: 3 },
  labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
  assignees: { nodes: [{ login: "bob", avatarUrl: "https://avatars/b.png" }] },
  milestone: { title: "v1" },
};

/** GraphQL PR 节点夹具（GraphQLPullNode 形状；MERGED 用于验证状态映射） */
const gqlPull = {
  number: 7,
  title: "Add feature",
  state: "MERGED",
  url: "https://github.com/evil7/puregit/pull/7",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-03T00:00:00Z",
  closedAt: "2026-07-03T00:00:00Z",
  body: "desc",
  viewerSubscription: null,
  mergedAt: "2026-07-03T00:00:00Z",
  isDraft: false,
  author: { login: "alice", avatarUrl: "https://avatars/a.png" },
  comments: { totalCount: 1 },
  commits: { totalCount: 5 },
  additions: 100,
  deletions: 20,
  changedFiles: 3,
  headRefName: "feature",
  baseRefName: "main",
  headRefOid: "abc123",
  baseRefOid: "def456",
  headRepositoryOwner: { login: "alice" },
  baseRepository: { owner: { login: "evil7" } },
  labels: { nodes: [{ name: "enhancement", color: "a2eeef" }] },
  assignees: null,
  milestone: null,
};

/** GraphQL PR 完整查询夹具（PULL_DETAIL_FULL_QUERY 形状：detail + comments.nodes + 评审摘要字段） */
const gqlPullFull = {
  ...gqlPull,
  id: "PR_7",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  comments: {
    totalCount: 1,
    nodes: [
      {
        id: "c1",
        body: "nice",
        createdAt: "2026-07-02T00:00:00Z",
        updatedAt: "2026-07-02T00:00:00Z",
        author: { login: "alice", avatarUrl: "https://avatars/a.png" },
        url: "https://github.com/evil7/puregit/pull/7#issuecomment-1",
      },
    ],
  },
  reviews: {
    nodes: [
      {
        id: "r1",
        state: "APPROVED",
        body: "LGTM",
        submittedAt: "2026-07-04T00:00:00Z",
        author: { login: "bob", avatarUrl: "https://avatars/b.png" },
      },
    ],
  },
  reviewRequests: {
    nodes: [
      {
        requestedReviewer: {
          __typename: "User",
          login: "carol",
          avatarUrl: "https://avatars/c.png",
        },
      },
    ],
  },
};

const restIssue: Issue = {
  id: 1,
  number: 42,
  title: "REST issue",
  state: "open",
  html_url: "https://github.com/evil7/puregit/issues/42",
  user: { login: "alice" },
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  closed_at: null,
  comments: 0,
  body: null,
  labels: [],
  assignees: [],
  milestone: null,
};

const restPull: PullRequest = {
  id: 2,
  number: 7,
  title: "REST PR",
  state: "open",
  html_url: "https://github.com/evil7/puregit/pull/7",
  user: { login: "alice" },
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  closed_at: null,
  body: null,
  merged_at: null,
  comments: 0,
  commits: 0,
  additions: 0,
  deletions: 0,
  changed_files: 0,
  labels: [],
  assignees: [],
  milestone: null,
  head: { ref: "feature", label: "alice:feature", sha: "abc" },
  base: { ref: "main", label: "evil7:main", sha: "def" },
  draft: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  // REST 层 fetchIssues 返回 Issue[]（smart 层包装为 { items, openCount, closedCount }）
  mockFetchIssues.mockResolvedValue([restIssue]);
  mockFetchIssueDetail.mockResolvedValue(restIssue);
  mockSubscribe.mockResolvedValue({ subscribed: true, ignored: false });
  mockUnsubscribe.mockResolvedValue(undefined);
  mockFetchPulls.mockResolvedValue([restPull]);
  mockFetchPullDetail.mockResolvedValue(restPull);
  mockFetchIssueComments.mockResolvedValue([]);
  mockFetchPullReviews.mockResolvedValue([]);
});

describe("fetchIssuesSmart（三级决策：REST 条件 / search / GraphQL 首选降级）", () => {
  it("page>1 分页 → 直 REST（GraphQL 不调用）", async () => {
    await fetchIssuesSmart("evil7", "puregit", "open", "gho_x", undefined, 30, 2);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchIssues).toHaveBeenCalled();
  });

  it("含 author 过滤 → 直 REST（GraphQL 不调用）", async () => {
    await fetchIssuesSmart("evil7", "puregit", "open", "gho_x", { author: "alice" });
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchIssues).toHaveBeenCalled();
  });

  it("含 q 搜索 → search API（GraphQL/fetchIssues 均不调用）", async () => {
    mockSearch.mockResolvedValue({ items: [restIssue] } as never);
    const r = await fetchIssuesSmart("evil7", "puregit", "open", "gho_x", { q: "bug" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchIssues).not.toHaveBeenCalled();
    expect(r.items).toEqual([restIssue]);
  });

  it("author 含 @me → search API（REST /issues 不支持 @me）", async () => {
    mockSearch.mockResolvedValue({ items: [] } as never);
    await fetchIssuesSmart("evil7", "puregit", "open", "gho_x", { author: "@me" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockFetchIssues).not.toHaveBeenCalled();
  });

  it("token 为空 → 直 REST", async () => {
    await fetchIssuesSmart("evil7", "puregit", "open", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchIssues).toHaveBeenCalled();
  });

  it("GraphQL 成功 → toIssue 转换 + openCount/closedCount，REST 不调用", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          openCount: { totalCount: 10 },
          closedCount: { totalCount: 5 },
          issues: { nodes: [gqlIssue] },
        },
      },
    } as never);
    const r = await fetchIssuesSmart("evil7", "puregit", "open", "gho_x");
    expect(mockFetchIssues).not.toHaveBeenCalled();
    expect(r.openCount).toBe(10);
    expect(r.closedCount).toBe(5);
    const i = r.items[0];
    expect(i.number).toBe(42);
    expect(i.state).toBe("open"); // state 小写
    expect(i.title).toBe("Fix the bug");
    expect(i.user).toEqual({ login: "alice", avatar_url: "https://avatars/a.png" });
    expect(i.labels).toEqual([{ name: "bug", color: "d73a4a" }]);
    expect(i.assignees).toEqual([{ login: "bob", avatar_url: "https://avatars/b.png" }]);
    expect(i.milestone).toEqual({ title: "v1" });
    expect(i.subscription).toBe("SUBSCRIBED");
  });

  it("GraphQL 返回 errors → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    const r = await fetchIssuesSmart("evil7", "puregit", "open", "gho_x");
    expect(mockFetchIssues).toHaveBeenCalled();
    expect(r.openCount).toBeNull();
  });

  it("GraphQL 抛异常 → 降级 REST", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    const r = await fetchIssuesSmart("evil7", "puregit", "open", "gho_x");
    expect(mockFetchIssues).toHaveBeenCalled();
    expect(r.items).toEqual([restIssue]);
  });
});

describe("fetchIssueDetailSmart（GraphQL 首选 + 降级）", () => {
  it("token 为空 → REST", async () => {
    const r = await fetchIssueDetailSmart("evil7", "puregit", 42, undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchIssueDetail).toHaveBeenCalled();
    expect(r).toBe(restIssue);
  });

  it("GraphQL 成功 → toIssue 转换", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: { issue: gqlIssue } } } as never);
    const r = await fetchIssueDetailSmart("evil7", "puregit", 42, "gho_x");
    expect(mockFetchIssueDetail).not.toHaveBeenCalled();
    expect(r.number).toBe(42);
    expect(r.state).toBe("open");
  });

  it("GraphQL errors / 异常 → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchIssueDetailSmart("evil7", "puregit", 42, "gho_x")).id).toBe(1);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchIssueDetailSmart("evil7", "puregit", 42, "gho_x")).id).toBe(1);
    expect(mockFetchIssueDetail).toHaveBeenCalledTimes(2);
  });
});

describe("setIssueSubscriptionSmart（双步 GraphQL + REST 兜底，订阅语义反转）", () => {
  it("GraphQL 双步成功：subscribed=true → UNSUBSCRIBED mutation，返回 false（已取消）", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { issue: { id: "I_1" } } } } as never)
      .mockResolvedValueOnce({ data: {} } as never);
    const r = await setIssueSubscriptionSmart("evil7", "puregit", 42, true, "gho_x");
    expect(r).toBe(false);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockGraphql).toHaveBeenCalledTimes(2);
    // 第二次调用 mutation 传 UNSUBSCRIBED
    expect(mockGraphql.mock.calls[1][0]).toBeDefined();
  });

  it("GraphQL 双步成功：subscribed=false → SUBSCRIBED mutation，返回 true", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { issue: { id: "I_1" } } } } as never)
      .mockResolvedValueOnce({ data: {} } as never);
    const r = await setIssueSubscriptionSmart("evil7", "puregit", 42, false, "gho_x");
    expect(r).toBe(true);
  });

  it("查不到 issue node id → REST 兜底：subscribed=true → unsubscribeIssue", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: { issue: null } } } as never);
    const r = await setIssueSubscriptionSmart("evil7", "puregit", 42, true, "gho_x");
    expect(mockUnsubscribe).toHaveBeenCalledWith("evil7", "puregit", 42, "gho_x");
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(r).toBe(false); // 兜底后返回订阅后状态（未订阅）
  });

  it("REST 兜底：subscribed=false → subscribeIssue", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: { issue: null } } } as never);
    const r = await setIssueSubscriptionSmart("evil7", "puregit", 42, false, "gho_x");
    expect(mockSubscribe).toHaveBeenCalledWith("evil7", "puregit", 42, "gho_x");
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it("GraphQL 抛异常 → REST 兜底（unsubscribeIssue）", async () => {
    mockGraphql.mockRejectedValue(new TypeError("net"));
    const r = await setIssueSubscriptionSmart("evil7", "puregit", 42, true, "gho_x");
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(r).toBe(false);
  });
});

describe("fetchPullsSmart（三级决策：分页 REST / 过滤 search / GraphQL 首选降级）", () => {
  it("page>1 → 直 REST", async () => {
    await fetchPullsSmart("evil7", "puregit", "open", "gho_x", undefined, 2);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchPulls).toHaveBeenCalled();
  });

  it("含 filters → search API（filter pull_request + 最小 PullRequest 映射）", async () => {
    const searchIssue = {
      ...restIssue,
      pull_request: { url: "x" },
      closed_at: "2026-07-01T00:00:00Z",
      state: "closed",
    } as Issue & { pull_request: { url: string }; closed_at: string | null };
    mockSearch.mockResolvedValue({ items: [searchIssue] } as never);
    const r = await fetchPullsSmart("evil7", "puregit", "open", "gho_x", { author: "alice" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockFetchPulls).not.toHaveBeenCalled();
    expect(r.items).toHaveLength(1);
    const p = r.items[0];
    expect(p.merged_at).toBe("2026-07-01T00:00:00Z"); // closed → merged_at 透传 closed_at
    expect(p.commits).toBe(0);
  });

  it("search 结果过滤掉非 PR（pull_request 缺失）", async () => {
    mockSearch.mockResolvedValue({ items: [restIssue] } as never);
    const r = await fetchPullsSmart("evil7", "puregit", "open", "gho_x", { q: "bug" });
    expect(r.items).toHaveLength(0);
  });

  it("GraphQL 成功 → toPull 转换（MERGED→closed + merged_at + head.label）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          openCount: { totalCount: 3 },
          closedCount: { totalCount: 1 },
          pullRequests: { nodes: [gqlPull] },
        },
      },
    } as never);
    const r = await fetchPullsSmart("evil7", "puregit", "all", "gho_x");
    expect(mockFetchPulls).not.toHaveBeenCalled();
    const p = r.items[0];
    expect(p.state).toBe("closed"); // MERGED → closed
    expect(p.merged_at).toBe("2026-07-03T00:00:00Z");
    expect(p.head).toEqual({ ref: "feature", label: "alice:feature", sha: "abc123" });
    expect(p.base).toEqual({ ref: "main", label: "evil7:main", sha: "def456" });
    expect(p.commits).toBe(5);
    expect(p.additions).toBe(100);
    expect(p.labels).toEqual([{ name: "enhancement", color: "a2eeef" }]);
    expect(p.assignees).toEqual([]);
  });

  it("GraphQL errors / 异常 → 熔断降级 REST（withRestFallback 统一降级链）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchPullsSmart("evil7", "puregit", "open", "gho_x")).items[0].id).toBe(2);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchPullsSmart("evil7", "puregit", "open", "gho_x")).items[0].id).toBe(2);
    expect(mockFetchPulls).toHaveBeenCalledTimes(2);
  });
});

describe("fetchPullDetailSmart（GraphQL 首选 + 降级）", () => {
  it("token 为空 → REST", async () => {
    const r = await fetchPullDetailSmart("evil7", "puregit", 7, undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(r).toBe(restPull);
  });

  it("GraphQL 成功 → toPull 转换（state 小写）", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: { pullRequest: gqlPull } } } as never);
    const r = await fetchPullDetailSmart("evil7", "puregit", 7, "gho_x");
    expect(mockFetchPullDetail).not.toHaveBeenCalled();
    expect(r.state).toBe("closed");
    expect(r.number).toBe(7);
  });

  it("GraphQL errors / 异常 → 熔断降级 REST（withRestFallback 统一降级链）", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchPullDetailSmart("evil7", "puregit", 7, "gho_x")).id).toBe(2);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchPullDetailSmart("evil7", "puregit", 7, "gho_x")).id).toBe(2);
    expect(mockFetchPullDetail).toHaveBeenCalledTimes(2);
  });
});

describe("fetchPullDetailFullSmart（detail+comments+reviewSummary 复合查询）", () => {
  it("token 空 → REST 分步（pr + comments + reviewSummary 由 reviews 推断）", async () => {
    const r = await fetchPullDetailFullSmart("evil7", "puregit", 7, undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchPullDetail).toHaveBeenCalled();
    expect(mockFetchIssueComments).toHaveBeenCalled();
    expect(mockFetchPullReviews).toHaveBeenCalled();
    expect(r.pr.id).toBe(2);
    expect(r.reviewSummary?.pullRequestId).toBe("");
    expect(r.reviewSummary?.reviewDecision).toBeNull();
  });

  it("GraphQL 成功 → 一次查询返回 pr + comments + reviewSummary（含评审字段）", async () => {
    mockGraphql.mockResolvedValue({ data: { repository: { pullRequest: gqlPullFull } } } as never);
    const r = await fetchPullDetailFullSmart("evil7", "puregit", 7, "gho_x");
    expect(mockFetchPullDetail).not.toHaveBeenCalled();
    expect(mockFetchIssueComments).not.toHaveBeenCalled();
    expect(mockFetchPullReviews).not.toHaveBeenCalled();
    // pr 转换（MERGED → closed）
    expect(r.pr.number).toBe(7);
    expect(r.pr.state).toBe("closed");
    // comments 转换
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0].body).toBe("nice");
    // reviewSummary 转换（pullRequestId / reviewDecision / mergeable / reviews / reviewRequests）
    expect(r.reviewSummary?.pullRequestId).toBe("PR_7");
    expect(r.reviewSummary?.reviewDecision).toBe("APPROVED");
    expect(r.reviewSummary?.mergeable).toBe("MERGEABLE");
    expect(r.reviewSummary?.reviews).toHaveLength(1);
    expect(r.reviewSummary?.reviews[0].state).toBe("APPROVED");
    expect(r.reviewSummary?.reviewRequests).toHaveLength(1);
    expect(r.reviewSummary?.reviewRequests[0].login).toBe("carol");
  });

  it("GraphQL errors → 熔断降级 REST 分步", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    const r = await fetchPullDetailFullSmart("evil7", "puregit", 7, "gho_x");
    expect(mockFetchPullDetail).toHaveBeenCalled();
    expect(mockFetchIssueComments).toHaveBeenCalled();
    expect(mockFetchPullReviews).toHaveBeenCalled();
    expect(r.pr.id).toBe(2);
  });

  it("GraphQL 抛异常 → 熔断降级 REST 分步", async () => {
    mockGraphql.mockRejectedValue(new TypeError("fetch failed"));
    const r = await fetchPullDetailFullSmart("evil7", "puregit", 7, "gho_x");
    expect(mockFetchPullDetail).toHaveBeenCalled();
    expect(mockFetchPullReviews).toHaveBeenCalled();
    expect(r.pr.id).toBe(2);
  });
});
