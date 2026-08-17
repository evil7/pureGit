/**
 * ============================================================================
 * setWebCommitSignoffSmart 降级决策 单元测试 —— web 提交签名 GraphQL 主通道门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - signoff：GraphQL updateRepositoryWebCommitSignoffSetting 首选（独立 mutation，UpdateRepositoryInput 无此字段）
 * - 失败 → 降级 REST PATCH web_commit_signoff_required
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
    updateRepository: vi.fn(),
  };
});

import { setWebCommitSignoffSmart } from "@/lib/api/api-repo";
import { graphqlRequest } from "@/lib/api/api-core";
import { updateRepository } from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockUpdateRepository = vi.mocked(updateRepository);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setWebCommitSignoffSmart", () => {
  it("GraphQL 成功 → 不调 REST updateRepository", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({ data: {} } as never);
    await setWebCommitSignoffSmart("o", "r", true, "gho_x");
    expect(mockUpdateRepository).not.toHaveBeenCalled();
  });

  it("GraphQL mutation 失败 → 降级 REST web_commit_signoff_required", async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { repository: { id: "R_1" } } } as never)
      .mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockUpdateRepository.mockResolvedValue({} as never);
    await setWebCommitSignoffSmart("o", "r", true, "gho_x");
    expect(mockUpdateRepository).toHaveBeenCalledWith("o", "r", "gho_x", {
      web_commit_signoff_required: true,
    });
  });

  it("查 repositoryId 失败 → 降级 REST", async () => {
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: "x" }] } as never);
    mockUpdateRepository.mockResolvedValue({} as never);
    await setWebCommitSignoffSmart("o", "r", false, "gho_x");
    expect(mockUpdateRepository).toHaveBeenCalledWith("o", "r", "gho_x", {
      web_commit_signoff_required: false,
    });
  });
});
