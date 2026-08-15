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
 * - raw-proxy.fetchJsdelivrContent：用 commit sha 从 jsDelivr /gh/ 取文件（内容寻址精确绕墙）
 * - raw-proxy URL 构造纯函数：rawUrlToProxy / buildRawDirectUrl / buildRawProxyUrl / buildJsdelivrUrl
 * - api-file.fetchFileContentSmart（blob 页主加载通道）：
 *   登录 = REST contents（100MB）→ $raw 代理保底（去 GraphQL）；
 *   匿名 = 拿 sha → jsDelivr @sha → REST → raw 直连保底；knownSize 门控（>100MB 直接保底）
 *
 * 【关键语义基线】
 * 1. knownSize > API_REST_MAX_BYTES(100MB) → 直接保底通道（免无谓 API 尝试）
 * 2. 登录保底走 $raw 代理（directFirst=false）；匿名保底 raw 直连（allowProxy=false）
 * 3. 匿名优先 jsDelivr @sha（拿到 sha 才走），失败/拿不到 sha 才 REST
 * 4. rawUrlToProxy 仅处理 raw.githubusercontent.com；其他 URL 原样返回
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / fetchFileContent / fetchLatestCommit /
 * fetchRawContentSmart / fetchJsdelivrContent / global fetch），**零真实网络请求**——无风控风险。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/api-core", () => ({
  graphqlRequest: vi.fn(),
  hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
}));

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchFileContent: vi.fn(),
    fetchLatestCommit: vi.fn(),
  };
});

vi.mock("@/lib/repo/raw-proxy", () => ({
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
  fetchJsdelivrContent: vi.fn(),
}));

vi.mock("@/lib/repo/sha-cache", () => ({
  getCachedSha: vi.fn(() => null),
  setCachedSha: vi.fn(),
}));

vi.mock("@/lib/net/proxy-mode", () => ({
  getProxyMode: vi.fn(async () => "on"),
  anonymousProxyAllowed: vi.fn((mode: string) => mode === "on"),
}));

vi.mock("@/lib/net/channel-status", () => ({
  reportChannel: vi.fn(),
}));

import { fetchFileContentSmart, API_REST_MAX_BYTES } from "@/lib/api/api-file";
import { graphqlRequest } from "@/lib/api/api-core";
import { fetchFileContent, fetchLatestCommit } from "@/lib/restapi";
import { fetchRawContentSmart, fetchJsdelivrContent } from "@/lib/repo/raw-proxy";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchFileContent = vi.mocked(fetchFileContent);
const mockFetchLatestCommit = vi.mocked(fetchLatestCommit);
const mockRaw = vi.mocked(fetchRawContentSmart);
const mockJsdelivr = vi.mocked(fetchJsdelivrContent);

/** 简单 Response mock */
function mockRes(ok: boolean, text: string, status = 200): Response {
  return { ok, status, text: async () => text } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchFileContent.mockResolvedValue("REST content");
  mockFetchLatestCommit.mockResolvedValue(null);
  mockRaw.mockResolvedValue("RAW content");
  mockJsdelivr.mockResolvedValue(null);
});

describe("fetchFileContentSmart（登录：REST contents → $raw 代理保底）", () => {
  it("knownSize > 100MB → 直接保底（REST 不调，$raw 代理 directFirst=false）", async () => {
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

  it("REST contents 成功 → 返回 REST 结果（$raw 不调，去 GraphQL）", async () => {
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(mockRaw).not.toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("REST 失败 → 登录保底 $raw 代理（directFirst=false）", async () => {
    mockFetchFileContent.mockRejectedValue(new Error("403"));
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(mockRaw).toHaveBeenCalledWith("o", "r", "HEAD", "a.ts", false);
    expect(c).toBe("RAW content");
  });

  it("保底也失败（$raw 返回 null）→ 抛 ApiError 413", async () => {
    mockFetchFileContent.mockRejectedValue(new Error("403"));
    mockRaw.mockResolvedValue(null);
    await expect(fetchFileContentSmart("o", "r", "a.ts", "gho_x")).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("fetchFileContentSmart（匿名：拿 sha → jsDelivr → REST → raw）", () => {
  it("jsDelivr @sha 命中 → 返回（REST 不调，零额度）", async () => {
    mockFetchLatestCommit.mockResolvedValue({
      sha: "abc123",
      commit: { message: "m", committer: { date: "2026-01-01T00:00:00Z" } },
    });
    mockJsdelivr.mockResolvedValue("jsdelivr content");
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined);
    expect(mockFetchFileContent).not.toHaveBeenCalled();
    expect(c).toBe("jsdelivr content");
  });

  it("jsDelivr 失败 → REST contents", async () => {
    mockFetchLatestCommit.mockResolvedValue({
      sha: "abc123",
      commit: { message: "m", committer: { date: "2026-01-01T00:00:00Z" } },
    });
    mockJsdelivr.mockResolvedValue(null);
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined);
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("拿不到 sha → 跳过 jsDelivr 直接 REST", async () => {
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined);
    expect(mockJsdelivr).not.toHaveBeenCalled();
    expect(mockFetchFileContent).toHaveBeenCalled();
    expect(c).toBe("REST content");
  });

  it("REST 失败（非限流）→ 匿名保底 raw 直连（allowProxy=false）", async () => {
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
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    // 直接 URL 构造
    expect(raw.buildRawDirectUrl("o r", "re po", "feat/x", "a/b.ts")).toBe(
      "https://raw.githubusercontent.com/o%20r/re%20po/feat%2Fx/a/b.ts",
    );
    expect(raw.buildRawProxyUrl("o", "r", "main", "a/b.ts")).toContain("/$raw/o/r/main/a/b.ts");
    // buildJsdelivrUrl：/gh/{owner}/{repo}@{ref}/{path} 结构
    expect(raw.buildJsdelivrUrl("o", "r", "main", "a/b.ts")).toBe(
      "https://cdn.jsdelivr.net/gh/o/r@main/a/b.ts",
    );
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
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    const fetchMock = vi.fn(async () => mockRes(true, "direct text"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBe("direct text");
    vi.unstubAllGlobals();
  });

  it("直连失败（网络错误）→ 转 $raw 代理成功", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // raw 直连失败
      .mockResolvedValueOnce(mockRes(true, "proxy text")); // $raw 代理命中
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c).toBe("proxy text");
    vi.unstubAllGlobals();
  });

  it("directFirst=false → 跳过直连直接代理", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    const fetchMock = vi.fn(async () => mockRes(true, "proxy text"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts", false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBe("proxy text");
    vi.unstubAllGlobals();
  });

  it("allowProxy=false 且直连失败 → 返回 null（仅直连，不转代理）", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("blocked"));
    vi.stubGlobal("fetch", fetchMock);
    const c = await raw.fetchRawContentSmart("o", "r", "main", "a.ts", true, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toBeNull();
    vi.unstubAllGlobals();
  });

  it("代理 404 / 超限 → null", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/repo/raw-proxy");
    const raw = await import("@/lib/repo/raw-proxy");
    const fetchMock = vi.fn().mockResolvedValue(mockRes(false, ""));
    vi.stubGlobal("fetch", fetchMock);
    expect(await raw.fetchRawContentSmart("o", "r", "main", "missing")).toBeNull();
    vi.unstubAllGlobals();
  });
});
