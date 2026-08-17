/**
 * ============================================================================
 * api-tags smart 决策 单元测试 —— Tags 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - Tags 整体 REST-only（GraphQL 无适配）→ smart 层透明转发 REST。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchTags: vi.fn(),
    createTag: vi.fn(),
    deleteTag: vi.fn(),
  };
});

import { fetchTagsSmart, createTagSmart, deleteTagSmart } from "@/lib/api/api-tags";
import { fetchTags, createTag, deleteTag } from "@/lib/restapi";

const mFetch = vi.mocked(fetchTags);
const mCreate = vi.mocked(createTag);
const mDelete = vi.mocked(deleteTag);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchTagsSmart", () => {
  it("REST-only 透明转发 fetchTags", async () => {
    const tags = [
      {
        name: "v1.0",
        commit: { sha: "abc", url: "x" },
        zipball_url: "",
        tarball_url: "",
        node_id: "n",
      },
    ];
    mFetch.mockResolvedValue(tags);
    const result = await fetchTagsSmart("o", "r", "gho_x");
    expect(result).toEqual(tags);
    expect(mFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("createTagSmart", () => {
  it("REST-only 透明转发 createTag（两步组合在 rest 层）", async () => {
    mCreate.mockResolvedValue(undefined);
    await createTagSmart("o", "r", "v1.0", "msg", "abc123", "gho_x");
    expect(mCreate).toHaveBeenCalledWith("o", "r", "v1.0", "msg", "abc123", "gho_x");
  });
});

describe("deleteTagSmart", () => {
  it("REST-only 透明转发 deleteTag", async () => {
    mDelete.mockResolvedValue(undefined);
    await deleteTagSmart("o", "r", "v1.0", "gho_x");
    expect(mDelete).toHaveBeenCalledWith("o", "r", "v1.0", "gho_x");
  });
});
