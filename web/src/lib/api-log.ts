/**
 * API 请求日志工具（熔断友好 · 简洁格式 + fallback 序号关联）
 *
 * 设计目标：熔断切换时日志可一眼区分「主请求 / 降级触发 / 降级后的 REST 请求」。
 * - 简洁无复杂缩进：主请求无图标、降级触发打 `[Fallback#n]`、降级 REST 前缀 `↪`
 * - fallback 序号（#n）为**值传递**（进入降级链时同步递增），并发场景下仍能正确关联
 *   「哪次 GraphQL 降级触发了哪些 REST 请求」——不依赖全局可变状态判断，天然并发安全
 *
 * 日志格式：
 *   YYYY-MM-DD 12:23:34:123 [Graph] PullRequest | vars: {"aa":"bb"} error(1) 45B 32ms
 *   YYYY-MM-DD 12:23:34:125 [Fallback#3] fetchPullsSmart | error: Resource not found
 *   YYYY-MM-DD 12:23:34:126 ↪ [Rest] GET /repos/a/b/pulls 200 123KB 32ms
 *
 * 规则：
 * - 主请求（GraphQL 主通道 / 匿名 REST 直连）无图标
 * - 降级触发打 `[Fallback#n]` 行（含 error 详情；n 为 fallback 会话序号，递增）
 * - 降级后的 REST 请求前缀 `↪`（左右空格为图标间隔）
 * - 协议自动标注 [Graph] / [Rest]；时间戳含毫秒（性能对比）
 */
import type { ApiMode } from "./octokit";

/** fallback 会话序号（递增；值传递，并发安全） */
let fallbackSeq = 0;

/** 当前活动的 fallback 栈（压入/弹出保存旧值，正确处理嵌套降级链 GraphQL→REST→$raw） */
const fallbackStack: number[] = [];

/** 进入熔断降级链，返回 { id, end }——id 供 [Fallback#n] 关联，end 还原到进入前状态 */
export function beginFallback(): { id: number; end: () => void } {
  const id = ++fallbackSeq;
  fallbackStack.push(id);
  return { id, end: () => fallbackStack.pop() };
}

/** 当前是否处于熔断降级链中（true → REST 日志加 ↪ 图标） */
export function inFallback(): boolean {
  return fallbackStack.length > 0;
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

/** 字节 → 可读大小（<1KB 显示 B；≥1KB 显示 1 位小数 KB，strip 尾随 .0） */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = (bytes / 1024).toFixed(1);
  return `${kb.endsWith(".0") ? kb.slice(0, -2) : kb}KB`;
}

/** 协议标签（GraphQL → [Graph] / REST → [Rest]） */
const MODE_LABEL: Record<ApiMode, string> = { graphql: "Graph", rest: "Rest" };

/** error 对象 → 可读详情（string / Error.message / JSON 兜底） */
function errDetail(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err) ?? String(err);
}

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
 * 主请求日志（GraphQL 主通道 / 匿名 REST 直连）；处于降级链中时自动加 ↪ 图标。
 */
export function logMainRequest(
  mode: ApiMode,
  detail: string,
  status: number | string,
  ms: number,
  size?: number,
): void {
  if (!isDev()) return;
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  const icon = inFallback() ? "↪ " : "";
  console.log(`${ts()} ${icon}[${MODE_LABEL[mode]}] ${detail}${sizeStr} ${status} ${ms}ms`);
}

/**
 * GraphQL 主请求日志（含 vars 快照；status 为 HTTP 状态码或 error(n)/network-error 标记）。
 */
export function logGraphqlMain(
  name: string,
  variables: Record<string, unknown>,
  status: number | string,
  ms: number,
  size?: number,
): void {
  if (!isDev()) return;
  let vars = "";
  try {
    vars = ` | vars: ${JSON.stringify(variables)}`;
  } catch {
    /* ignore */
  }
  const sizeStr = size != null ? ` ${fmtSize(size)}` : "";
  console.log(`${ts()} [Graph] ${name}${vars}${sizeStr} ${status} ${ms}ms`);
}

/**
 * 降级触发日志（[Fallback#n] + error 详情）——GraphQL 失败即将走 REST 时打；
 * err 为空（如无具体错误）时省略 `| error:` 段。
 */
export function logFallback(name: string, err: unknown, id: number): void {
  if (!isDev()) return;
  const errStr = err != null ? ` | error: ${errDetail(err)}` : "";
  console.log(`${ts()} [Fallback#${id}] ${name}${errStr}`);
}

/**
 * 通用级别日志（[Error]/[Warn]/[Info]）——补充 catch 块中被静默吞掉的错误/信号，避免丢失调试信息。
 * 级别语义：
 * - [Error]：真实错误（fallback REST 也失败、HTTP 4xx/5xx、非预期异常）
 * - [Warn]：可预期/可恢复信号（网络错误触发熔断、静默降级返回空、补丁失败回退默认值）
 * - [Info]：一般信息（匿名短路降级、状态提示）
 */

/** 错误日志——真实错误（fallback 也失败、HTTP 4xx/5xx、非预期异常） */
export function logError(name: string, err: unknown): void {
  if (!isDev()) return;
  console.log(`${ts()} [Error] ${name} | error: ${errDetail(err)}`);
}

/** 警告日志——可预期/可恢复信号（熔断、静默降级、补丁回退默认） */
export function logWarn(name: string, msg: string): void {
  if (!isDev()) return;
  console.log(`${ts()} [Warn] ${name} | ${msg}`);
}

/** 信息日志——一般信息（匿名短路降级、状态提示） */
export function logInfo(name: string, msg: string): void {
  if (!isDev()) return;
  console.log(`${ts()} [Info] ${name} | ${msg}`);
}
