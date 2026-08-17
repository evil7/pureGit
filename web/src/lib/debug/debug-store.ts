/**
 * API 调试工具 —— Collection / History 本地持久化
 *
 * - Collection：预置模板（内省常用）+ 用户保存的命名请求（localStorage）
 * - History：执行历史（请求 + 结果摘要 + 身份 + 时间；上限 50 条，先进先出）
 * - 仅存请求描述与结果文本，**绝不存 token**（红线 1）
 */
import type { DebugRequest, DebugResult } from "./debug-api";
import { EMPTY_REQUEST, normalizeBodyType } from "./debug-api";

export interface CollectionItem {
  id: string;
  name: string;
  request: DebugRequest;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  request: DebugRequest;
  result: DebugResult;
  /** 执行时身份标识（anonymous / account:<login> / pat） */
  identity: string;
  createdAt: number;
}

const COLLECTION_KEY = "puregit_debug_collection";
const HISTORY_KEY = "puregit_debug_history";
const MAX_HISTORY = 50;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** 归一化持久化的请求（旧 bodyType "form" → "form-urlencoded"） */
function normalizeRequest(req: DebugRequest): DebugRequest {
  if (!req) return req;
  return { ...req, bodyType: normalizeBodyType(req.bodyType) };
}

/** 保存前脱敏：token 注入行 value 非占位（用户手输密钥）一律归一为占位 */
function sanitizeRequest(req: DebugRequest): DebugRequest {
  if (!req?.headers?.length) return req;
  const headers = req.headers.map((h) =>
    h.token && h.value && !h.value.startsWith("Bearer •")
      ? { ...h, value: "Bearer ••••••••••" }
      : h,
  );
  return { ...req, headers };
}

function save(key: string, items: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* 隐私模式等写失败忽略（仅失去持久化） */
  }
}

/* ── Collection ─────────────────────────────────────────────── */

/** 内省预置模板（新装即内置；用户可删） */
export const PRESET_COLLECTION: CollectionItem[] = [
  {
    id: "preset-schema",
    name: "__schema",
    request: {
      ...EMPTY_REQUEST,
      protocol: "graphql",
      method: "query",
      query: "query { __schema { queryType { name } mutationType { name } types { name kind } } }",
    },
    createdAt: 0,
  },
  {
    id: "preset-type-org",
    name: "__type(Organization)",
    request: {
      ...EMPTY_REQUEST,
      protocol: "graphql",
      method: "query",
      query:
        'query { __type(name: "Organization") { name fields { name type { kind name ofType { kind name ofType { name } } } } } }',
    },
    createdAt: 0,
  },
  {
    id: "preset-type-user",
    name: "__type(User)",
    request: {
      ...EMPTY_REQUEST,
      protocol: "graphql",
      method: "query",
      query:
        'query { __type(name: "User") { name fields { name type { kind name ofType { kind name ofType { name } } } } } }',
    },
    createdAt: 0,
  },
  {
    id: "preset-type-repo",
    name: "__type(Repository)",
    request: {
      ...EMPTY_REQUEST,
      protocol: "graphql",
      method: "query",
      query:
        'query { __type(name: "Repository") { name fields { name type { kind name ofType { kind name ofType { name } } } } } }',
    },
    createdAt: 0,
  },
  {
    id: "preset-viewer",
    name: "viewer",
    request: {
      ...EMPTY_REQUEST,
      protocol: "graphql",
      method: "query",
      query: "query { viewer { login name avatarUrl } }",
    },
    createdAt: 0,
  },
  {
    id: "preset-rest-repo",
    name: "REST /repos/{owner}/{repo}",
    request: {
      ...EMPTY_REQUEST,
      protocol: "rest",
      method: "GET",
      url: "/repos/{owner}/{repo}",
      bodyType: "none",
    },
    createdAt: 0,
  },
];

export function loadCollection(): CollectionItem[] {
  const saved = (load<CollectionItem>(COLLECTION_KEY) ?? []).map((i) => ({
    ...i,
    request: normalizeRequest(i.request),
  }));
  // 预置模板始终在前（用户删除后不再出现）
  const presetIds = new Set(saved.map((s) => s.id));
  const presets = PRESET_COLLECTION.filter((p) => !presetIds.has(p.id));
  return [...presets, ...saved];
}

export function addCollectionItem(name: string, request: DebugRequest): CollectionItem {
  const item: CollectionItem = {
    id: uid(),
    name,
    request: sanitizeRequest(request),
    createdAt: Date.now(),
  };
  save(COLLECTION_KEY, [...load<CollectionItem>(COLLECTION_KEY), item]);
  return item;
}

export function removeCollectionItem(id: string): void {
  save(
    COLLECTION_KEY,
    load<CollectionItem>(COLLECTION_KEY).filter((i) => i.id !== id),
  );
}

/* ── History ────────────────────────────────────────────────── */

export function loadHistory(): HistoryItem[] {
  return (load<HistoryItem>(HISTORY_KEY) ?? []).map((i) => ({
    ...i,
    request: normalizeRequest(i.request),
  }));
}

export function addHistoryItem(request: DebugRequest, result: DebugResult, identity: string): void {
  const item: HistoryItem = {
    id: uid(),
    request: sanitizeRequest(request),
    result,
    identity,
    createdAt: Date.now(),
  };
  const next = [item, ...load<HistoryItem>(HISTORY_KEY)].slice(0, MAX_HISTORY);
  save(HISTORY_KEY, next);
}

export function removeHistoryItem(id: string): void {
  save(
    HISTORY_KEY,
    load<HistoryItem>(HISTORY_KEY).filter((i) => i.id !== id),
  );
}

export function clearHistory(): void {
  save(HISTORY_KEY, []);
}
