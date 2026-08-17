/**
 * ============================================================================
 * api-deploy-keys smart 决策 单元测试 —— deploy keys 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - deploy keys 整体 REST-only（GraphQL 无写 mutation 且 DeployKey 无数字 id，
 *   读取 GraphQL 无法与 REST 数字 key_id 删除衔接）→ smart 层透明转发 REST。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchDeployKeys: vi.fn(),
    addDeployKey: vi.fn(),
    deleteDeployKey: vi.fn(),
  };
});

import {
  fetchDeployKeysSmart,
  addDeployKeySmart,
  deleteDeployKeySmart,
} from "@/lib/api/api-deploy-keys";
import { fetchDeployKeys, addDeployKey, deleteDeployKey } from "@/lib/restapi";

const mockFetch = vi.mocked(fetchDeployKeys);
const mockAdd = vi.mocked(addDeployKey);
const mockDelete = vi.mocked(deleteDeployKey);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchDeployKeysSmart", () => {
  it("REST-only 透明转发 fetchDeployKeys（数字 id 贯穿删除）", async () => {
    mockFetch.mockResolvedValue([{ id: 1, title: "prod", key: "ssh-rsa AAA" }] as never);
    const keys = await fetchDeployKeysSmart("o", "r", "gho_x");
    expect(keys).toEqual([{ id: 1, title: "prod", key: "ssh-rsa AAA" }]);
    expect(mockFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("addDeployKeySmart", () => {
  it("REST-only 透明转发 addDeployKey（含 read_only）", async () => {
    mockAdd.mockResolvedValue({ id: 1, title: "prod" } as never);
    await addDeployKeySmart("o", "r", "prod", "ssh-rsa AAA", true, "gho_x");
    expect(mockAdd).toHaveBeenCalledWith("o", "r", "prod", "ssh-rsa AAA", true, "gho_x");
  });
});

describe("deleteDeployKeySmart", () => {
  it("REST-only 透明转发 deleteDeployKey", async () => {
    mockDelete.mockResolvedValue(undefined);
    await deleteDeployKeySmart("o", "r", 5, "gho_x");
    expect(mockDelete).toHaveBeenCalledWith("o", "r", 5, "gho_x");
  });
});
