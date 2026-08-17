/**
 * ============================================================================
 * fetchFileContentSmart / fetchRawContentSmart 通道分流 单元测试（$raw 纯透传重构后）
 * ============================================================================
 *
 * 【验收基线】
 * $raw 仅代表 worker 纯反代（受 RAW_PROXY_ENABLE 门控）；获取文件内容由前端直发 API。
 * - proxy 可用（on / login+登录）→ 走 /$raw 透传
 * - 否则（off / login+匿名）→ 前端直发 fetchFileContent（api contents，登录带 token）
 *
 * 【关键语义】
 * 1. proxy=on 或 login+token → fetch /$raw（credentials include），200 返回文本 + reportChannel("worker")
 * 2. proxy=login+匿名 或 off → fetchFileContent（api contents）
 * 3. /$raw 分支 maxBytes 门控：Content-Length > maxBytes → 抛 413（读 body 前拦截）
 * 4. /$raw 分支 413 → ApiError(413)；404 → ApiError(404)；401/403/5xx/网络错误 → 降级 api-contents
 *
 * 【测试方式】全部 mock（global fetch / graphqlRequest / channel-status / proxy-mode / fetchFileContent）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/api/api-core", () => ({
  graphqlRequest: vi.fn(),
  hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
}));

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return { ...actual, fetchFileContent: vi.fn() };
});

vi.mock("@/lib/net/channel-status", () => ({
  reportChannel: vi.fn(),
}));

vi.mock("@/lib/net/proxy-mode", () => ({
  getRawProxyMode: vi.fn(),
  getReleaseProxyMode: vi.fn(),
  getProxyModes: vi.fn(),
  resetProxyModeCache: vi.fn(),
}));

import { fetchFileContentSmart, BLOB_INLINE_MAX_BYTES } from "@/lib/api/api-file";
import { fetchRawContentSmart, buildRawProxyUrl, buildRawDirectUrl } from "@/lib/repo/raw-proxy";
import { getRawProxyMode } from "@/lib/net/proxy-mode";
import { fetchFileContent } from "@/lib/restapi";
import { reportChannel } from "@/lib/net/channel-status";

const mockGetRawProxyMode = vi.mocked(getRawProxyMode);
const mockFetchFileContent = vi.mocked(fetchFileContent);
const mockReportChannel = vi.mocked(reportChannel);
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRawProxyMode.mockResolvedValue("on");
  mockFetchFileContent.mockResolvedValue("api-text");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchFileContentSmart（proxy 分流）", () => {
  it("proxy=on + 匿名 → 走 /$raw（200 返回文本 + reportChannel worker）", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("content", { status: 200 })) as typeof fetch;
    const c = await fetchFileContentSmart("o", "r", "a.ts");
    expect(c).toBe("content");
    expect(mockReportChannel).toHaveBeenCalledWith("worker");
    expect(mockFetchFileContent).not.toHaveBeenCalled();
  });

  it("proxy=login + token → 走 /$raw（credentials include + 正确 URL）", async () => {
    mockGetRawProxyMode.mockResolvedValue("login");
    const fetchMock = vi.fn().mockResolvedValue(new Response("x", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await fetchFileContentSmart("o r", "re po", "a/b.ts", "gho_x", "feat/x");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/$raw/o%20r/re%20po/feat%2Fx/a/b.ts");
    expect(init.credentials).toBe("include");
    expect(mockFetchFileContent).not.toHaveBeenCalled();
  });

  it("proxy=login + 匿名 → 前端直发 fetchFileContent（api contents）", async () => {
    mockGetRawProxyMode.mockResolvedValue("login");
    const fetchMock = vi.fn().mockResolvedValue(new Response("x", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const c = await fetchFileContentSmart("o", "r", "a.ts", undefined, "main");
    expect(c).toBe("api-text");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFetchFileContent).toHaveBeenCalledWith(
      "o",
      "r",
      "a.ts",
      undefined,
      "main",
      undefined,
    );
  });

  it("proxy=off + token → 前端直发 fetchFileContent", async () => {
    mockGetRawProxyMode.mockResolvedValue("off");
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x", "main");
    expect(c).toBe("api-text");
    expect(mockFetchFileContent).toHaveBeenCalledWith("o", "r", "a.ts", "gho_x", "main", undefined);
  });

  it("api contents 分支透传 maxBytes 门控参数", async () => {
    mockGetRawProxyMode.mockResolvedValue("off");
    await fetchFileContentSmart("o", "r", "big.bin", "gho_x", "main", BLOB_INLINE_MAX_BYTES);
    expect(mockFetchFileContent).toHaveBeenCalledWith(
      "o",
      "r",
      "big.bin",
      "gho_x",
      "main",
      BLOB_INLINE_MAX_BYTES,
    );
  });

  it("$raw 分支 maxBytes 门控：Content-Length > maxBytes → 抛 413（不读 body）", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: { "Content-Length": String(BLOB_INLINE_MAX_BYTES + 1) },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(
      fetchFileContentSmart("o", "r", "big.bin", "gho_x", "main", BLOB_INLINE_MAX_BYTES),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("$raw 分支 413 → 抛 ApiError 413", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "file_too_large" }), { status: 413 }),
      ) as typeof fetch;
    await expect(fetchFileContentSmart("o", "r", "a.ts", "gho_x")).rejects.toMatchObject({
      status: 413,
    });
  });

  it("$raw 分支 404 → 抛 ApiError 404", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
    await expect(fetchFileContentSmart("o", "r", "a.ts", "gho_x")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("$raw 分支 401（会话失效）→ 降级 api-contents", async () => {
    mockGetRawProxyMode.mockResolvedValue("login");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 })) as typeof fetch;
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(c).toBe("api-text");
    expect(mockFetchFileContent).toHaveBeenCalledWith("o", "r", "a.ts", "gho_x", "HEAD", undefined);
  });

  it("$raw 分支网络错误 → 降级 api-contents", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as typeof fetch;
    const c = await fetchFileContentSmart("o", "r", "a.ts", "gho_x");
    expect(c).toBe("api-text");
    expect(mockFetchFileContent).toHaveBeenCalled();
  });
});

describe("buildRawProxyUrl / buildRawDirectUrl（纯函数）", () => {
  it("buildRawProxyUrl 逐段编码 owner/repo/ref/path", () => {
    expect(buildRawProxyUrl("o r", "re po", "feat/x", "a/b.ts")).toBe(
      "/$raw/o%20r/re%20po/feat%2Fx/a/b.ts",
    );
  });

  it("buildRawDirectUrl 逐段编码 raw.githubusercontent.com 直连", () => {
    expect(buildRawDirectUrl("o r", "re po", "feat/x", "a/b.ts")).toBe(
      "https://raw.githubusercontent.com/o%20r/re%20po/feat%2Fx/a/b.ts",
    );
  });
});

describe("fetchRawContentSmart（DiffView 上下文对比用，proxy 分流）", () => {
  it("proxy=on → 走 /$raw 返回文本", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("direct text", { status: 200 })) as typeof fetch;
    const c = await fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(c).toBe("direct text");
    expect(mockFetchFileContent).not.toHaveBeenCalled();
  });

  it("proxy=login + 匿名 → 前端直发 fetchFileContent 返回文本", async () => {
    mockGetRawProxyMode.mockResolvedValue("login");
    const c = await fetchRawContentSmart("o", "r", "main", "a.ts");
    expect(c).toBe("api-text");
    expect(mockFetchFileContent).toHaveBeenCalledWith("o", "r", "a.ts", undefined, "main");
  });

  it("$raw 网络错误 → null", async () => {
    mockGetRawProxyMode.mockResolvedValue("on");
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("blocked")) as typeof fetch;
    expect(await fetchRawContentSmart("o", "r", "main", "a.ts")).toBeNull();
  });
});
