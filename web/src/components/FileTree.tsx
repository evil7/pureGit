/**
 * 文件树组件（Code/tree/blob 页共享）
 *
 * - 目录点击 → 跳转 `/:owner/:repo/tree/:branch/:path`
 * - 文件点击 → 跳转 `/:owner/:repo/blob/:branch/:path`
 * - 当前路径高亮（选中态跟随路由）
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/file-tree";

/** 按关键词过滤树（路径包含匹配），保留匹配节点及其祖先 */
function filterTree(node: TreeNode, q: string): TreeNode | null {
  const nameMatch = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
  if (node.type === "blob") return nameMatch ? node : null;
  const children = [...node.children.values()]
    .map((c) => filterTree(c, q))
    .filter((c): c is TreeNode => c !== null);
  if (nameMatch || children.length > 0) {
    return { ...node, children: new Map(children.map((c) => [c.name, c])) };
  }
  return null;
}

/** 收集所有目录路径（过滤时全展开用） */
function collectAllTreePaths(node: TreeNode): string[] {
  const out: string[] = [];
  for (const child of node.children.values()) {
    if (child.type === "tree") {
      out.push(child.path, ...collectAllTreePaths(child));
    }
  }
  return out;
}

/**
 * 递归展开当前路径的祖先目录（供初始展开用）
 * currentPath 形如 "src/utils/foo.ts"
 */
function collectOpenPaths(root: TreeNode, currentPath: string): Set<string> {
  const open = new Set<string>([""]);
  if (!currentPath) return open;
  const parts = currentPath.split("/");
  let cur = root;
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const child = cur?.children.get(parts[i]);
    if (!child || child.type !== "tree") break;
    open.add(child.path);
    cur = child;
  }
  return open;
}

export function FileTree({
  root,
  currentPath,
  branch,
  filter = "",
}: {
  root: TreeNode;
  /** 当前高亮路径（相对仓库根，如 "src/utils"） */
  currentPath: string;
  /** 分支名，用于构造跳转链接 */
  branch: string;
  /** 过滤关键词（Go to file 实时过滤） */
  filter?: string;
}) {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(() => collectOpenPaths(root, currentPath));
  const q = filter.trim().toLowerCase();
  const shownRoot = useMemo(() => (q ? filterTree(root, q) : root), [root, q]);

  // 过滤时全展开匹配结果
  useEffect(() => {
    if (q) {
      setOpen(new Set(["", ...(shownRoot ? collectAllTreePaths(shownRoot) : [])]));
    }
  }, [q, shownRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // currentPath 变化时同步展开新目录
  const [lastPath, setLastPath] = useState(currentPath);
  if (lastPath !== currentPath) {
    setLastPath(currentPath);
    setOpen((prev) => new Set([...prev, ...collectOpenPaths(root, currentPath)]));
  }

  const toggle = (path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const render = (node: TreeNode, depth: number) => {
    const isDir = node.type === "tree";
    const isOpen = open.has(node.path);
    const isActive = node.path === currentPath;
    // 官方排序：目录在前 + 字母序（同 FileList）
    const sortedChildren = [...node.children.values()].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1,
    );
    return (
      <div key={node.path || "root"}>
        {node.name && (
          <button
            onClick={() => {
              // 官方 blob/edit 左树：点目录仅展开/收起（不导航，树内浏览）；点文件才跳 blob
              if (isDir) {
                toggle(node.path);
              } else {
                navigate(`/${owner}/${repo}/blob/${branch}/${node.path}`);
              }
            }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            title={node.path}
            aria-expanded={isDir ? isOpen : undefined}
          >
            {/* 展开箭头（官方：目录行 chevron 三角在图标左侧；文件行占位对齐） */}
            {isDir ? (
              isOpen ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground/70" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" />
              )
            ) : (
              <span className="size-3 shrink-0" aria-hidden />
            )}
            {isDir ? (
              isOpen ? (
                <FolderOpen className="size-4 shrink-0 text-sky-500" />
              ) : (
                <Folder className="size-4 shrink-0 text-sky-500" />
              )
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground/60" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {isDir && isOpen && <div>{sortedChildren.map((child) => render(child, depth + 1))}</div>}
      </div>
    );
  };

  if (!shownRoot) {
    return <p className="p-2 text-sm text-muted-foreground">无匹配文件</p>;
  }
  return <div className="space-y-0.5">{render(shownRoot, 0)}</div>;
}
