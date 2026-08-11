/**
 * REST 端点集合树（左栏 API tab · REST 侧）
 *
 * 消费 schema-loader 的智能请求器（IndexedDB 缓存/TTL/SWR/预热）：
 * - **首屏**：只拉 index.json（tag 骨架 + 端点数）→ 立即渲染 43 个 tag 行
 * - **懒加载**：展开 tag 才 loadRestTag（req+res-min）→ 该 tag 下端点行就绪
 * - **预热**：后台 preloadAll 已把各 tag 拉入缓存，用户展开时命中缓存零等待
 * - **虚拟滚动（大数据量适配）**：与 GqlTree 同款扁平化可见行模型
 *   （@tanstack/react-virtual）——tag/端点/骨架/错误统一为行，只渲染可视区；
 *   **tag 加载状态提升到父组件持有**（行卸载重建不丢加载进度）
 * 点按端点 → onPickEndpoint（填充方法/路径/参数占位到请求编辑器）。
 */
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REST_METHOD_COLOR } from "./rest-meta";
import { getRestVersion, loadRestTag } from "./schema-loader";
import type { LoadResult } from "./schema-loader";
import type { OpenApiEndpoint, OpenApiGroup, RestTagInfo } from "@/lib/debug-openapi";

interface RestTreeProps {
  t: (k: string) => string;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
}

/** 虚拟列表行高估算（px）——tag/端点/骨架/错误行统一紧凑行高 */
const ROW_HEIGHT = 26;
/** 每层缩进（px）——与 GqlTree 同款：基础 6px + 层级 × INDENT（端点/骨架/错误为 tag 的 1 级子层） */
const ROW_INDENT = 14;

/** tag 懒加载状态（提升到 RestTree 持有——虚拟滚动行卸载重建不丢加载进度） */
type TagState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; group: LoadResult<OpenApiGroup> }
  | { status: "error" };

/** 扁平化可见行（tag 分组头 / 端点 / 骨架 / 错误，前序遍历顺序） */
type RestRow =
  | { kind: "tag"; id: string; tag: string; ops: number }
  | { kind: "endpoint"; id: string; ep: OpenApiEndpoint }
  | { kind: "skeleton"; id: string }
  | { kind: "error"; id: string };

/**
 * 扁平化可见行（纯函数）：只遍历已展开 tag——未展开 tag 不深入其端点，
 * 计算量 O(可见行) 而非 O(全量端点)。tag 加载状态决定展开后的骨架/错误/端点行。
 */
function flattenRows(
  tags: RestTagInfo[],
  expanded: Set<string>,
  states: Record<string, TagState>,
): RestRow[] {
  const rows: RestRow[] = [];
  for (const tagInfo of tags) {
    rows.push({ kind: "tag", id: tagInfo.tag, tag: tagInfo.tag, ops: tagInfo.ops });
    if (!expanded.has(tagInfo.tag)) continue;
    const st = states[tagInfo.tag];
    if (!st || st.status === "loading" || st.status === "idle") {
      rows.push({ kind: "skeleton", id: `${tagInfo.tag}:loading` });
    } else if (st.status === "error") {
      rows.push({ kind: "error", id: `${tagInfo.tag}:error` });
    } else {
      for (const ep of st.group.data.items) {
        rows.push({ kind: "endpoint", id: `${tagInfo.tag}:${ep.method}:${ep.path}`, ep });
      }
    }
  }
  return rows;
}

/** tag 分组头行（memo：props 全稳定——row 引用稳定 + 回调稳定） */
const TagRow = memo(function TagRow({
  row,
  expanded,
  onToggleTag,
}: {
  row: Extract<RestRow, { kind: "tag" }>;
  expanded: boolean;
  onToggleTag: (tag: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs font-medium hover:bg-accent"
      onClick={() => onToggleTag(row.tag)}
    >
      <ChevronDown
        className={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform",
          !expanded && "-rotate-90",
        )}
      />
      <span className="truncate">{row.tag}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{row.ops}</span>
    </button>
  );
});

/** 端点行（memo：ep 引用稳定 + onPickEndpoint 稳定） */
const EndpointRow = memo(function EndpointRow({
  row,
  onPickEndpoint,
}: {
  row: Extract<RestRow, { kind: "endpoint" }>;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
}) {
  const { ep } = row;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left hover:bg-accent"
      style={{ paddingLeft: 6 + ROW_INDENT }}
      onClick={() => onPickEndpoint(ep)}
      title={`${ep.method.toUpperCase()} ${ep.path}\n${ep.op.desc ?? ep.op.summary ?? ""}`}
    >
      <span
        className={cn(
          "w-11 shrink-0 font-mono text-[10px] font-semibold",
          REST_METHOD_COLOR[ep.method.toUpperCase()] ?? "text-muted-foreground",
        )}
      >
        {ep.method.toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
        {ep.path}
      </span>
    </button>
  );
});

export function RestTree({ t, onPickEndpoint }: RestTreeProps) {
  const [index, setIndex] = useState<
    | { status: "loading" }
    | { status: "ready"; tags: RestTagInfo[]; version: string }
    | { status: "error" }
  >({ status: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  /** 展开的 tag 集合（Set——toggle 只做集合增删） */
  const [expandedTags, setExpandedTags] = useState<Set<string>>(() => new Set());
  /** tag 懒加载状态表（提升持有；展开触发 loadRestTag，成功后写回） */
  const [tagStates, setTagStates] = useState<Record<string, TagState>>({});
  /** 滚动容器 ref（虚拟列表挂载） */
  const scrollRef = useRef<HTMLDivElement>(null);
  // ref 镜像最新状态（toggleTag 稳定回调不重建，Row memo 不失效）
  const expandedRef = useRef(expandedTags);
  expandedRef.current = expandedTags;
  const statesRef = useRef(tagStates);
  statesRef.current = tagStates;

  // 首次加载 index.json（tag 骨架）；失败允许重试（RefreshCw）
  useEffect(() => {
    let cancelled = false;
    setIndex({ status: "loading" });
    getRestVersion()
      .then((r) => {
        if (cancelled) return;
        setIndex({ status: "ready", tags: r.data.tags, version: r.data.version });
      })
      .catch(() => {
        if (!cancelled) setIndex({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  /**
   * tag 展开/收起 + 首次展开触发懒加载（状态提升持有）。
   * 首次展开（idle/error）→ 置 loading 并发起 loadRestTag；已 ready 直接复用缓存。
   * startTransition 低优先级——展开大量端点行渲染不阻塞点击输入。
   */
  const toggleTag = useCallback((tag: string) => {
    const st = statesRef.current[tag];
    const willExpand = !expandedRef.current.has(tag);
    if (willExpand && (!st || st.status === "idle" || st.status === "error")) {
      setTagStates((prev) => ({ ...prev, [tag]: { status: "loading" } }));
      loadRestTag(tag)
        .then((group) => setTagStates((prev) => ({ ...prev, [tag]: { status: "ready", group } })))
        .catch(() => setTagStates((prev) => ({ ...prev, [tag]: { status: "error" } })));
    }
    startTransition(() =>
      setExpandedTags((prev) => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      }),
    );
  }, []);

  /** 扁平化可见行（依赖 expanded + tagStates；全量 tag 顺序固定） */
  const rows: RestRow[] = useMemo(
    () => (index.status === "ready" ? flattenRows(index.tags, expandedTags, tagStates) : []),
    [index, expandedTags, tagStates],
  );
  /** 虚拟列表：只渲染可视区行（overscan 8），滚动性能与行数无关 */
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    /* 根容器 flex 高度链：标题 shrink-0 + 虚拟滚动区 flex-1（TabsContent 已撑满左栏高度） */
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：REST API 集合 + 版本徽章 + 刷新（重拉 index） */}
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("left.openapi")}
        </p>
        {index.status === "ready" && (
          <span className="rounded bg-muted px-1 py-px font-mono text-[9px] text-muted-foreground">
            {index.version.replace("openapi@", "")}
          </span>
        )}
        <button
          type="button"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setReloadTick((v) => v + 1)}
          title={t("gql.refresh")}
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
      {index.status === "loading" ? (
        <div className="space-y-1.5 px-1.5 py-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : index.status === "error" ? (
        <p className="px-1 py-4 text-center text-xs text-muted-foreground">
          {t("openapi.loadFailed")}
        </p>
      ) : (
        /* 扁平化可见行 + 虚拟滚动（tag/端点/骨架/错误统一为行；只渲染可视区） */
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5">
          <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={row.id}
                  data-index={vi.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {row.kind === "tag" ? (
                    <TagRow row={row} expanded={expandedTags.has(row.id)} onToggleTag={toggleTag} />
                  ) : row.kind === "endpoint" ? (
                    <EndpointRow row={row} onPickEndpoint={onPickEndpoint} />
                  ) : row.kind === "skeleton" ? (
                    <div className="py-0.5" style={{ paddingLeft: 6 + ROW_INDENT }}>
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ) : (
                    <p
                      className="py-0.5 text-[10px] text-destructive"
                      style={{ paddingLeft: 6 + ROW_INDENT }}
                    >
                      {t("openapi.loadFailed")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
