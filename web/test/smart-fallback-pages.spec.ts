/**
 * ============================================================================
 * api-pages smart 决策 单元测试 —— GitHub Pages 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - Pages 整体 REST-only（GraphQL 无 Pages 端点）→ smart 层透明转发 REST。
 * - fetchPagesSmart 未启用（404）→ 返回 null。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchPages: vi.fn(),
    createPagesSite: vi.fn(),
    updatePagesSite: vi.fn(),
    deletePagesSite: vi.fn(),
    listPagesBuilds: vi.fn(),
    requestPagesBuild: vi.fn(),
  };
});

import {
  fetchPagesSmart,
  createPagesSiteSmart,
  updatePagesSiteSmart,
  deletePagesSiteSmart,
  listPagesBuildsSmart,
  requestPagesBuildSmart,
} from "@/lib/api/api-pages";
import {
  fetchPages,
  createPagesSite,
  updatePagesSite,
  deletePagesSite,
  listPagesBuilds,
  requestPagesBuild,
} from "@/lib/restapi";

const mFetch = vi.mocked(fetchPages);
const mCreate = vi.mocked(createPagesSite);
const mUpdate = vi.mocked(updatePagesSite);
const mDelete = vi.mocked(deletePagesSite);
const mBuilds = vi.mocked(listPagesBuilds);
const mRequest = vi.mocked(requestPagesBuild);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPagesSmart", () => {
  it("REST-only 透明转发 fetchPages（未启用返回 null）", async () => {
    mFetch.mockResolvedValue(null);
    const result = await fetchPagesSmart("o", "r", "gho_x");
    expect(result).toBeNull();
    expect(mFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("createPagesSiteSmart", () => {
  it("REST-only 透明转发 createPagesSite", async () => {
    mCreate.mockResolvedValue({ url: "https://x" } as never);
    await createPagesSiteSmart("o", "r", "main", "/", "gho_x");
    expect(mCreate).toHaveBeenCalledWith("o", "r", "main", "/", "gho_x");
  });
});

describe("updatePagesSiteSmart", () => {
  it("REST-only 透明转发 updatePagesSite", async () => {
    mUpdate.mockResolvedValue(undefined);
    const input = { cname: "example.com", https_enforced: true };
    await updatePagesSiteSmart("o", "r", input, "gho_x");
    expect(mUpdate).toHaveBeenCalledWith("o", "r", input, "gho_x");
  });
});

describe("deletePagesSiteSmart", () => {
  it("REST-only 透明转发 deletePagesSite", async () => {
    mDelete.mockResolvedValue(undefined);
    await deletePagesSiteSmart("o", "r", "gho_x");
    expect(mDelete).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("listPagesBuildsSmart", () => {
  it("REST-only 透明转发 listPagesBuilds", async () => {
    const builds = [
      {
        url: "x",
        status: "built",
        error: { message: null },
        commit: "abc",
        duration: 1,
        created_at: "",
        updated_at: "",
      },
    ];
    mBuilds.mockResolvedValue(builds);
    const result = await listPagesBuildsSmart("o", "r", "gho_x");
    expect(result).toEqual(builds);
    expect(mBuilds).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("requestPagesBuildSmart", () => {
  it("REST-only 透明转发 requestPagesBuild", async () => {
    mRequest.mockResolvedValue({ status: "building" });
    await requestPagesBuildSmart("o", "r", "gho_x");
    expect(mRequest).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});
