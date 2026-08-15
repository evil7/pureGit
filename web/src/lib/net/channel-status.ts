/**
 * 通道状态跟踪（footer 状态灯数据源）。
 *
 * 记录「最近一次请求实际命中的服务通道」（GraphQL / REST / jsDelivr CDN / raw 直连 / Worker 代理），
 * 供 footer 状态灯实时展示——替代原先只标识「GitHub API 可用性」的单一指示灯，
 * 让省流方案实际走了哪条通道对用户可见。
 *
 * 全局单例（内存变量 + 订阅），各请求层命中时 reportChannel，footer subscribeChannel 订阅刷新。
 */
export type ChannelKind = "graphql" | "rest" | "jsdelivr" | "raw" | "worker";

let current: ChannelKind | null = null;
const listeners = new Set<() => void>();

/** 上报最近命中通道（同通道去重，避免无谓刷新） */
export function reportChannel(kind: ChannelKind): void {
  if (current === kind) return;
  current = kind;
  for (const cb of listeners) cb();
}

/** 读取最近命中通道（null = 尚无请求） */
export function getChannel(): ChannelKind | null {
  return current;
}

/** 订阅通道变化；返回退订函数 */
export function subscribeChannel(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
