/**
 * GraphQL Schema 树（左栏 API tab · GraphQL 侧）
 *
 * 受控组件：schema/loading/error 由 DebugPage 统一持有（schema 同时供请求编辑器
 * cm6-graphql 补全），onReload 触发重新加载（清缓存重拉本地完整 schema）。
 * 数据：完整 introspection 原数据（含 description）→ buildGqlFieldTree 顶层字段树
 * （query/mutation 分组手风琴默认展开）+ GqlSchemaContext 惰性字段层解析（展开时才
 * 构建该类型字段层，任意深度零网络）。
 *
 * 2026-08-11 勾选合并 + 双向同步 + 任意深度（状态机纯函数在 lib/debug-graphql.ts）：
 * - **勾选 = 唯一选中动作**：字段行前 checkbox，勾选/取消立即重建查询填充编辑器
 *   （无「填充选中」按钮）；**点击字段名仅展开/收起**返回类型子字段
 * - **任意深度递归**：FieldRow 递归组件，路径化展开态（path.join(".") 作 key）；
 *   connection 字段可继续展开 nodes/edges（惰性 fieldsOf，深度上限防循环）
 * - **勾选父级 → 默认字段集注入**（fillLeafs：id + 前 3 标量；connection 自动
 *   totalCount+nodes）；父级三态（checked/indeterminate/unchecked）按子树递归；
 *   取消最后一个子项 → 级联移除父
 * - **只有被勾选才写入**：生成 query 严格 = 勾选内容（gqlMapToQuery）
 * - **必填参数 → $var 提取**：勾选带必填参数字段自动生成变量引用（variables 面板
 *   由 M4 接入，此处只保证 query 合法）
 * - **反向同步（手写 → 勾选）**：监听编辑器 query（editorQuery prop），无语法错误时
 *   解析 AST（parseQueryFieldSelections 递归）→ buildSelectionsFromParsed 归一化
 *   → 与当前勾选深比较，不同才更新（不变量 5 收敛稳定）
 * - **内省分组**：底部固定 query/__schema、__type、__typename 三项，默认展开，
 *   点击填充内省查询
 * - **hover 详情**：字段行 title 含返回类型 + 参数清单（name: Type!）+ description
 */
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  buildGqlFieldTree,
  buildSelectionsFromParsed,
  gqlFieldCheckState,
  gqlMapToQuery,
  gqlMapsEqual,
  parseQueryFieldSelections,
  toggleFieldSelection,
  type GqlFieldNode,
  type GqlSchemaContext,
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

/** 递归展开深度上限（防类型环无限展开；connection 典型场景 3 级足够） */
const MAX_DEPTH = 5;

interface FieldRowProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  ctx: GqlSchemaContext;
  opType: "query" | "mutation";
  /** 顶层字段（GqlSelectionMap 的 key root；所有深度共享） */
  root: GqlFieldNode;
  /** 当前行字段 */
  field: GqlFieldNode;
  /** 当前字段路径（[] = root 自身；子字段 = [..., name]） */
  path: string[];
  /** 当前深度 */
  depth: number;
  selected: GqlSelectionMap;
  /** 展开态 map（仅子级 expanded 计算用；自身 expanded 由父级传入布尔，避免无关重绘） */
  expandedPaths: Record<string, boolean>;
  /** 当前行展开态 key（含 opType:root 前缀唯一；父级计算传入） */
  expandedKey: string;
  /** 当前行是否展开（父级从 expandedPaths 读好传入） */
  expanded: boolean;
  onToggleExpand: (pathKey: string) => void;
  /** 勾选/取消（路径化） */
  onToggle: (path: string[]) => void;
}

/** 字段行 title（hover 详情：返回类型 + 参数清单 + desc） */
function fieldTitle(f: GqlFieldNode): string {
  const parts = [`${f.name}: ${f.returnLabel}`];
  if (f.args.length > 0) {
    parts.push(
      `args: ${f.args.map((a) => `${a.name}: ${a.typeLabel}${a.required ? "!" : ""}`).join(", ")}`,
    );
  }
  if (f.desc) parts.push(f.desc);
  return parts.join("\n");
}

/** 单行字段（递归组件）：checkbox 勾选 + 字段名点击展开 + 子字段递归 */
function FieldRow({
  t,
  ctx,
  opType,
  root,
  field,
  path,
  depth,
  selected,
  expandedPaths,
  expandedKey,
  expanded,
  onToggleExpand,
  onToggle,
}: FieldRowProps) {
  // 可展开：非标量且深度未超上限（子字段层或 union possibleTypes）
  const childFields =
    !field.scalar && depth < MAX_DEPTH ? (ctx.fieldsOf(field.ofTypeName) ?? []) : [];
  const expandable = childFields.length > 0 || !!field.possibleTypes;
  const checkState = gqlFieldCheckState(ctx, selected, opType, root, path);
  return (
    <div>
      {/* 字段行：checkbox 勾选（唯一选中动作）+ 点击字段名仅展开 + 右侧展开指示 */}
      <div className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent">
        <Checkbox
          // radix CheckedState：boolean | "indeterminate"（三态原生支持）
          checked={
            checkState === "checked"
              ? true
              : checkState === "indeterminate"
                ? "indeterminate"
                : false
          }
          onCheckedChange={() => onToggle(path)}
          className="size-3.5 shrink-0"
          aria-label={`${t("gql.selectField")} ${field.name}`}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => expandable && onToggleExpand(expandedKey)}
          title={fieldTitle(field)}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              field.deprecated && "text-destructive line-through",
            )}
          >
            {field.name}
          </span>
          {/* 父级后方数字 = 子条目数量（对照 REST tag 端点数语义；args 在 hover title） */}
          {expandable && (
            <span className="shrink-0 rounded bg-muted px-1 text-[9px] leading-3 text-muted-foreground">
              {childFields.length || field.possibleTypes?.length || 0}
            </span>
          )}
          {/* connection 字段徽标（可继续展开 nodes/edges） */}
          {field.isConnection && (
            <span className="shrink-0 rounded bg-violet-500/10 px-1 text-[9px] leading-3 text-violet-600 dark:text-violet-400">
              conn
            </span>
          )}
          {/* 必填参数徽标（$var 提取；hover 看参数清单） */}
          {field.args.some((a) => a.required) && (
            <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] leading-3 text-amber-600 dark:text-amber-400">
              {field.args.filter((a) => a.required).length}▲
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
              onToggleExpand(expandedKey);
            }}
            title={expanded ? "收起" : "展开返回类型字段"}
          >
            <ChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
          </span>
        )}
      </div>
      {/* 展开：子字段递归（任意深度） */}
      {expanded && childFields.length > 0 && (
        <div className="ml-3 border-l border-muted pl-1.5">
          {childFields.map((cf) => (
            <FieldRow
              key={cf.name}
              t={t}
              ctx={ctx}
              opType={opType}
              root={root}
              field={cf}
              path={[...path, cf.name]}
              depth={depth + 1}
              selected={selected}
              expandedPaths={expandedPaths}
              expandedKey={`${expandedKey}.${cf.name}`}
              expanded={!!expandedPaths[`${expandedKey}.${cf.name}`]}
              onToggleExpand={onToggleExpand}
              onToggle={onToggle}
            />
          ))}
          {/* 深度上限提示 */}
          {depth + 1 >= MAX_DEPTH && (
            <p className="px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("gql.depthLimit")}</p>
          )}
        </div>
      )}
      {/* 展开：union possibleTypes 提示 */}
      {expanded && field.possibleTypes && (
        <div className="ml-3 border-l border-muted pl-1.5">
          <p className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {field.possibleTypes.join(" | ")}
          </p>
        </div>
      )}
    </div>
  );
}

interface GqlTreeProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  schema: GraphQLSchema | null;
  /** 惰性字段层解析上下文（DebugPage 由 schema 构建；null = schema 未就绪禁用勾选） */
  gqlCtx: GqlSchemaContext | null;
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
  gqlCtx,
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
  // 字段展开态（`opType:rootName:path` 唯一 key；root 自身 = `opType:rootName`——
  // 修复旧版 path.join(".") 导致 root 全共享 "" key 的全展开 bug）
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  // 勾选集合（顶层字段 key + 嵌套树；状态机在 lib 层）
  const [selected, setSelected] = useState<GqlSelectionMap>({});
  /** 顶层字段树（schema 就绪后构建，含展开浏览数据） */
  const fieldTree: GqlSchemaTree | null = useMemo(
    () => (schema ? buildGqlFieldTree(schema) : null),
    [schema],
  );

  /** 提交勾选集合：更新状态 + 立即重建查询填充（勾选即填充，无独立按钮；仅勾选内容写入） */
  const commitSelection = (next: GqlSelectionMap, opType: "query" | "mutation") => {
    setSelected(next);
    if (gqlCtx) onPickGqlMulti(opType, gqlMapToQuery(gqlCtx, next, opType));
  };

  /** 勾选/取消字段（任意深度路径；root 自身 = []） */
  const toggleField = (opType: "query" | "mutation", root: GqlFieldNode, path: string[]) => {
    if (!gqlCtx) return;
    commitSelection(toggleFieldSelection(gqlCtx, selected, opType, root, path), opType);
  };

  /**
   * 展开/收起（唯一 key；startTransition 低优先级——大字段展开渲染数百行不阻塞输入，
   * React 18 并发分片渲染）。useCallback 稳定引用配合 memo 组件减少无关重绘。
   */
  const toggleExpand = useCallback((pathKey: string) => {
    startTransition(() => setExpandedPaths((s) => ({ ...s, [pathKey]: !s[pathKey] })));
  }, []);

  /**
   * 反向同步（手写 → 勾选）：编辑器 query 变化时解析 AST，无语法错误则自动
   * 添加/移除对应勾选（buildSelectionsFromParsed 归一化：非 schema 字段/内省字段
   * 跳过，对象空 selection 跳过——维持状态机不变量 1/2）。
   * 正向填充（勾选 → 生成 query）也会触发本 effect——解析产物与当前勾选一致则
   * 不更新（不变量 5：正反向收敛，循环稳定）。
   */
  useEffect(() => {
    if (!fieldTree || !gqlCtx) return;
    const parsed = parseQueryFieldSelections(editorQuery);
    if (!parsed) return; // 语法错误 → 不反向同步
    const list = parsed.opType === "query" ? fieldTree.query : fieldTree.mutation;
    const next = buildSelectionsFromParsed(gqlCtx, parsed.opType, parsed.fields, list);
    // 与当前勾选深比较：相等 → 不更新（防循环/无谓渲染；不变量 5 收敛稳定）
    if (!gqlMapsEqual(next, selected)) setSelected(next);
  }, [editorQuery, fieldTree, selected, gqlCtx]);

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
      ) : fieldTree && gqlCtx ? (
        /* query / mutation 分组手风琴（字段可展开返回类型；勾选合并构造；任意深度） */
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
                      const rootKey = `${key}:${f.name}`;
                      return (
                        <FieldRow
                          key={f.name}
                          t={t}
                          ctx={gqlCtx}
                          opType={key}
                          root={f}
                          field={f}
                          path={[]}
                          depth={0}
                          selected={selected}
                          expandedPaths={expandedPaths}
                          expandedKey={rootKey}
                          expanded={!!expandedPaths[rootKey]}
                          onToggleExpand={toggleExpand}
                          onToggle={(path) => toggleField(key, f, path)}
                        />
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
