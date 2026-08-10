/**
 * REST 端点集合树（左栏 API tab · REST 侧）
 *
 * 消费 schema-loader 的智能请求器（IndexedDB 缓存/TTL/SWR/预热）：
 * - **首屏**：只拉 index.json（tag 骨架 + 端点数 + 文件体积）→ 立即渲染 43 个分组
 * - **懒加载**：展开 tag 时才 loadRestTag（req+res-min，毫秒级）→ 显示端点列表
 * - **预热**：后台 preloadAll 已把各 tag 拉入缓存，用户展开时命中缓存零等待
 * 点按端点 → onPickEndpoint（填充方法/路径/参数占位到请求编辑器）。
 */
import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REST_METHOD_COLOR } from "./rest-meta";
import { getRestVersion, loadRestTag } from "./schema-loader";
import type { OpenApiEndpoint, OpenApiGroup, RestTagInfo } from "@/lib/debug-openapi";
import type { LoadResult } from "./schema-loader";

interface RestTreeProps {
  t: (k: string) => string;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
}

/** 单个 tag 分组的懒加载展开内容（缓存命中零等待；未命中显示骨架） */
function TagGroup({
  tag,
  ops,
  t,
  onPickEndpoint,
}: {
  tag: string;
  ops: number;
  t: (k: string) => string;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; group: LoadResult<OpenApiGroup> }
    | { status: "error" }
  >({ status: "idle" });

  const toggle = () => {
    if (state.status === "idle" || state.status === "error") {
      setState({ status: "loading" });
      loadRestTag(tag)
        .then((group) => setState({ status: "ready", group }))
        .catch(() => setState({ status: "error" }));
    } else if (state.status === "ready") {
      setState({ status: "idle" }); // 收起（数据保留，重新展开即 ready）
    }
  };

  const open = state.status === "loading" || state.status === "ready";
  return (
    <div className="mb-0.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium hover:bg-accent"
        onClick={toggle}
      >
        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <span className="truncate">{tag}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{ops}</span>
      </button>
      {state.status === "loading" && (
        <div className="ml-2 space-y-1 border-l border-muted py-1 pl-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
      {state.status === "error" && (
        <p className="ml-2 border-l border-muted py-1 pl-2 text-[10px] text-destructive">
          {t("openapi.loadFailed")}
        </p>
      )}
      {state.status === "ready" && (
        <div className="ml-2 border-l border-muted pl-1">
          {state.group.data.items.map((ep, i) => (
            <button
              key={`${ep.method}-${ep.path}-${i}`}
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
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
          ))}
        </div>
      )}
    </div>
  );
}

export function RestTree({ t, onPickEndpoint }: RestTreeProps) {
  const [index, setIndex] = useState<
    | { status: "loading" }
    | { status: "ready"; tags: RestTagInfo[]; version: string }
    | { status: "error" }
  >({ status: "loading" });
  const [reloadTick, setReloadTick] = useState(0);

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

  return (
    <div className="p-1.5">
      {/* 头部：REST API 集合 + 版本徽章 + 刷新（重拉 index） */}
      <div className="flex items-center gap-1 px-1.5 pb-1">
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
        index.tags.map((tagInfo) => (
          <TagGroup
            key={tagInfo.tag}
            tag={tagInfo.tag}
            ops={tagInfo.ops}
            t={t}
            onPickEndpoint={onPickEndpoint}
          />
        ))
      )}
    </div>
  );
}
