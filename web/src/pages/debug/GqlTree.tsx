/**
 * GraphQL Schema 树（左栏 API tab · GraphQL 侧）+ 常用模板
 *
 * 受控组件：schema/loading/error 由 DebugPage 统一持有（schema 同时供请求编辑器
 * cm6-graphql 补全），onReload 触发重新加载（清缓存重拉本地完整 schema）。
 * 数据：完整 introspection 原数据（含 description）→ buildGqlFieldTree 顶层字段树
 * （query/mutation 分组手风琴默认展开）→ 字段可展开返回类型的子字段（从外向内浏览）；
 * union 返回显示 possibleTypes。点按字段 → 生成「即用」查询模板（仅必填参数示例值）。
 * 底部保留常用模板列表（PRESET_COLLECTION 的 graphql 项）。
 */
import { useMemo, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildGqlFieldTree, type GqlFieldNode, type GqlSchemaTree } from "@/lib/debug-graphql";
import { PRESET_COLLECTION } from "@/lib/debug-store";
import type { GraphQLSchema } from "graphql";
import { GraphQLLogo } from "./GraphQLLogo";

interface GqlTreeProps {
  t: (k: string) => string;
  schema: GraphQLSchema | null;
  loading: boolean;
  error: boolean;
  onReload: () => void;
  onPickGqlField: (field: GqlFieldNode, opType: "query" | "mutation") => void;
  onPickGqlChild: (root: GqlFieldNode, child: GqlFieldNode, opType: "query" | "mutation") => void;
  /** GraphQL 模板点按 → 填充请求 */
  onPickGqlTemplate: (query: string, method: "query" | "mutation") => void;
}

export function GqlTree({
  t,
  schema,
  loading,
  error,
  onReload,
  onPickGqlField,
  onPickGqlChild,
  onPickGqlTemplate,
}: GqlTreeProps) {
  // GraphQL 分组展开态（query/mutation 默认都展开——点按即用）
  const [gqlSections, setGqlSections] = useState<Record<string, boolean>>({
    query: true,
    mutation: true,
  });
  // 字段展开态（字段名 → 已展开返回类型的子字段）
  const [gqlExpanded, setGqlExpanded] = useState<Record<string, boolean>>({});
  /** 顶层字段树（schema 就绪后构建，含展开浏览数据） */
  const fieldTree: GqlSchemaTree | null = useMemo(
    () => (schema ? buildGqlFieldTree(schema) : null),
    [schema],
  );
  /** 常用 GraphQL 模板（PRESET_COLLECTION 过滤 protocol==="graphql"） */
  const gqlTemplates = useMemo(
    () => PRESET_COLLECTION.filter((c) => c.request.protocol === "graphql"),
    [],
  );
  return (
    <div className="p-1.5">
      {/* Schema 区：标题 + 右侧 加载/刷新 按钮 */}
      <div className="flex items-center gap-1 px-1.5 pb-1">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <GraphQLLogo className="size-3 text-violet-600 dark:text-violet-400" />
          {t("gql.schema")}
        </p>
        <button
          type="button"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onReload}
          disabled={loading}
          title={fieldTree ? t("gql.refresh") : t("gql.load")}
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </button>
      </div>
      {loading ? (
        <div className="space-y-1.5 px-1.5 py-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-1.5 px-1.5 py-1">
          <p className="text-xs text-destructive">{t("gql.loadFailed")}</p>
          <button type="button" className="text-xs text-primary underline" onClick={onReload}>
            {t("gql.retry")}
          </button>
        </div>
      ) : fieldTree ? (
        /* query / mutation 分组手风琴（字段可展开返回类型） */
        <div>
          {(
            [
              { key: "query", label: t("gql.queryRoot"), fields: fieldTree.query },
              { key: "mutation", label: t("gql.mutationRoot"), fields: fieldTree.mutation },
            ] as const
          ).map(({ key, label, fields }) => {
            const open = gqlSections[key] ?? true;
            return (
              <div key={key} className="mb-0.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium hover:bg-accent"
                  onClick={() => setGqlSections((s) => ({ ...s, [key]: !open }))}
                >
                  <ChevronDown
                    className={cn(
                      "size-3 text-muted-foreground transition-transform",
                      !open && "-rotate-90",
                    )}
                  />
                  <span className="font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                    {label}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{fields.length}</span>
                </button>
                {open && (
                  <div className="ml-2 border-l pl-1">
                    {fields.map((f) => {
                      const expanded = gqlExpanded[f.name] ?? false;
                      const expandable = !!f.typeFields || !!f.possibleTypes;
                      return (
                        <div key={f.name}>
                          {/* 字段行：点击生成模板；有返回类型子字段时右侧可展开。
                             仅显示字段名（返回类型在 hover tooltip，列表保持紧凑） */}
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                            onClick={() => onPickGqlField(f, key)}
                            title={`${f.name}: ${f.returnLabel}${f.desc ? `\n${f.desc}` : ""}`}
                          >
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-xs",
                                f.deprecated && "text-destructive line-through",
                              )}
                            >
                              {f.name}
                            </span>
                            {expandable && (
                              <span
                                role="button"
                                tabIndex={-1}
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setGqlExpanded((s) => ({
                                    ...s,
                                    [f.name]: !expanded,
                                  }));
                                }}
                                title={expanded ? "收起" : "展开返回类型字段"}
                              >
                                <ChevronDown
                                  className={cn(
                                    "size-3 transition-transform",
                                    !expanded && "-rotate-90",
                                  )}
                                />
                              </span>
                            )}
                          </button>
                          {/* 展开：返回类型的子字段（点击子字段生成精确模板） */}
                          {expanded && f.typeFields && (
                            <div className="ml-3 border-l border-muted pl-1.5">
                              {f.typeFields.map((cf) => (
                                <button
                                  key={cf.name}
                                  type="button"
                                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-accent"
                                  onClick={() => onPickGqlChild(f, cf, key)}
                                  title={`${f.name} { ${cf.name} } — ${cf.returnLabel}`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-[11px]">
                                    {cf.name}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {/* 展开：union possibleTypes 提示 */}
                          {expanded && f.possibleTypes && (
                            <div className="ml-3 border-l border-muted pl-1.5">
                              <p className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {f.possibleTypes.join(" | ")}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-1.5 py-2 text-xs text-muted-foreground">
          {t("gql.noSchema")}
          <button
            type="button"
            className="ml-1.5 text-xs text-primary underline"
            onClick={onReload}
          >
            {t("gql.load")}
          </button>
        </p>
      )}
      {/* 常用模板（PRESET_COLLECTION 保留） */}
      <p className="px-1.5 pb-1 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("gql.templates")}
      </p>
      {gqlTemplates.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
          onClick={() =>
            onPickGqlTemplate(
              item.request.query,
              (item.request.method as "query" | "mutation") ?? "query",
            )
          }
          title={item.request.query.slice(0, 80)}
        >
          <span className="w-9 shrink-0 font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
            GQL
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
