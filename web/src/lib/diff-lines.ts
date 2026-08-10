/**
 * unified diff 解析 → 3 列表格渲染行（DiffView 重构）
 *
 * REST patch 只给统一 diff 文本（无行号），行号须从 hunk 头推导：
 *   `@@ -oldStart,oldCount +newStart,newCount @@`
 * 逐行推进：del 消耗旧行号 / add 消耗新行号 / ctx 双消耗。
 *
 * 另提供 jsdiff 全量对比（Expand 上下文用）：diffLines(baseRaw, headRaw)
 * → 完整 DiffRow 列表（含全部上下文行）。
 */
import { diffLines } from "diff";

export type DiffRowType = "hunk" | "add" | "del" | "ctx" | "empty";

export interface DiffRow {
  type: DiffRowType;
  /** 旧行号（del/ctx 有值） */
  oldLine?: number;
  /** 新行号（add/ctx 有值） */
  newLine?: number;
  /** 旧列内容（del/ctx） */
  oldContent?: string;
  /** 新列内容（add/ctx） */
  newContent?: string;
  /** hunk 头原始文本（type=hunk） */
  hunkHeader?: string;
}

/** hunk 头正则：@@ -oldStart[,oldCount] +newStart[,newCount] @@ */
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * 解析 unified diff patch → 渲染行列表（行号自 hunk 头推导）。
 * patch 尾部无换行的最后一行也会被处理（split 产生空串需过滤 EOF 段）。
 */
export function parsePatch(patch: string | undefined): DiffRow[] {
  if (!patch) return [];
  const rows: DiffRow[] = [];
  let oldCursor = 0;
  let newCursor = 0;

  const lines = patch.split("\n");
  // patch 通常以单个换行结束 → split 末尾空串（EOF 标记）跳过
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(HUNK_RE);
      if (m) {
        oldCursor = Number(m[1]);
        newCursor = Number(m[2]);
      }
      rows.push({ type: "hunk", hunkHeader: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ type: "add", newLine: newCursor, newContent: line.slice(1) });
      newCursor++;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ type: "del", oldLine: oldCursor, oldContent: line.slice(1) });
      oldCursor++;
      continue;
    }
    if (line.startsWith(" ")) {
      rows.push({
        type: "ctx",
        oldLine: oldCursor,
        newLine: newCursor,
        oldContent: line.slice(1),
        newContent: line.slice(1),
      });
      oldCursor++;
      newCursor++;
      continue;
    }
    // 空行 / EOF
    rows.push({ type: "empty" });
  }
  return rows;
}

/**
 * jsdiff 全量行对比（Expand 上下文用）：旧文件 vs 新文件 → DiffRow 列表。
 * 输出整文件（含全部上下文行），行号从头推导，类型映射：
 *   removed → del / added → add / both → ctx
 */
export function diffLinesToRows(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldCursor = 1;
  let newCursor = 1;

  for (const part of parts) {
    const isDel = part.removed === true;
    const isAdd = part.added === true;
    if (isDel && isAdd) continue; // 理论上不会同时
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const line of lines) {
      if (isDel) {
        rows.push({ type: "del", oldLine: oldCursor, oldContent: line });
        oldCursor++;
      } else if (isAdd) {
        rows.push({ type: "add", newLine: newCursor, newContent: line });
        newCursor++;
      } else {
        rows.push({
          type: "ctx",
          oldLine: oldCursor,
          newLine: newCursor,
          oldContent: line,
          newContent: line,
        });
        oldCursor++;
        newCursor++;
      }
    }
  }
  return rows;
}
