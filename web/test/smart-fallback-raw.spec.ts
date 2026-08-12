/**
 * ============================================================================
 * $raw 链路 + fetchFileContentSmart 智能通道 单元测试 —— CN 网络受限场景降级质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * 本项目核心痛点：raw.githubusercontent.com 在受限网络被墙/不可达。$raw 链路设计：
 * - raw-proxy.fetchRawContentSmart：直连 raw →（可选）Worker /$raw 代理降级；
 *   directFirst=false 跳过直连（登录保底，受限网络直连超时浪费 5s）；
 *   allowProxy=false 仅直连（匿名保底「原始直连」用户定稿）
 * - raw-proxy URL 构造纯函数：rawUrlToProxy / buildRawDirectUrl / buildRawProxyUrl
 * - api-repo.fetchFileContentSmart（blob 页主加载通道）：
 *   登录 = GraphQL blob（≤1MB）→ REST contents（100MB）→ $raw 代理保底；
 *   匿名 = REST → raw 直连保底；knownSize 门控（>100MB 直接保底；>1MB 跳过 GraphQL）
 *
 * 【关键语义基线】
 * 1. GraphQL blob isTruncated=true（>1MB）→ 必须跳过（防静默返回残缺内容）
 * 2. knownSize > API_REST_MAX_BYTES(100MB) → 直接保底通道（免无谓 API 尝试）
 * 3. 登录保底走 $raw 代理（directFirst=false）；匿名保底 raw 直连（allowProxy=false）
 * 4. rawUrlToProxy 仅处理 raw.githubusercontent.com；其他 URL 原样返回
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / fetchFileContent / fetchRawContentSmart
 * / global fetch），**零真实网络请求**——无风控风险。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api-core", () => ({
  graphqlRequest: vi.fn(),
  hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
}));

vi.mock("@/lib/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rest")>();
  return {
    ...actual,
    fetchFileContent: vi.fn(),
  };
});

vi.mock("@/lib/raw-proxy", () => ({
  RAW_MAX_BYTES: 100 * 1024 * 1024,
  rawUrlToProxy: vi.fn((url: string) => url),
  buildRawDirectUrl: vi.fn(
    (o: string, r: string, ref: string, p: string) =>
      `https://raw.githubusercontent.com/${o}/${r}/${ref}/${p}`,
  ),
  buildRawProxyUrl: vi.fn(
    (o: string, r: string, ref: string, p: string) => `/$raw/${o}/${r}/${ref}/${p}`,
  ),
  fetchRawContentSmart: vi.fn(),
}));

import { fetchFileContentSmart, API_REST_MAX_BYTES, API_GQL_MAX_BYTES } from "@/lib/api-repo";
import { graphqlRequest } from "@/lib/api-core";
import { fetchFileContent } from "@/lib/rest";
import { fetchRawContentSmart } from "@/lib/raw-proxy";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchFileContent = vi.mocked(fetchFileContent);
const mockRaw = vi.mocked(fetchRawContentSmart);

/** 简单 Response mock */
function mockRes(ok: boolean, text: string, status = 200): Response {
  return { ok, status, text: async () => text } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchFileContent.mockResolvedValue("REST content");
  mockRaw.mockResolvedValue("RAW content");
});

describe("fetchFileContentSmart（登录：GraphQL → REST → $raw 代理保底）", () => {
  it("knownSize > 100MB → 直接保底（GraphQL/REST 均不调，$raw 代理 directFirst=false）", async () => {
    const c = await fetchFileContentSmart(
      "o",
      "r",
      "big.bin",
      "gho_x",
      "main",
      API_REST_MAX_BYTES + 1,
    );
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchFileContent).not.toHaveBeenCalled();
    expect(mockRaw).toHaveBeenCalledWith("o", "r", "main", "big.bin", false);
    expect(c).toBe("RAW content");
  });

  it("knownSize > 1MB（≤100MB）→ 跳过 GraphQL 直接 REST（防 isTruncated 残缺）", async () => {
    const c = await fetchFileContentSmart(
      "o",
      "r",
      "mid.bin",
      "gho_x",
      "main",
      API_GQL_MAX_BYTES + 1,
    );
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("GraphQL blob 成功（text 完整非截断）→ 返回 GraphQL 结果，REST 不调", async () => {
    mockGraphql.mockResolvedValue({
      data: { repository: { object: { text: "GQL text", isTruncated: false } } },
    } as never);
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(mockFetchFileContent).not.toHaveBeenCalled();
    expect(mockRaw).not.toHaveBeenCalled();
    expect(c).toBe("GQL text");
  });

  it("GraphQL blob isTruncated=true（>1MB）→ 跳过残缺内容降级 REST", async () => {
    mockGraphql.mockResolvedValue({
      data: { repository: { object: { text: "partial...", isTruncated: true } } },
    } as never);
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("GraphQL errors / 异常 → 降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect(await fetchFileContentSmart("o", "r", "a.ts", "gho_x")).toBe("REST content");
    mockGraphql.mockRejectedValue(new TypeError("net"));
    expect(await fetchFileContentSmart("o", "r", "a.ts", "gho_x")).toBe("REST content");
    expect(mockFetchFileContent).toHaveBeenCalledTimes(2);
  });

  it("GraphQL + REST 都失败 → 登录保底 $raw 代理（directFirst=false）", async () => {
    mockGraphql.mockRejectedValue(new TypeError("net"));
    mockFetchFileContent.mockRejectedValue(new Error("403"));
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(mockRaw).toHaveBeenCalledWith("o", "r", "HEAD", "a.ts", false);
    expect(c).toBe("RAW content");
  });

  it("保底也失败（$raw 返回 null）→ 抛 ApiError 413", async () => {
    mockGraphql.mockRejectedValue(new TypeError("net"));
    mockFetchFileContent.mockRejectedValue(new Error("403"));
    mockRaw.mockResolvedValue(null);
    await expect(fetchFileContentSmart("o", "r", "a.ts", "gho_x")).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("fetchFileContentSmart（匿名：REST → raw 直连保底）", () => {
  it("token 空 → 跳过 GraphQL 直接 REST", async () => {
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("REST 失败 → 匿名保底 raw 直连（allowProxy=false，仅直连）", async () => {
    mockFetchFileContent.mockRejectedValue(new Error("404"));
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined);
    expect(mockRaw).toHaveBeenCalledWith("o", "r", "HEAD", "a.ts", true, false);
    expect(c).toBe("RAW content");
  });

  it("匿名保底失败 → 抛 ApiError 404（公开文件不可达，引导登录）", async () => {
    mockFetchFileContent.mockRejectedValue(new Error("404"));
    mockRaw.mockResolvedValue(null);
    await expect(fetchFileContentSmart("o", "r", "a.ts", undefined)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("raw-proxy URL 构造纯函数（经真实模块验证）", () => {
  // 注意：上面 mock 了 raw-proxy 的 URL 函数；此处重新 import 真实模块验证纯函数
  // （vi.resetModules + 直接静态导入 raw-proxy 会冲突——改用独立 describe + 动态 import）
  it("rawUrlToProxy / buildRawDirectUrl / buildRawProxyUrl 正确编码", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    // 直接 URL 构造
    expect(raw.buildRawDirectUrl("o r", "re po", "feat/x", "a/b.ts")).toBe(
      "https://raw.githubusercontent.com/o%20r/re%20po/feat%2Fx/a/b.ts",
    );
    expect(raw.buildRawProxyUrl("o", "r", "main", "a/b.ts")).toContain("/$raw/o/r/main/a/b.ts");
    // rawUrlToProxy：raw 域名 → 代理；非 raw 域名原样
    expect(raw.rawUrlToProxy("https://raw.githubusercontent.com/o/r/main/a.png")).toContain(
      "/$raw/o/r/main/a.png",
    );
    expect(raw.rawUrlToProxy("https://example.com/x.png")).toBe("https://example.com/x.png");
    expect(raw.rawImgFallbackSrc("https://raw.githubusercontent.com/o/r/main/i.png")).toContain(
      "/$raw/o/r/main/i.png",
    );
  });
});

describe("raw-proxy fetchRawContentSmart（真实模块 + global fetch mock）", () => {
  it("直连成功 → 返回文本（不转代理）", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    const fetchMock = vi.fn(async () => mockRes(true, "direct text"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBe("direct text");
    vi.unstubAllGlobals();
  });

  it("直连失败（网络错误）→ 转 $raw 代理成功", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockRes(true, "proxy text"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c).toBe("proxy text");
    vi.unstubAllGlobals();
  });

  it("directFirst=false → 跳过直连直接代理", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    const fetchMock = vi.fn(async () => mockRes(true, "proxy text"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts", false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBe("proxy text");
    vi.unstubAllGlobals();
  });

  it("allowProxy=false 且直连失败 → 返回 null（仅直连）", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("blocked"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts", true, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBeNull();
    vi.unstubAllGlobals();
  });

  it("代理 404 / 超限 → null", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/raw-proxy");
    const raw = await import("@/lib/raw-proxy");
    const fetchMock = vi.fn().mockResolvedValue(mockRes(false, ""));
    vi.stubGlobal("fetch", fetchMock);
    expect(await raw.fetchRawContentSmart("o", "r", "main", "missing")).toBeNull();
    vi.unstubAllGlobals();
  });
});
