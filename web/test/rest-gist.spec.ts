/**
 * ============================================================================
 * rest-user-nav Gist 完整化 单元测试 —— gist 评论/fork/删除 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - gist 评论/fork/删除 整体 REST-only（GraphQL 无 gist mutation 适配）。
 * - fetchGistComments 空数组（endpoint 返回 null）归一为 []。
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
  fetchGistComments,
  createGistComment,
  updateGistComment,
  deleteGistComment,
  forkGist,
  deleteGist,
} from "@/lib/restapi/rest-user-nav";

const mockTyped = vi.mocked(typedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchGistComments", () => {
  it("透明返回评论列表", async () => {
    const list = [
      {
        id: 1,
        user: { login: "a", avatar_url: "" },
        body: "hi",
        created_at: "",
        updated_at: "",
        html_url: "",
      },
    ];
    mockTyped.mockResolvedValue(list as never);
    const result = await fetchGistComments("gid", "gho_x");
    expect(result).toEqual(list);
  });

  it("返回 null → 归一为 []", async () => {
    mockTyped.mockResolvedValue(null as never);
    const result = await fetchGistComments("gid", null);
    expect(result).toEqual([]);
  });
});

describe("createGistComment", () => {
  it("转发 createComment", async () => {
    mockTyped.mockResolvedValue({ id: 1 } as never);
    await createGistComment("gid", "body", "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});

describe("updateGistComment", () => {
  it("转发 updateComment", async () => {
    mockTyped.mockResolvedValue({ id: 1 } as never);
    await updateGistComment("gid", 1, "new", "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});

describe("deleteGistComment", () => {
  it("转发 deleteComment", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await deleteGistComment("gid", 1, "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});

describe("forkGist", () => {
  it("返回 fork 后的 gist", async () => {
    const forked = { id: "fork-id" } as never;
    mockTyped.mockResolvedValue(forked);
    const result = await forkGist("gid", "gho_x");
    expect(result).toEqual(forked);
  });
});

describe("deleteGist", () => {
  it("转发 delete", async () => {
    mockTyped.mockResolvedValue(undefined as never);
    await deleteGist("gid", "gho_x");
    expect(mockTyped).toHaveBeenCalledTimes(1);
  });
});
