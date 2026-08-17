/**
 * 仓库信息上下文（独立文件：RepoLayout 与 StarForkButtons 共用，避免循环 import）
 *
 * - RepoLayout：Provider 提供仓库元数据（含 viewer star/watch 状态）+ update 局部更新
 * - StarForkButtons：优先读 context 初始状态，避免重复发 REST（/user/starred、/subscription）
 * - 子页面（RepoCode 等）：复用仓库元数据（default_branch 等）
 * - 设置页 Features 开关：PATCH 成功后经 update 同步 context → RepoHeader tabs 立即反映
 */
import { createContext, useContext } from "react";
import type { GitTree, Repository } from "../restapi";

export interface RepoDataValue {
  data: Repository | null;
  /** 局部更新仓库元数据（不触发重新拉取；如 Features 开关后同步 has_* → tabs 即时更新） */
  update: (patch: Partial<Repository>) => void;
}

/** 仓库信息上下文（供子页面复用仓库元数据 + 局部更新） */
export const RepoDataContext = createContext<RepoDataValue>({
  data: null,
  update: () => undefined,
});

/** 子页面读取仓库元数据（含 default_branch 与 viewer star/watch 状态） */
export function useRepoData(): Repository | null {
  return useContext(RepoDataContext).data;
}

/** 子页面局部更新仓库元数据（设置页 Features 开关同步 tabs 用） */
export function useRepoUpdate(): (patch: Partial<Repository>) => void {
  return useContext(RepoDataContext).update;
}

/**
 * 仓库文件树上下文（BlobPage 从树查文件 size 做通道门控）。
 * RepoCode 布局已拉取递归树（git/trees，GitTreeItem 自带 size），children 挂载时树必已就绪
 * （loading 期间 children 不渲染）——直接经 context 复用，避免 BlobPage 重复请求。
 */
export const RepoTreeContext = createContext<GitTree | null>(null);

/** 子页面读取仓库递归文件树（含每个 blob 的 size；null = 加载失败/未提供） */
export function useRepoTreeData(): GitTree | null {
  return useContext(RepoTreeContext);
}
