/**
 * ============================================================================
 * diff-lines.ts 单元测试 —— DiffView 数据层（unified diff 解析 + 行号推导）质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * DiffView 是 PR 变更文件查看核心组件，其数据层（diff-lines.ts）负责：
 * - parsePatch：解析 REST patch 的 unified diff 文本 → 渲染行列表。
 *   行号必须从 hunk 头 `@@ -oldStart[,oldCount] +newStart[,newCount] @@` 推导：
 *   del 消耗旧行号 / add 消耗新行号 / ctx 双消耗 / hunk 行重置游标 / EOF 空行 → empty。
 * - diffLinesToRows：jsdiff 全量对比（Expand 上下文）→ 完整 DiffRow 列表（含全部上下文行）。
 *
 * 【关键语义基线】
 * 1. hunk 头 `@@ -1,3 +4,2 @@` → oldStart=1 / newStart=4（行号从 hunk 头重置，忽略 count）
 * 2. `+`/`-`/` ` 前缀剥离（slice(1)）；`\ No newline at end of file` 行以 `\` 开头 → 落入 empty
 * 3. patch 尾随换行产生的末尾空串 → empty 行（EOF 段）
 * 4. diffLinesToRows 行号从头（1）推导，类型映射 removed→del / added→add / both→ctx
 *
 * 【测试方式】纯函数单元测试，无任何网络/DOM 依赖。
 */
import { describe, it, expect } from "vitest";
import { parsePatch, diffLinesToRows } from "@/lib/diff-lines";

describe("parsePatch", () => {
  it("undefined / 空串 → 空数组", () => {
    expect(parsePatch(undefined)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });

  it("单 hunk + 增删改：行号自 hunk 头推导", () => {
    // @@ -1,3 +1,3 @@
    //  ctx: old1/new1
    // -del: old2
    // +add: new2
    //  ctx: old3/new3（末尾无换行，无 EOF empty）
    const patch = "@@ -1,3 +1,3 @@\n context\n-old\n+new\n context";
    const rows = parsePatch(patch);
    expect(rows).toEqual([
      { type: "hunk", hunkHeader: "@@ -1,3 +1,3 @@" },
      { type: "ctx", oldLine: 1, newLine: 1, oldContent: "context", newContent: "context" },
      { type: "del", oldLine: 2, oldContent: "old" },
      { type: "add", newLine: 2, newContent: "new" },
      { type: "ctx", oldLine: 3, newLine: 3, oldContent: "context", newContent: "context" },
    ]);
  });

  it("多 hunk：第二个 hunk 重置行号游标", () => {
    // 第一个 hunk 结束后旧游标=2，第二个 hunk @@ -10,2 +20,2 @@ 应重置
    const patch = "@@ -1,1 +1,1 @@\n a\n@@ -10,2 +20,2 @@\n b\n c\n";
    const rows = parsePatch(patch);
    expect(rows[0]).toEqual({ type: "hunk", hunkHeader: "@@ -1,1 +1,1 @@" });
    expect(rows[1]).toEqual({
      type: "ctx",
      oldLine: 1,
      newLine: 1,
      oldContent: "a",
      newContent: "a",
    });
    expect(rows[2]).toEqual({ type: "hunk", hunkHeader: "@@ -10,2 +20,2 @@" });
    // 第二个 hunk 的 ctx 从 10/20 开始（重置生效）
    expect(rows[3]).toEqual({
      type: "ctx",
      oldLine: 10,
      newLine: 20,
      oldContent: "b",
      newContent: "b",
    });
    expect(rows[4]).toEqual({
      type: "ctx",
      oldLine: 11,
      newLine: 21,
      oldContent: "c",
      newContent: "c",
    });
  });

  it("无 count 的 hunk 头（@@ -1 +1 @@）同样解析", () => {
    const rows = parsePatch("@@ -1 +1 @@\n+new\n");
    expect(rows[0]).toEqual({ type: "hunk", hunkHeader: "@@ -1 +1 @@" });
    expect(rows[1]).toEqual({ type: "add", newLine: 1, newContent: "new" });
  });

  it("新增文件（+ 开头）hunk：add 行号从 1 递增", () => {
    const rows = parsePatch("@@ -0,0 +1,2 @@\n+line1\n+line2\n");
    expect(rows[1]).toEqual({ type: "add", newLine: 1, newContent: "line1" });
    expect(rows[2]).toEqual({ type: "add", newLine: 2, newContent: "line2" });
  });

  it("删除文件：del 行号从 1 递增", () => {
    const rows = parsePatch("@@ -1,2 +0,0 @@\n-gone1\n-gone2\n");
    expect(rows[1]).toEqual({ type: "del", oldLine: 1, oldContent: "gone1" });
    expect(rows[2]).toEqual({ type: "del", oldLine: 2, oldContent: "gone2" });
  });

  it("patch 尾随换行的 EOF 空行 → empty 行", () => {
    const rows = parsePatch("@@ -1,1 +1,1 @@\n a\n\n");
    const last = rows[rows.length - 1];
    expect(last.type).toBe("empty");
  });

  it("No newline 标记行（\\ 开头）→ empty 行（不入旧/新行号）", () => {
    const rows = parsePatch(
      "@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file",
    );
    const emptyCount = rows.filter((r) => r.type === "empty").length;
    expect(emptyCount).toBe(2);
    // 行号不受 empty 影响：del old1、add new1
    expect(rows.find((r) => r.type === "del")).toEqual({
      type: "del",
      oldLine: 1,
      oldContent: "old",
    });
    expect(rows.find((r) => r.type === "add")).toEqual({
      type: "add",
      newLine: 1,
      newContent: "new",
    });
  });
});

describe("diffLinesToRows（jsdiff 全量对比）", () => {
  it("相同文本 → 全部 ctx，行号 1..n 双对齐", () => {
    const rows = diffLinesToRows("a\nb\nc", "a\nb\nc");
    expect(rows).toEqual([
      { type: "ctx", oldLine: 1, newLine: 1, oldContent: "a", newContent: "a" },
      { type: "ctx", oldLine: 2, newLine: 2, oldContent: "b", newContent: "b" },
      { type: "ctx", oldLine: 3, newLine: 3, oldContent: "c", newContent: "c" },
    ]);
  });

  it("中间新增 → add 行，上下文行号对齐", () => {
    const rows = diffLinesToRows("a\nb", "a\nX\nb");
    expect(rows.filter((r) => r.type === "add")).toEqual([
      { type: "add", newLine: 2, newContent: "X" },
    ]);
    // 第一行 ctx 双 1；b 行：旧 2 新 3
    expect(rows.find((r) => r.type === "ctx" && r.oldContent === "a")).toEqual({
      type: "ctx",
      oldLine: 1,
      newLine: 1,
      oldContent: "a",
      newContent: "a",
    });
    expect(rows.find((r) => r.type === "ctx" && r.newContent === "b")).toEqual({
      type: "ctx",
      oldLine: 2,
      newLine: 3,
      oldContent: "b",
      newContent: "b",
    });
  });

  it("删除行 → del，上下文行号对齐", () => {
    const rows = diffLinesToRows("a\nX\nb", "a\nb");
    expect(rows.filter((r) => r.type === "del")).toEqual([
      { type: "del", oldLine: 2, oldContent: "X" },
    ]);
    expect(rows.find((r) => r.type === "ctx" && r.newContent === "b")).toEqual({
      type: "ctx",
      oldLine: 3,
      newLine: 2,
      oldContent: "b",
      newContent: "b",
    });
  });

  it("全替换 → del 块 + add 块（行号各自连续）", () => {
    const rows = diffLinesToRows("old1\nold2", "new1");
    expect(rows.filter((r) => r.type === "del")).toEqual([
      { type: "del", oldLine: 1, oldContent: "old1" },
      { type: "del", oldLine: 2, oldContent: "old2" },
    ]);
    expect(rows.filter((r) => r.type === "add")).toEqual([
      { type: "add", newLine: 1, newContent: "new1" },
    ]);
  });

  it("空旧文本 + 新文本 → 全 add（从 1 开始）", () => {
    const rows = diffLinesToRows("", "a\nb");
    expect(rows.map((r) => r.type)).toEqual(["add", "add"]);
    expect(rows[0]).toEqual({ type: "add", newLine: 1, newContent: "a" });
    expect(rows[1]).toEqual({ type: "add", newLine: 2, newContent: "b" });
  });
});
