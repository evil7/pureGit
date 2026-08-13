/**
 * 文件树折叠状态（独立文件：RepoCode.tsx 是组件文件，fast refresh 要求只导出组件；
 * context/hook 移到此处，RepoCode 提供 Provider、BlobPage/TreePage 消费——
 * 官方折叠态：树按钮+分支+面包屑+Go to file 全部并入 sticky 单行，而非独立工具栏行）
 */
import { createContext, useContext } from "react";

export interface TreeCollapseCtxValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

export const TreeCollapseCtx = createContext<TreeCollapseCtxValue>({
  collapsed: false,
  setCollapsed: () => {},
});

/** 消费折叠态（BlobPage/TreePage 的 sticky 单行头部） */
export function useTreeCollapse(): TreeCollapseCtxValue {
  return useContext(TreeCollapseCtx);
}
