/**
 * REST 请求参数表格（Params tab）——**照搬 KeyValueTable（请求头）骨架再做修改**
 *
 * 列结构（与请求头完全一致，视觉/交互统一）：
 * `[checkbox] [key（InputGroup 内嵌类型胶囊）] [value] [操作]`
 * - **类型胶囊**：仅 key 输入框用 `InputGroup` + `InputGroupAddon align="inline-end"`
 *   将胶囊放在输入框后方（框内右侧）——path → `path[n]`（n = split('/') 段索引，
 *   误删占位可快速定位取值位置）；query → `query`。其余单元格保持纯 Input。
 * - **必填（path + required query）**：checkbox 恒开不可编辑，name 只读，**操作列 Lock 图标**
 *   （不可删除）——与请求头必填锁定行同语义。**必填未填值（value 空）→ 输入框警告样式**
 *   （红色边框 + 浅红底）+ placeholder 占位提示（字符串类 `{name}`、数字类 `1`）；
 *   删空不再自动补回 `{key}` 文本——placeholder 提示代替，URL 由 buildUrlFromParams
 *   恢复模板占位（`/orgs/{org}/repos`）
 * - **选填（query 非必填）**：checkbox 可开关，name 可编辑，**操作列 X 删除按钮**（可增删）；
 *   删除/添加按钮与 KeyValueTable 同款 `Button size="icon" variant="ghost" h-6 w-6`，
 *   添加行同为表格内 colSpan 行（靠左与 checkbox 槽对齐）
 *
 * **复合占位段（单 path 段多参数，如 `{base}...{head}`）→ 合并单行渲染**：
 * - 识别：path 行 `segCount > 1`（同 index 共享一段，`segPos` 段内序号）
 * - key 格：只读显示全部参数名 + 真实分隔符（`base...head`）——段结构经 key 本身传达
 * - value 格：**每参数独立 Input + 中间真实分隔符文本**（低对比，非可编辑）——
 *   分次编辑天然正确（每框只改自己），复杂段 `{aaa}...{bbb}---{ccc}` 自动扩展为
 *   3 input + 2 分隔符，无需特判
 * - 扁平标签：类型胶囊仍为 `path[n]`（不引入 `·1/2` 等层级后缀，遵循扁平原则）
 *
 * 与响应面板空状态端点文档对照：端点选择后自动填充（path 占位 + query 空值），
 * 用户按文档填值 → 参数编辑 onChange 同步重建 URL（debug-params.ts 正向）；
 * 直接改 URL → syncParamsFromUrl 反向更新本表。事件驱动无 useEffect 防循环。
 *
 * **文档可选参数待选 badge**：docQueryNames（当前匹配端点的全部 query 参数名）− 表格已有
 * query 行 → 显示在添加按钮右侧（虚线胶囊）；点击 → 补行（空值，explicit=false，
 * 填值后输出 URL）→ badge 消失。**非必填 query 默认不自动列出**（仅 required query 由
 * 端点匹配自动填充行），全部以 badge 呈现由用户自行决定添加；被删除/未用的文档参数
 * 同样以此对照呈现。
 */
import { Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

/** 复合段 key 显示（参数名 + 中间真实分隔符）：`base...head` / `aaa...bbb---ccc` */
function compoundKeyLabel(group: DebugParam[]): string {
  const seps = group[0]?.segSeparators ?? [];
  let label = "";
  group.forEach((g, gi) => {
    if (gi > 0) label += seps[gi] ?? "";
    label += g.name;
  });
  return label;
}

/** 必填未填时的占位提示：数字类 → `1`，其余 → `{name}`（需求：path/query 必填删空显示占位） */
function requiredPlaceholder(p: DebugParam): string {
  if (p.type === "integer" || p.type === "number") return "1";
  return `{${p.name}}`;
}

/** 必填未填（value 空）→ 输入框警告样式（红色边框 + focus ring） */
function requiredMissing(p: DebugParam): boolean {
  return p.required === true && (p.value?.trim() ?? "") === "";
}

export function ParamsTable({ t, rows, onChange, docQueryNames }: ParamsTableProps) {
  const update = (i: number, patch: Partial<DebugParam>) => {
    onChange(rows.map((r, xi) => (xi === i ? { ...r, ...patch } : r)));
  };
  /** 按对象引用更新（复合段合并行内更新具体参数行） */
  const updateRef = (target: DebugParam, patch: Partial<DebugParam>) => {
    onChange(rows.map((r) => (r === target ? { ...r, ...patch } : r)));
  };
  /** 添加 query 行：
   *  - name 给定（文档 badge 补选）→ explicit=true（显式行：空值也输出裸名 `?aaa`——
   *    用户主动添加即见效果，满足「只 key 无值」需求；URL 移除该 key → 行移除转回 badge）
   *  - 空（手动添加）→ explicit=undefined（编辑中行：输 name+value 后才输出 URL） */
  const addQuery = (name = "") => {
    onChange([
      ...rows,
      { name, in: "query" as const, value: "", enabled: true, explicit: name ? true : undefined },
    ]);
  };
  const remove = (i: number) => {
    onChange(rows.filter((_, xi) => xi !== i));
  };
  /** 文档可选参数待选 badge：文档 query 参数 − 表格已有（含 disabled 行） */
  const docBadges =
    docQueryNames?.filter((n) => !rows.some((r) => r.in === "query" && r.name === n)) ?? [];

  /** 渲染列表：复合段（segCount>1）同 index 行合并为单组；其余单行。segPos 已由
   *  sortParamsForDisplay 保证段内升序（base 恒在 head 前） */
  const renderItems: (
    | { kind: "single"; idx: number }
    | { kind: "compound"; group: DebugParam[] }
  )[] = [];
  const consumed = new Set<number>();
  rows.forEach((p, i) => {
    if (consumed.has(i)) return;
    if (p.in === "path" && (p.segCount ?? 1) > 1) {
      const group = rows
        .filter((q) => q.in === "path" && q.index === p.index)
        .sort((a, b) => (a.segPos ?? 0) - (b.segPos ?? 0));
      rows.forEach((q, qi) => {
        if (q.in === "path" && q.index === p.index) consumed.add(qi);
      });
      renderItems.push({ kind: "compound", group });
    } else {
      renderItems.push({ kind: "single", idx: i });
    }
  });

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
          {renderItems.map((item) =>
            item.kind === "compound" ? (
              /* 复合段合并行（segCount>1）：单行展示全部参数——key 显示参数名+分隔符，
                 value 每参数独立 Input + 中间真实分隔符文本（低对比非可编辑） */
              <tr
                key={`compound-${item.group[0].index ?? "-"}`}
                className="border-b bg-muted/30 last:border-b-0"
              >
                <td className="py-1 pl-3 pr-2">
                  <div className="flex h-6 w-6 items-center justify-center">
                    <Checkbox checked disabled className="size-3.5" title={t("headers.enabled")} />
                  </div>
                </td>
                <td className="py-1 pr-1.5">
                  <InputGroup className="h-7">
                    <InputGroupInput
                      value={compoundKeyLabel(item.group)}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <InputGroupAddon align="inline-end">
                      <TypePill p={item.group[0]} t={t} />
                    </InputGroupAddon>
                  </InputGroup>
                </td>
                {/* value：每参数一个 Input，中间真实分隔符文本（非可编辑连接符） */}
                <td className="py-1 pr-1.5">
                  <div className="flex items-center gap-0.5">
                    {item.group.map((g, gi) => (
                      <div key={g.name} className="flex min-w-0 flex-1 items-center gap-0.5">
                        {gi > 0 && (
                          <span
                            className="shrink-0 select-none font-mono text-[10px] text-muted-foreground/70"
                            title={t("params.sepHint")}
                          >
                            {item.group[0].segSeparators?.[gi] ?? ""}
                          </span>
                        )}
                        <Input
                          value={g.value}
                          onChange={(e) => {
                            // 复合段必填删空 → 清空 value（placeholder 提示；URL 由
                            // buildUrlFromParams 恢复该参数子占位）
                            updateRef(g, { value: e.target.value });
                          }}
                          placeholder={
                            requiredMissing(g)
                              ? requiredPlaceholder(g)
                              : t("params.valuePlaceholder")
                          }
                          className={cn(
                            "h-7 min-w-0 flex-1 font-mono text-xs",
                            requiredMissing(g) &&
                              "border-destructive/70 bg-destructive/5 focus-visible:ring-destructive/30",
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </td>
                <td className="py-1 pr-3">
                  <div
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                    title={t("doc.required")}
                  >
                    <Lock className="size-3.5" />
                  </div>
                </td>
              </tr>
            ) : (
              (() => {
                const p = rows[item.idx];
                // 锁定：path 必填 + required query（不可删除、checkbox 恒开、key 只读）
                const locked = p.in === "path" || p.required === true;
                const missing = requiredMissing(p); // 必填未填 → 警告样式 + 占位提示
                return (
                  <tr
                    key={`${p.in}-${p.name}-${item.idx}`}
                    className={cn("border-b last:border-b-0", locked && "bg-muted/30")}
                  >
                    {/* enabled：必填恒开不可编辑；选填可开关 */}
                    <td className="py-1 pl-3 pr-2">
                      <div className="flex h-6 w-6 items-center justify-center">
                        <Checkbox
                          checked={locked ? true : p.enabled !== false}
                          disabled={locked}
                          onCheckedChange={(c) => update(item.idx, { enabled: c === true })}
                          className="size-3.5"
                          title={t("headers.enabled")}
                        />
                      </div>
                    </td>
                    {/* key：InputGroup 内嵌类型胶囊（inline-end 框后）；锁定行只读 */}
                    <td className="py-1 pr-1.5">
                      <InputGroup className="h-7">
                        <InputGroupInput
                          value={p.name}
                          readOnly={locked}
                          onChange={(e) => update(item.idx, { name: e.target.value })}
                          placeholder={t("params.namePlaceholder")}
                          className="font-mono text-xs"
                        />
                        <InputGroupAddon align="inline-end">
                          <TypePill p={p} t={t} />
                        </InputGroupAddon>
                      </InputGroup>
                    </td>
                    {/* value：path 填真实值替换占位；query 拼 query string。
                        必填（path/required query）删空 → value 清空 + placeholder 显示
                        {name}/1（URL 由 buildUrlFromParams 恢复模板占位）+ 警告样式 */}
                    <td className="py-1 pr-1.5">
                      <Input
                        value={p.value}
                        onChange={(e) => {
                          // 删空不再自动补回 {key}（placeholder 提示代替）；显式行空值保留
                          update(item.idx, { value: e.target.value });
                        }}
                        placeholder={
                          missing ? requiredPlaceholder(p) : t("params.valuePlaceholder")
                        }
                        className={cn(
                          "h-7 w-full font-mono text-xs",
                          missing &&
                            "border-destructive/70 bg-destructive/5 focus-visible:ring-destructive/30",
                        )}
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
                          onClick={() => remove(item.idx)}
                          title={t("history.delete")}
                        >
                          <X className="size-3.5" />{" "}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })()
            ),
          )}
          {/* 添加按钮行：横跨全宽、按钮靠左（与 checkbox 槽同起点同宽 → 中心对齐，同请求头）；
              右侧排列文档可选参数 badges（对照文档：未自动列出的非必填 / 被删的文档 query
              参数待选——由用户点击添加，不占用表格行） */}
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
