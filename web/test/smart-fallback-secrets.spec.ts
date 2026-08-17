/**
 * ============================================================================
 * api-secrets smart 决策 单元测试 —— Secrets & Variables 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - secrets/variables 整体 REST-only（GraphQL 无对应类型/字段）→ smart 层透明转发 REST。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchRepoSecrets: vi.fn(),
    fetchRepoVariables: vi.fn(),
    upsertRepoSecret: vi.fn(),
    deleteRepoSecret: vi.fn(),
    createRepoVariable: vi.fn(),
    updateRepoVariable: vi.fn(),
    deleteRepoVariable: vi.fn(),
  };
});

import {
  fetchRepoSecretsSmart,
  fetchRepoVariablesSmart,
  upsertRepoSecretSmart,
  deleteRepoSecretSmart,
  createRepoVariableSmart,
  updateRepoVariableSmart,
  deleteRepoVariableSmart,
} from "@/lib/api/api-secrets";
import {
  fetchRepoSecrets,
  fetchRepoVariables,
  upsertRepoSecret,
  deleteRepoSecret,
  createRepoVariable,
  updateRepoVariable,
  deleteRepoVariable,
} from "@/lib/restapi";

const mFetchSecrets = vi.mocked(fetchRepoSecrets);
const mFetchVariables = vi.mocked(fetchRepoVariables);
const mUpsert = vi.mocked(upsertRepoSecret);
const mDelSecret = vi.mocked(deleteRepoSecret);
const mCreateVar = vi.mocked(createRepoVariable);
const mUpdateVar = vi.mocked(updateRepoVariable);
const mDelVar = vi.mocked(deleteRepoVariable);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRepoSecretsSmart", () => {
  it("REST-only 透明转发 fetchRepoSecrets", async () => {
    const list = [{ name: "TOKEN", created_at: "", updated_at: "" }];
    mFetchSecrets.mockResolvedValue(list);
    const result = await fetchRepoSecretsSmart("o", "r", "gho_x");
    expect(result).toEqual(list);
    expect(mFetchSecrets).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("fetchRepoVariablesSmart", () => {
  it("REST-only 透明转发 fetchRepoVariables", async () => {
    const list = [{ name: "ENV", value: "prod", created_at: "", updated_at: "" }];
    mFetchVariables.mockResolvedValue(list);
    const result = await fetchRepoVariablesSmart("o", "r", "gho_x");
    expect(result).toEqual(list);
    expect(mFetchVariables).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("upsertRepoSecretSmart", () => {
  it("REST-only 透明转发 upsertRepoSecret（值加密由 REST 层承担）", async () => {
    mUpsert.mockResolvedValue(undefined);
    await upsertRepoSecretSmart("o", "r", "TOKEN", "secret", "gho_x");
    expect(mUpsert).toHaveBeenCalledWith("o", "r", "TOKEN", "secret", "gho_x");
  });
});

describe("deleteRepoSecretSmart", () => {
  it("REST-only 透明转发 deleteRepoSecret", async () => {
    mDelSecret.mockResolvedValue(undefined);
    await deleteRepoSecretSmart("o", "r", "TOKEN", "gho_x");
    expect(mDelSecret).toHaveBeenCalledWith("o", "r", "TOKEN", "gho_x");
  });
});

describe("createRepoVariableSmart", () => {
  it("REST-only 透明转发 createRepoVariable", async () => {
    mCreateVar.mockResolvedValue(undefined);
    await createRepoVariableSmart("o", "r", "ENV", "prod", "gho_x");
    expect(mCreateVar).toHaveBeenCalledWith("o", "r", "ENV", "prod", "gho_x");
  });
});

describe("updateRepoVariableSmart", () => {
  it("REST-only 透明转发 updateRepoVariable", async () => {
    mUpdateVar.mockResolvedValue(undefined);
    await updateRepoVariableSmart("o", "r", "ENV", "staging", "gho_x");
    expect(mUpdateVar).toHaveBeenCalledWith("o", "r", "ENV", "staging", "gho_x");
  });
});

describe("deleteRepoVariableSmart", () => {
  it("REST-only 透明转发 deleteRepoVariable", async () => {
    mDelVar.mockResolvedValue(undefined);
    await deleteRepoVariableSmart("o", "r", "ENV", "gho_x");
    expect(mDelVar).toHaveBeenCalledWith("o", "r", "ENV", "gho_x");
  });
});
