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
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
/** 虚拟列表行高估算（px）——header/字段/模板行统一紧凑行高 */
const ROW_HEIGHT = 24;
/** 每层缩进（px）——字段行 paddingLeft = 基础 6px + depth × INDENT（多级层级递进） */
const ROW_INDENT = 14;

/** 虚拟列表可见行（扁平化渲染模型：分组头 / 字段 / 内省模板三种行，前序遍历顺序） */
type GqlRow =
  | { kind: "header"; id: string; label: string; count: number }
  | {
      kind: "field";
      id: string;
      opType: "query" | "mutation";
      /** 顶层字段引用（三态/勾选沿 root 路径解析） */
      root: GqlFieldNode;
      field: GqlFieldNode;
      path: string[];
      depth: number;
      /** 可展开（非标量且深度未超上限） */
      expandable: boolean;
    }
  | { kind: "preset"; id: string; name: string; query: string };

/** 字段行唯一 id：`opType:rootName[:path]`（root 自身 = `opType:rootName`；修复旧 path.join 共享 key bug） */
function fieldRowId(opType: string, rootName: string, path: string[]): string {
  return path.length === 0 ? `${opType}:${rootName}` : `${opType}:${rootName}:${path.join(".")}`;
}

/** 分组头 id（query/mutation/introspection 统一命名空间） */
function groupRowId(opType: string): string {
  return `group:${opType}`;
}

/**
 * 扁平化可见行（纯函数）：DFS 前序遍历，仅深入「已展开」的节点——
 * 未展开子树不遍历，计算量 O(可见行) 而非 O(全树)。selected 不参与（勾选不重建行数组）。
 */
function flattenRows(tree: GqlSchemaTree, ctx: GqlSchemaContext, expanded: Set<string>): GqlRow[] {
  const rows: GqlRow[] = [];
  for (const opType of ["query", "mutation"] as const) {
    const fields = opType === "query" ? tree.query : tree.mutation;
    const groupId = groupRowId(opType);
    rows.push({ kind: "header", id: groupId, label: opType, count: fields.length });
    if (!expanded.has(groupId)) continue;
    for (const root of fields) {
      walkField(ctx, rows, expanded, opType, root, root, [], 0);
    }
  }
  const introId = groupRowId("introspection");
  rows.push({
    kind: "header",
    id: introId,
    label: "introspection",
    count: INTROSPECTION_PRESETS.length,
  });
  if (expanded.has(introId)) {
    for (const p of INTROSPECTION_PRESETS) {
      rows.push({ kind: "preset", id: `preset:${p.name}`, name: p.name, query: p.query });
    }
  }
  return rows;
}

/** DFS 单字段展开（扁平化核心）：push 当前行；已展开且未超深度 → 递归子字段 */
function walkField(
  ctx: GqlSchemaContext,
  rows: GqlRow[],
  expanded: Set<string>,
  opType: "query" | "mutation",
  root: GqlFieldNode,
  field: GqlFieldNode,
  path: string[],
  depth: number,
): void {
  const id = fieldRowId(opType, root.name, path);
  const childFields =
    !field.scalar && depth < MAX_DEPTH ? (ctx.fieldsOf(field.ofTypeName) ?? []) : [];
  rows.push({
    kind: "field",
    id,
    opType,
    root,
    field,
    path,
    depth,
    expandable: childFields.length > 0 || !!field.possibleTypes,
  });
  if (!expanded.has(id) || childFields.length === 0) return;
  for (const cf of childFields) {
    walkField(ctx, rows, expanded, opType, root, cf, [...path, cf.name], depth + 1);
  }
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

interface RowProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  ctx: GqlSchemaContext;
  row: GqlRow;
  /** 展开态（当前行是否展开；父级算好传入，memo 比较快） */
  expanded: boolean;
  /** 三态（主组件算好传入——selected 变化只重算可视行） */
  checkState: "checked" | "indeterminate" | "unchecked";
  onToggleGroup: (groupId: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleField: (row: Extract<GqlRow, { kind: "field" }>) => void;
  onPickGqlTemplate: (query: string, method: "query" | "mutation") => void;
}

/** 单行渲染（memo：props 全稳定——field/root 引用不变、checkState 字符串、expanded 布尔、回调 useCallback） */
const Row = memo(function Row({
  t,
  ctx,
  row,
  expanded,
  checkState,
  onToggleGroup,
  onToggleExpand,
  onToggleField,
  onPickGqlTemplate,
}: RowProps) {
  // 分组头行
  if (row.kind === "header") {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-xs font-medium hover:bg-accent"
          onClick={() => onToggleGroup(row.id)}
        >
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              !expanded && "-rotate-90",
            )}
          />
          <span className="font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
            {row.label}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">{row.count}</span>
        </button>
      </div>
    );
  }
  // 内省模板行（分组下 1 级子层：固定 1 级缩进）
  if (row.kind === "preset") {
    return (
      <div className="flex items-center" style={{ paddingLeft: 6 + ROW_INDENT }}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-accent"
          onClick={() => onPickGqlTemplate(row.query, "query")}
          title={row.query}
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.name}</span>
        </button>
      </div>
    );
  }
  // 字段行（缩进按 depth 递增：顶层 0 级，每展开一层 +1 级）
  const { field } = row;
  return (
    <div
      className="flex items-center gap-1 rounded py-0.5 pr-1.5 hover:bg-accent"
      style={{ paddingLeft: 6 + row.depth * ROW_INDENT }}
    >
      <Checkbox
        checked={
          checkState === "checked" ? true : checkState === "indeterminate" ? "indeterminate" : false
        }
        onCheckedChange={() => onToggleField(row)}
        className="size-3.5 shrink-0"
        aria-label={`${t("gql.selectField")} ${field.name}`}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() => row.expandable && onToggleExpand(row.id)}
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
        {row.expandable && (
          <span className="shrink-0 rounded bg-muted px-1 text-[9px] leading-3 text-muted-foreground">
            {(ctx?.fieldsOf(field.ofTypeName) ?? []).length || field.possibleTypes?.length || 0}
          </span>
        )}
        {field.isConnection && (
          <span className="shrink-0 rounded bg-violet-500/10 px-1 text-[9px] leading-3 text-violet-600 dark:text-violet-400">
            conn
          </span>
        )}
        {field.args.some((a) => a.required) && (
          <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] leading-3 text-amber-600 dark:text-amber-400">
            {field.args.filter((a) => a.required).length}▲
          </span>
        )}
      </button>
      {row.expandable && (
        <span
          role="button"
          tabIndex={-1}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(row.id);
          }}
          title={expanded ? "收起" : "展开返回类型字段"}
        >
          <ChevronDown className={cn("size-3 transition-transform", !expanded && "-rotate-90")} />
        </span>
      )}
    </div>
  );
});

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
  // 展开态（Set<string>：分组头 id `group:opType` + 字段 id `opType:root[:path]`）——
  // query/mutation/introspection 分组默认展开
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["group:query", "group:mutation", "group:introspection"]),
  );
  // 勾选集合（顶层字段 key + 嵌套树；状态机在 lib 层）
  const [selected, setSelected] = useState<GqlSelectionMap>({});
  /** 顶层字段树（schema 就绪后构建，含展开浏览数据） */
  const fieldTree: GqlSchemaTree | null = useMemo(
    () => (schema ? buildGqlFieldTree(schema) : null),
    [schema],
  );
  /** 滚动容器 ref（虚拟列表挂载） */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 扁平化可见行（依赖 expanded——勾选 selected 不参与，勾选不重建行数组） */
  const visibleRows: GqlRow[] = useMemo(
    () => (fieldTree && gqlCtx ? flattenRows(fieldTree, gqlCtx, expanded) : []),
    [fieldTree, gqlCtx, expanded],
  );
  /** 虚拟列表：只渲染可视区行（overscan 8），滚动性能与行数无关 */
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  /** 提交勾选集合：更新状态 + 立即重建查询填充（勾选即填充，无独立按钮；仅勾选内容写入） */
  const commitSelection = useCallback(
    (next: GqlSelectionMap, opType: "query" | "mutation") => {
      setSelected(next);
      if (gqlCtx) onPickGqlMulti(opType, gqlMapToQuery(gqlCtx, next, opType));
    },
    [gqlCtx, onPickGqlMulti],
  );

  /** 勾选/取消字段（行引用传入；状态机按 opType/root/path 切换） */
  const toggleField = useCallback(
    (row: Extract<GqlRow, { kind: "field" }>) => {
      if (!gqlCtx) return;
      commitSelection(
        toggleFieldSelection(gqlCtx, selected, row.opType, row.root, row.path),
        row.opType,
      );
    },
    [gqlCtx, selected, commitSelection],
  );

  /** 分组头展开/收起（startTransition 低优先级——切换分组渲染大量行不阻塞输入） */
  const toggleGroup = useCallback((groupId: string) => {
    startTransition(() =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      }),
    );
  }, []);

  /** 字段展开/收起（Set 操作 + startTransition） */
  const toggleExpand = useCallback((id: string) => {
    startTransition(() =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    );
  }, []);

  /**
   * 反向同步（手写 → 勾选）：编辑器 query 变化时解析 AST，无语法错误则自动
   * 添加/移除对应勾选（buildSelectionsFromParsed 递归归一化：非 schema 字段/内省字段
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
    /* 根容器 flex 高度链：标题 shrink-0 + 虚拟滚动区 flex-1（TabsContent 已撑满左栏高度） */
    <div className="flex h-full min-h-0 flex-col">
      {/* Schema 区：标题 + 右侧 加载/刷新 按钮 */}
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-1.5">
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
        /* 扁平化可见行 + 虚拟滚动（分组头/字段/内省模板统一为行；只渲染可视区）
         * 每个虚拟项必须绝对定位（top:0 + translateY(vi.start)）到虚拟位置——
         * 缺定位所有行会堆叠文档流顶部，滚动后可视区只剩虚拟高度空白（白屏 bug） */
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5">
          <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = visibleRows[vi.index];
              const checkState =
                row.kind === "field"
                  ? gqlFieldCheckState(gqlCtx, selected, row.opType, row.root, row.path)
                  : "unchecked";
              return (
                <div
                  key={row.id}
                  data-index={vi.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <Row
                    t={t}
                    ctx={gqlCtx}
                    row={row}
                    expanded={expanded.has(row.id)}
                    checkState={checkState}
                    onToggleGroup={toggleGroup}
                    onToggleExpand={toggleExpand}
                    onToggleField={toggleField}
                    onPickGqlTemplate={onPickGqlTemplate}
                  />
                </div>
              );
            })}
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
