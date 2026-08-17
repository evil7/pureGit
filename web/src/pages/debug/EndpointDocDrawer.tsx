/**
 * 端点文档 Drawer（右侧抽屉，`/$debug` REST 端点完整文档展示）
 *
 * 文档从返回面板空状态迁移至此：点 URL 框右侧 book icon 按钮触发，
 * 以独立右侧抽屉完整展示当前匹配端点的文档——方法/路径 + summary/desc +
 * 参数表（含 desc）+ 请求体结构（JSON-schema 树）+ 响应结构（res-full 懒加载）。
 * 与请求区「参数 tab」对照：表格负责设值，drawer 负责完整查阅。
 */
import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { loadResFull } from "./schema-loader";
import { METHOD_COLOR } from "./rest-meta";
import type { OpenApiEndpoint, RestResFullFile } from "@/lib/debug/debug-openapi";

/** 文档区段标题（参数/请求体/响应统一：无图标，可选 hint 后缀如 content-type/计数） */
function DocSectionTitle({ label, hint }: { label: string; hint?: string }) {
  return (
    <p className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      {hint && (
        <span className="font-mono text-[10px] normal-case text-muted-foreground/80">{hint}</span>
      )}
    </p>
  );
}

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
      <DocSectionTitle label={t("doc.responses")} />
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

interface EndpointDocDrawerProps {
  t: (k: string) => string;
  /** 当前匹配的 REST 端点（未匹配时 drawer 关闭） */
  endpoint: OpenApiEndpoint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 右侧文档抽屉：完整端点文档（头部 + 参数表 + 请求体结构 + 响应结构） */
export function EndpointDocDrawer({ t, endpoint, open, onOpenChange }: EndpointDocDrawerProps) {
  const { path, method, op } = endpoint ?? { path: "", method: "get" as const, op: { params: [] } };
  const params = op.params ?? [];
  const bodyCts = op.bodyTypes ?? [];
  const bodySchema =
    op.body?.["application/json"] ??
    op.body?.[bodyCts.find((c) => c !== "application/json") ?? ""] ??
    null;
  const tag = endpoint?.tag ?? "";
  const methodUpper = method.toUpperCase();

  return (
    <Drawer direction="right" open={open && !!endpoint} onOpenChange={onOpenChange}>
      {/* 右侧文档抽屉：宽 2/3 总宽（vaul 默认 w-3/4 + sm:max-w-sm 太窄，
         文档长表/深 schema 阅读舒适；须同时清 max-width 否则 24rem 卡住） */}
      <DrawerContent className="w-2/3! max-w-none!">
        <div className="flex h-full flex-col">
          {/* 头部：方法徽标 + 路径 + summary/desc + tag */}
          <DrawerHeader className="border-b">
            <div className="flex items-start justify-between gap-2">
              {/* 方法徽标 + 路径：统一放大（徽标 text-xs 与 text-sm 路径视觉协调、垂直居中） */}
              <DrawerTitle className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 font-mono text-xs font-bold leading-none",
                    METHOD_COLOR[methodUpper] ?? "text-muted-foreground",
                  )}
                >
                  {methodUpper}
                </span>
                <span className="truncate font-mono text-sm">{path}</span>
              </DrawerTitle>
              <DrawerCloseButton t={t} />
            </div>
            {tag && <span className="text-[10px] text-muted-foreground">{tag}</span>}
            <DrawerDescription asChild>
              <div className="min-w-0">
                {op.summary && <p className="text-xs font-medium text-foreground">{op.summary}</p>}
                {op.desc && (
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {op.desc}
                  </p>
                )}
              </div>
            </DrawerDescription>
          </DrawerHeader>

          {/* 文档主体（内滚） */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* 参数表（含 desc 完整列） */}
            {params.length > 0 && (
              <section className="mb-4">
                <DocSectionTitle label={`${t("doc.params")} (${params.length})`} />
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-left text-[10px]">
                    <thead className="bg-muted/50">
                      <tr className="text-muted-foreground">
                        <th className="px-2 py-1 font-medium">{t("doc.paramName")}</th>
                        <th className="px-2 py-1 font-medium">{t("doc.paramIn")}</th>
                        <th className="px-2 py-1 font-medium">{t("doc.paramType")}</th>
                        <th className="px-2 py-1 font-medium">{t("doc.paramRequired")}</th>
                        <th className="px-2 py-1 font-medium">{t("doc.paramDesc")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((p) => (
                        <tr key={`${p.in}-${p.name}`} className="border-t">
                          <td className="px-2 py-1 font-mono">{p.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">{p.in}</td>
                          <td className="px-2 py-1 font-mono text-muted-foreground">
                            {p.type ?? "any"}
                          </td>
                          <td className="px-2 py-1">
                            {p.required ? (
                              <span className="rounded bg-red-500/10 px-1 text-[9px] text-red-600 dark:text-red-400">
                                {t("doc.required")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{p.desc ?? "—"}</td>
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
                <DocSectionTitle
                  label={t("doc.requestBody")}
                  hint={bodyCts.length > 0 ? bodyCts.join(", ") : undefined}
                />
                <SchemaTree t={t} schema={bodySchema} depth={0} />
              </section>
            )}

            {/* 响应结构 */}
            <ResponseSchemas t={t} tag={tag} path={path} method={method} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** 右上角关闭按钮（DrawerHeader 内） */
function DrawerCloseButton({ t }: { t: (k: string) => string }) {
  return (
    <DrawerClose asChild>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground"
        title={t("doc.close")}
        aria-label={t("doc.close")}
      >
        <X className="size-3.5" />
      </Button>
    </DrawerClose>
  );
}
