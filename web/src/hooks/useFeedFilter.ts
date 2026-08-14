/**
 * Feed 动态类型过滤偏好 hook
 *
 * 首页动态（Feed）按事件类型勾选过滤，偏好保存（localStorage + 云同步）。
 * - 类型：star/fork/push/comment/release/issue/pr（对应 Events API 事件类型映射）
 * - 值约定：`pg-feed-filter` 存逗号分隔类型串（如 `star,fork`）；"all" / 缺省 = 全量勾选；
 *   空集合（全不选）按「全选」处理（无展示意义，且兼容旧版空 = 全选语义）
 * - 云同步：改动经 requestPrefsPush()，PREFS_SYNC_EVENT 后重读（与 useDateFormat 同模式）
 */
import { useEffect, useMemo, useState } from "react";
import { PREFS_SYNC_EVENT, requestPrefsPush } from "@/lib/auth/prefs-sync";

/** Feed 动态类型（Events API 事件类型映射；follow 无数据源不纳入） */
export type FeedFilterType = "star" | "fork" | "push" | "comment" | "release" | "issue" | "pr";

/** 全部类型（勾选列表 / URL 解析校验 / 偏好存储合法值集合；顺序 = 用户偏好展示序：标星、分支、推送、合并、发布、问题、评论） */
export const FEED_TYPES: readonly FeedFilterType[] = [
  "star",
  "fork",
  "push",
  "pr",
  "release",
  "issue",
  "comment",
];

const STORAGE_KEY = "pg-feed-filter";

/** 是否全选（空集合 = 全不选 = 按全选处理；或已勾满全部类型） */
export function isAllFeedTypes(types: FeedFilterType[]): boolean {
  return types.length === 0 || types.length >= FEED_TYPES.length;
}

/** 存储串 → 勾选集合（"all" / 缺省 / 非法值 → 全量勾选；逗号分隔 + 白名单过滤） */
export function parseFeedTypes(raw: string | null): FeedFilterType[] {
  if (!raw || raw === "all") return [...FEED_TYPES];
  const set = new Set<FeedFilterType>();
  for (const part of raw.split(",")) {
    const p = part.trim() as FeedFilterType;
    if (FEED_TYPES.includes(p)) set.add(p);
  }
  if (set.size === 0) return [...FEED_TYPES];
  return FEED_TYPES.filter((t) => set.has(t));
}

/** 勾选集合 → 存储串（全选/全不选 → "all"；其余逗号分隔，去重 + 白名单） */
export function serializeFeedTypes(types: FeedFilterType[]): string {
  const clean = [...new Set(types)].filter((t) => FEED_TYPES.includes(t));
  if (clean.length === 0 || clean.length >= FEED_TYPES.length) return "all";
  return clean.join(",");
}

/** 读本地偏好的勾选集合（默认全量勾选） */
function loadStoredFeedTypes(): FeedFilterType[] {
  try {
    return parseFeedTypes(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [...FEED_TYPES];
  }
}

export function useFeedFilter() {
  const [types, setTypes] = useState<FeedFilterType[]>(loadStoredFeedTypes);

  // 云端偏好同步后重读（换设备自动同步）
  useEffect(() => {
    const onSync = () => setTypes(loadStoredFeedTypes());
    window.addEventListener(PREFS_SYNC_EVENT, onSync);
    return () => window.removeEventListener(PREFS_SYNC_EVENT, onSync);
  }, []);

  /** 更新勾选（写本地 + 云同步；全选 → "all"） */
  const setFilter = (next: FeedFilterType[]) => {
    setTypes(next);
    try {
      localStorage.setItem(STORAGE_KEY, serializeFeedTypes(next));
    } catch {
      /* ignore */
    }
    requestPrefsPush();
  };

  /** 是否全选（空集合 = 全不选 = 按全选处理；或已勾满全部类型） */
  const isAll = useMemo(() => isAllFeedTypes(types), [types]);

  return { types, setFilter, isAll };
}
