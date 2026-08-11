/**
 * 响应面板（下部：响应状态条 + Body/Headers，固定高度常驻可视）
 *
 * - 响应头部一行：开合按钮 + 返回头/返回体 tabs + 右侧 statusCode/耗时/大小/美化
 * - **空状态 = 端点文档**：从 REST 集合树选中端点但尚未发送时，直接把该端点的
 *   参数表 / 请求体结构 / 响应结构（res-full 懒加载）展示在返回体面板——
 *   替代独立文档抽屉（Postman 同思路），无需额外导航；发送后自动被真实响应覆盖
 * - 返回体：pretty 态用只读 CodeEditor（已格式化）+ 编辑器内右上角复制按钮；raw 态原样 pre
 * - 返回头：K/V 列表
 * - GitHub App 专属端点 401（需 App JWT）顶部提示条
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Copy, Braces, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";
import { loadResFull } from "./schema-loader";
import { METHOD_COLOR } from "./rest-meta";
import type { DebugResult } from "@/lib/debug-api";
import type { OpenApiEndpoint, RestResFullFile } from "@/lib/debug-openapi";

/** 响应体字节数格式化（B/KB/MB） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type ViewMode = "pretty" | "raw";

interface ResponsePanelProps {
  t: (k: string) => string;
  result: DebugResult | null;
  /** 当前选中的 REST 端点（未发送时在返回体面板展示端点文档；GraphQL/无端点为 null） */
  endpoint: OpenApiEndpoint | null;
  respCollapsed: boolean;
  setRespCollapsed: (v: boolean) => void;
  respTab: "body" | "headers";
  setRespTab: (v: "body" | "headers") => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  /** GitHub App 专属端点 401 提示 */
  appJwt401: boolean;
}

export function ResponsePanel({
  t,
  result,
  endpoint,
  respCollapsed,
  setRespCollapsed,
  respTab,
  setRespTab,
  viewMode,
  setViewMode,
  appJwt401,
}: ResponsePanelProps) {
  return (
    /* 折叠时仅保留头部一行（开合按钮收起内容） */
    <div
      className={cn(
        "shrink-0 flex-col overflow-hidden border-t",
        respCollapsed ? "flex" : "flex h-[42%] min-h-60",
      )}
    >
      {/* 响应头部一行：开合按钮 + 返回头/返回体 tabs（返回头在前，默认仍选中返回体）
            + 右侧 statusCode/耗时/大小/视图 */}
      <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
        {/* 响应区开合按钮：展开态 ChevronDown（点击向下关闭），折叠态 ChevronUp */}
        <Button
          variant="ghost"
          size="icon"
          className="mr-0.5 h-7 w-7 shrink-0 rounded-full px-0 text-muted-foreground hover:text-foreground"
          onClick={() => setRespCollapsed(!respCollapsed)}
          title={respCollapsed ? t("response.expand") : t("response.collapse")}
        >
          {respCollapsed ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
        {(
          [
            { value: "headers", label: t("response.headers") },
            { value: "body", label: t("response.body") },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setRespTab(tab.value)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              respTab === tab.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
        {/* 右侧：statusCode（未请求时不显示）→ 耗时/大小 → 美化 */}
        <div className="ml-auto flex items-center gap-2 pl-2">
          {result && (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                result.ok
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400",
              )}
            >
              {result.status}
            </span>
          )}
          {result && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {result.durationMs}
                {t("unit.ms")}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatSize(new TextEncoder().encode(result.bodyText).length)}
              </span>
            </>
          )}
          {/* 美化 Toggle：仅 Braces icon；按下开启 pretty、取消即 raw */}
          <Toggle
            size="xs"
            variant="outline"
            pressed={viewMode === "pretty"}
            onPressedChange={(on) => setViewMode(on ? "pretty" : "raw")}
            title={t("view.pretty")}
            aria-label={t("view.pretty")}
          >
            <Braces />
          </Toggle>
        </div>
      </div>
      {/* 响应内容（flex-1 内滚；折叠时隐藏） */}
      {!respCollapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* GitHub App 专属端点提示（401 JWT） */}
          {appJwt401 && (
            <div className="border-b bg-amber-500/10 px-3 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
              {t("response.appJwtHint")}
            </div>
          )}
          {!result ? (
            /* 空状态：有端点 → 展示端点文档（替代「点击发送」占位）；否则原占位 */
            endpoint ? (
              <ResponseDoc t={t} endpoint={endpoint} />
            ) : (
              <p className="flex h-full items-center justify-center px-3 py-4 text-center text-xs text-muted-foreground">
                {t("response.waiting")}
              </p>
            )
          ) : respTab === "headers" ? (
            Object.keys(result.responseHeaders).length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">—</p>
            ) : (
              <div className="divide-y">
                {Object.entries(result.responseHeaders).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2 px-3 py-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                      {k}
                    </span>
                    <span className="min-w-0 flex-[1.5] break-all font-mono text-[11px]">{v}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* 返回体：pretty 态用只读 CodeEditor（已格式化）+ 编辑器内右上角复制按钮；raw 态原样 pre */
            <div className="h-full min-h-0 p-2">
              {viewMode === "pretty" ? (
                <div className="relative h-full min-h-0">
                  <CodeEditor
                    value={result.networkError ? result.networkError : prettyJson(result.bodyText)}
                    onChange={() => {}}
                    path="body.json"
                    fill
                    readOnly
                    toolbar={false}
                    className="rounded-md"
                  />
                  <CopyButton
                    text={result.networkError ?? result.bodyText}
                    title={t("response.copy")}
                  />
                </div>
              ) : (
                /* raw 态：pre 撑满响应内容区（min-h-full——内容少时占满容器，
                   内容多时自然撑高、外层 overflow-auto 滚动），右上角复制按钮 */
                <div className="relative h-full min-h-0">
                  <pre
                    className={cn(
                      "m-0 min-h-full px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all",
                      !result.ok && "text-destructive",
                    )}
                  >
                    {result.networkError ? result.networkError : result.bodyText}
                  </pre>
                  <CopyButton
                    text={result.networkError ?? result.bodyText}
                    title={t("response.copy")}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 复制按钮（pretty/raw 右上角共用） */
function CopyButton({ text, title }: { text: string; title: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="absolute right-2 top-2 z-10 h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => {});
      }}
      title={title}
    >
      <Copy className="size-3.5" />
    </Button>
  );
}

/** JSON 美化（网络错误原样返回；非法 JSON 原样返回） */
function prettyJson(text: string): string {
  if (!text?.trim()) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* ── 空状态：端点文档（参数表 / 请求体结构 / 响应结构） ──── */

/** JSON-schema 树渲染：字段名 / 类型徽章 / 必填 / desc，嵌套逐层展开 */
function SchemaTree({
  t,
  schema,
  depth = 0,
}: {
  t: (k: string) => string;
  schema: unknown;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  if (typeof schema !== "object" || schema === null) return null;
  const s = schema as Record<string, unknown>;
  const type =
    typeof s.type === "string" ? s.type : s.properties ? "object" : s.items ? "array" : "any";
  const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);
  const props = s.properties as Record<string, unknown> | undefined;
  // 组合分支（oneOf/anyOf：多形态 schema；allOf 合并已由 deref 展开，防御性保留）
  const branches = (s.oneOf ?? s.anyOf ?? (s.allOf ? [s.allOf] : undefined)) as
    | unknown[]
    | undefined;

  // 组合分支 → 渲染分支列表（标题/类型 + 子树）
  if (branches) {
    return (
      <div className="pl-1">
        <button
          type="button"
          className="flex w-full items-center gap-1 py-0.5 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {s.oneOf ? "oneOf" : s.anyOf ? "anyOf" : "allOf"} ({branches.length})
          </span>
          {typeof s.description === "string" && (
            <span className="truncate text-[10px] text-muted-foreground">{s.description}</span>
          )}
        </button>
        {expanded && (
          <div className="ml-2 border-l border-muted pl-2">
            {branches.map((branch, i) => {
              const b = (branch ?? {}) as Record<string, unknown>;
              const title =
                typeof b.title === "string"
                  ? b.title
                  : typeof b.type === "string"
                    ? b.type
                    : "variant";
              return (
                <div key={i} className="py-0.5">
                  <span className="font-mono text-[10px] font-medium">{title}</span>
                  <SchemaTree t={t} schema={branch} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 叶子（标量/枚举）→ 单行：类型徽章 + desc
  if (!props && !s.items) {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {Array.isArray(s.enum) ? `enum(${s.enum.length})` : type}
        </span>
        {typeof s.description === "string" && (
          <span className="truncate text-[10px] text-muted-foreground">{s.description}</span>
        )}
      </div>
    );
  }

  // 对象/数组 → 可展开的字段列表
  const title = s.items
    ? `array<${typeof (s.items as Record<string, unknown>)?.type === "string" ? (s.items as Record<string, unknown>).type : "object"}>`
    : "object";
  return (
    <div className="pl-1">
      <button
        type="button"
        className="flex w-full items-center gap-1 py-0.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{title}</span>
        {typeof s.description === "string" && (
          <span className="truncate text-[10px] text-muted-foreground">{s.description}</span>
        )}
      </button>
      {expanded && (
        <div className="ml-2 border-l border-muted pl-2">
          {props &&
            Object.entries(props).map(([name, child]) => (
              <div key={name} className="py-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[11px]",
                      required.has(name) && "font-semibold",
                    )}
                  >
                    {name}
                  </span>
                  {required.has(name) && (
                    <span className="shrink-0 rounded bg-red-500/10 px-1 text-[9px] leading-3 text-red-600 dark:text-red-400">
                      {t("doc.required")}
                    </span>
                  )}
                </div>
                <SchemaTree t={t} schema={child} depth={depth + 1} />
              </div>
            ))}
          {s.items ? <SchemaTree t={t} schema={s.items} depth={depth + 1} /> : null}
        </div>
      )}
    </div>
  );
}

/** 响应状态码列表：进入即自动加载 res-full，**默认展开第一个 2xx（通常 200）** */
function ResponseSchemas({
  t,
  tag,
  path,
  method,
}: {
  t: (k: string) => string;
  tag: string;
  path: string;
  method: string;
}) {
  const [full, setFull] = useState<RestResFullFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // 端点变化 → 自动加载 res-full（缓存命中秒开）；默认展开第一个 2xx
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setFull(null);
    setOpen(null);
    loadResFull(tag)
      .then((r) => {
        if (cancelled) return;
        setFull(r.data);
        const resp = (r.data.paths?.[path]?.[method as keyof (typeof r.data.paths)[string]] ??
          null) as Record<string, unknown> | null;
        if (resp) {
          const codes = Object.keys(resp).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true }),
          );
          const first2xx = codes.find((c) => c.startsWith("2"));
          if (first2xx) setOpen(first2xx);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, path, method]);

  const responses = (full?.paths?.[path]?.[method as keyof (typeof full.paths)[string]] ??
    null) as Record<string, unknown> | null;
  const codes = responses
    ? Object.keys(responses).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];

  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("doc.responses")}
      </p>
      {loading && (
        <div className="space-y-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      )}
      {error && (
        <p className="text-[10px] text-destructive">
          {t("doc.loadFailed")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setError(false);
              setLoading(true);
              loadResFull(tag)
                .then((r) => setFull(r.data))
                .catch(() => setError(true))
                .finally(() => setLoading(false));
            }}
          >
            {t("gql.retry")}
          </button>
        </p>
      )}
      {full && (
        <div className="space-y-1">
          {codes.length === 0 && (
            <p className="text-[10px] text-muted-foreground">{t("doc.noResponses")}</p>
          )}
          {codes.map((code) => {
            const resp = (responses?.[code] ?? {}) as Record<string, unknown>;
            const desc = typeof resp.description === "string" ? resp.description : "";
            const isOpen = open === code;
            return (
              <div key={code}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                  onClick={() => setOpen(isOpen ? null : code)}
                >
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] font-semibold",
                      code.startsWith("2")
                        ? "text-emerald-600 dark:text-emerald-400"
                        : code.startsWith("4") || code.startsWith("5")
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {code}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">{desc}</span>
                </button>
                {isOpen && (
                  <div className="ml-3 border-l border-muted pl-2">
                    {resp.content ? (
                      Object.entries(resp.content as Record<string, unknown>).map(([ct, c]) => (
                        <div key={ct} className="py-1">
                          <span className="font-mono text-[9px] text-muted-foreground">{ct}</span>
                          <SchemaTree
                            t={t}
                            schema={(c as Record<string, unknown>)?.schema}
                            depth={1}
                          />
                        </div>
                      ))
                    ) : (
                      <p className="py-1 text-[10px] text-muted-foreground">{t("doc.noBody")}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 空状态端点文档：方法/路径 + summary/desc + 参数表 + 请求体结构 + 响应结构 */
function ResponseDoc({ t, endpoint }: { t: (k: string) => string; endpoint: OpenApiEndpoint }) {
  const { path, method, op } = endpoint;
  const params = op.params ?? [];
  const bodyCts = op.bodyTypes ?? [];
  const bodySchema =
    op.body?.["application/json"] ??
    op.body?.[bodyCts.find((c) => c !== "application/json") ?? ""] ??
    null;

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* 头部：方法徽标 + 路径 + summary/desc */}
      <div className="mb-3 flex items-start gap-2">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
            METHOD_COLOR[method.toUpperCase()] ?? "text-muted-foreground",
          )}
        >
          {method.toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-xs">{path}</p>
          {op.summary && <p className="mt-0.5 text-xs font-medium">{op.summary}</p>}
          {op.desc && (
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {op.desc}
            </p>
          )}
        </div>
      </div>

      {/* 参数表 */}
      {params.length > 0 && (
        <section className="mb-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("doc.params")} ({params.length})
          </p>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-muted/50">
                <tr className="text-muted-foreground">
                  <th className="px-2 py-1 font-medium">{t("doc.paramName")}</th>
                  <th className="px-2 py-1 font-medium">{t("doc.paramIn")}</th>
                  <th className="px-2 py-1 font-medium">{t("doc.paramType")}</th>
                  <th className="px-2 py-1 font-medium">{t("doc.paramRequired")}</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={`${p.in}-${p.name}`} className="border-t">
                    <td className="px-2 py-1 font-mono">{p.name}</td>
                    <td className="px-2 py-1 text-muted-foreground">{p.in}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{p.type ?? "any"}</td>
                    <td className="px-2 py-1">
                      {p.required ? (
                        <span className="rounded bg-red-500/10 px-1 text-[9px] text-red-600 dark:text-red-400">
                          {t("doc.required")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 请求体结构 */}
      {bodySchema && (
        <section className="mb-4">
          <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Info className="size-3" />
            {t("doc.requestBody")}
            {bodyCts.length > 0 && (
              <span className="font-mono normal-case text-muted-foreground">
                {bodyCts.join(", ")}
              </span>
            )}
          </p>
          <SchemaTree t={t} schema={bodySchema} depth={0} />
        </section>
      )}

      {/* 响应结构 */}
      <ResponseSchemas t={t} tag={endpoint.tag} path={path} method={method} />
    </div>
  );
}
