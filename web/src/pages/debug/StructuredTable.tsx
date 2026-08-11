/**
 * StructuredTable —— M5.5 结构驱动递归表格（GraphQL input/列表变量编辑器）
 *
 * 替代 GqlVariablesPanel 的 input/列表变量「JSON 字面量手写」：
 * - **input** → 缩进子表格（字段行：checkbox + 名称/类型胶囊 + 值控件递归）
 * - **list** → 数组编辑器（[+ 添加] 项；元素 input → 子表格、标量 → 输入框）
 * - **scalar/enum/boolean** → 输入框 / 下拉（对齐 GqlVariablesPanel 行值惯例）
 *
 * 数据模型 lib/debug-gql-structured.ts（StructuredField/StructuredRow 纯函数）：
 * - 结构由 GraphQLInputType 递归展开（inputTypeToStructured）
 * - 编辑回调不可变更新（onChange 上抛整棵新行），父组件序列化 → JSON
 * - 默认值不在此填充（忠实还原）；placeholder 提示默认值/类型
 *
 * 组件只做渲染 + 不可变更新，无状态逻辑（可测逻辑全在 lib）。
 */
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StructuredRow } from "@/lib/debug-gql-structured";

interface StructuredTableProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  /** 当前行（kind=input 或 list——由调用方保证） */
  row: StructuredRow;
  /** 不可变更新：整棵新行上抛（父组件序列化写 variables） */
  onChange: (next: StructuredRow) => void;
  /** 缩进层级（视觉递进；顶层 = 0） */
  depth?: number;
}

/** 字段默认值 → 输入框 placeholder（提示用户可留空或用默认值） */
function fieldPlaceholder(f: StructuredRow["field"]): string {
  if (f.defaultValue !== undefined) {
    const d = typeof f.defaultValue === "string" ? f.defaultValue : JSON.stringify(f.defaultValue);
    return `${d}`;
  }
  if (f.kind === "scalar") {
    if (f.scalarName === "Int" || f.scalarName === "Float") return "123";
    if (f.scalarName === "Boolean") return "";
    return "值";
  }
  return "";
}

/** 标量/枚举/布尔 → 值控件（输入框 / 下拉） */
function LeafValue({ row, onChange }: { row: StructuredRow; onChange: (v: string) => void }) {
  const f = row.field;
  if (f.kind === "enum" || f.kind === "boolean") {
    const opts = f.kind === "enum" ? (f.enumValues ?? []) : ["true", "false"];
    return (
      <Select value={row.value} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-full font-mono text-xs">
          <SelectValue placeholder="…" />
        </SelectTrigger>
        <SelectContent>
          {opts.map((v) => (
            <SelectItem key={v} value={v} className="font-mono text-xs">
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      value={row.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={fieldPlaceholder(f)}
      className="h-7 w-full font-mono text-xs"
    />
  );
}

/**
 * 递归行编辑器：input → 子表格（children 字段行）；list → 数组项容器；
 * scalar/enum/boolean → LeafValue。所有编辑经不可变更新上抛。
 */
function RowEditor({ row, onChange, t, depth }: StructuredTableProps) {
  const f = row.field;

  // ── list：数组编辑器 ──
  if (f.kind === "list") {
    const el = f.element;
    const addItem = () => {
      if (!el) return;
      // 新项：input 元素 → 骨架 children；标量 → 空值项行
      const item: StructuredRow =
        el.kind === "input"
          ? {
              field: el,
              value: "",
              enabled: true,
              children: el.fields.map((ff) => ({
                field: ff,
                value: ff.defaultValue !== undefined ? String(ff.defaultValue) : "",
                enabled: true,
                children: [],
                items: [],
              })),
              items: [],
            }
          : { field: el, value: "", enabled: true, children: [], items: [] };
      onChange({ ...row, items: [...row.items, el.kind === "input" ? item.children : [item]] });
    };
    const removeItem = (i: number) => {
      onChange({ ...row, items: row.items.filter((_, xi) => xi !== i) });
    };
    return (
      <div className="flex flex-col gap-1" style={{ paddingLeft: depth ? 12 : 0 }}>
        {row.items.map((item, i) => {
          const itemRow: StructuredRow =
            el?.kind === "input"
              ? { field: el, value: "", enabled: true, children: item, items: [] }
              : item[0];
          return (
            <div key={i} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                {el?.kind === "input" ? (
                  <RowEditor
                    t={t}
                    row={itemRow}
                    onChange={(next) =>
                      onChange({
                        ...row,
                        items: row.items.map((it, xi) => (xi === i ? next.children : it)),
                      })
                    }
                    depth={(depth ?? 0) + 1}
                  />
                ) : (
                  <LeafValue
                    row={itemRow}
                    onChange={(v) =>
                      onChange({
                        ...row,
                        items: row.items.map((it, xi) =>
                          xi === i ? [{ ...itemRow, value: v }] : it,
                        ),
                      })
                    }
                  />
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="mt-0.5 h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeItem(i)}
                title={t("history.delete")}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            size="xs"
            variant="outline"
            className="h-6 gap-0.5 px-2 text-[11px]"
            onClick={addItem}
          >
            <Plus className="size-3" />
            添加
          </Button>
        </div>
      </div>
    );
  }

  // ── input：子表格（children 字段行递归） ──
  if (f.kind === "input") {
    const updateChild = (i: number, next: StructuredRow) => {
      onChange({ ...row, children: row.children.map((c, xi) => (xi === i ? next : c)) });
    };
    return (
      <div
        className="rounded-md border border-border/60 bg-background/60"
        style={{ marginLeft: depth ? 8 : 0 }}
      >
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-8" />
            <col className="w-2/5" />
            <col />
          </colgroup>
          <tbody>
            {row.children.map((child, i) => (
              <tr key={`${child.field.name}:${i}`} className="border-b last:border-b-0">
                <td className="py-0.5 pl-2 pr-1">
                  <input
                    type="checkbox"
                    checked={child.enabled !== false || child.field.required}
                    disabled={child.field.required}
                    onChange={(e) => updateChild(i, { ...child, enabled: e.target.checked })}
                    className="size-3.5"
                    title={child.field.required ? t("variables.required") : t("headers.enabled")}
                  />
                </td>
                <td className="py-0.5 pr-1.5">
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "truncate font-mono text-[11px]",
                        child.field.required
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                      title={child.field.description}
                    >
                      {child.field.name}
                      {/* 必填星号：红色强调（与名称/胶囊色区分） */}
                      {child.field.required && (
                        <span className="text-destructive" aria-hidden>
                          {" "}
                          *
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 font-mono text-[9px] leading-4",
                        child.field.required
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground",
                      )}
                      title={child.field.typeLabel}
                    >
                      {child.field.kind === "input"
                        ? child.field.typeLabel
                        : child.field.typeLabel.replace(/[![\]]/g, "")}
                    </span>
                  </div>
                </td>
                <td className="py-0.5 pr-2">
                  <RowEditor
                    t={t}
                    row={child}
                    onChange={(next) => updateChild(i, next)}
                    depth={(depth ?? 0) + 1}
                  />
                </td>
              </tr>
            ))}
            {row.children.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-1 text-[10px] text-muted-foreground">
                  （空 input）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // ── scalar/enum/boolean：值控件 ──
  return <LeafValue row={row} onChange={(v) => onChange({ ...row, value: v })} />;
}

/** 顶层入口：渲染 input/list 行的结构化子表格 */
export function StructuredTable({ t, row, onChange, depth = 0 }: StructuredTableProps) {
  return <RowEditor t={t} row={row} onChange={onChange} depth={depth} />;
}
