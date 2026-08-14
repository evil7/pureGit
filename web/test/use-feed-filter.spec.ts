/**
 * ============================================================================
 * useFeedFilter 类型解析/序列化 单元测试 —— Feed 动态类型过滤偏好质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `pg-feed-filter` 偏好键承载首页 Feed 动态类型勾选集合：
 * - parseFeedTypes：存储串 → 勾选集合；"all"/缺省/非法 → 全量勾选；逗号分隔 + 白名单过滤非法类型
 * - serializeFeedTypes：勾选集合 → 存储串；全选/全不选 → "all"；其余逗号分隔；去重 + 白名单
 * - isAllFeedTypes：全量勾选 或 空集合（全不选 = 按全选处理）→ true
 */
import { describe, it, expect } from "vitest";
import {
  parseFeedTypes,
  serializeFeedTypes,
  isAllFeedTypes,
  FEED_TYPES,
} from "@/hooks/useFeedFilter";

describe("parseFeedTypes（存储串 → 勾选集合）", () => {
  it("null / 空串 / all → 全量勾选", () => {
    expect(parseFeedTypes(null)).toEqual([...FEED_TYPES]);
    expect(parseFeedTypes("")).toEqual([...FEED_TYPES]);
    expect(parseFeedTypes("all")).toEqual([...FEED_TYPES]);
  });

  it("逗号分隔 → 按 FEED_TYPES 顺序的集合", () => {
    expect(parseFeedTypes("star,fork")).toEqual(["star", "fork"]);
    expect(parseFeedTypes("pr,issue,release")).toEqual(["pr", "release", "issue"]);
  });

  it("非法类型过滤（未知类型丢弃，全非法 → 全量）", () => {
    expect(parseFeedTypes("star,unknown,follow")).toEqual(["star"]);
    expect(parseFeedTypes("unknown,follow")).toEqual([...FEED_TYPES]);
  });
});

describe("serializeFeedTypes（勾选集合 → 存储串）", () => {
  it("全量勾选 / 全不选 → all", () => {
    expect(serializeFeedTypes([...FEED_TYPES])).toBe("all");
    expect(serializeFeedTypes([])).toBe("all");
  });

  it("子集 → 逗号分隔", () => {
    expect(serializeFeedTypes(["star", "push"])).toBe("star,push");
  });

  it("去重 + 白名单过滤", () => {
    expect(serializeFeedTypes(["star", "star", "fork"])).toBe("star,fork");
  });
});

describe("isAllFeedTypes（全选判定）", () => {
  it("全量勾选 → true", () => {
    expect(isAllFeedTypes([...FEED_TYPES])).toBe(true);
  });

  it("空集合（全不选按全选处理）→ true", () => {
    expect(isAllFeedTypes([])).toBe(true);
  });

  it("子集 → false", () => {
    expect(isAllFeedTypes(["star", "fork"])).toBe(false);
  });
});

describe("FEED_TYPES 覆盖（7 类，顺序 = 展示序：标星/分支/推送/合并/发布/问题/评论）", () => {
  it("包含 star/fork/push/pr/release/issue/comment", () => {
    expect(FEED_TYPES).toEqual(["star", "fork", "push", "pr", "release", "issue", "comment"]);
  });
});
