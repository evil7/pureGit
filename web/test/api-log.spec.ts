/**
 * api-log 熔断日志工具 单元测试 —— 层级缩进 + fallback 标记 质量门
 *
 * 验收基线（对应架构设计「熔断日志格式」）：
 * - 主请求无缩进（[Graph]/[Rest] 直打）
 * - fallback 请求 `↪` 前缀且前空 2 格（beginFallback → inFallback 层级）
 * - 时间戳含毫秒（YYYY-MM-DD HH:mm:ss:SSS）
 * - GraphQL 主请求含 vars；错误有单独 error 详情行
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  beginFallback,
  logGraphqlError,
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

describe("api-log 熔断日志（层级缩进 + fallback 标记）", () => {
  beforeEach(() => {
    // 日志仅 DEV 输出——测试环境默认 false，显式开启
    setApiLogDev(true);
  });

  afterEach(() => {
    setApiLogDev(false);
  });

  it("主请求（无 fallback）→ 无缩进，时间戳含毫秒", () => {
    const lines = capture(() => logMainRequest("graphql", "Viewer", 200, 32, 1024));
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3} \[Graph\] Viewer 200 1.0KB 32ms$/,
    );
    expect(lines[0]).not.toContain("↪");
  });

  it("fallback 中 → ↪ 前缀且前空 2 格", () => {
    const lines = capture(() => {
      const end = beginFallback();
      try {
        logMainRequest("rest", "GET /repos/a/b", 200, 32, 1024);
      } finally {
        end();
      }
    });
    // 时间戳前缀 + 缩进 + ↪ + [Rest]
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}\s+↪ \[Rest\] GET \/repos\/a\/b 200 1.0KB 32ms$/,
    );
  });

  it("嵌套 fallback → 深度递增（2 层 ↪ 前空 4 格）", () => {
    const lines = capture(() => {
      const end1 = beginFallback();
      const end2 = beginFallback();
      try {
        logMainRequest("rest", "GET /x", 200, 5);
      } finally {
        end2();
        end1();
      }
    });
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}\s+↪ \[Rest\] GET \/x 200 5ms$/,
    );
  });

  it("beginFallback 结束后 inFallback 归零（后续主请求无 ↪）", () => {
    const lines = capture(() => {
      const end = beginFallback();
      end();
      logMainRequest("graphql", "After", 200, 1);
    });
    expect(lines[0]).not.toContain("↪");
  });

  it("GraphQL 主请求日志含 vars", () => {
    const lines = capture(() =>
      logGraphqlMain("PullRequest", { owner: "a", number: 7 }, 200, 32, 512),
    );
    expect(lines[0]).toContain('[Graph] PullRequest | vars: {"owner":"a","number":7}');
    expect(lines[0]).toContain("200");
    expect(lines[0]).toContain("32ms");
  });

  it("GraphQL 错误详情行单独输出", () => {
    const lines = capture(() => logGraphqlError("PullRequest", "boom"));
    expect(lines[0]).toContain("[Graph] PullRequest | error: boom");
  });

  it("fallback 中 GraphQL 错误行也带 ↪", () => {
    const lines = capture(() => {
      const end = beginFallback();
      try {
        logGraphqlError("PullRequest", "boom");
      } finally {
        end();
      }
    });
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}\s+↪ \[Graph\] PullRequest \| error: boom/,
    );
  });
});
