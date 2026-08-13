/**
 * 文件树构建与查询（独立文件：FileTree.tsx 是组件文件，fast refresh 要求只导出组件；
 * TreeNode/buildTree/useRepoTree 移到此处，FileEditorPage / RepoCode 等跨文件引用）
 */
import { useMemo } from "react";
import type { GitTreeItem } from "@/lib/restapi";

export interface TreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  children: Map<string, TreeNode>;
  size?: number;
}

/** 扁平树 → 嵌套树 */
export function buildTree(items: GitTreeItem[]): TreeNode {
  const root: TreeNode = { name: "", path: "", type: "tree", children: new Map() };
  for (const item of items) {
    if (item.type === "commit") continue;
    const parts = item.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? item.type : "tree",
          children: new Map(),
          size: isLast ? item.size : undefined,
        };
        node.children.set(part, child);
      }
      node = child;
    }
  }
  return root;
}

/** 过滤噪音目录，构建文件树 */
export function useRepoTree(tree: { tree: GitTreeItem[] } | null): TreeNode | null {
  return useMemo(() => {
    if (!tree) return null;
    const filtered = tree.tree.filter(
      (item) =>
        !item.path.startsWith("node_modules/") &&
        !item.path.startsWith(".git/") &&
        !item.path.startsWith("dist/") &&
        !item.path.startsWith("build/"),
    );
    return buildTree(filtered);
  }, [tree]);
}
