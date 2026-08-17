/**
 * ============================================================================
 * RepoCode 路径解析 单元测试 —— tree/blob 路径提取质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * `useMemoPath` 从路由 pathname 提取当前文件/目录路径（tree/blob 段），
 * 供文件树高亮与面包屑使用：
 * - `/owner/repo/tree/<branch>` → ""（仓库根）
 * - `/owner/repo/tree/<branch>/<path...>` → path（可多段）
 * - `/owner/repo/blob/<branch>/<path...>` → path
 * - 非 tree/blob 路由（issues 等）→ ""（无匹配）
 * - 分支名假设不含 `/`（GitHub 分支名可含 `/`，此时分支段被当路径——记录为已知行为边界）
 */
import { describe, it, expect } from "vitest";
import { parseTreePath, resolveBranchPath } from "@/lib/repo/repo-path";

describe("parseTreePath（tree/blob 路径提取）", () => {
  it("tree 分支根 → 空串", () => {
    expect(parseTreePath("/owner/repo/tree/main")).toBe("");
  });

  it("tree 单段路径 → 该段", () => {
    expect(parseTreePath("/owner/repo/tree/main/src")).toBe("src");
  });

  it("tree 多段路径 → 完整保留", () => {
    expect(parseTreePath("/owner/repo/tree/main/src/components/Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });

  it("blob 路径 → 完整保留（文件路径）", () => {
    expect(parseTreePath("/owner/repo/blob/main/README.md")).toBe("README.md");
    expect(parseTreePath("/owner/repo/blob/dev/docs/guide/getting-started.md")).toBe(
      "docs/guide/getting-started.md",
    );
  });

  it("非 tree/blob 路由 → 空串（无匹配）", () => {
    expect(parseTreePath("/owner/repo/issues")).toBe("");
    expect(parseTreePath("/owner/repo")).toBe("");
    expect(parseTreePath("/")).toBe("");
    expect(parseTreePath("")).toBe("");
  });

  it("tree/blob 之外的其他 /tree 前缀（如路径本身含 tree 目录）按路由语义解析", () => {
    // /owner/repo/tree/main/tree/ → 路径含名为 tree 的目录
    expect(parseTreePath("/owner/repo/tree/main/tree")).toBe("tree");
  });
});

describe("resolveBranchPath（分支名可含 /，按分支列表最长前缀匹配）", () => {
  const BRANCHES = ["main", "dev", "fix/webfuzz-chunked-request-body-echo", "feature/foo"];

  it("空 splat → 空 branch/path（由调用方回退 default_branch）", () => {
    expect(resolveBranchPath("", BRANCHES)).toEqual({ branch: "", path: "" });
  });

  it("单段分支根 → branch 命中、path 空", () => {
    expect(resolveBranchPath("main", BRANCHES)).toEqual({ branch: "main", path: "" });
  });

  it("单段分支 + 多段路径 → path 完整保留", () => {
    expect(resolveBranchPath("main/src/components/Button.tsx", BRANCHES)).toEqual({
      branch: "main",
      path: "src/components/Button.tsx",
    });
  });

  it("斜杠分支（整段即分支名）→ branch 完整命中、path 空", () => {
    expect(resolveBranchPath("fix/webfuzz-chunked-request-body-echo", BRANCHES)).toEqual({
      branch: "fix/webfuzz-chunked-request-body-echo",
      path: "",
    });
  });

  it("斜杠分支 + 路径 → 最长前缀匹配分支、余下为 path", () => {
    expect(resolveBranchPath("fix/webfuzz-chunked-request-body-echo/README.md", BRANCHES)).toEqual({
      branch: "fix/webfuzz-chunked-request-body-echo",
      path: "README.md",
    });
  });

  it("同名前缀分支取最长（fix 与 fix/xxx 并存时）", () => {
    const bs = ["fix", "fix/webfuzz-chunked-request-body-echo"];
    expect(resolveBranchPath("fix/webfuzz-chunked-request-body-echo/x", bs)).toEqual({
      branch: "fix/webfuzz-chunked-request-body-echo",
      path: "x",
    });
  });

  it("未命中分支列表 → 退化为首段 = branch（旧行为兜底）", () => {
    expect(resolveBranchPath("unknown-branch/a/b", BRANCHES)).toEqual({
      branch: "unknown-branch",
      path: "a/b",
    });
  });

  it("空分支列表 → 退化为首段 = branch", () => {
    expect(resolveBranchPath("main/a/b", [])).toEqual({ branch: "main", path: "a/b" });
  });
});
