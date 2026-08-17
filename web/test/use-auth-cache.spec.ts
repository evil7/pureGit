/**
 * ============================================================================
 * useAuth session 缓存 单元测试 —— sessionStorage 标签页级缓存容错质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * 架构红线：access token 仅存内存变量，不写 localStorage 明文；刷新后经 Worker
 * /$auth/session 恢复。sessionStorage 缓存为**标签页级**（关闭即清，非持久）——
 * 是 CN 网络受限下「安全性 × 操作顺畅度」的折中点（避免每次刷新读 KV）。
 * - writeCache：写入 sessionStorage（写入失败静默忽略，回退 worker）
 * - readCache：损坏 JSON / 缺 token / expiresAt 非数字 → null（容错回退 worker 恢复）
 * - clearCache：清除缓存
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SESSION_CACHE_KEY, readCache, writeCache, clearCache } from "@/lib/auth/session-cache";

/** node 环境注入的 sessionStorage mock */
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

const validCache = {
  token: "gho_test_token",
  user: { login: "alice", userId: 123 },
  scopes: { mode: "read" as const },
  grantedScopes: ["repo"],
  expiresAt: 1_800_000_000_000,
};

beforeEach(() => {
  vi.stubGlobal("sessionStorage", makeStorage());
});

describe("readCache", () => {
  it("无缓存 → null", () => {
    expect(readCache()).toBeNull();
  });

  it("writeCache 后 → 完整读回", () => {
    writeCache(validCache);
    const c = readCache();
    expect(c).toEqual(validCache);
  });

  it("损坏 JSON → null（容错）", () => {
    sessionStorage.setItem(SESSION_CACHE_KEY, "{bad json!!");
    expect(readCache()).toBeNull();
  });

  it("合法 JSON 但缺 token → null", () => {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ expiresAt: 123 }));
    expect(readCache()).toBeNull();
  });

  it("合法 JSON 但 expiresAt 非数字 → null", () => {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ token: "x", expiresAt: "soon" }));
    expect(readCache()).toBeNull();
  });

  it("sessionStorage 不可用（getItem 抛错）→ null", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
    expect(readCache()).toBeNull();
  });
});

describe("writeCache / clearCache", () => {
  it("写入后可读回，清除后不可读", () => {
    writeCache(validCache);
    expect(readCache()).not.toBeNull();
    clearCache();
    expect(readCache()).toBeNull();
  });

  it("写入失败（隐私模式）静默忽略，不抛错", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
    expect(() => writeCache(validCache)).not.toThrow();
  });
});
