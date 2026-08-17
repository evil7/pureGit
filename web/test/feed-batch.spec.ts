/**
 * ============================================================================
 * api-feed-batch 批量补拉调度 单元测试 —— feed 卡片详情请求风暴防护质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * feed 每页最多 10 张卡，PR/push 卡详情若逐卡独立查询会单页发出 N 次请求（最坏 N+1 次/页）。
 * api-feed-batch 的承诺（对应架构红线 4「GraphQL 唯一主通道」+ 防风暴）：
 * - 微任务合并：同一帧（setTimeout 0）注册的多个 PR / 多个 commit → 各合并 1 次 GraphQL
 *   aliases 请求（PR 批 + commit 批各 1 次，互不混批），单页请求数收敛为 2~3 次
 * - 模块级缓存：同一 key（owner/repo#number|sha）再次注册 → 零新增请求（翻页回访免费）
 * - 降级：单节点 null / 整体 errors / 网络异常 / 匿名（token 空）→ resolve(null)
 *   （卡片回退 payload 基础信息，不阻塞渲染、不重试防风暴）
 * - commit message 归一：messageHeadline 多行/空白 → 单空格单行
 *
 * 【测试方式与风控红线】全部 mock graphqlRequest（api-core）；零真实网络请求。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphqlRequest } from "@/lib/api/api-core";
import { scheduleFeedPr, scheduleFeedCommit } from "@/lib/api/api-feed-batch";

vi.mock("@/lib/api/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

const mockGraphql = vi.mocked(graphqlRequest);
const TOKEN = "test-token";

/** PR alias 节点（r{i}.pullRequest 响应结构） */
const prNode = (number: number, title: string, overrides: Record<string, unknown> = {}) => ({
  number,
  title,
  state: "OPEN",
  mergedAt: null,
  url: `https://github.com/o/r/pull/${number}`,
  headRefName: "feat/abc",
  baseRefName: "main",
  headRepositoryOwner: { login: "o" },
  comments: { totalCount: 3 },
  ...overrides,
});

/** 等待批量 flush（setTimeout 0 宏任务 + promise 队列） */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockGraphql.mockReset();
});

describe("微任务合并（同一帧 → 1 次请求）", () => {
  it("2 PR + 2 commit 同帧注册 → PR 批 + commit 批共 2 次请求，各含 2 个 alias", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedPrBatch")) {
        return {
          data: { r0: { pullRequest: prNode(1, "PR1") }, r1: { pullRequest: prNode(2, "PR2") } },
        };
      }
      return {
        data: {
          c0: { object: { messageHeadline: "fix: a" } },
          c1: { object: { messageHeadline: "feat: b" } },
        },
      };
    });

    const pr1 = scheduleFeedPr("o", "r", 1, TOKEN);
    const pr2 = scheduleFeedPr("o", "r", 2, TOKEN);
    const c1 = scheduleFeedCommit("o", "r", "sha1", TOKEN);
    const c2 = scheduleFeedCommit("o", "r", "sha2", TOKEN);
    await flush();

    expect(mockGraphql).toHaveBeenCalledTimes(2);
    const prQuery = mockGraphql.mock.calls[0][0] as string;
    const commitQuery = mockGraphql.mock.calls[1][0] as string;
    expect(prQuery).toContain("r0: repository");
    expect(prQuery).toContain("r1: repository");
    expect(commitQuery).toContain("c0: repository");
    expect(commitQuery).toContain("c1: repository");

    const [a, b] = await Promise.all([pr1, pr2]);
    expect(a).toMatchObject({ number: 1, title: "PR1", comments: 3 });
    expect(b).toMatchObject({ number: 2, title: "PR2" });
    expect(await c1).toBe("fix: a");
    expect(await c2).toBe("feat: b");
  });

  it("仅 PR 同帧 → 仅 1 次 PR 批请求", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedPrBatch")) {
        return { data: { r0: { pullRequest: prNode(9, "PR9") } } };
      }
      return { data: {} };
    });
    const p = scheduleFeedPr("o", "r", 9, TOKEN);
    await flush();
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    expect((mockGraphql.mock.calls[0][0] as string).startsWith("query FeedPrBatch")).toBe(true);
    expect(await p).toMatchObject({ number: 9 });
  });

  it("PR 摘要含分支字段（统一 PR 卡 base ← head badge 数据源）", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedPrBatch")) {
        // 查询文本必须含 headRefName/baseRefName/headRepositoryOwner（feed 卡分支 badge 依赖）
        expect(query).toContain("headRefName");
        expect(query).toContain("baseRefName");
        expect(query).toContain("headRepositoryOwner");
        return {
          data: {
            r0: {
              pullRequest: prNode(10, "PR10", {
                headRefName: "feature/xyz",
                baseRefName: "release/1.0",
                headRepositoryOwner: { login: "other" },
              }),
            },
          },
        };
      }
      return { data: {} };
    });
    const p = scheduleFeedPr("o", "r", 10, TOKEN);
    await flush();
    const pr = await p;
    expect(pr).toMatchObject({
      number: 10,
      headRefName: "feature/xyz",
      baseRefName: "release/1.0",
      headOwner: "other",
    });
  });
});

describe("模块级缓存（翻页回访零请求）", () => {
  it("同 key 再次注册 → 零新增请求且复用结果", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedPrBatch")) {
        return { data: { r0: { pullRequest: prNode(11, "PR11") } } };
      }
      return { data: {} };
    });
    const first = scheduleFeedPr("o", "r", 11, TOKEN);
    await flush();
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    const again = scheduleFeedPr("o", "r", 11, TOKEN);
    await flush();
    expect(mockGraphql).toHaveBeenCalledTimes(1); // 无新增请求
    expect(await first).toMatchObject({ number: 11, title: "PR11" });
    expect(await again).toMatchObject({ number: 11, title: "PR11" });
  });
});

describe("降级（resolve null，不阻塞渲染）", () => {
  it("单节点 null（仓库已删/私有）→ 该节点 null，其余正常", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedPrBatch")) {
        return {
          data: {
            r0: { pullRequest: null },
            r1: { pullRequest: prNode(21, "PR21") },
          },
        };
      }
      return { data: {} };
    });
    // 用唯一 repo key：模块级缓存跨用例共享，避免命中其他用例已缓存的 o/r#1
    const p1 = scheduleFeedPr("nullrepo", "r", 1, TOKEN);
    const p2 = scheduleFeedPr("nullrepo", "r", 21, TOKEN);
    await flush();
    expect(await p1).toBeNull();
    expect(await p2).toMatchObject({ number: 21 });
  });

  it("GraphQL errors（熔断/耗尽/匿名短路返回 errors）→ 全部 resolve null", async () => {
    mockGraphql.mockResolvedValue({
      errors: [{ message: "GraphQL skipped (cooldown/exhausted)" }],
    });
    const p = scheduleFeedPr("o", "r", 31, TOKEN);
    const c = scheduleFeedCommit("o", "r", "sha31", TOKEN);
    await flush();
    expect(await p).toBeNull();
    expect(await c).toBeNull();
  });

  it("graphqlRequest 抛异常（网络层）→ 全部 resolve null", async () => {
    mockGraphql.mockRejectedValue(new Error("network down"));
    const p = scheduleFeedPr("o", "r", 41, TOKEN);
    await flush();
    expect(await p).toBeNull();
  });

  it("匿名（token 空）→ resolve null 且零请求", async () => {
    const p = scheduleFeedPr("o", "r", 51, null);
    const c = scheduleFeedCommit("o", "r", "sha51", null);
    await flush();
    expect(await p).toBeNull();
    expect(await c).toBeNull();
    expect(mockGraphql).not.toHaveBeenCalled();
  });
});

describe("commit message 归一", () => {
  it("messageHeadline 多行/空白 → 单空格单行", async () => {
    mockGraphql.mockImplementation(async (query: string) => {
      if (query.startsWith("query FeedCommitBatch")) {
        return { data: { c0: { object: { messageHeadline: "fix: a\n\nbody line\n" } } } };
      }
      return { data: {} };
    });
    const m = scheduleFeedCommit("o", "r", "sha61", TOKEN);
    await flush();
    expect(await m).toBe("fix: a body line");
  });
});
