/**
 * ============================================================================
 * 档位 2 低频写操作 单元测试 —— REST 参数透传门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * 覆盖本轮新增的 7 个 REST 写函数，验证 octokit 方法名与参数透传正确：
 * - updateCommitComment（repos.updateCommitComment）
 * - updateReviewComment / deleteReviewComment / createReplyForReviewComment（pulls.*）
 * - updateReview / deletePendingReview（pulls.*）
 * - updateReleaseAsset（repos.updateReleaseAsset）
 * - markRepoNotificationsAsRead（activity.markRepoNotificationsAsRead）
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
import { updateCommitComment } from "@/lib/restapi/rest-repo";
import {
  updateReviewComment,
  deleteReviewComment,
  createReplyForReviewComment,
  updateReview,
  deletePendingReview,
} from "@/lib/restapi/rest-issue-pr";
import { updateReleaseAsset } from "@/lib/restapi/rest-repo";
import { markRepoNotificationsAsRead } from "@/lib/restapi/rest-user-nav";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

/** 取最后一次 typedRequest 调用的 octokit 回调，塞入 mock octokit 后执行，返回 mock 方法 */
function runLast(methods: Record<string, Record<string, ReturnType<typeof vi.fn>>>) {
  const [, run] = mockTyped.mock.calls[mockTyped.mock.calls.length - 1];
  const octokit = { rest: methods };
  return { run, octokit };
}

describe("commit 评论编辑", () => {
  it("updateCommitComment 透传 owner/repo/comment_id/body", async () => {
    mockTyped.mockResolvedValue({} as never);
    await updateCommitComment("o", "r", 5, "new body", "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ repos: { updateCommitComment: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      comment_id: 5,
      body: "new body",
    });
  });
});

describe("行内评审评论编辑/删除/回复", () => {
  it("updateReviewComment 透传 comment_id/body", async () => {
    mockTyped.mockResolvedValue({} as never);
    await updateReviewComment("o", "r", 7, "edited", "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ pulls: { updateReviewComment: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({ owner: "o", repo: "r", comment_id: 7, body: "edited" });
  });

  it("deleteReviewComment 透传 comment_id", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await deleteReviewComment("o", "r", 8, "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ pulls: { deleteReviewComment: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({ owner: "o", repo: "r", comment_id: 8 });
  });

  it("createReplyForReviewComment 透传 pull_number/comment_id/body", async () => {
    mockTyped.mockResolvedValue({} as never);
    await createReplyForReviewComment("o", "r", 12, 9, "reply", "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ pulls: { createReplyForReviewComment: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 12,
      comment_id: 9,
      body: "reply",
    });
  });
});

describe("pending review 更新/删除", () => {
  it("updateReview 透传 pull_number/review_id/body", async () => {
    mockTyped.mockResolvedValue({} as never);
    await updateReview("o", "r", 12, 3, "draft body", "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ pulls: { updateReview: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 12,
      review_id: 3,
      body: "draft body",
    });
  });

  it("deletePendingReview 透传 pull_number/review_id", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await deletePendingReview("o", "r", 12, 3, "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ pulls: { deletePendingReview: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 12, review_id: 3 });
  });
});

describe("release 资产编辑", () => {
  it("updateReleaseAsset 透传 asset_id/name/label", async () => {
    mockTyped.mockResolvedValue({} as never);
    await updateReleaseAsset("o", "r", 42, { name: "a.zip", label: "win" }, "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ repos: { updateReleaseAsset: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      asset_id: 42,
      name: "a.zip",
      label: "win",
    });
  });
});

describe("按仓库标记通知已读", () => {
  it("markRepoNotificationsAsRead 透传 owner/repo", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await markRepoNotificationsAsRead("o", "r", "gho_x");
    const list = vi.fn().mockResolvedValue({});
    const { run, octokit } = runLast({ activity: { markRepoNotificationsAsRead: list } });
    await run(octokit as never);
    expect(list).toHaveBeenCalledWith({ owner: "o", repo: "r" });
  });
});
