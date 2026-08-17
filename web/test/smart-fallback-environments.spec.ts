/**
 * ============================================================================
 * api-environments smart 决策 单元测试 —— environments 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - fetchEnvironmentsSmart：GraphQL repository.environments 首选，失败/匿名 → 降级 REST。
 * - createEnvironmentSmart：GraphQL createEnvironment 首选（先查 repositoryId），失败 → REST。
 * - deleteEnvironmentSmart：有 nodeId → GraphQL deleteEnvironment；无 nodeId → REST（按 name）。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(),
  };
});

import {
  fetchEnvironmentsSmart,
  createEnvironmentSmart,
  deleteEnvironmentSmart,
} from "@/lib/api/api-environments";
import { graphqlRequest } from "@/lib/api/api-core";
import { fetchEnvironments, createEnvironment, deleteEnvironment } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetch = vi.mocked(fetchEnvironments);
const mockCreate = vi.mocked(createEnvironment);
const mockDelete = vi.mocked(deleteEnvironment);

const gqlEnv = {
  id: "EN_1",
  databaseId: 123,
  name: "production",
  isPinned: true,
  protectionRules: { totalCount: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchEnvironmentsSmart", () => {
  it("GraphQL 成功 → 映射（databaseId→id / id→nodeId），不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { repository: { environments: { nodes: [gqlEnv] } } },
    } as never);
    const envs = await fetchEnvironmentsSmart("o", "r", "gho_x");
    expect(envs).toEqual([
      { id: 123, nodeId: "EN_1", name: "production", protectionRules: 2, isPinned: true },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("GraphQL 失败 → 降级 REST fetchEnvironments", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockFetch.mockResolvedValue([{ id: 1, name: "production", protectionRules: 0 }] as never);
    const envs = await fetchEnvironmentsSmart("o", "r", "gho_x");
    expect(envs).toEqual([{ id: 1, name: "production", protectionRules: 0 }]);
    expect(mockFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });

  it("匿名（token 空）→ 强制 REST fetchEnvironments", async () => {
    mockFetch.mockResolvedValue([] as never);
    await fetchEnvironmentsSmart("o", "r", null);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith("o", "r", null);
  });
});

describe("createEnvironmentSmart", () => {
  it("GraphQL 成功 → 返回 environment，不调 REST", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({ data: { createEnvironment: { environment: gqlEnv } } } as never);
    const env = await createEnvironmentSmart("o", "r", "production", "gho_x");
    expect(env.name).toBe("production");
    expect(env.nodeId).toBe("EN_1");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("GraphQL mutation 失败 → 降级 REST createEnvironment", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockCreate.mockResolvedValue({ id: 1, name: "production", protectionRules: 0 } as never);
    const env = await createEnvironmentSmart("o", "r", "production", "gho_x");
    expect(env.name).toBe("production");
    expect(mockCreate).toHaveBeenCalledWith("o", "r", "production", "gho_x");
  });
});

describe("deleteEnvironmentSmart", () => {
  it("有 nodeId 且 GraphQL 成功 → 不调 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ data: {} } as never);
    await deleteEnvironmentSmart("o", "r", { nodeId: "EN_1", name: "production" }, "gho_x");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("无 nodeId → 直接 REST deleteEnvironment（按 name）", async () => {
    mockDelete.mockResolvedValue(undefined);
    await deleteEnvironmentSmart("o", "r", { name: "production" }, "gho_x");
    expect(mockDelete).toHaveBeenCalledWith("o", "r", "production", "gho_x");
  });
});
