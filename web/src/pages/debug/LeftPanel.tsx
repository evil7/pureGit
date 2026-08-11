/**
 * 左栏：历史 / API（API 按协议切换内容）+ 底部缓存进度条
 *
 * - History：执行历史（请求 + 结果摘要 + 身份 + 时间；autoSave 开关 / 清空）
 * - API：protocol === graphql → GqlTree（Schema 树）；rest → RestTree（端点集合树）
 * - **底部缓存进度条**：订阅 schema-loader 的 onPreloadProgress——后台预热 / 过期刷新
 *   时显示「正在预载 schema 数据 N/M」（shadcn Progress 细条，低对比不打扰）；
 *   空闲时隐藏。后台任务不影响正常使用，但能视觉感知。
 */
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RestTree } from "./RestTree";
import { GqlTree } from "./GqlTree";
import { GraphQLLogo } from "./GraphQLLogo";
import { REST_METHOD_COLOR, statusColorClass } from "./rest-meta";
import type { HistoryItem } from "@/lib/debug-store";
import type { DebugProtocol } from "@/lib/debug-api";
import type { OpenApiEndpoint } from "@/lib/debug-openapi";
import type { GraphQLSchema } from "graphql";
import type { GqlSchemaContext } from "@/lib/debug-graphql";

interface LeftPanelProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  protocol: DebugProtocol;
  history: HistoryItem[];
  autoSave: boolean;
  setAutoSave: (v: boolean) => void;
  onReplay: (item: HistoryItem) => void;
  onClearHistory: () => void;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
  /** GraphQL 勾选合并 → 填充请求（query 空字符串 = 清空） */
  onPickGqlMulti: (opType: "query" | "mutation", query: string) => void;
  /** 当前编辑器 GraphQL 查询文本（反向同步到勾选） */
  gqlEditorQuery: string;
  /** GraphQL Schema（受控；DebugPage 统一持有，供 GqlTree 与编辑器补全共用） */
  gqlSchema: GraphQLSchema | null;
  /** GraphQL 惰性字段层解析上下文（schema 就绪后由 DebugPage 构建，透传 GqlTree） */
  gqlCtx: GqlSchemaContext | null;
  gqlLoading: boolean;
  gqlError: boolean;
  onGqlReload: () => void;
  onPickGqlTemplate: (query: string, method: "query" | "mutation") => void;
}

export function LeftPanel({
  t,
  protocol,
  history,
  autoSave,
  setAutoSave,
  onReplay,
  onClearHistory,
  onPickEndpoint,
  onPickGqlMulti,
  gqlEditorQuery,
  gqlSchema,
  gqlCtx,
  gqlLoading,
  gqlError,
  onGqlReload,
  onPickGqlTemplate,
}: LeftPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="history" className="flex min-h-0 flex-1 flex-col">
        {/* 左栏头部 tabs：四周留边距（顶部/左右 6px），与左侧栏边缘、navbar 对齐 */}
        <TabsList className="mx-1.5 mt-1.5 w-[calc(100%-0.75rem)]">
          <TabsTrigger value="history" className="flex-1 gap-1.5">
            <HistoryIcon className="size-3.5" />
            {t("left.history")}
          </TabsTrigger>
          <TabsTrigger value="api" className="flex-1 gap-1.5" title={t("left.openapi")}>
            {protocol === "graphql" ? (
              <GraphQLLogo className="size-3.5 text-violet-600 dark:text-violet-400" />
            ) : (
              <GlobeIcon />
            )}
            API
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto">
          {/* 顶部小型操作栏：(switch) 自动保存 ｜ (count 徽章) (清空 icon) */}
          <div className="flex items-center justify-between gap-2 px-2 pt-1.5">
            <label
              className="flex cursor-pointer items-center gap-1"
              title={t("option.saveHistory")}
            >
              <Switch checked={autoSave} onCheckedChange={setAutoSave} className="scale-75" />
              <span className="text-[10px] text-muted-foreground">{t("option.saveHistory")}</span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-4 text-muted-foreground">
                {history.length}
              </span>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={onClearHistory}
                title={t("history.clear")}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {t("history.empty")}
            </p>
          ) : (
            <div className="space-y-1 p-2">
              {history.map((item) => {
                const gql = item.request.protocol === "graphql";
                const methodLabel = gql ? "GQL" : item.request.method;
                return (
                  /* 整行可点击 = 填充请求数据到编辑器（不自动发送，用户可改后再发送） */
                  <button
                    key={item.id}
                    type="button"
                    className="block w-full cursor-pointer rounded-md px-1.5 py-1 text-left hover:bg-accent"
                    onClick={() => onReplay(item)}
                    title={t("history.fill")}
                  >
                    {/* 第一行：method 徽章（最左，Postman 视觉锚点）+ URL/查询文本 */}
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold leading-4",
                          gql
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "bg-accent/70 " +
                                (REST_METHOD_COLOR[item.request.method] ?? "text-muted-foreground"),
                        )}
                      >
                        {methodLabel}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {gql ? item.request.query.slice(0, 40) : item.request.url}
                      </span>
                    </span>
                    {/* 第二行：状态码（3 位补零，失败 0 → 000；仅字体颜色）+ 耗时 · 身份 */}
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      <span className={cn("font-semibold", statusColorClass(item.result.status))}>
                        {String(item.result.status).padStart(3, "0")}
                      </span>
                      {" · "}
                      {item.result.durationMs}ms · {item.identity}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* API 集合：按协议显示不同内容 */}
        <TabsContent value="api" className="min-h-0 flex-1 overflow-y-auto">
          {protocol === "graphql" ? (
            <GqlTree
              t={t}
              schema={gqlSchema}
              gqlCtx={gqlCtx}
              editorQuery={gqlEditorQuery}
              loading={gqlLoading}
              error={gqlError}
              onReload={onGqlReload}
              onPickGqlMulti={onPickGqlMulti}
              onPickGqlTemplate={onPickGqlTemplate}
            />
          ) : (
            <RestTree t={t} onPickEndpoint={onPickEndpoint} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** REST 地球图标（协议切换用，独立于 lucide Globe 以保持语义） */
function GlobeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 text-emerald-600 dark:text-emerald-400"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}
