/**
 * REST 请求参数表格（Params tab）——**照搬 KeyValueTable（请求头）骨架再做修改**
 *
 * 列结构（与请求头完全一致，视觉/交互统一）：
 * `[checkbox] [key（InputGroup 内嵌类型胶囊）] [value] [操作]`
 * - **类型胶囊**：仅 key 输入框用 `InputGroup` + `InputGroupAddon align="inline-end"`
 *   将胶囊放在输入框后方（框内右侧）——path → `path[n]`（n = split('/') 段索引，
 *   误删占位可快速定位取值位置）；query → `query`。其余单元格保持纯 Input。
 * - **必填（path）**：checkbox 恒开不可编辑，name 只读，**操作列 Lock 图标**（不可删除）
 *   ——与请求头必填锁定行同语义
 * - **选填（query）**：checkbox 可开关，name 可编辑，**操作列 X 删除按钮**（可增删）；
 *   删除/添加按钮与 KeyValueTable 同款 `Button size="icon" variant="ghost" h-6 w-6`，
 *   添加行同为表格内 colSpan 行（靠左与 checkbox 槽对齐）
 *
 * 与响应面板空状态端点文档对照：端点选择后自动填充（path 占位 + query 空值），
 * 用户按文档填值 → 参数编辑 onChange 同步重建 URL（debug-params.ts 正向）；
 * 直接改 URL → syncParamsFromUrl 反向更新本表。事件驱动无 useEffect 防循环。
 *
 * **文档可选参数待选 badge**：docQueryNames（当前匹配端点的 query 参数名）− 表格已有
 * query 行 → 显示在添加按钮右侧（虚线胶囊）；点击 → 补行（空值，explicit=false，
 * 填值后输出 URL）→ badge 消失。被删除/未用的文档参数以此对照呈现。
 */
import { Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { DebugParam } from "@/lib/debug-api";

interface ParamsTableProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  rows: DebugParam[];
  onChange: (rows: DebugParam[]) => void;
  /** 当前匹配端点的文档 query 参数名（对照文档可选参数 → 待选 badge；未匹配/无文档为空） */
  docQueryNames?: string[];
}

/** 类型胶囊（key 输入框内嵌 addon，inline-end 靠右）：path → path[n]，query → query */
function TypePill({ p, t }: { p: DebugParam; t: (k: string) => string }) {
  return p.in === "path" ? (
    <span
      className="shrink-0 rounded bg-sky-500/10 px-1 font-mono text-[9px] leading-4 text-sky-600 dark:text-sky-400"
      title={t("params.pathIndex")}
    >
      path[{p.index ?? "-"}]
    </span>
  ) : (
    <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">
      query
    </span>
  );
}

export function ParamsTable({ t, rows, onChange, docQueryNames }: ParamsTableProps) {
  const update = (i: number, patch: Partial<DebugParam>) => {
    onChange(rows.map((r, xi) => (xi === i ? { ...r, ...patch } : r)));
  };
  /** 添加 query 行（name 给定 → 文档 badge 补选；空 → 手动添加空白行） */
  const addQuery = (name = "") => {
    onChange([
      ...rows,
      { name, in: "query" as const, value: "", enabled: true, explicit: name ? false : undefined },
    ]);
  };
  const remove = (i: number) => {
    onChange(rows.filter((_, xi) => xi !== i));
  };
  /** 文档可选参数待选 badge：文档 query 参数 − 表格已有（含 disabled 行） */
  const docBadges =
    docQueryNames?.filter((n) => !rows.some((r) => r.in === "query" && r.name === n)) ?? [];

  return (
    <div>
      <table className="w-full table-fixed border-collapse">
        {/* 列宽与请求头一致：checkbox（24px 槽）/ key / value / 操作 */}
        <colgroup>
          <col className="w-11" />
          <col className="w-1/3" />
          <col />
          <col className="w-7" />
        </colgroup>
        <tbody>
          {rows.map((p, i) => {
            const locked = p.in === "path"; // path 必填锁定；query 选填可删
            return (
              <tr
                key={`${p.in}-${p.name}-${i}`}
                className={cn("border-b last:border-b-0", locked && "bg-muted/30")}
              >
                {/* enabled：必填恒开不可编辑；选填可开关 */}
                <td className="py-1 pl-3 pr-2">
                  <div className="flex h-6 w-6 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={locked ? true : p.enabled !== false}
                      disabled={locked}
                      onChange={(e) => update(i, { enabled: e.target.checked })}
                      className="size-3.5"
                      title={t("headers.enabled")}
                    />
                  </div>
                </td>
                {/* key：InputGroup 内嵌类型胶囊（inline-end 框后）；path 只读 */}
                <td className="py-1 pr-1.5">
                  <InputGroup className="h-7">
                    <InputGroupInput
                      value={p.name}
                      readOnly={locked}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder={t("params.namePlaceholder")}
                      className="font-mono text-xs"
                    />
                    <InputGroupAddon align="inline-end">
                      <TypePill p={p} t={t} />
                    </InputGroupAddon>
                  </InputGroup>
                </td>
                {/* value：普通 Input（path 填真实值替换占位；query 拼 query string）
                    必填 path 删空 → 自动补回 {name} 占位符（URL 回到占位状态，方便重填） */}
                <td className="py-1 pr-1.5">
                  <Input
                    value={p.value}
                    onChange={(e) => {
                      const v = e.target.value;
                      update(i, {
                        value: locked && v.trim() === "" ? `{${p.name}}` : v,
                      });
                    }}
                    placeholder={t("params.valuePlaceholder")}
                    className="h-7 w-full font-mono text-xs"
                  />
                </td>
                {/* 操作：必填 Lock 占位（同请求头锁定行）；选填 X 删除按钮（同请求头用户行） */}
                <td className="py-1 pr-3">
                  {locked ? (
                    <div
                      className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                      title={t("doc.required")}
                    >
                      <Lock className="size-3.5" />
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(i)}
                      title={t("history.delete")}
                    >
                      <X className="size-3.5" />{" "}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
          {/* 添加按钮行：横跨全宽、按钮靠左（与 checkbox 槽同起点同宽 → 中心对齐，同请求头）；
              右侧排列文档可选参数 badges（对照文档：被删/未用的文档 query 参数待选） */}
          <tr>
            <td colSpan={4} className="py-1 pl-3 pr-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                  onClick={() => addQuery()}
                  title={t("params.addQuery")}
                >
                  <Plus className="size-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">{t("params.addQuery")}</span>
                {docBadges.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1 border-l border-border pl-2">
                    {docBadges.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                        onClick={() => addQuery(n)}
                        title={t("params.pickDocQuery", { name: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
