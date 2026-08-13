/**
 * API 调试工具 —— 智能请求器（schema 数据加载 + 缓存 + 预热）
 *
 * 统一管理 debug 页的 schema 数据获取，自动决策「用缓存还是拉新数据」（SWR）：
 * - **分层加载**：index.json（tag 骨架，首屏）→ tag 懒加载（req+res-min）→
 *   文档 drawer 按需（res-full）→ 后台预热全部 tag
 * - **缓存**：IndexedDB（解析态对象，供二次进入跳过 fetch+parse）；内存缓存
 *   加速会话内重复访问；**并发去重**（同 key 多组件请求合并为一次 fetch）
 * - **过期（TTL）**：默认 24h；命中过期 → 立即返回 stale（UI 不等待）+ 后台刷新
 *   新数据写回；`version`（转录脚本写入）变化 → 视为过期强制重拉
 * - **预热进度**：preloadAll 遍历 index.tags 逐个加载，经 onPreloadProgress 回调
 *   驱动左栏底部缓存进度条（后台任务视觉感知，不阻塞交互）
 *
 * 数据源：web/public/debug/（scripts/build-schemas-octokit.mjs 转录产物）——
 * rest/index.json + rest/<tag>.req/res-min/res-full.json + gql/schema.json。
 * 消费结构契约见 debug-openapi.ts / debug-graphql.ts。
 */
import type {
  RestIndex,
  RestReqFile,
  RestResMinFile,
  RestResFullFile,
  OpenApiGroup,
  OpenApiEndpoint,
} from "@/lib/debug/debug-openapi";
import { buildGroupFromTag, endpointToRequest } from "@/lib/debug/debug-openapi";
import { buildGqlSchemaFromIntrospection } from "@/lib/debug/debug-graphql";
import type { GraphQLSchema } from "graphql";

const REST_BASE = "/debug/rest";
const GQL_PATH = "/debug/gql/schema.json";
const GQL_INDEX_PATH = "/debug/gql/index.json";

/** 缓存默认 TTL（GitHub schema 更新节奏低，24h 足够） */
const DEFAULT_TTL = 24 * 3600 * 1000;

export type LoadSource = "cache" | "network" | "stale";

export interface LoadResult<T> {
  data: T;
  source: LoadSource;
}

/* ── IndexedDB 缓存（解析态对象；原始文本兜底） ───────────── */

interface CacheEntry<T = unknown> {
  /** 缓存的数据（对象或文本） */
  data: T;
  /** 写入时间戳（ms） */
  ts: number;
  /** 数据版本（转录版本；与 index.json version 比对，变化即过期） */
  version: string;
}

const DB_NAME = "puregit-debug-cache";
const DB_STORE = "schema";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try {
    const db = await idbOpen();
    return await new Promise<CacheEntry<T> | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const get = tx.objectStore(DB_STORE).get(key);
      get.onsuccess = () => resolve(get.result as CacheEntry<T> | undefined);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return undefined; // IndexedDB 不可用（隐私模式等）→ 退化为无缓存
  }
}

async function idbSet(key: string, entry: CacheEntry<unknown>): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(entry, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 写失败忽略（仅失去持久化） */
  }
}

/* ── 内存缓存 + 并发去重 ─────────────────────────────────── */

interface MemEntry<T> {
  data: T;
  ts: number;
  version: string;
}

const memCache = new Map<string, MemEntry<unknown>>();
const inflight = new Map<string, Promise<LoadResult<unknown>>>();

/* ── 预热进度事件 ────────────────────────────────────────── */

export interface PreloadProgress {
  done: number;
  total: number;
  /** 当前处理的 tag / 任务名 */
  label: string;
  /** 预热中（false = 过期刷新） */
  preload: boolean;
}

type ProgressListener = (p: PreloadProgress) => void;
const progressListeners = new Set<ProgressListener>();

/** 订阅后台任务进度（返回取消函数） */
export function onPreloadProgress(fn: ProgressListener): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function emitProgress(p: PreloadProgress): void {
  for (const fn of progressListeners) fn(p);
}

/* ── 核心请求器 ──────────────────────────────────────────── */

/**
 * 加载 JSON 的统一请求器（缓存优先 + TTL + SWR + 并发去重）：
 * - 内存命中且未过期 → cache
 * - IndexedDB 命中：未过期 → cache；过期 → 立即返回 stale + 后台刷新写回
 * - 无缓存 → fetch → 写缓存 → network；fetch 失败 → 返回 null 数据（调用方处理）
 */
function loadJson<T>(key: string, path: string, version: string): Promise<LoadResult<T>> {
  const hit = memCache.get(key);
  if (hit && !isExpired(hit)) {
    return Promise.resolve({ data: hit.data as T, source: "cache" });
  }
  const running = inflight.get(key);
  if (running) return running as Promise<LoadResult<T>>;

  const p = (async (): Promise<LoadResult<T>> => {
    const entry = await idbGet<unknown>(key);
    const now = Date.now();
    if (entry) {
      const expired = isExpired(entry) || entry.version !== version;
      if (!expired) {
        memCache.set(key, { data: entry.data, ts: entry.ts, version: entry.version });
        return { data: entry.data as T, source: "cache" };
      }
      // stale-while-revalidate：先给 stale，后台刷新（不阻塞调用方）
      void refresh(key, path, version);
      memCache.set(key, { data: entry.data, ts: now, version });
      return { data: entry.data as T, source: "stale" };
    }
    return refresh(key, path, version);
  })();
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  return p;
}

function isExpired(entry: { ts: number }): boolean {
  return Date.now() - entry.ts > DEFAULT_TTL;
}

/** 网络拉取 + 写内存/IndexedDB 缓存（SWR 后台刷新与首次加载共用） */
async function refresh<T>(key: string, path: string, version: string): Promise<LoadResult<T>> {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = (await res.json()) as T;
    const now = Date.now();
    memCache.set(key, { data, ts: now, version });
    void idbSet(key, { data, ts: now, version });
    return { data, source: "network" };
  } catch (e) {
    // 网络失败：若有 IndexedDB 旧数据（过期）则降级返回；否则抛错由调用方提示
    const entry = await idbGet<unknown>(key);
    if (entry) {
      memCache.set(key, { data: entry.data, ts: entry.ts, version: entry.version });
      return { data: entry.data as T, source: "stale" };
    }
    throw e;
  }
}

/* ── 公开 API（debug 页面各组件调用） ────────────────────── */

export function getRestVersion(): Promise<LoadResult<RestIndex>> {
  return loadJson<RestIndex>("rest:index", `${REST_BASE}/index.json`, "index");
}

/** 展开某 tag：req + res-min（集合树端点展示；res-full 单独懒加载） */
export async function loadRestTag(tag: string): Promise<LoadResult<OpenApiGroup>> {
  const [reqR, resMinR] = await Promise.all([
    loadJson<RestReqFile>(`rest:req:${tag}`, `${REST_BASE}/${tag}.req.json`, "rest"),
    loadJson<RestResMinFile>(`rest:res-min:${tag}`, `${REST_BASE}/${tag}.res-min.json`, "rest"),
  ]);
  const group = buildGroupFromTag(reqR.data, resMinR.data);
  const source: LoadSource =
    reqR.source === "network" || resMinR.source === "network" ? "network" : reqR.source;
  return { data: group, source };
}

/** 文档 drawer：某 tag 的响应完整 schema（按需，仅文档浏览） */
export function loadResFull(tag: string): Promise<LoadResult<RestResFullFile>> {
  return loadJson<RestResFullFile>(
    `rest:res-full:${tag}`,
    `${REST_BASE}/${tag}.res-full.json`,
    "rest",
  );
}

/* ── 全量端点索引（URL ↔ 端点匹配数据源，需求 5） ─────────── */

let allEndpoints: OpenApiEndpoint[] | null = null;
let allEndpointsLoading: Promise<OpenApiEndpoint[]> | null = null;

/**
 * 全量端点索引（遍历所有 tag 合并；并发去重 + 内存缓存）。
 * 预热完成后全部命中缓存（毫秒级）；首次调用会触发未缓存 tag 的 fetch。
 * 供 DebugPage 在 URL/method 变化时匹配端点文档。
 */
export function getAllEndpoints(): Promise<OpenApiEndpoint[]> {
  if (allEndpoints) return Promise.resolve(allEndpoints);
  if (allEndpointsLoading) return allEndpointsLoading;
  allEndpointsLoading = (async () => {
    const idx = await getRestVersion();
    const groups = await Promise.all(idx.data.tags.map((tag) => loadRestTag(tag.tag)));
    const eps = groups.flatMap((g) => g.data.items);
    allEndpoints = eps;
    return eps;
  })().finally(() => {
    allEndpointsLoading = null;
  });
  return allEndpointsLoading;
}

/** 端点点按 → 填充请求（复用 debug-openapi 的构造逻辑） */
export { endpointToRequest };

/* ── GraphQL schema 加载 ─────────────────────────────────── */

let gqlSchema: GraphQLSchema | null = null;

/** 数据源 npm 包版本（`graphql-schema@15.26.1`——第二行 hover 描述数据源） */
export function getGqlVersion(): Promise<LoadResult<{ version: string }>> {
  return loadJson<{ version: string }>("gql:index", GQL_INDEX_PATH, "gql");
}

/** 加载完整 GraphQL schema（introspection 原数据 → 运行时 schema）：
 * 内存命中直接返回；否则 IndexedDB 缓存原始 JSON 文本 → 重新 build（构建不可缓存，
 * class 实例不可结构化克隆）。完整 introspection 含 description（悬停文档数据）。 */
export async function loadGqlSchema(): Promise<GraphQLSchema> {
  if (gqlSchema) return gqlSchema;
  const { data } = await loadJson<unknown>("gql:schema", GQL_PATH, "gql");
  gqlSchema = buildGqlSchemaFromIntrospection(data as { __schema: unknown });
  return gqlSchema;
}

export function getCachedGqlSchema(): GraphQLSchema | null {
  return gqlSchema;
}

/** 手动清空 GraphQL schema（刷新时先清再加载） */
export function clearGqlSchema(): void {
  gqlSchema = null;
  memCache.delete("gql:schema");
}

/** R3/刷新：清空 REST 内存缓存（index + 各 tag + 全量端点索引）——强制下次加载走网络 */
export function clearRestCache(): void {
  for (const key of [...memCache.keys()]) {
    if (key.startsWith("rest:") || key === "rest:index") memCache.delete(key);
  }
  allEndpoints = null;
  allEndpointsLoading = null;
}

/** F13：本地快照的缓存时间戳（ms；-1 = 无缓存）——供「版本落后自动刷新」判断 */
export async function getGqlSchemaFetchedAt(): Promise<number> {
  const entry = await idbGet<unknown>("gql:schema");
  return entry?.ts ?? -1;
}

/** F13：在线 introspection 结果写缓存（登录态后台自动刷新）——
 * 覆盖 IndexedDB + 内存 + 运行时 schema（下次进入即用新快照）。
 * introspectionData = fetchGqlSchema 的原始 introspection JSON（{__schema}）。 */
export function saveGqlSchemaOnline(introspectionData: unknown): void {
  const now = Date.now();
  memCache.set("gql:schema", { data: introspectionData, ts: now, version: "gql" });
  void idbSet("gql:schema", { data: introspectionData, ts: now, version: "gql" });
  // 运行时 schema 同步更新（当前会话立即可用）
  try {
    gqlSchema = buildGqlSchemaFromIntrospection(introspectionData as { __schema: unknown });
  } catch {
    /* 在线数据异常 → 保持现状（下次进入回退旧缓存） */
  }
}

/* ── 后台预热（左栏底部缓存进度条数据源） ─────────────────── */

let preloading = false;

/**
 * 后台预热全部 tag（首屏后异步执行，不阻塞交互）：
 * 遍历 index.json 的 tag 清单逐个加载 req+res-min（写缓存），res-full 也一并预热
 * （文档 drawer 秒开）。进度经 onPreloadProgress 回调 → 左栏底部缓存进度条。
 * 已在预热中（并发进入）直接返回。
 */
export async function preloadAll(): Promise<void> {
  if (preloading) return;
  preloading = true;
  try {
    const idx = await getRestVersion();
    const tags = idx.data.tags;
    emitProgress({ done: 0, total: tags.length, label: tags[0]?.tag ?? "", preload: true });
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i].tag;
      emitProgress({ done: i, total: tags.length, label: tag, preload: true });
      try {
        await loadRestTag(tag);
        await loadResFull(tag);
      } catch {
        /* 单 tag 失败不中断预热（网络抖动容忍） */
      }
    }
    emitProgress({ done: tags.length, total: tags.length, label: "", preload: true });
  } finally {
    preloading = false;
  }
}
