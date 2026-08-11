/**
 * GraphQL Schema 树（左栏 API tab · GraphQL 侧）
 *
 * 受控组件：schema/loading/error 由 DebugPage 统一持有（schema 同时供请求编辑器
 * cm6-graphql 补全），onReload 触发重新加载（清缓存重拉本地完整 schema）。
 * 数据：完整 introspection 原数据（含 description）→ buildGqlFieldTree 顶层字段树
 * （query/mutation 分组手风琴默认展开）→ 字段可展开返回类型的子字段（从外向内浏览）；
 * union 返回显示 possibleTypes。点按字段 → 生成「即用」查询模板（仅必填参数示例值）。
 *
 * 2026-08-11 勾选合并 + 双向同步（状态机纯函数在 lib/debug-graphql.ts，全量测试覆盖）：
 * - **勾选 = 唯一选中动作**：字段行（含展开的子字段）前 checkbox，勾选/取消立即重建
 *   查询填充编辑器（无「填充选中」按钮）；**点击字段名仅展开/收起**返回类型子字段
 * - **勾选父级 → 子项全自动勾选**（对象 root 自动带全部可见子字段，无隐式默认主键）：
 *   父级三态（checked/indeterminate/unchecked）；取消最后一个子项 → 父级一并取消
 * - **只有被勾选才写入**：生成 query 严格 = 勾选内容（gqlMapToQuery，无默认字段/主键）
 * - **反向同步（手写 → 勾选）**：监听编辑器 query（editorQuery prop），无语法错误时
 *   解析 AST（parseQueryFieldSelections）→ buildSelectionsFromParsed 归一化
 *   （对象空 selection / 非 schema 字段 / 内省字段不产生勾选）→ 与当前勾选比较，不同才更新
 * - **内省分组**：底部固定 query/__schema、__type、__typename 三项（替代原自定义模板），
 *   默认展开，点击填充内省查询
 * - **hover 详情**：字段行 title 含返回类型 + 参数清单（name: Type!）+ description 全文
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  buildGqlFieldTree,
  buildSelectionsFromParsed,
  gqlMapToQuery,
  gqlRootCheckState,
  parseQueryFieldSelections,
  toggleChildSelection,
  toggleRootSelection,
  type GqlFieldNode,
  type GqlSchemaTree,
  type GqlSelectionMap,
} from "@/lib/debug-graphql";
import type { GraphQLSchema } from "graphql";
import { GraphQLLogo } from "./GraphQLLogo";

/** 内省查询模板（GraphQL spec 标准：__schema / __type / __typename） */
const INTROSPECTION_PRESETS = [
  {
    name: "__schema",
    query: "query { __schema { queryType { name } mutationType { name } types { name kind } } }",
  },
  {
    name: "__type(name)",
    query:
      'query { __type(name: "…") { name kind fields { name type { kind name ofType { kind name } } } } }',
  },
  {
    name: "__typename",
    query: "query { __typename }",
  },
] as const;

interface GqlTreeProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  schema: GraphQLSchema | null;
  /** 当前编辑器 GraphQL 查询文本（反向同步：手写改动 → 自动更新勾选） */
  editorQuery: string;
  loading: boolean;
  error: boolean;
  onReload: () => void;
  /** 勾选合并 → 填充请求（同操作类型多字段拼接；query 空字符串 = 清空） */
  onPickGqlMulti: (opType: "query" | "mutation", query: string) => void;
  /** GraphQL 模板点按 → 填充请求 */
  onPickGqlTemplate: (query: string, method: "query" | "mutation") => void;
}

export function GqlTree({
  t,
  schema,
  editorQuery,
  loading,
  error,
  onReload,
  onPickGqlMulti,
  onPickGqlTemplate,
}: GqlTreeProps) {
  // GraphQL 分组展开态（query/mutation/内省默认都展开——点按即用）
  const [gqlSections, setGqlSections] = useState<Record<string, boolean>>({
    query: true,
    mutation: true,
    introspection: true,
  });
  // 字段展开态（字段名 → 已展开返回类型的子字段）
  const [gqlExpanded, setGqlExpanded] = useState<Record<string, boolean>>({});
  // 勾选集合（顶层字段 + 子字段合并构造；同操作类型字段共享；状态机在 lib 层）
  const [selected, setSelected] = useState<GqlSelectionMap>({});
  /** 顶层字段树（schema 就绪后构建，含展开浏览数据） */
  const fieldTree: GqlSchemaTree | null = useMemo(
    () => (schema ? buildGqlFieldTree(schema) : null),
    [schema],
  );

  /** 提交勾选集合：更新状态 + 立即重建查询填充（勾选即填充，无独立按钮；仅勾选内容写入） */
  const commitSelection = (next: GqlSelectionMap, opType: "query" | "mutation") => {
    setSelected(next);
    onPickGqlMulti(opType, gqlMapToQuery(next, opType));
  };

  /** 勾选顶层字段（父级 checkbox）→ 状态机切换（对象 root 自动全选可见子字段） */
  const toggleRoot = (opType: "query" | "mutation", root: GqlFieldNode) => {
    commitSelection(toggleRootSelection(selected, opType, root), opType);
  };
  /** 勾选子字段 → 状态机切换（取消最后一个子项 → 父级一并取消） */
  const toggleChild = (opType: "query" | "mutation", root: GqlFieldNode, childName: string) => {
    commitSelection(toggleChildSelection(selected, opType, root, childName), opType);
  };

  /**
   * 反向同步（手写 → 勾选）：编辑器 query 变化时解析 AST，无语法错误则自动
   * 添加/移除对应勾选（buildSelectionsFromParsed 归一化：非 schema 字段/内省字段
   * 跳过，对象空 selection 跳过——维持状态机不变量 1/2）。
   * 正向填充（勾选 → 生成 query）也会触发本 effect——解析产物与当前勾选一致则
   * 不更新（不变量 5：正反向收敛，循环稳定）。
   */
  useEffect(() => {
    if (!fieldTree) return;
    const parsed = parseQueryFieldSelections(editorQuery);
    if (!parsed) return; // 语法错误 → 不反向同步
    const list = parsed.opType === "query" ? fieldTree.query : fieldTree.mutation;
    const next = buildSelectionsFromParsed(parsed.opType, parsed.fields, list);
    // 与当前勾选比较：同 key 数 + 每项 children 相等 → 不更新（防循环/无谓渲染）
    const same =
      Object.keys(next).length === Object.keys(selected).length &&
      Object.entries(next).every(([k, v]) => {
        const cur = selected[k];
        return (
          cur !== undefined &&
          cur.children.size === v.children.size &&
          [...v.children].every((c) => cur.children.has(c))
        );
      });
    if (!same) setSelected(next);
  }, [editorQuery, fieldTree, selected]);
  /** 字段行 title（hover 详情：返回类型 + 参数清单 + desc） */
  const fieldTitle = (f: GqlFieldNode): string => {
    const parts = [`${f.name}: ${f.returnLabel}`];
    if (f.args.length > 0) {
      parts.push(
        `args: ${f.args.map((a) => `${a.name}: ${a.typeLabel}${a.required ? "!" : ""}`).join(", ")}`,
      );
    }
    if (f.desc) parts.push(f.desc);
    return parts.join("\n");
  };
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
        /* query / mutation 分组手风琴（字段可展开返回类型；勾选合并构造） */
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
                      "size-3 shrink-0 text-muted-foreground transition-transform",
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
                      const checkState = gqlRootCheckState(selected, key, f);
                      const isSel = checkState !== "unchecked";
                      const childSel = isSel
                        ? selected[`${key}:${f.name}`].children
                        : new Set<string>();
                      return (
                        <div key={f.name}>
                          {/* 字段行：checkbox 勾选（唯一选中动作）+ 点击字段名仅展开 + 右侧展开指示 */}
                          <div className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent">
                            <Checkbox
                              // radix CheckedState：boolean | "indeterminate"（三态原生支持）
                              checked={
                                checkState === "checked"
                                  ? true
                                  : checkState === "indeterminate"
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={() => toggleRoot(key, f)}
                              className="size-3.5 shrink-0"
                              aria-label={`${t("gql.selectField")} ${f.name}`}
                            />
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                              onClick={() =>
                                expandable && setGqlExpanded((s) => ({ ...s, [f.name]: !expanded }))
                              }
                              title={fieldTitle(f)}
                            >
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-xs",
                                  f.deprecated && "text-destructive line-through",
                                )}
                              >
                                {f.name}
                              </span>
                              {/* 父级后方数字 = 子条目数量（可展开子字段数，对照 REST tag 的端点数语义；
                                  args 参数清单保留在 hover title） */}
                              {expandable && (
                                <span className="shrink-0 rounded bg-muted px-1 text-[9px] leading-3 text-muted-foreground">
                                  {f.typeFields?.length ?? f.possibleTypes?.length ?? 0}
                                </span>
                              )}
                            </button>
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
                          </div>
                          {/* 展开：返回类型的子字段（checkbox 勾选 + 点击生成精确模板） */}
                          {expanded && f.typeFields && (
                            <div className="ml-3 border-l border-muted pl-1.5">
                              {f.typeFields.map((cf) => (
                                <div
                                  key={cf.name}
                                  className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
                                >
                                  <Checkbox
                                    checked={childSel.has(cf.name)}
                                    onCheckedChange={() => toggleChild(key, f, cf.name)}
                                    className="size-3 shrink-0"
                                    aria-label={`${t("gql.selectField")} ${f.name}.${cf.name}`}
                                  />
                                  {/* 子字段纯文本展示（无更深展开；勾选为唯一交互） */}
                                  <span
                                    className="min-w-0 flex-1 truncate text-[11px]"
                                    title={`${f.name} { ${cf.name} } — ${cf.returnLabel}${cf.desc ? `\n${cf.desc}` : ""}`}
                                  >
                                    {cf.name}
                                  </span>
                                </div>
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
          {/* 内省分组（GraphQL spec 标准，替代原自定义模板；默认展开） */}
          <div className="mb-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium hover:bg-accent"
                onClick={() =>
                  setGqlSections((s) => ({ ...s, introspection: !gqlSections.introspection }))
                }
              >
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    !gqlSections.introspection && "-rotate-90",
                  )}
                />
                <span className="font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                  {t("gql.introspection")}
                </span>
              </button>
            </div>
            {gqlSections.introspection && (
              <div className="ml-2 border-l pl-1">
                {INTROSPECTION_PRESETS.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                    onClick={() => onPickGqlTemplate(item.query, "query")}
                    title={item.query}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
    </div>
  );
}
