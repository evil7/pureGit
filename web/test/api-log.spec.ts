/**
 * api-log 熔断日志工具 单元测试 —— 简洁格式 + fallback 序号关联 质量门
 *
 * 验收基线（对应架构设计「熔断日志格式」）：
 * - 主请求无图标（[Graph]/[Rest] 直打）
 * - 降级触发打 `[Fallback#n]` 行（含 error 详情 + 会话序号）
 * - 降级 REST 请求 `↪` 前缀（左右空格为图标间隔）
 * - 时间戳含毫秒（YYYY-MM-DD HH:mm:ss:SSS）
 * - GraphQL 主请求含 vars 快照
 * - fallback 序号递增（值传递，并发安全）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  beginFallback,
  logFallback,
  logGraphqlMain,
  logMainRequest,
  setApiLogDev,
} from "@/lib/api-log";

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

describe("api-log 熔断日志（简洁格式 + fallback 序号关联）", () => {
  beforeEach(() => {
    // 日志仅 DEV 输出——测试环境默认 false，显式开启
    setApiLogDev(true);
  });

  afterEach(() => {
    setApiLogDev(false);
  });

  it("主请求（无 fallback）→ 无图标，时间戳含毫秒", () => {
    const lines = capture(() => logMainRequest("graphql", "Viewer", 200, 32, 1024));
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3} \[Graph\] Viewer 1KB 200 32ms$/,
    );
    expect(lines[0]).not.toContain("↪");
  });

  it("fallback 中 → ↪ 前缀（左右空格为图标间隔）", () => {
    const lines = capture(() => {
      const { end } = beginFallback();
      try {
        logMainRequest("rest", "GET /repos/a/b", 200, 32, 1024);
      } finally {
        end();
      }
    });
    // 时间戳 + 空格 + ↪ + 空格 + [Rest]
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3} ↪ \[Rest\] GET \/repos\/a\/b 1KB 200 32ms$/,
    );
  });

  it("嵌套 fallback → 仍只单层 ↪ 图标（无复杂缩进）", () => {
    const lines = capture(() => {
      const a = beginFallback();
      const b = beginFallback();
      try {
        logMainRequest("rest", "GET /x", 200, 5);
      } finally {
        b.end();
        a.end();
      }
    });
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3} ↪ \[Rest\] GET \/x 200 5ms$/,
    );
    expect(lines[0]).not.toMatch(/↪\s+↪/); // 无多层图标叠加
  });

  it("beginFallback 结束后 inFallback 归零（后续主请求无 ↪）", () => {
    const lines = capture(() => {
      const { end } = beginFallback();
      end();
      logMainRequest("graphql", "After", 200, 1);
    });
    expect(lines[0]).not.toContain("↪");
  });

  it("fallback 序号递增（值传递，并发安全关联）", () => {
    const ids: number[] = [];
    const a = beginFallback();
    const b = beginFallback();
    ids.push(a.id, b.id);
    a.end();
    b.end();
    const c = beginFallback();
    ids.push(c.id);
    c.end();
    expect(ids[0]).toBeLessThan(ids[1]);
    expect(ids[1]).toBeLessThan(ids[2]);
  });

  it("GraphQL 主请求日志含 vars", () => {
    const lines = capture(() =>
      logGraphqlMain("PullRequest", { owner: "a", number: 7 }, 200, 32, 512),
    );
    expect(lines[0]).toContain('[Graph] PullRequest | vars: {"owner":"a","number":7}');
    expect(lines[0]).toContain("512B");
    expect(lines[0]).toContain("200");
    expect(lines[0]).toContain("32ms");
  });

  it("降级触发日志 [Fallback#n] 含 error 详情 + 序号", () => {
    const { id, end } = beginFallback();
    end();
    const lines = capture(() => logFallback("fetchPullsSmart", "Resource not found", id));
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} \\[Fallback#${id}\\] fetchPullsSmart \\| error: Resource not found$`,
      ),
    );
  });

  it("降级触发日志 err 为空时省略 error 段", () => {
    const { id, end } = beginFallback();
    end();
    const lines = capture(() => logFallback("fetchPullsSmart", null, id));
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} \\[Fallback#${id}\\] fetchPullsSmart$`,
      ),
    );
    expect(lines[0]).not.toContain("error:");
  });
});
