/**
 * K/V 表格（请求头 / form-urlencoded / form-data 共用）
 * 用真实 `<table>` 布局（colgroup 定列宽比例）：
 * [checkbox] [key] [value] [操作]，所有行（锁定/编辑/添加）列宽自动一致对齐。
 * - required：锁定行（必填请求头自动填充；checkbox 恒开、不可编辑/删除）——操作列以 Lock 图标占位
 * - token 行（Authorization）：key 固定只读；value 为空时框内靠右显示 Key 图标（点击填充已登录 token 占位），
 *   填充后图标变 Trash（点击清空还原），可任意手输；行尾 X 照常删除（匿名）
 * - fileMode（form-data）：Value 单元格内 Upload 前缀 icon（视觉一致）——
 *   可正常输入文本，也可点 icon 上传文件（选文件后 value 显示文件名并记录 File）
 * - + 添加按钮位于表格最底部一行、**靠左**；删除经 onDeleteRow 回调（文件索引同步）
 */
import { useRef } from "react";
import { KeyRound, Lock, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { HeaderRow } from "@/lib/debug-api";

export function KeyValueTable({
  rows,
  onChange,
  required,
  fileMode,
  onFileChange,
  onDeleteRow,
  onAddRow,
  keyPlaceholder,
  valuePlaceholder,
  enabledTitle,
  deleteTitle,
  addTitle,
  lockTitle,
  uploadTitle,
  fileHint,
  tokenValue,
  fillTokenTitle,
  clearTokenTitle,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  required?: HeaderRow[];
  fileMode?: boolean;
  onFileChange?: (index: number, file: File | null) => void;
  onDeleteRow: (index: number) => void;
  onAddRow: () => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  enabledTitle: string;
  deleteTitle: string;
  addTitle: string;
  lockTitle: string;
  uploadTitle?: string;
  fileHint?: string;
  /** token 行占位文本（点击 Key 填充） */
  tokenValue?: string;
  fillTokenTitle?: string;
  clearTokenTitle?: string;
}) {
  // 隐藏文件输入 ref（按行索引；点 Upload icon 触发）
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <div>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {/* 列宽自动控制：checkbox（24px 槽居中，与添加按钮同宽对齐）/ key / value / 操作 */}
          <col className="w-11" />
          <col className="w-1/3" />
          <col />
          <col className="w-7" />
        </colgroup>
        <tbody>
          {/* 必填锁定行（不可修改；操作列 Lock 图标占位） */}
          {required &&
            required.length > 0 &&
            required.map((h, i) => (
              <tr key={`req-${i}`} className="border-b bg-muted/30 last:border-b-0">
                <td className="py-1 pl-3 pr-2">
                  {/* 24px 槽居中：与底部添加按钮（同宽同起点）中心对齐 */}
                  <div className="flex h-6 w-6 items-center justify-center">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="size-3.5"
                      title={enabledTitle}
                    />
                  </div>
                </td>
                <td className="py-1 pr-1.5">
                  <Input value={h.key} readOnly className="h-7 w-full font-mono text-xs" />
                </td>
                <td className="py-1 pr-1.5">
                  <Input value={h.value} readOnly className="h-7 w-full font-mono text-xs" />
                </td>
                <td className="py-1 pr-3">
                  <div
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                    title={lockTitle}
                  >
                    <Lock className="size-3.5" />
                  </div>
                </td>
              </tr>
            ))}
          {/* 用户可编辑行 */}
          {rows.length > 0 &&
            rows.map((h, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-1 pl-3 pr-2">
                  {/* 24px 槽居中：与底部添加按钮（同宽同起点）中心对齐 */}
                  <div className="flex h-6 w-6 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={h.enabled !== false}
                      onChange={(e) =>
                        onChange(
                          rows.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x)),
                        )
                      }
                      className="size-3.5"
                      title={enabledTitle}
                    />
                  </div>
                </td>
                <td className="py-1 pr-1.5">
                  <Input
                    value={h.key}
                    onChange={(e) =>
                      onChange(rows.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)))
                    }
                    placeholder={keyPlaceholder}
                    readOnly={h.token}
                    className="h-7 w-full font-mono text-xs"
                  />
                </td>
                <td className="py-1 pr-1.5">
                  {h.token ? (
                    /* token 行：value 框内靠右 Key/Trash 切换按钮；
                       占位态（Bearer • 开头）只读，必须先清空才能手动编辑 */
                    <div className="relative">
                      <Input
                        value={h.value}
                        onChange={(e) =>
                          onChange(
                            rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                        placeholder={valuePlaceholder}
                        readOnly={h.value.startsWith("Bearer •")}
                        className={cn(
                          "h-7 w-full pr-7 font-mono text-xs",
                          h.value.startsWith("Bearer •") &&
                            "cursor-not-allowed text-muted-foreground opacity-80",
                        )}
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          onChange(
                            rows.map((x, xi) =>
                              xi === i ? { ...x, value: h.value ? "" : (tokenValue ?? "") } : x,
                            ),
                          )
                        }
                        title={h.value ? clearTokenTitle : fillTokenTitle}
                      >
                        {h.value ? (
                          <Trash2 className="size-3.5" />
                        ) : (
                          <KeyRound className="size-3.5" />
                        )}
                      </button>
                    </div>
                  ) : fileMode ? (
                    /* form-data：Upload 前缀 icon（文件上传） */
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
                        onClick={() => fileRefs.current[i]?.click()}
                        title={uploadTitle}
                      >
                        <Upload className="size-3.5" />
                      </Button>
                      <input
                        ref={(el) => {
                          fileRefs.current[i] = el;
                        }}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          onFileChange?.(i, f);
                          if (f) {
                            // 选文件后 value 显示文件名（仍可手改）
                            onChange(rows.map((x, xi) => (xi === i ? { ...x, value: f.name } : x)));
                          }
                          e.target.value = "";
                        }}
                      />
                      <Input
                        value={h.value}
                        onChange={(e) =>
                          onChange(
                            rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                        placeholder={valuePlaceholder}
                        className="h-7 min-w-0 flex-1 font-mono text-xs"
                      />
                    </div>
                  ) : (
                    <Input
                      value={h.value}
                      onChange={(e) =>
                        onChange(
                          rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                      placeholder={valuePlaceholder}
                      className="h-7 w-full font-mono text-xs"
                    />
                  )}
                </td>
                <td className="py-1 pr-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteRow(i)}
                    title={deleteTitle}
                  >
                    <X className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          {/* 添加按钮行：横跨全宽、按钮靠左（与 checkbox 槽同起点同宽 → 中心对齐） */}
          <tr>
            <td colSpan={4} className="py-1 pl-3 pr-3">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                onClick={onAddRow}
                title={addTitle}
              >
                <Plus className="size-3.5" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      {fileMode && rows.length > 0 && (
        <p className="px-3 py-1 text-[10px] leading-4 text-muted-foreground">{fileHint}</p>
      )}
    </div>
  );
}
