/**
 * GraphQL Variables 面板（RequestEditor · GraphQL Variables tab）——KV 表格对齐 REST 参数操作习惯
 *
 * 对标 KeyValueTable/ParamsTable 的列结构与锁定/删除/添加语义，替代 JSON 编辑器：
 * `[checkbox] [key + 类型胶囊] [value（枚举/布尔=下拉；input/列表=JSON 字面量）] [操作]`
 * - **必填变量自动成行（锁定）**：query 声明 NON_NULL → 自动行——checkbox 恒开、name 只读、
 *   操作列 Lock 不可删；空值必填 → 输入框警告样式（红框）+ 类型化 placeholder
 * - **可选变量 → 待选 badge**：query 声明非必填 → 添加按钮右侧虚线胶囊（同 REST docBadges
 *   操作习惯），点击补行（正常行：checkbox 可开关、X 可删）
 * - **类型胶囊**：key 输入框 InputGroup 内嵌（String! / Int / OrderDirection）——必填红调、
 *   可选灰调；自定义行无胶囊（发送时 extra 校验提醒）
 * - **枚举/布尔下拉**：value 格 Select 切换（OrderDirection → ASC/DESC；Boolean → true/false）
 * - **输入 → 自动转 JSON**：任意编辑实时 rowsToJson（按类型转换：String 原样 / Int·Float
 *   Number / input·列表 JSON.parse）写入 req.variables——发送（executeDebug 已 tryParseJson）
 *   与历史记录天然复用，无独立转换动作
 * - **实时校验**：validateVariables 双向校验（缺必填/多余/类型）+ 行转换错误，校验条按
 *   missing/extra/type 三色分类，错误总数经 onErrorsChange 驱动 tab 徽标
 *
 * 正反向同步（防输入光标跳动）：
 * - 正向：行编辑 → rowsToJson → commit(json)（lastEmitted 记录自己写入文本）
 * - 反向：variables 变化 → effect——若为自身写入（isSelf）只同步声明结构（增删行，值不动）；
 *   外部变化（历史重放等）全量重建行值
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  collectVariables,
  parseVariablesJson,
  validateVariables,
  type GqlVariableDef,
  type GqlVariableError,
} from "@/lib/debug-gql-variables";
import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  type GraphQLInputType,
  type GraphQLSchema,
} from "graphql";

/** 变量表格行（声明行由 query 派生；自定义行由用户添加） */
interface GqlVarRow {
  name: string;
  /** 类型胶囊文本（String! / Int / OrderDirection；自定义行空 = 不显示胶囊） */
  typeLabel: string;
  /** 解析后输入类型（null = 未声明自定义行） */
  type: GraphQLInputType | null;
  required: boolean;
  /** 是否 query 声明（true = 自动行，name 只读；false = 用户自定义） */
  declared: boolean;
  /** 文本值（按类型语义：String 原样 / Int 数字 / input·列表 JSON 字面量） */
  value: string;
  enabled: boolean;
}

interface GqlVariablesPanelProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  /** GraphQL Schema（提取变量类型用；null = 未就绪禁用提取） */
  gqlSchema: GraphQLSchema | null;
  /** 当前查询文本（变量声明来源；语法错误时 collectVariables 返回 null） */
  query: string;
  /** 当前 variables JSON 文本（发送/历史复用；表格实时写入） */
  variables: string;
  onChange: (v: string) => void;
  /** 校验错误总数回调（驱动 RequestEditor 的 Variables tab 徽标） */
  onErrorsChange: (count: number) => void;
}

/** 校验错误分类徽标（missing/extra/type-mismatch 三色区分） */
const KIND_STYLE: Record<GqlVariableError["kind"], string> = {
  missing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  extra: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "type-mismatch": "bg-destructive/10 text-destructive",
};

/** 行值（文本）→ JSON 值：按声明类型转换；null 类型（自定义行）宽松 JSON.parse */
function textToJsonValue(
  text: string,
  type: GraphQLInputType | null,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, value: undefined };
  if (!type) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: true, value: text }; // 未声明变量按字符串注入（extra 校验会提醒）
    }
  }
  if (isNonNullType(type)) return textToJsonValue(text, type.ofType);
  if (isListType(type)) {
    try {
      const v = JSON.parse(text);
      return Array.isArray(v)
        ? { ok: true, value: v }
        : { ok: false, error: "列表值应为 JSON 数组文本" };
    } catch {
      return { ok: false, error: "列表值应为 JSON 数组文本" };
    }
  }
  const named = getNamedType(type);
  if (isScalarType(named)) {
    if (named.name === "Int" || named.name === "Float") {
      const n = Number(text);
      return Number.isNaN(n)
        ? { ok: false, error: `应为数字（${named.name}）` }
        : { ok: true, value: n };
    }
    if (named.name === "Boolean") return { ok: true, value: text === "true" };
    return { ok: true, value: text }; // String/ID/URI/DateTime 等标量原样
  }
  if (isEnumType(named)) return { ok: true, value: text };
  if (isInputObjectType(named)) {
    try {
      const v = JSON.parse(text);
      return typeof v === "object" && v !== null && !Array.isArray(v)
        ? { ok: true, value: v }
        : { ok: false, error: "input 值应为 JSON 对象文本" };
    } catch {
      return { ok: false, error: "input 值应为 JSON 对象文本" };
    }
  }
  return { ok: true, value: text };
}

/** 表格行 → JSON 对象（enabled 关 / 空名 / 可选空值跳过；转换错误返回） */
function rowsToJson(rows: GqlVarRow[], defs: GqlVariableDef[]): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  const defMap = new Map(defs.map((d) => [d.name, d]));
  for (const row of rows) {
    if (row.enabled === false) continue;
    const name = row.name.trim();
    if (!name) continue;
    const def = defMap.get(name);
    const type = def?.type ?? row.type;
    if (row.value.trim() === "") continue; // 空值（必填缺失由 validate 报 missing）
    const res = textToJsonValue(row.value, type);
    if (res.ok && res.value !== undefined) json[name] = res.value;
  }
  return json;
}

/** 声明行同步（防输入光标跳动）：isSelf（自身写入）只增删结构不动值；外部变化全量重建值 */
function syncRows(
  prev: GqlVarRow[],
  defs: GqlVariableDef[],
  json: Record<string, unknown>,
  isSelf: boolean,
): GqlVarRow[] {
  // 声明行在 defs 中消失 → 移除（query 删除变量）；自定义行保留
  let rows = prev.filter((r) => !r.declared || defs.some((d) => d.name === r.name));
  // 必填声明行确保存在（自动成行锁定）；可选声明行不自动创建（badge 补行）
  for (const d of defs) {
    if (!d.required) continue;
    if (rows.some((r) => r.declared && r.name === d.name)) continue;
    const v = json[d.name];
    rows.push({
      name: d.name,
      typeLabel: d.typeLabel,
      type: d.type,
      required: true,
      declared: true,
      value: v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v),
      enabled: true,
    });
  }
  // 外部 JSON 全量同步值（历史重放等）；自身写入跳过值同步
  if (!isSelf) {
    rows = rows.map((r) => {
      if (!r.declared) return r;
      const v = json[r.name];
      const text = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return r.value === text ? r : { ...r, value: text };
    });
    // 外部 JSON 中表格缺失的变量 → 新增自定义行（不自动删除用户已删行）
    for (const [k, v] of Object.entries(json)) {
      if (!rows.some((r) => r.name === k)) {
        rows.push({
          name: k,
          typeLabel: "",
          type: null,
          required: false,
          declared: false,
          value: typeof v === "string" ? v : JSON.stringify(v),
          enabled: true,
        });
      }
    }
  }
  return rows;
}

/** 行值类型化 placeholder（对齐 REST 参数 requiredPlaceholder 思路） */
function valuePlaceholder(row: GqlVarRow): string {
  if (!row.type) return "值";
  let t: GraphQLInputType = row.type;
  while (isNonNullType(t)) t = t.ofType;
  if (isListType(t)) return "[ ... ]";
  const named = getNamedType(t);
  if (isScalarType(named)) {
    if (named.name === "Int" || named.name === "Float") return "123";
    if (named.name === "Boolean") return "";
    return "值";
  }
  if (isInputObjectType(named)) return '{ "field": "..." }';
  return "值";
}

/** 枚举 / 布尔 → 下拉选项；其余 null（普通输入框） */
function selectOptions(row: GqlVarRow): string[] | null {
  if (!row.type) return null;
  let t: GraphQLInputType = row.type;
  while (isNonNullType(t)) t = t.ofType;
  const named = getNamedType(t);
  if (isEnumType(named)) return named.getValues().map((v) => v.name);
  if (isScalarType(named) && named.name === "Boolean") return ["true", "false"];
  return null;
}

export function GqlVariablesPanel({
  t,
  gqlSchema,
  query,
  variables,
  onChange,
  onErrorsChange,
}: GqlVariablesPanelProps) {
  /** 变量定义（null = query 语法错误；[] = 无变量） */
  const defs = useMemo(
    () => (gqlSchema ? collectVariables(query, gqlSchema) : null),
    [query, gqlSchema],
  );
  /** 表格行（声明行 + 自定义行） */
  const [rows, setRows] = useState<GqlVarRow[]>([]);
  /** 自身写入的 JSON 文本（判断反向同步是否自己触发） */
  const lastEmittedRef = useRef("");

  /** 反向同步：defs/variables 变化 → 重建行（值相同返回原引用，输入不跳光标） */
  useEffect(() => {
    const parsed = parseVariablesJson(variables);
    const json =
      parsed.ok &&
      typeof parsed.value === "object" &&
      parsed.value !== null &&
      !Array.isArray(parsed.value)
        ? (parsed.value as Record<string, unknown>)
        : {};
    const isSelf = lastEmittedRef.current === variables;
    setRows((prev) => {
      const next = syncRows(prev, defs ?? [], json, isSelf);
      return next === prev ? prev : next;
    });
  }, [defs, variables]);

  /** 提交行 → 写 req.variables（JSON 文本；发送/历史复用） */
  const commit = (next: GqlVarRow[]) => {
    setRows(next);
    const text = JSON.stringify(rowsToJson(next, defs ?? []), null, 2);
    lastEmittedRef.current = text;
    onChange(text);
  };
  const updateRow = (i: number, patch: Partial<GqlVarRow>) => {
    commit(rows.map((r, xi) => (xi === i ? { ...r, ...patch } : r)));
  };

  /** 待选 badge：可选声明变量 − 表格已有 */
  const optionalBadges =
    defs?.filter((d) => !d.required && !rows.some((r) => r.name === d.name)) ?? [];
  /** 添加自定义行（未声明变量；发送时 extra 校验提醒） */
  const addCustom = () => {
    commit([
      ...rows,
      {
        name: "",
        typeLabel: "",
        type: null,
        required: false,
        declared: false,
        value: "",
        enabled: true,
      },
    ]);
  };

  /** JSON 解析态（语法错误提示） */
  const parsed = useMemo(() => parseVariablesJson(variables), [variables]);
  /** 语义校验：validateVariables（缺/多/类型）+ 行值转换错误（type-mismatch） */
  const errors = useMemo(() => {
    const out: GqlVariableError[] = [];
    if (!defs || !parsed.ok) return out;
    const json = rowsToJson(rows, defs);
    out.push(...validateVariables(defs, json));
    // 行转换错误（列表/input JSON 解析失败等）
    for (const row of rows) {
      if (row.enabled === false || !row.name.trim() || row.value.trim() === "") continue;
      const res = textToJsonValue(row.value, row.type);
      if (!res.ok) out.push({ key: row.name, kind: "type-mismatch", message: res.error });
    }
    return out;
  }, [defs, parsed, rows]);
  const missing = errors.filter((e) => e.kind === "missing");
  const extra = errors.filter((e) => e.kind === "extra");
  const typeErrors = errors.filter((e) => e.kind === "type-mismatch");

  // 错误总数上抛（tab 徽标）；0 时也上抛（清空旧徽标）
  useEffect(() => {
    onErrorsChange(errors.length);
  }, [errors.length, onErrorsChange]);

  /** 必填空值 → 警告样式（对齐 ParamsTable requiredMissing） */
  const requiredMissing = (row: GqlVarRow): boolean => row.required && row.value.trim() === "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 语法错误 / 无变量 / 无 schema 提示（表格不可用时的明确边界态） */}
      {defs === null ? (
        <p className="px-1 py-1 text-[11px] text-destructive">{t("variables.syntaxError")}</p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-11" />
            <col className="w-1/3" />
            <col />
            <col className="w-7" />
          </colgroup>
          <tbody>
            {/* 必填声明行（锁定：checkbox 恒开、name 只读、操作列 Lock） */}
            {rows
              .filter((r) => r.declared && r.required)
              .map((r, ri) => {
                const opts = selectOptions(r);
                return (
                  <tr key={`req-${r.name}`} className="border-b bg-muted/30 last:border-b-0">
                    <td className="py-1 pl-3 pr-2">
                      <div className="flex h-6 w-6 items-center justify-center">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="size-3.5"
                          title={t("headers.enabled")}
                        />
                      </div>
                    </td>
                    <td className="py-1 pr-1.5">
                      <InputGroup>
                        <InputGroupInput
                          value={`$${r.name}`}
                          readOnly
                          className="h-7 w-full font-mono text-xs"
                        />
                        <InputGroupAddon align="inline-end">
                          <span
                            className="shrink-0 rounded bg-amber-500/10 px-1 font-mono text-[9px] leading-4 text-amber-600 dark:text-amber-400"
                            title={t("variables.required")}
                          >
                            {r.typeLabel}
                          </span>
                        </InputGroupAddon>
                      </InputGroup>
                    </td>
                    <td className="py-1 pr-1.5">
                      {opts ? (
                        <Select value={r.value} onValueChange={(v) => updateRow(ri, { value: v })}>
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
                      ) : (
                        <Input
                          value={r.value}
                          onChange={(e) => updateRow(ri, { value: e.target.value })}
                          placeholder={valuePlaceholder(r)}
                          className={cn(
                            "h-7 w-full font-mono text-xs",
                            requiredMissing(r) &&
                              "border-destructive bg-destructive/5 focus-visible:ring-destructive/40",
                          )}
                        />
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      <div
                        className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                        title={t("variables.required")}
                      >
                        <Lock className="size-3.5" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            {/* 用户行（可选声明行 / 自定义行）：checkbox 可开关、X 可删 */}
            {rows
              .filter((r) => !(r.declared && r.required))
              .map((r) => {
                const i = rows.indexOf(r);
                const opts = selectOptions(r);
                return (
                  <tr key={`${r.name}:${i}`} className="border-b last:border-b-0">
                    <td className="py-1 pl-3 pr-2">
                      <div className="flex h-6 w-6 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={r.enabled !== false}
                          onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                          className="size-3.5"
                          title={t("headers.enabled")}
                        />
                      </div>
                    </td>
                    <td className="py-1 pr-1.5">
                      {r.declared ? (
                        <InputGroup>
                          <InputGroupInput
                            value={`$${r.name}`}
                            readOnly
                            className="h-7 w-full font-mono text-xs"
                          />
                          <InputGroupAddon align="inline-end">
                            <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">
                              {r.typeLabel}
                            </span>
                          </InputGroupAddon>
                        </InputGroup>
                      ) : (
                        <Input
                          value={r.name}
                          onChange={(e) => updateRow(i, { name: e.target.value })}
                          placeholder="$var"
                          className="h-7 w-full font-mono text-xs"
                        />
                      )}
                    </td>
                    <td className="py-1 pr-1.5">
                      {opts ? (
                        <Select value={r.value} onValueChange={(v) => updateRow(i, { value: v })}>
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
                      ) : (
                        <Input
                          value={r.value}
                          onChange={(e) => updateRow(i, { value: e.target.value })}
                          placeholder={valuePlaceholder(r)}
                          className="h-7 w-full font-mono text-xs"
                        />
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive"
                        onClick={() => commit(rows.filter((_, xi) => xi !== i))}
                        title={t("history.delete")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            {/* 添加按钮行：Plus 靠左（与 checkbox 槽对齐）+ 可选变量待选 badge 靠左显示 */}
            <tr>
              <td colSpan={4} className="py-1 pl-3 pr-3">
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                    onClick={addCustom}
                    title={t("variables.add")}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  {optionalBadges.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">
                        {t("variables.optional")}:
                      </span>
                      {optionalBadges.map((d) => (
                        <button
                          key={d.name}
                          type="button"
                          className="rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-px font-mono text-[10px] text-muted-foreground hover:border-foreground hover:text-foreground"
                          title={t("variables.addOptional")}
                          onClick={() =>
                            commit([
                              ...rows,
                              {
                                name: d.name,
                                typeLabel: d.typeLabel,
                                type: d.type,
                                required: false,
                                declared: true,
                                value: "",
                                enabled: true,
                              },
                            ])
                          }
                        >
                          ${d.name}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* 校验条：通过 ✅ / 有问题 ⚠（分类计数，点击展开错误明细） */}
      {defs !== null && (defs.length > 0 || rows.some((r) => r.name.trim())) && (
        <div className="px-1 pb-1.5 pt-1">
          <details className="group">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-medium",
                errors.length === 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              <span>{errors.length === 0 ? "✓" : "⚠"}</span>
              <span>
                {errors.length === 0
                  ? t("variables.valid")
                  : t("variables.errors", { n: errors.length })}
              </span>
              {errors.length > 0 && (
                <span className="ml-auto flex gap-1">
                  {missing.length > 0 && (
                    <span className="rounded bg-amber-500/15 px-1">
                      {t("variables.missing")} {missing.length}
                    </span>
                  )}
                  {extra.length > 0 && (
                    <span className="rounded bg-sky-500/15 px-1">
                      {t("variables.extra")} {extra.length}
                    </span>
                  )}
                  {typeErrors.length > 0 && (
                    <span className="rounded bg-destructive/15 px-1">
                      {t("variables.type")} {typeErrors.length}
                    </span>
                  )}
                </span>
              )}
            </summary>
            {errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 rounded border border-muted p-1">
                {errors.map((e, i) => (
                  <li key={`${e.key}-${i}`} className="flex items-start gap-1.5 text-[10px]">
                    <span
                      className={cn("mt-px shrink-0 rounded px-1 leading-4", KIND_STYLE[e.kind])}
                    >
                      {e.kind === "missing"
                        ? t("variables.missing")
                        : e.kind === "extra"
                          ? t("variables.extra")
                          : t("variables.type")}
                    </span>
                    <span className="font-mono text-muted-foreground">{e.key}</span>
                    <span className="text-foreground/80">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
      {!parsed.ok && (
        <p className="px-1 pb-1.5 text-[10px] text-destructive">
          {t("variables.jsonError")}: {parsed.error}
        </p>
      )}
    </div>
  );
}
