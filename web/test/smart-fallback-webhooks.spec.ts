/**
 * ============================================================================
 * api-webhooks smart 决策 单元测试 —— Webhooks 通路门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * - webhooks 整体 REST-only（GraphQL 无 repository webhook 端点）→ smart 层透明转发 REST。
 * 全部 mock，零真实网络请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchRepoWebhooks: vi.fn(),
    createRepoWebhook: vi.fn(),
    updateRepoWebhook: vi.fn(),
    deleteRepoWebhook: vi.fn(),
    pingRepoWebhook: vi.fn(),
    fetchWebhookDeliveries: vi.fn(),
    redeliverWebhookDelivery: vi.fn(),
  };
});

import {
  fetchRepoWebhooksSmart,
  createRepoWebhookSmart,
  updateRepoWebhookSmart,
  deleteRepoWebhookSmart,
  pingRepoWebhookSmart,
  fetchWebhookDeliveriesSmart,
  redeliverWebhookDeliverySmart,
} from "@/lib/api/api-webhooks";
import {
  fetchRepoWebhooks,
  createRepoWebhook,
  updateRepoWebhook,
  deleteRepoWebhook,
  pingRepoWebhook,
  fetchWebhookDeliveries,
  redeliverWebhookDelivery,
} from "@/lib/restapi";
import type { WebhookInput } from "@/lib/restapi";

const mFetch = vi.mocked(fetchRepoWebhooks);
const mCreate = vi.mocked(createRepoWebhook);
const mUpdate = vi.mocked(updateRepoWebhook);
const mDelete = vi.mocked(deleteRepoWebhook);
const mPing = vi.mocked(pingRepoWebhook);
const mDeliveries = vi.mocked(fetchWebhookDeliveries);
const mRedeliver = vi.mocked(redeliverWebhookDelivery);

beforeEach(() => {
  vi.clearAllMocks();
});

const input: WebhookInput = {
  url: "https://example.com/hook",
  contentType: "json",
  events: ["push"],
  active: true,
};

describe("fetchRepoWebhooksSmart", () => {
  it("REST-only 透明转发 fetchRepoWebhooks", async () => {
    const list = [
      {
        id: 1,
        name: "web",
        active: true,
        events: ["push"],
        config: { url: "x", content_type: "json" },
      } as never,
    ];
    mFetch.mockResolvedValue(list);
    const result = await fetchRepoWebhooksSmart("o", "r", "gho_x");
    expect(result).toEqual(list);
    expect(mFetch).toHaveBeenCalledWith("o", "r", "gho_x");
  });
});

describe("createRepoWebhookSmart", () => {
  it("REST-only 透明转发 createRepoWebhook", async () => {
    mCreate.mockResolvedValue({ id: 1 } as never);
    await createRepoWebhookSmart("o", "r", input, "gho_x");
    expect(mCreate).toHaveBeenCalledWith("o", "r", input, "gho_x");
  });
});

describe("updateRepoWebhookSmart", () => {
  it("REST-only 透明转发 updateRepoWebhook（含 hookId）", async () => {
    mUpdate.mockResolvedValue({ id: 1 } as never);
    await updateRepoWebhookSmart("o", "r", 1, input, "gho_x");
    expect(mUpdate).toHaveBeenCalledWith("o", "r", 1, input, "gho_x");
  });
});

describe("deleteRepoWebhookSmart", () => {
  it("REST-only 透明转发 deleteRepoWebhook", async () => {
    mDelete.mockResolvedValue(undefined);
    await deleteRepoWebhookSmart("o", "r", 1, "gho_x");
    expect(mDelete).toHaveBeenCalledWith("o", "r", 1, "gho_x");
  });
});

describe("pingRepoWebhookSmart", () => {
  it("REST-only 透明转发 pingRepoWebhook", async () => {
    mPing.mockResolvedValue(undefined);
    await pingRepoWebhookSmart("o", "r", 1, "gho_x");
    expect(mPing).toHaveBeenCalledWith("o", "r", 1, "gho_x");
  });
});

describe("fetchWebhookDeliveriesSmart", () => {
  it("REST-only 透明转发 fetchWebhookDeliveries", async () => {
    const d = [
      {
        id: 1,
        guid: "g",
        delivered_at: "",
        redelivery: false,
        duration: 0,
        status: "",
        status_code: 200,
        event: "push",
        action: null,
      },
    ];
    mDeliveries.mockResolvedValue(d);
    const result = await fetchWebhookDeliveriesSmart("o", "r", 1, "gho_x");
    expect(result).toEqual(d);
    expect(mDeliveries).toHaveBeenCalledWith("o", "r", 1, "gho_x");
  });
});

describe("redeliverWebhookDeliverySmart", () => {
  it("REST-only 透明转发 redeliverWebhookDelivery", async () => {
    mRedeliver.mockResolvedValue(undefined);
    await redeliverWebhookDeliverySmart("o", "r", 1, 5, "gho_x");
    expect(mRedeliver).toHaveBeenCalledWith("o", "r", 1, 5, "gho_x");
  });
});
