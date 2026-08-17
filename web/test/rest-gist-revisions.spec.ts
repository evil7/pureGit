/**
 * ============================================================================
 * Gist revisions / starred / public / for-user 单元测试 —— REST 参数透传
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchGistRevisions：透传 gist_id/per_page/page，空返回兜底 []。
 * - getGistRevision：透传 gist_id/sha。
 * - fetchStarredGists / fetchPublicGists / fetchUserGists：透传分页与 username。
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
import {
  fetchGistRevisions,
  getGistRevision,
  fetchStarredGists,
  fetchPublicGists,
  fetchUserGists,
} from "@/lib/restapi/rest-user-nav";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchGistRevisions（listCommits 参数透传 + 空返回兜底）", () => {
  it("透传 gist_id/per_page/page 并兜底 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    await expect(fetchGistRevisions("g1", "gho_x", 50, 2)).resolves.toEqual([]);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { gists: { listCommits: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.gists.listCommits).toHaveBeenCalledWith({
      gist_id: "g1",
      per_page: 50,
      page: 2,
    });
  });
});

describe("getGistRevision（getRevision 参数透传）", () => {
  it("透传 gist_id/sha", async () => {
    mockTyped.mockResolvedValue({ id: "g1" } as never);
    await getGistRevision("g1", "sha123");
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { gists: { getRevision: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.gists.getRevision).toHaveBeenCalledWith({
      gist_id: "g1",
      sha: "sha123",
    });
  });
});

describe("fetchStarredGists（listStarred 参数透传）", () => {
  it("透传 per_page/page", async () => {
    mockTyped.mockResolvedValue([] as never);
    await fetchStarredGists("gho_x", 100, 1);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { gists: { listStarred: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.gists.listStarred).toHaveBeenCalledWith({ per_page: 100, page: 1 });
  });
});

describe("fetchPublicGists（listPublic 参数透传）", () => {
  it("透传 per_page/page", async () => {
    mockTyped.mockResolvedValue([] as never);
    await fetchPublicGists(null, 30, 1);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { gists: { listPublic: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.gists.listPublic).toHaveBeenCalledWith({ per_page: 30, page: 1 });
  });
});

describe("fetchUserGists（listForUser 参数透传）", () => {
  it("透传 username/per_page/page", async () => {
    mockTyped.mockResolvedValue([] as never);
    await fetchUserGists("alice", "gho_x", 30, 2);
    const [, run] = mockTyped.mock.calls[0];
    const octokit = { rest: { gists: { listForUser: vi.fn().mockResolvedValue({}) } } };
    await run(octokit as never);
    expect(octokit.rest.gists.listForUser).toHaveBeenCalledWith({
      username: "alice",
      per_page: 30,
      page: 2,
    });
  });
});
