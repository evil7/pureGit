/**
 * 左栏：REST / Graph（接口类型切换，直观选择协议）
 *
 * - 顶部 tab = REST（左）/ Graph（右）——点击切换协议（方法一并切换，
 *   URL 子路径 effect 反向写回 /$debug/rest|graph）
 * - REST → RestTree（端点集合树）；Graph → GqlTree（Schema 树）
 * - 执行历史已迁出左栏 → 独立右侧 HistoryDrawer（请求区常驻 icon 按钮触发）
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RestTree } from "./RestTree";
import { GqlTree } from "./GqlTree";
import { GraphQLLogo } from "./GraphQLLogo";
import type { DebugProtocol } from "@/lib/debug/debug-api";
import type { OpenApiEndpoint } from "@/lib/debug/debug-openapi";
import type { GraphQLSchema } from "graphql";
import type { GqlSchemaContext } from "@/lib/debug/debug-graphql";

interface LeftPanelProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  protocol: DebugProtocol;
  /** 左栏 tab 协议切换（REST/Graph）——方法一并切换（GET/query） */
  onProtocolChange: (p: DebugProtocol) => void;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
  /** 当前匹配的 REST 端点（URL+method 匹配或点选）——对应端点行 hover 显示文档按钮 */
  activeEndpoint: OpenApiEndpoint | null;
  /** 端点文档抽屉是否打开（行内按钮高亮态） */
  docOpen: boolean;
  /** 端点文档抽屉开关（对应端点行 hover 右侧 book icon 触发） */
  onToggleDoc: () => void;
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
  onProtocolChange,
  onPickEndpoint,
  activeEndpoint,
  docOpen,
  onToggleDoc,
  onPickGqlMulti,
  gqlEditorQuery,
  gqlSchema,
  gqlCtx,
  gqlLoading,
  gqlError,
  onGqlReload,
  onPickGqlTemplate,
}: LeftPanelProps) {
  /** 协议 → tab 值（graphql → graph；rest → rest） */
  const tabValue = protocol === "graphql" ? "graph" : "rest";
  return (
    <div className="flex h-full flex-col">
      {/* 受控 Tabs：外部协议变化（方法下拉/URL 子路径）同步高亮；点击切换协议 */}
      <Tabs
        value={tabValue}
        onValueChange={(v) => onProtocolChange(v === "graph" ? "graphql" : "rest")}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* 左栏头部 tabs：四周留边距（顶部/左右 6px），与左侧栏边缘、navbar 对齐 */}
        <TabsList className="mx-1.5 mt-1.5 w-[calc(100%-0.75rem)]">
          <TabsTrigger value="rest" className="flex-1 gap-1.5">
            <GlobeIcon />
            {t("left.rest")}
          </TabsTrigger>
          <TabsTrigger value="graph" className="flex-1 gap-1.5">
            <GraphQLLogo className="size-3.5 text-violet-600 dark:text-violet-400" />
            {t("left.graph")}
          </TabsTrigger>
        </TabsList>

        {/* REST 端点集合树 */}
        <TabsContent value="rest" className="min-h-0 flex-1 overflow-y-auto">
          <RestTree
            t={t}
            onPickEndpoint={onPickEndpoint}
            activeEndpoint={activeEndpoint}
            docOpen={docOpen}
            onToggleDoc={onToggleDoc}
          />
        </TabsContent>

        {/* GraphQL Schema 树 */}
        <TabsContent value="graph" className="min-h-0 flex-1 overflow-y-auto">
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
