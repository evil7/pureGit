/**
 * ============================================================================
 * api-core.ts 单元测试 —— GraphQL smart 请求包装（模式决策/熔断）质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `api-core.graphqlRequest` 是 GraphQL 主模式下的智能请求包装，决定 smart 层
 * 何时走 GraphQL、何时短路降级 REST、何时触发熔断：
 * - 匿名（token 空）→ 短路返回 errors（GitHub GraphQL 匿名恒 403，直接降级 REST，不耗配额）
 * - 非 GraphQL 主模式（rest / 耗尽 / 熔断，由 octokit.shouldUseGraphQL 决策）→ 短路降级
 * - 网络层错误（TypeError/DOMException AbortError）→ 触发 GraphQL 熔断（60s 冷却）
 * - HTTP 4xx/5xx（token 失效等）→ 不熔断（非网络问题）
 * - 正常 → 原样返回 GraphQL 响应
 *
 * 【测试隔离】mock @/lib/octokit（决策函数）与 @/lib/graphql（底层请求），
 * 仅验证 api-core 自身的决策/熔断逻辑。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/octokit", () => ({
  shouldUseGraphQL: vi.fn(),
  triggerGqlCooldown: vi.fn(),
}));

vi.mock("@/lib/graphql", () => ({
  graphqlRequest: vi.fn(),
  hasGraphQLErrors: vi.fn(() => false),
}));

import { graphqlRequest } from "@/lib/api-core";
import { shouldUseGraphQL, triggerGqlCooldown } from "@/lib/octokit";
import { graphqlRequest as rawGraphqlRequest } from "@/lib/graphql";

const mockShouldGraphQL = vi.mocked(shouldUseGraphQL);
const mockTriggerCooldown = vi.mocked(triggerGqlCooldown);
const mockRaw = vi.mocked(rawGraphqlRequest);

const QUERY = "query Viewer { viewer { login } }";
const VARS = { after: "abc" };

beforeEach(() => {
  vi.clearAllMocks();
  mockShouldGraphQL.mockReturnValue(true);
  mockRaw.mockResolvedValue({ data: { viewer: { login: "alice" } } } as never);
});

describe("匿名短路（GraphQL 匿名恒 403 → 直接降级 REST）", () => {
  it("token 为 null → errors，不发起 GraphQL 请求", async () => {
    const r = await graphqlRequest(QUERY, VARS, null);
    expect(r.errors?.[0]?.message).toContain("anonymous");
    expect(mockRaw).not.toHaveBeenCalled();
    expect(mockTriggerCooldown).not.toHaveBeenCalled();
  });

  it("token 为空串 → 同上", async () => {
    const r = await graphqlRequest(QUERY, VARS, "");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("token 为 undefined → 同上", async () => {
    const r = await graphqlRequest(QUERY, VARS, undefined);
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockRaw).not.toHaveBeenCalled();
  });
});

describe("非 GraphQL 主模式短路（rest / 耗尽 / 熔断）", () => {
  it("shouldUseGraphQL false → errors，不发起请求，不熔断", async () => {
    mockShouldGraphQL.mockReturnValue(false);
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r.errors?.[0]?.message).toContain("skipped");
    expect(mockRaw).not.toHaveBeenCalled();
    expect(mockTriggerCooldown).not.toHaveBeenCalled();
  });
});

describe("熔断触发（仅网络层错误）", () => {
  it("fetch failed（TypeError）→ 返回 errors 且触发 GraphQL 熔断", async () => {
    mockRaw.mockRejectedValue(new TypeError("fetch failed"));
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockTriggerCooldown).toHaveBeenCalledTimes(1);
  });

  it("超时中止（DOMException AbortError）→ 触发熔断", async () => {
    mockRaw.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockTriggerCooldown).toHaveBeenCalledTimes(1);
  });

  it("HTTP 错误（普通 Error，如 401 token 失效）→ 不熔断", async () => {
    mockRaw.mockRejectedValue(new Error("Request failed with status code 401"));
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockTriggerCooldown).not.toHaveBeenCalled();
  });
});

describe("正常路径", () => {
  it("GraphQL 成功 → 原样返回响应，不熔断", async () => {
    const ok = { data: { viewer: { login: "bob" } } };
    mockRaw.mockResolvedValue(ok as never);
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r).toEqual(ok);
    expect(mockRaw).toHaveBeenCalledWith(QUERY, VARS, "gho_x");
    expect(mockTriggerCooldown).not.toHaveBeenCalled();
  });

  it("GraphQL 业务错误（errors 数组，非异常）→ 原样返回，不熔断", async () => {
    const errResp = { errors: [{ message: "Resource not found" }] };
    mockRaw.mockResolvedValue(errResp as never);
    const r = await graphqlRequest(QUERY, VARS, "gho_x");
    expect(r).toEqual(errResp);
    expect(mockTriggerCooldown).not.toHaveBeenCalled();
  });
});
