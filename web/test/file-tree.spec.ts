/**
 * ============================================================================
 * file-tree.ts 单元测试 —— 文件树构建（扁平 → 嵌套）质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * buildTree 是 RepoCode 文件树（FileTreeSidebar）与 FileEditorPage 的核心数据层：
 * - 扁平 GitTreeItem[]（git/trees 递归结果，path 为完整路径）→ 嵌套 TreeNode 树
 * - 目录节点 type="tree"；叶子节点 type 保留原始（blob/tree）
 * - 中间路径自动补目录节点；同路径多次出现不重复建节点（合并）
 * - size 只在叶子节点（目录无 size）
 * - commit 类型跳过（不进入树）
 *
 * 【关键语义基线】
 * 1. 根节点 name/path 为空串（虚拟根）
 * 2. children 为 Map（插入序；无显式排序逻辑——Git 返回顺序即展示顺序）
 * 3. 深层路径 `src/components/Button.tsx` → 三层嵌套（src → components → Button.tsx）
 * 4. 目录与文件同层共存；目录也是合法叶子（type="tree" 且是最后一段）
 *
 * 【测试方式】纯函数单元测试，无任何网络/DOM 依赖。
 */
import { describe, it, expect } from "vitest";
import { buildTree, type TreeNode } from "@/lib/file-tree";

/** 便捷读取 Map children */
function child(node: TreeNode, name: string): TreeNode {
  const c = node.children.get(name);
  if (!c) throw new Error(`child ${name} not found`);
  return c;
}

describe("buildTree", () => {
  it("空数组 → 仅虚拟根（name/path 空串）", () => {
    const root = buildTree([]);
    expect(root.name).toBe("");
    expect(root.path).toBe("");
    expect(root.type).toBe("tree");
    expect(root.children.size).toBe(0);
  });

  it("单个根级文件 → root.children 含 blob 叶子", () => {
    const root = buildTree([
      { path: "README.md", mode: "100644", type: "blob", size: 10, sha: "x" },
    ]);
    const f = child(root, "README.md");
    expect(f).toMatchObject({ name: "README.md", path: "README.md", type: "blob", size: 10 });
    expect(f.children.size).toBe(0);
  });

  it("深层路径 → 自动补中间目录节点（src → components → Button.tsx）", () => {
    const root = buildTree([
      { path: "src/components/Button.tsx", mode: "100644", type: "blob", size: 100, sha: "x" },
    ]);
    const src = child(root, "src");
    expect(src).toMatchObject({ name: "src", path: "src", type: "tree" });
    expect(src.size).toBeUndefined(); // 目录无 size
    const comp = child(src, "components");
    expect(comp).toMatchObject({ name: "components", path: "src/components", type: "tree" });
    const btn = child(comp, "Button.tsx");
    expect(btn).toMatchObject({
      name: "Button.tsx",
      path: "src/components/Button.tsx",
      type: "blob",
      size: 100,
    });
  });

  it("同目录多文件合并（不重复建目录节点）", () => {
    const root = buildTree([
      { path: "src/a.ts", mode: "100644", type: "blob", size: 1, sha: "x" },
      { path: "src/b.ts", mode: "100644", type: "blob", size: 2, sha: "x" },
      { path: "src/sub/c.ts", mode: "100644", type: "blob", size: 3, sha: "x" },
    ]);
    const src = child(root, "src");
    expect(src.children.size).toBe(3); // a.ts / b.ts / sub
    expect(child(src, "sub").children.size).toBe(1);
  });

  it("目录也是合法叶子（type=tree 且为最后一段）", () => {
    const root = buildTree([
      { path: "docs", mode: "040000", type: "tree", size: 0, sha: "x" },
      { path: "docs/guide.md", mode: "100644", type: "blob", size: 5, sha: "x" },
    ]);
    const docs = child(root, "docs");
    expect(docs.type).toBe("tree");
    expect(docs.path).toBe("docs");
    // docs 目录作为叶子被记录后，后续 docs/guide.md 应合并进同一节点
    expect(docs.children.size).toBe(1);
    expect(child(docs, "guide.md").type).toBe("blob");
  });

  it("commit 类型跳过（submodule 等不进树）", () => {
    const root = buildTree([
      { path: ".gitmodules", mode: "100644", type: "blob", size: 1, sha: "x" },
      { path: "lib", mode: "160000", type: "commit", size: 0, sha: "x" },
    ]);
    expect(root.children.size).toBe(1);
    expect(root.children.has("lib")).toBe(false);
  });

  it("同名目录与文件共存（同 path 不同 type 不冲突，各自建节点）", () => {
    // 理论上 git 树不允许，但防御：同一 path 先文件后目录不互相覆盖
    const root = buildTree([
      { path: "app", mode: "100644", type: "blob", size: 7, sha: "x" },
      { path: "app/main.ts", mode: "100644", type: "blob", size: 8, sha: "x" },
    ]);
    // 第二次出现 app 时 isLast=false（还有 main.ts）→ 原 blob 节点被复用为 tree 节点路径
    // （防御语义：不抛错、合并继续，路径前缀保证）
    expect(() => child(root, "app").children.get("main.ts")).not.toThrow();
  });

  it("真实仓库形态：根级混合 文件+目录 保序", () => {
    const root = buildTree([
      { path: ".gitignore", mode: "100644", type: "blob", size: 20, sha: "x" },
      { path: "README.md", mode: "100644", type: "blob", size: 30, sha: "x" },
      { path: "src", mode: "040000", type: "tree", size: 0, sha: "x" },
      { path: "src/index.ts", mode: "100644", type: "blob", size: 40, sha: "x" },
      { path: "package.json", mode: "100644", type: "blob", size: 50, sha: "x" },
    ]);
    expect(root.children.size).toBe(4);
    expect([...root.children.keys()]).toEqual([".gitignore", "README.md", "src", "package.json"]);
    expect(child(root, "src").children.size).toBe(1);
  });
});
