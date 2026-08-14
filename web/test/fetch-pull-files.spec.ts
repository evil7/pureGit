/**
 * ============================================================================
 * rest-issue-pr fetchPullFiles 分页 单元测试 —— Files changed 分页加载质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * PR Files changed tab 按需求「一次只获取不超过 5 个文件 + 加载更多逐步加载」：
 * - fetchPullFiles(owner, repo, number, token, page, perPage)：每页默认 5 个
 * - hasMore 用 Link 头 `rel="next"` 精确判断（页满判断在恰好整页时误报多一次空请求）
 * - 返回 { items, hasMore } 结构，供 PullDetailPage 维护分页状态并渲染「加载更多」按钮
 * - 非 2xx 抛 ApiError（错误语义与其他 REST 通道一致）
 *
 * 【测试方式与风控红线】全部 mock fetchWithTimeout（rest-core 底层通道），
 * **零真实网络请求**——不触发真实 GitHub API，无风控风险。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi/rest-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi/rest-core")>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

import { fetchWithTimeout, ApiError } from "@/lib/restapi/rest-core";
import { fetchPullFiles, type PullFile } from "@/lib/restapi/rest-issue-pr";

const mockFetch = vi.mocked(fetchWithTimeout);

/** 构造 mock 响应（items + link header） */
function mockRes(items: PullFile[], link: string | null = null) {
  mockFetch.mockResolvedValue({
    status: 200,
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "link" ? link : null) },
    text: async () => JSON.stringify(items),
    json: async () => items,
  } as never);
}

const file = (i: number): PullFile => ({
  filename: `packages/mod-${i}/index.ts`,
  status: "modified",
  additions: i * 10,
  deletions: 1,
  changes: i * 10 + 1,
  patch: `@@ -1 +1 @@\n-${i}\n+${i * 2}`,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPullFiles 分页（每页 5 个 + Link 头 hasMore）", () => {
  it("默认 page=1 perPage=5，URL 参数正确透传", async () => {
    mockRes([file(1)]);
    const r = await fetchPullFiles("evil7", "puregit", 7, "gho_x");
    expect(r.items).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/repos/evil7/puregit/pulls/7/files");
    expect(url).toContain("per_page=5");
    expect(url).toContain("page=1");
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gho_x");
  });

  it("Link 头含 rel=next → hasMore=true（本页满 5 个，还有下一页）", async () => {
    mockRes(
      [file(1), file(2), file(3), file(4), file(5)],
      '<https://api.github.com/repos/evil7/puregit/pulls/7/files?per_page=5&page=2>; rel="next", <https://api.github.com/repos/evil7/puregit/pulls/7/files?per_page=5&page=3>; rel="last"',
    );
    const r = await fetchPullFiles("evil7", "puregit", 7, "gho_x");
    expect(r.items).toHaveLength(5);
    expect(r.hasMore).toBe(true);
  });

  it("无 Link 头（恰好整页=5 个）→ hasMore=false，不误报多一次空请求", async () => {
    mockRes([file(1), file(2), file(3), file(4), file(5)]);
    const r = await fetchPullFiles("evil7", "puregit", 7, "gho_x");
    expect(r.items).toHaveLength(5);
    expect(r.hasMore).toBe(false);
  });

  it("末页不满 5 个（无 next）→ hasMore=false", async () => {
    mockRes([file(1), file(2)]);
    const r = await fetchPullFiles("evil7", "puregit", 7, "gho_x", 2);
    expect(r.items).toHaveLength(2);
    expect(r.hasMore).toBe(false);
  });

  it("page/perPage 参数按调用透传（加载更多传 page+1）", async () => {
    mockRes([file(9)], null);
    const r = await fetchPullFiles("evil7", "puregit", 7, "gho_x", 3, 5);
    expect(mockFetch.mock.calls[0][0]).toContain("page=3");
    expect(mockFetch.mock.calls[0][0]).toContain("per_page=5");
    expect(r.items[0].filename).toBe("packages/mod-9/index.ts");
  });

  it("非 2xx → 抛 ApiError（携带状态码）", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
      headers: { get: () => null },
      text: async () => '{"message":"Not Found"}',
      json: async () => ({ message: "Not Found" }),
    } as never);
    await expect(fetchPullFiles("evil7", "puregit", 999, "gho_x")).rejects.toBeInstanceOf(ApiError);
  });
});
