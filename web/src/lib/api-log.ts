/**
 * API 请求日志工具（熔断友好 · 层级缩进 + fallback 标记）
 *
 * 设计目标：熔断切换时日志可一眼区分「主请求 / 熔断后请求」，视觉层级清晰。
 *
 * 日志格式：
 *   YYYY-MM-DD 12:23:34:123 [Graph] xxxQuery | vars: {"aa":"bb"}  500  123KB  32ms
 *   YYYY-MM-DD 12:23:34:123 [Graph] xxxQuery | error: {...}
 *   YYYY-MM-DD 12:23:34:123   ↪ [Rest] GET /repos/xxx/xxx  200  123KB  32ms
 *   YYYY-MM-DD 12:23:34:123   ↪ [Rest] GET /repos/xxx/xxx  200  123KB  32ms
 *
 * 规则：
 * - 主请求（GraphQL 主通道 / 匿名 REST 直连）无缩进
 * - 熔断 fallback 请求（GraphQL 失败 → REST 降级链）前缀 `↪` 且前空 2 格
 * - 协议自动标注 [Graph] / [Rest]
 * - 时间戳含毫秒（性能对比）
 * - GraphQL 主请求错误时单独打 error 详情行（完整 error 对象）
 */
import type { ApiMode } from "./octokit";

/** 熔断层级深度（主请求=0；每层 fallback 请求 +1）——支持嵌套降级链（GraphQL→REST→RAW 等） */
let fallbackDepth = 0;

/** 标记进入熔断降级链（GraphQL 失败即将走 REST 时调用，返回还原函数） */
export function beginFallback(): () => void {
  fallbackDepth++;
  return () => {
    if (fallbackDepth > 0) fallbackDepth--;
  };
}

/** 当前是否处于熔断降级链中（true → 日志加 ↪ 前缀） */
export function inFallback(): boolean {
  return fallbackDepth > 0;
}

/** 毫秒时间戳 → YYYY-MM-DD HH:mm:ss:SSS（当前时刻，含毫秒） */
function ts(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}:${p(d.getMilliseconds(), 3)}`
  );
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** 协议标签（GraphQL → [Graph] / REST → [Rest]） */
const MODE_LABEL: Record<ApiMode, string> = { graphql: "Graph", rest: "Rest" };

/** DEV 开关（默认取构建环境；测试可覆盖） */
let devEnabled = import.meta.env.DEV;

/** 测试/工具可覆盖 DEV（api-log.spec.ts 用） */
export function setApiLogDev(enabled: boolean): void {
  devEnabled = enabled;
}

function isDev(): boolean {
  return devEnabled;
}

/**
 * 打印主请求日志（GraphQL 主通道 / 匿名 REST 直连）
 */
export function logMainRequest(
  mode: ApiMode,
  detail: string,
  status: number | string,
  ms: number,
  size?: number,
): void {
  if (!isDev()) return;
  const indent = "  ".repeat(fallbackDepth);
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  const prefix = inFallback() ? `${indent}↪ ` : "";
  console.log(`${ts()} ${prefix}[${MODE_LABEL[mode]}] ${detail} ${status}${sizeStr} ${ms}ms`);
}

/**
 * 打印 GraphQL 主请求日志（含 vars + 错误详情）
 */
export function logGraphqlMain(
  name: string,
  variables: Record<string, unknown>,
  status: number | string,
  ms: number,
  size?: number,
): void {
  if (!isDev()) return;
  const indent = "  ".repeat(fallbackDepth);
  const prefix = inFallback() ? `${indent}↪ ` : "";
  let vars = "";
  try {
    vars = ` | vars: ${JSON.stringify(variables)}`;
  } catch {
    /* ignore */
  }
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  console.log(`${ts()} ${prefix}[Graph] ${name}${vars}${sizeStr} ${status} ${ms}ms`);
}

/**
 * 打印 GraphQL 错误详情行（单独一行，便于看完整 error 对象）
 */
export function logGraphqlError(
  name: string,
  err: unknown,
  status: number | string = "error",
): void {
  if (!isDev()) return;
  const indent = "  ".repeat(fallbackDepth);
  const prefix = inFallback() ? `${indent}↪ ` : "";
  const detail =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : (JSON.stringify(err) ?? String(err));
  console.log(`${ts()} ${prefix}[Graph] ${name} | error: ${detail} (${status})`);
}
