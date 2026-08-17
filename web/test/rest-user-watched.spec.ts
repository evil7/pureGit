/**
 * ============================================================================
 * fetchUserWatched 单元测试 —— 用户 Watching 仓库 REST 通路
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchUserWatched：正确透传 username/per_page/page（listReposWatchedByUser）。
 * - fetchUserWatchedSmart：GraphQL 无适配 → 直接 REST 转发（perPage=100 一次拉全）。
 * 全部 mock typedRequest（rest-core 底层通道），零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi/rest-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi/rest-core")>();
  return {
    ...actual,
    typedRequest: vi.fn(),
  };
});

import { typedRequest } from "@/lib/restapi/rest-core";
import { fetchUserWatched } from "@/lib/restapi/rest-user-org";
import { fetchUserWatchedSmart } from "@/lib/api/api-org";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchUserWatched（listReposWatchedByUser 参数透传）", () => {
  it("透传 username/per_page/page", async () => {
    mockTyped.mockResolvedValue([] as never);
    await fetchUserWatched("alice", 50, "gho_x", 3);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = {
      rest: { activity: { listReposWatchedByUser: vi.fn().mockResolvedValue({}) } },
    };
    await run(octokit as never);
    expect(octokit.rest.activity.listReposWatchedByUser).toHaveBeenCalledWith({
      username: "alice",
      per_page: 50,
      page: 3,
    });
  });
});

describe("fetchUserWatchedSmart（GraphQL 无适配 → REST 直连）", () => {
  it("perPage=100 一次拉全", async () => {
    mockTyped.mockResolvedValue([] as never);
    await fetchUserWatchedSmart("alice", "gho_x");
    const [, run] = mockTyped.mock.calls[0];
    const octokit = {
      rest: { activity: { listReposWatchedByUser: vi.fn().mockResolvedValue({}) } },
    };
    await run(octokit as never);
    expect(octokit.rest.activity.listReposWatchedByUser).toHaveBeenCalledWith({
      username: "alice",
      per_page: 100,
      page: 1,
    });
  });
});
