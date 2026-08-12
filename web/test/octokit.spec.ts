/**
 * ============================================================================
 * octokit.ts 单元测试 —— API 模式偏好 / 额度跟踪 / 熔断 / 模式决策 质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `octokit.ts` 是 REST（@octokit/rest）与 GraphQL（@octokit/graphql）双客户端的统一入口：
 * - 模式偏好：localStorage `puregit_api_mode`（默认 graphql；未登录 token 为 null 时自动 REST）
 * - 额度跟踪：REST/GraphQL 各自独立计数（响应头 x-ratelimit-* 写入统一缓存）；
 *   缺失头保留原值防清零；setApiUsage 部分更新合并
 * - 熔断：某模式 remaining===0 或网络故障 → 自动切换另一模式（cooldown 60s），**不改变用户设置**
 * - 决策：shouldUseGraphQL/shouldUseRest —— 恒 GraphQL 优先，耗尽/熔断自动降级 REST
 * - 订阅机制：subscribeUsageChange/getApiUsage/hasApiUsageData/setApiUsage 供 footer/偏好页
 *
 * 【测试隔离说明】
 * - toast 模块（notifyModeFallback）整体 mock，断言「降级时是否提示」
 * - prefs-sync（setApiMode 动态 import 的云同步）整体 mock，防止测试中触发真实推送
 * - localStorage 用 vi.stubGlobal 注入（node 环境无浏览器 API）
 * - 额度/熔断为模块级单例：beforeEach 重置 usage；熔断时间用 fake timers + setSystemTime 控制
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { notifyModeFallback } from "@/lib/toast";

vi.mock("@/lib/toast", () => ({
  notifyModeFallback: vi.fn(),
}));

vi.mock("@/lib/prefs-sync", () => ({
  PREFS_SYNC_EVENT: "puregit:prefs-synced",
  setPrefsAuth: vi.fn(),
  getPrefsToken: vi.fn(() => null),
  requestPrefsPush: vi.fn(),
}));

type Octokit = typeof import("@/lib/octokit");
let octokit: Octokit;

/** 简单 localStorage mock（node 环境注入） */
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

const EMPTY_BUCKET = { limit: 0, remaining: 0, used: 0, reset: 0 };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // 额度/熔断为模块级单例：每次全新 import 获得干净状态，避免跨用例污染
  vi.resetModules();
  octokit = await import("@/lib/octokit");
});

describe("模式偏好（localStorage）", () => {
  it("无值 / 非法值 → 默认 graphql", () => {
    vi.stubGlobal("localStorage", makeStorage());
    expect(octokit.getApiMode()).toBe("graphql");
    localStorage.setItem("puregit_api_mode", "bogus");
    expect(octokit.getApiMode()).toBe("graphql");
  });

  it("rest → rest；setApiMode 写入后可读回", () => {
    vi.stubGlobal("localStorage", makeStorage());
    localStorage.setItem("puregit_api_mode", "rest");
    expect(octokit.getApiMode()).toBe("rest");
    octokit.setApiMode("graphql");
    expect(octokit.getApiMode()).toBe("graphql");
    octokit.setApiMode("rest");
    expect(octokit.getApiMode()).toBe("rest");
  });

  it("localStorage 不可用（getItem 抛错）→ 回退默认 graphql", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
    expect(octokit.getApiMode()).toBe("graphql");
  });
});

describe("额度跟踪", () => {
  it("初始无数据：hasApiUsageData false，双桶全 0", () => {
    expect(octokit.hasApiUsageData()).toBe(false);
    const u = octokit.getApiUsage();
    expect(u.rest).toEqual(EMPTY_BUCKET);
    expect(u.graphql).toEqual(EMPTY_BUCKET);
    expect(u.lastMode).toBeNull();
  });

  it("setApiUsage 部分更新合并（只动传入的模式）", () => {
    octokit.setApiUsage({ limit: 5000, remaining: 4999, used: 1, reset: 100 });
    const u = octokit.getApiUsage();
    expect(u.rest).toEqual({ limit: 5000, remaining: 4999, used: 1, reset: 100 });
    expect(u.graphql).toEqual(EMPTY_BUCKET); // 未传入不动
    octokit.setApiUsage(undefined, { limit: 5000, remaining: 5000 });
    const u2 = octokit.getApiUsage();
    expect(u2.rest).toEqual({ limit: 5000, remaining: 4999, used: 1, reset: 100 }); // rest 保留
    expect(u2.graphql.limit).toBe(5000);
  });

  it("hasApiUsageData：任一模式 limit>0 → true", () => {
    expect(octokit.hasApiUsageData()).toBe(false);
    octokit.setApiUsage({ limit: 5000, remaining: 5000 });
    expect(octokit.hasApiUsageData()).toBe(true);
  });

  it("isExhausted：limit>0 且 remaining<=0 → 耗尽；limit=0 不视为耗尽", () => {
    expect(octokit.isExhausted("graphql")).toBe(false); // limit=0
    octokit.setApiUsage(undefined, { limit: 5000, remaining: 0 });
    expect(octokit.isExhausted("graphql")).toBe(true);
    octokit.setApiUsage(undefined, { limit: 5000, remaining: 1 });
    expect(octokit.isExhausted("graphql")).toBe(false);
  });

  it("getApiUsage 返回副本：修改返回值不影响内部状态", () => {
    octokit.setApiUsage({ limit: 5000, remaining: 5000 });
    const u = octokit.getApiUsage();
    u.rest.limit = 0;
    expect(octokit.getApiUsage().rest.limit).toBe(5000);
  });

  it("subscribeUsageChange：写入后触发订阅；退订后不再触发", () => {
    const cb = vi.fn();
    const unsubscribe = octokit.subscribeUsageChange(cb);
    octokit.setApiUsage({ limit: 5000, remaining: 5000 });
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    octokit.setApiUsage({ limit: 6000, remaining: 6000 });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("熔断（cooldown）", () => {
  it("triggerRestCooldown 后 60s 内 isRestCooldown true，过期后 false", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(octokit.isRestCooldown()).toBe(false);
    octokit.triggerRestCooldown();
    expect(octokit.isRestCooldown()).toBe(true);
    vi.setSystemTime(1_000_000 + 59_999);
    expect(octokit.isRestCooldown()).toBe(true);
    vi.setSystemTime(1_000_000 + 60_000);
    expect(octokit.isRestCooldown()).toBe(false);
  });

  it("triggerGqlCooldown 同理（REST 熔断不影响 GraphQL 判定，反之亦然）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    octokit.triggerGqlCooldown();
    expect(octokit.isGqlCooldown()).toBe(true);
    expect(octokit.isRestCooldown()).toBe(false);
    vi.setSystemTime(1_000_000 + 60_001);
    expect(octokit.isGqlCooldown()).toBe(false);
  });
});

describe("模式决策", () => {
  it("正常状态：shouldUseGraphQL true，shouldUseRest false，无降级提示", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(octokit.shouldUseGraphQL()).toBe(true);
    expect(octokit.shouldUseRest()).toBe(false);
    expect(notifyModeFallback).not.toHaveBeenCalled();
  });

  it("GraphQL 耗尽 → shouldUseGraphQL false，shouldUseRest true，提示降级到 rest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    octokit.setApiUsage(undefined, { limit: 5000, remaining: 0 });
    expect(octokit.shouldUseGraphQL()).toBe(false);
    expect(octokit.shouldUseRest()).toBe(true);
    expect(notifyModeFallback).toHaveBeenCalledWith("rest");
  });

  it("GraphQL 熔断 → 同样降级 REST 并提示", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    octokit.triggerGqlCooldown();
    expect(octokit.shouldUseGraphQL()).toBe(false);
    expect(octokit.shouldUseRest()).toBe(true);
    expect(notifyModeFallback).toHaveBeenCalledWith("rest");
  });

  it("GraphQL 熔断期间 REST 可用：shouldUseRest true（本次请求走 REST）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    octokit.triggerGqlCooldown();
    expect(octokit.shouldUseRest()).toBe(true);
  });
});
