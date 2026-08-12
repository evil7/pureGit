/**
 * ============================================================================
 * prefs-sync 本地偏好收集 单元测试 —— 打包上传前白名单过滤质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `collectLocalPrefs` 将本地偏好（theme/lang/codeTheme/apiMode/dateFormat）打包为
 * 可上传对象（Worker 端白名单校验，未知键丢弃；本模块先本地过滤一次）：
 * - 合法值收集：theme ∈ {light,dark,system}、lang ∈ {system,zh-CN,en-US}、
 *   codeTheme 任意非空、apiMode ∈ {graphql,rest}、dateFormat ∈ {absolute,iso,relative}
 * - 非法值忽略（不入包）
 * - localStorage 不可用 → 空对象
 * - 安全：prefs 仅 UI 偏好，绝不含 token/密钥
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { collectLocalPrefs } from "@/lib/prefs-sync";

function makeStorage(init: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(init));
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

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

describe("collectLocalPrefs", () => {
  it("空偏好 → 空对象", () => {
    expect(collectLocalPrefs()).toEqual({});
  });

  it("全量合法偏好 → 全部收集", () => {
    vi.stubGlobal(
      "localStorage",
      makeStorage({
        "pg-theme": "dark",
        pg_lang: "zh-CN",
        "pg-code-theme": "github-dark",
        puregit_api_mode: "rest",
        "pg-date-format": "relative",
      }),
    );
    expect(collectLocalPrefs()).toEqual({
      theme: "dark",
      lang: "zh-CN",
      codeTheme: "github-dark",
      apiMode: "rest",
      dateFormat: "relative",
    });
  });

  it("非法值忽略（不入包）", () => {
    vi.stubGlobal(
      "localStorage",
      makeStorage({
        "pg-theme": "red",
        pg_lang: "fr",
        puregit_api_mode: "weird",
        "pg-date-format": "yesterday",
        // codeTheme 任意非空合法
        "pg-code-theme": "x",
      }),
    );
    expect(collectLocalPrefs()).toEqual({ codeTheme: "x" });
  });

  it("codeTheme 空串不收集（非空要求）", () => {
    vi.stubGlobal("localStorage", makeStorage({ "pg-code-theme": "" }));
    expect(collectLocalPrefs()).toEqual({});
  });

  it("localStorage 不可用（抛错）→ 空对象", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
    expect(collectLocalPrefs()).toEqual({});
  });

  it("只收集白名单键：其他 localStorage 键不影响", () => {
    vi.stubGlobal(
      "localStorage",
      makeStorage({
        "pg-theme": "system",
        unrelated_key: "whatever",
        another: "x",
      }),
    );
    expect(collectLocalPrefs()).toEqual({ theme: "system" });
  });
});
