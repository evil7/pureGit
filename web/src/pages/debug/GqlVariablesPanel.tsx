/**
 * GraphQL Variables 面板（RequestEditor · GraphQL Variables tab）
 *
 * 对标 Insomnia/GraphiQL 的变量联动体验，纯 UI 层消费 debug-gql-variables 三件套：
 * - **自动骨架**：collectVariables 提取 query 声明的变量 → buildVariablesJson 生成
 *   JSON 骨架（标量/枚举 ""、input 递归字段、列表 []），「生成骨架」一键填充
 * - **实时校验**：parseVariablesJson + validateVariables 双向校验（缺必填/多余/
 *   类型不匹配/枚举非法/input 结构），校验条按 missing/extra/type 分类展示，
 *   错误总数经 onErrorsChange 回调驱动 RequestEditor 的 Variables tab 徽标
 * - **枚举下拉**：枚举类型变量内联 Select 一键选值写入 JSON（避免手拼枚举字符串）
 * - **边界态**：query 语法错误 → 明确提示不误报；无变量 → 提示；无 schema → 提示
 */
import { useEffect, useMemo } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";
import {
  buildVariablesJson,
  collectVariables,
  parseVariablesJson,
  validateVariables,
  type GqlVariableError,
} from "@/lib/debug-gql-variables";
import { getNamedType, isEnumType, type GraphQLSchema } from "graphql";

interface GqlVariablesPanelProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  /** GraphQL Schema（提取变量类型用；null = 未就绪禁用骨架/校验） */
  gqlSchema: GraphQLSchema | null;
  /** 当前查询文本（变量声明来源；语法错误时 collectVariables 返回 null） */
  query: string;
  /** 当前 variables JSON 文本 */
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

export function GqlVariablesPanel({
  t,
  gqlSchema,
  query,
  variables,
  onChange,
  onErrorsChange,
}: GqlVariablesPanelProps) {
  /** 变量定义（null = query 语法错误；[] = 无变量）——query 变化即时重算 */
  const defs = useMemo(
    () => (gqlSchema ? collectVariables(query, gqlSchema) : null),
    [query, gqlSchema],
  );
  /** JSON 解析（语法错误与语义校验分离：parse 失败 → 只提示语法） */
  const parsed = useMemo(() => parseVariablesJson(variables), [variables]);
  /** 语义校验错误（仅 query 有效 + JSON 可解析时） */
  const errors = useMemo(() => {
    if (!defs || !parsed.ok) return [];
    return validateVariables(defs, parsed.value);
  }, [defs, parsed]);
  const missing = errors.filter((e) => e.kind === "missing");
  const extra = errors.filter((e) => e.kind === "extra");
  const typeErrors = errors.filter((e) => e.kind === "type-mismatch");

  // 错误总数上抛（tab 徽标）；0 时也上抛（清空旧徽标）
  useEffect(() => {
    onErrorsChange(errors.length);
  }, [errors.length, onErrorsChange]);

  /** 一键生成 JSON 骨架（覆盖当前内容——按钮 title 已明示） */
  const genSkeleton = () => {
    if (!defs || defs.length === 0) return;
    onChange(JSON.stringify(buildVariablesJson(defs), null, 2));
  };

  /** 枚举下拉选值 → 写回 JSON（保留其他变量；当前解析失败则从空对象起） */
  const setEnumValue = (name: string, value: string) => {
    const cur = parseVariablesJson(variables);
    const base =
      cur.ok && typeof cur.value === "object" && cur.value !== null && !Array.isArray(cur.value)
        ? (cur.value as Record<string, unknown>)
        : {};
    onChange(JSON.stringify({ ...base, [name]: value }, null, 2));
  };

  /** 枚举类型 def 的合法值列表（Select 选项数据源） */
  const enumValuesOf = (def: NonNullable<typeof defs>[number]): string[] | null => {
    const named = getNamedType(def.type);
    return isEnumType(named) ? named.getValues().map((v) => v.name) : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏：变量声明 chips（$name: Type!，必填前缀红点）+ 枚举下拉 + 生成骨架 */}
      <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5 pt-0.5">
        {defs === null ? (
          <p className="px-1 text-[11px] text-destructive">{t("variables.syntaxError")}</p>
        ) : defs.length === 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {gqlSchema ? t("variables.noVars") : t("variables.noSchema")}
          </p>
        ) : (
          <>
            {defs.map((def) => {
              const enumValues = enumValuesOf(def);
              const curValue =
                parsed.ok && parsed.value && typeof parsed.value === "object"
                  ? (parsed.value as Record<string, unknown>)[def.name]
                  : undefined;
              return (
                <div
                  key={def.name}
                  className={cn(
                    "flex items-center gap-1 rounded border border-muted px-1.5 py-0.5 font-mono text-[10px]",
                    def.required && "border-amber-500/30 bg-amber-500/5",
                  )}
                  title={`$${def.name}: ${def.typeLabel}${def.required ? "（必填）" : ""}`}
                >
                  <span
                    className={cn(
                      "size-1 shrink-0 rounded-full",
                      def.required ? "bg-amber-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="text-foreground">${def.name}</span>
                  <span className="text-muted-foreground">{def.typeLabel}</span>
                  {enumValues && (
                    <Select
                      value={String(curValue ?? "")}
                      onValueChange={(v) => setEnumValue(def.name, v)}
                    >
                      <SelectTrigger className="h-5 w-auto gap-1 rounded px-1 text-[10px]">
                        <SelectValue placeholder="…" />
                      </SelectTrigger>
                      <SelectContent>
                        {enumValues.map((v) => (
                          <SelectItem key={v} value={v} className="font-mono text-[10px]">
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={genSkeleton}
              title={t("variables.genHint")}
            >
              <Wand2 className="size-3" />
              {t("variables.generate")}
            </Button>
          </>
        )}
      </div>

      {/* 校验条：通过 ✅ / 有问题 ⚠（分类计数，点击展开错误明细） */}
      {defs !== null && defs.length > 0 && (
        <div className="px-1 pb-1.5">
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

      {/* JSON 编辑器（fill 撑满；overflow-visible + relative z-10 防 tooltip 裁剪/遮挡） */}
      <CodeEditor
        value={variables}
        onChange={onChange}
        path="variables.json"
        placeholder={t("variablesPlaceholder")}
        fill
        toolbar={false}
        className="relative z-10 flex-1 overflow-visible rounded-md"
      />
    </div>
  );
}
