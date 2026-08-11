/**
 * 请求编辑器（上部：请求行 + 请求 Tabs + 当前 Tab 内容）
 *
 * Postman 风格：请求行（方法下拉 + URL + Send）+ Tabs（REST Headers/Body；
 * GraphQL Query/Variables/Headers）+ Body 类型快速切换（JSON/FormUrl/FormData/Raw）。
 * - 方法下拉：RESTful（GET/HEAD/POST/PATCH/PUT/DELETE/OPTIONS）/ GraphQL（query/mutation），
 *   选方法即定协议；切 REST 自动规整 URL、POST/PUT 默认 JSON、GET/HEAD/OPTIONS 无请求数据
 * - Headers：必填锁定行 + token 行（Authorization）+ 用户行（KeyValueTable）
 * - GraphQL Query：CodeEditor 挂 cm6-graphql schema 驱动补全（字段/参数/枚举 + 诊断）
 * - Body：json/text 用 CodeEditor；form 用 KeyValueTable；none 提示
 */
import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, List, Save, Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/SegmentedControl";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";
import { KeyValueTable } from "./KeyValueTable";
import { ParamsTable } from "./ParamsTable";
import { GqlVariablesPanel } from "./GqlVariablesPanel";
import { GraphQLLogo } from "./GraphQLLogo";
import { buildUrlFromParams, syncParamsFromUrl, type DocParams } from "@/lib/debug-params";
import { METHOD_COLOR, REST_API_BASE, normalizeRestUrl, CT_BY_BODY } from "./rest-meta";
import type { DebugRequest, BodyType, HeaderRow } from "@/lib/debug-api";
import type { OpenApiEndpoint } from "@/lib/debug-openapi";
import type { GraphQLSchema } from "graphql";

const REST_METHODS = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] as const;
const GQL_METHODS = ["query", "mutation"] as const;

interface RequestEditorProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  req: DebugRequest;
  /** 请求更新：patch 或全量 updater（方法切换/bodyType 需读取当前值） */
  set: (update: Partial<DebugRequest> | ((r: DebugRequest) => DebugRequest)) => void;
  tokenPlaceholder: string;
  requiredHeaders: HeaderRow[];
  gqlSchema: GraphQLSchema | null;
  /** 当前 REST 端点的 requestBody schema（json content-type；字段级补全数据源） */
  bodySchema: Record<string, unknown> | null;
  /** 当前匹配的 REST 端点（URL+method 匹配或点选；未匹配为 null）——参数表对照文档 */
  endpoint: OpenApiEndpoint | null;
  /** 端点文档抽屉是否打开（book icon 按钮高亮态） */
  docOpen: boolean;
  /** 端点文档抽屉开关（URL 框右侧 book icon 触发；仅匹配到端点时可用） */
  onToggleDoc: () => void;
  setFormFile: (i: number, file: File | null) => void;
  running: boolean;
  onRun: () => void;
  onSaveHistory: () => void;
  canSaveHistory: boolean;
  autoSave: boolean;
  leftHidden: boolean;
  onToggleLeft: () => void;
}

export function RequestEditor({
  t,
  req,
  set,
  tokenPlaceholder,
  requiredHeaders,
  gqlSchema,
  bodySchema,
  endpoint,
  docOpen,
  onToggleDoc,
  setFormFile,
  running,
  onRun,
  onSaveHistory,
  canSaveHistory,
  autoSave,
  leftHidden,
  onToggleLeft,
}: RequestEditorProps) {
  // ── 请求 Tab（Postman 风格：REST Params/Headers/Body；GraphQL Query/Variables/Headers） ──
  type ReqTab = "params" | "headers" | "body" | "query" | "variables";
  const [reqTab, setReqTab] = useState<ReqTab>(req.protocol === "graphql" ? "query" : "headers");
  /** GraphQL 变量校验错误总数（GqlVariablesPanel 上抛；驱动 Variables tab 红色徽标） */
  const [varsError, setVarsError] = useState(0);
  /** 参数 tab 显示条件：匹配到端点文档且文档含需设定的参数（path/query）——
   *  未匹配（自定义 URL）或无参数 → 不显示参数 tab（仅请求头/请求数据） */
  const hasDocParams =
    !!endpoint && (endpoint.op.params ?? []).some((p) => p.in === "path" || p.in === "query");
  // 默认选中 Tab：协议/方法/端点匹配变化时重置——GraphQL→查询；
  // REST 优先级：**参数 > 请求数据 > 请求头**——有文档参数 → 参数（对照文档填值）；
  // 无参数但有请求数据（POST/PUT 等非 GET/HEAD/OPTIONS）→ 请求数据；否则 → 请求头
  useEffect(() => {
    if (req.protocol === "graphql") {
      setReqTab("query");
    } else if (hasDocParams) {
      setReqTab("params");
    } else if (!noBodyMethod) {
      setReqTab("body");
    } else {
      setReqTab("headers");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.protocol, req.method, endpoint]);
  /** GET/HEAD/OPTIONS 无请求数据（不渲染 Body tab） */
  const noBodyMethod =
    req.protocol === "rest" &&
    (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS");

  // ── 表格行操作（请求头 / form） ──
  const addHeaderRow = () =>
    set({ headers: [...req.headers, { key: "", value: "", enabled: true }] });
  const deleteHeaderRow = (i: number) => set({ headers: req.headers.filter((_, xi) => xi !== i) });

  /** 点选请求数据类型：设 bodyType + 自动写/更新 Content-Type 请求头（用户可改可删） */
  const applyBodyType = (v: BodyType) => {
    set((r) => {
      const ct = CT_BY_BODY[v];
      if (!ct) return { ...r, bodyType: v };
      const has = r.headers.some((h) => h.key.trim().toLowerCase() === "content-type");
      const headers = has
        ? r.headers.map((h) =>
            h.key.trim().toLowerCase() === "content-type"
              ? { ...h, key: "Content-Type", value: ct, enabled: true }
              : h,
          )
        : [...r.headers, { key: "Content-Type", value: ct, enabled: true }];
      return { ...r, bodyType: v, headers };
    });
  };
  const addFormRow = () =>
    set({ formRows: [...(req.formRows ?? []), { key: "", value: "", enabled: true }] });
  const deleteFormRow = (i: number) =>
    set({ formRows: (req.formRows ?? []).filter((_, xi) => xi !== i) });

  /** 手动格式化当前请求数据（GraphQL → formatGraphQL；JSON → prettyJson） */
  const formatBody = () => {
    if (req.protocol === "graphql") {
      // 延迟 import 避免首屏加载 graphql 格式化逻辑
      void import("@/lib/debug-api").then(({ formatGraphQL }) => {
        const out = formatGraphQL(req.query);
        if (out !== null) set({ query: out });
      });
      return;
    }
    if (req.bodyType === "json") {
      void import("@/lib/debug-api").then(({ prettyJson }) => {
        const out = prettyJson(req.body);
        if (out !== req.body) set({ body: out });
      });
    }
    // text/form 无格式化语义
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 请求行：[方法] [URL] [Send]；区内 sticky（List 折叠按钮已移至请求 Tabs 行前） */}
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-card p-1.5">
        {/* 方法下拉（DropdownMenu 分区：RESTful / GraphQL；选方法即定协议） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-8 w-29.5 shrink-0 gap-1 px-2.5 text-xs font-medium"
            >
              {req.protocol === "graphql" ? (
                <GraphQLLogo className="size-3.5 text-violet-600 dark:text-violet-400" />
              ) : (
                <GlobeMethodIcon />
              )}
              <span className={cn("truncate", METHOD_COLOR[req.method] ?? "text-foreground")}>
                {req.method}
              </span>
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-29.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                <GlobeMethodIcon />
                RESTful
              </DropdownMenuLabel>
              {REST_METHODS.map((m) => (
                <DropdownMenuItem
                  key={m}
                  onClick={() =>
                    set((r) => ({
                      ...r,
                      method: m,
                      protocol: "rest",
                      // 切 REST：完整 URL（如残留 GraphQL 完整地址）规整为 path
                      url: normalizeRestUrl(r.url),
                      // POST/PUT 自动切到 Body tab 并默认 JSON
                      ...(m === "POST" || m === "PUT" ? { bodyType: "json" as BodyType } : {}),
                      // GET/HEAD/OPTIONS 无请求数据
                      ...(m === "GET" || m === "HEAD" || m === "OPTIONS"
                        ? { bodyType: "none" as BodyType }
                        : {}),
                    }))
                  }
                >
                  <span className={cn("font-mono text-xs font-semibold", METHOD_COLOR[m])}>
                    {m}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                <GraphQLLogo className="size-3 text-violet-600 dark:text-violet-400" />
                GraphQL
              </DropdownMenuLabel>
              {GQL_METHODS.map((m) => (
                <DropdownMenuItem
                  key={m}
                  onClick={() => set({ method: m, protocol: "graphql", query: "" })}
                >
                  <span className={cn("font-mono text-xs font-semibold", METHOD_COLOR[m])}>
                    {m}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* URL / 端点输入：InputGroup 固定前缀 https://api.github.com（仅输 path）
              REST 可编辑 path；GraphQL 同样 addon 前缀 + 只读 /graphql（端点固定） */}
        <InputGroup className="h-8 min-w-0 flex-1">
          <InputGroupAddon>
            {/* 前缀 base 提示：text-sm 与 path 输入框（Input md:text-sm 实际 14px）一致；
               leading-none 防 line-height 撑高 InputGroup（items-center 垂直居中） */}
            <InputGroupText className="font-mono text-sm leading-none">
              {REST_API_BASE}
            </InputGroupText>
          </InputGroupAddon>
          {req.protocol === "rest" ? (
            <InputGroupInput
              value={req.url}
              onChange={(e) => {
                const url = e.target.value;
                // 反向联动：改 URL → 在参数模型内同步（文档权威骨架稳定，不重建端点）。
                // endpoint 存在时传 doc：path 行对齐模板 index、query 按文档全集保留
                // （结构变化换端点由 DebugPage 防抖判定，此处仅同步值）
                const doc: DocParams | undefined = endpoint
                  ? {
                      path: endpoint.path,
                      queryNames: (endpoint.op.params ?? [])
                        .filter((p) => p.in === "query")
                        .map((p) => p.name),
                    }
                  : undefined;
                set({ url, params: syncParamsFromUrl(req.params, url, doc) });
              }}
              placeholder={t("urlPlaceholder")}
              className="h-7 font-mono text-xs"
            />
          ) : (
            <InputGroupInput
              value="/graphql"
              readOnly
              className="h-7 cursor-not-allowed font-mono text-xs"
            />
          )}
          {/* 端点文档抽屉触发：仅匹配到正确路径（endpoint 非空）时显示在 URL 框右侧 */}
          {endpoint && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-pressed={docOpen}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  docOpen && "bg-accent text-foreground",
                )}
                onClick={onToggleDoc}
                title={t("doc.open")}
                aria-label={t("doc.open")}
              >
                <BookOpen className="size-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {/* Send（凭据已由 Headers 表格 Authorization 行控制，身份下拉已删） */}
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          onClick={onRun}
          disabled={running}
          title={`${t("execute")} (Ctrl+Enter)`}
        >
          <Send className="size-3.5" />
          {t("execute")}
        </Button>
        {/* 手动保存历史：autoSave 关闭时显示（发送后保存当前请求+响应） */}
        {!autoSave && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 px-0 text-muted-foreground hover:text-foreground"
            onClick={onSaveHistory}
            disabled={!canSaveHistory}
            title={t("history.save")}
          >
            <Save className="size-3.5" />
          </Button>
        )}
      </div>

      {/* ── 请求 Tabs（Postman 风格：REST Headers/Body；GraphQL Query/Variables/Headers） ── */}
      <div className="flex items-center gap-0.5 border-b px-1.5">
        {/* 左栏折叠（List 图标）：置于请求头 tabs 前方 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "mr-1 h-7 w-7 shrink-0 rounded-full px-0",
            !leftHidden ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          onClick={onToggleLeft}
          title={leftHidden ? "Show history/API" : "Hide history/API"}
        >
          <List className="size-3.5" />
        </Button>
        {(req.protocol === "graphql"
          ? [
              // 请求头放最前方
              { value: "headers", label: t("headers") },
              { value: "query", label: t("query") },
              { value: "variables", label: t("variables") },
            ]
          : [
              // 参数放最前方（path/query 双向联动，对照响应面板文档填值）；
              // 仅匹配到文档且含需设定的参数（path/query）才显示，否则不显示参数
              ...(hasDocParams ? [{ value: "params", label: t("params.tab") }] : []),
              { value: "headers", label: t("headers") },
              // GET/HEAD/OPTIONS 无请求数据：不渲染 Body tab
              ...(!noBodyMethod ? [{ value: "body", label: t("body") }] : []),
            ]
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setReqTab(tab.value as ReqTab)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              reqTab === tab.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {/* GraphQL 变量校验错误徽标（>0 时红色计数，任何 tab 下可见） */}
            {tab.value === "variables" && req.protocol === "graphql" && varsError > 0 && (
              <span className="ml-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-destructive/10 px-1 text-[9px] font-semibold leading-4 text-destructive">
                {varsError}
              </span>
            )}
          </button>
        ))}
        {/* 请求数据类型选项栏：tabs 右侧（JSON/FormUrl/FormData/Raw；点选自动设置 Content-Type） */}
        {req.protocol === "rest" && !noBodyMethod && (
          <div className="ml-auto flex items-center gap-1 pl-2">
            <SegmentedControl<BodyType>
              size="xs"
              variant="tab"
              value={req.bodyType}
              onValueChange={applyBodyType}
              options={[
                { value: "json", label: "JSON" },
                { value: "form-urlencoded", label: "FormUrl" },
                { value: "form-data", label: "FormData" },
                { value: "text", label: "Raw" },
              ]}
            />
            {req.bodyType === "json" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground"
                onClick={formatBody}
                title={t("body.format")}
              >
                <Wand2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
        {/* GraphQL 格式化按钮：tabs 右侧 */}
        {req.protocol === "graphql" && (
          <div className="ml-auto flex items-center gap-1 pl-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground"
              onClick={formatBody}
              title={t("body.format")}
            >
              <Wand2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* ── 当前 Tab 内容（flex-1 内滚） ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reqTab === "params" && req.protocol === "rest" && (
          /* Params：path/query 参数（编辑联动 URL；对照响应面板文档自动填充 + 待选 badge） */
          <div className="p-2">
            <ParamsTable
              t={t}
              rows={req.params}
              onChange={(params) => {
                // 正向联动：改参数 → 重建 URL。endpoint 存在时传 doc——复合占位段
                // （{base}...{head}）从模板段重建（分次编辑不毁其余子占位）
                const doc: DocParams | undefined = endpoint
                  ? {
                      path: endpoint.path,
                      queryNames: (endpoint.op.params ?? [])
                        .filter((p) => p.in === "query")
                        .map((p) => p.name),
                    }
                  : undefined;
                set({ params, url: buildUrlFromParams(req.url, params, doc) });
              }}
              docQueryNames={
                endpoint
                  ? (endpoint.op.params ?? []).filter((p) => p.in === "query").map((p) => p.name)
                  : []
              }
            />
          </div>
        )}
        {reqTab === "headers" && (
          /* Headers：必填锁定行（Lock 占位）+ token 行（Authorization）+ 用户行 */
          <div className="p-2">
            <KeyValueTable
              rows={req.headers}
              onChange={(headers) => set({ headers })}
              required={requiredHeaders}
              onDeleteRow={deleteHeaderRow}
              onAddRow={addHeaderRow}
              keyPlaceholder={t("headers.keyPlaceholder")}
              valuePlaceholder={t("headers.valuePlaceholder")}
              enabledTitle={t("headers.enabled")}
              deleteTitle={t("history.delete")}
              addTitle={t("headers.add")}
              lockTitle={t("headers.lock")}
              tokenValue={tokenPlaceholder}
              fillTokenTitle={t("headers.fillToken")}
              clearTokenTitle={t("headers.clearToken")}
            />
          </div>
        )}
        {reqTab === "body" && req.protocol === "rest" && (
          /* Body：类型选项栏在 tabs 右侧；none 提示；form 表格；json/text 编辑器（fill 撑满）
             h-full min-h-0（非 min-h-full）：外层 scroll 容器高度确定 → 本容器 height:100% 确定 →
             CodeEditor 外层 flex-1 → cm-host flex-1 → cm-editor height:100% 才能解析撑满
             （min-h-full 只给 min-height 不给 height，flex 高度链 indeterminate → cm-editor 塌陷成内容高） */
          <div className="flex h-full min-h-0 flex-col p-2">
            {req.bodyType === "none" ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("body.noneHint")}</p>
            ) : req.bodyType === "form-urlencoded" || req.bodyType === "form-data" ? (
              <KeyValueTable
                rows={req.formRows ?? []}
                onChange={(formRows) => set({ formRows })}
                fileMode={req.bodyType === "form-data"}
                onFileChange={setFormFile}
                onDeleteRow={deleteFormRow}
                onAddRow={addFormRow}
                keyPlaceholder={t("headers.keyPlaceholder")}
                valuePlaceholder={t("headers.valuePlaceholder")}
                enabledTitle={t("headers.enabled")}
                deleteTitle={t("history.delete")}
                addTitle={t("headers.add")}
                lockTitle={t("headers.lock")}
                uploadTitle={t("body.upload")}
                fileHint={t("body.fileHint")}
              />
            ) : (
              /* json/text 编辑器：直接作为外层 flex 子项（fill 撑满，与 GraphQL query 同构）
                 overflow-visible：补全 tooltip 溢出编辑器底部/右侧不被裁剪
                 relative z-10：lint 诊断框向上溢出编辑器顶部时盖过 tabs 行/sticky 请求行 */
              <CodeEditor
                value={req.body}
                onChange={(v) => set({ body: v })}
                path={`body.${req.bodyType === "json" ? "json" : "txt"}`}
                placeholder={t("bodyPlaceholder")}
                fill
                toolbar={false}
                className="relative z-10 flex-1 overflow-visible rounded-md"
                jsonSchema={bodySchema}
              />
            )}
          </div>
        )}
        {reqTab === "query" && req.protocol === "graphql" && (
          /* GraphQL 查询体（schema 就绪后挂载智能补全 + 语法诊断；
             overflow-visible 防 tooltip 裁剪；relative z-10 防诊断框向上被 tabs 行遮挡）
             h-full min-h-0：确定高度链（同 Body 注释），cm-editor 撑满 */
          <div className="flex h-full min-h-0 flex-col p-2">
            <CodeEditor
              value={req.query}
              onChange={(v) => set({ query: v })}
              path="query.graphql"
              placeholder={t("queryPlaceholder")}
              fill
              toolbar={false}
              className="relative z-10 flex-1 overflow-visible rounded-md"
              graphqlSchema={gqlSchema}
            />
          </div>
        )}
        {reqTab === "variables" && req.protocol === "graphql" && (
          /* GraphQL Variables（智能面板：自动骨架 + 实时校验条 + 枚举下拉 + 编辑器） */
          <div className="p-2">
            <GqlVariablesPanel
              t={t}
              gqlSchema={gqlSchema}
              query={req.query}
              variables={req.variables}
              onChange={(v) => set({ variables: v })}
              onErrorsChange={setVarsError}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** REST 地球图标（方法下拉中的 RESTful 标识，独立于 lucide Globe 以保持语义） */
function GlobeMethodIcon() {
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
