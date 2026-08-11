/**
 * API 调试工具页面（/$debug 纯前端路由）—— 主布局与状态编排
 *
 * 参考 Postman/Apifox 重构：上下分栏 + 请求 Tabs（Params/Headers/Body），
 * 精简掉右栏——鉴权并入请求行、额度并入响应状态条、选项并入左栏/响应视图。
 * - 左栏：History（执行历史）/ API（REST 端点集合树 + GraphQL Schema 树）
 * - 上部：请求编辑器（请求行 sticky + 请求 Tabs + 当前 Tab 内容）
 * - 下部：响应面板（状态条 + 响应 Tabs Body/Headers + 内容，固定高度常驻可视）
 *
 * **纯前端路由（用户明确）**：Worker 完全不参与，无任何鉴权/闸门——
 * 前端直接复用已登录 token（或匿名）经 debug-api.ts 直连 api.github.com 快速调试。
 * 权限继承主站自身 session（token 经 /$auth/session 恢复），无额外安全面。
 *
 * 数据层（schema-loader.ts）：REST 三层产物（req/res-min/res-full + index.json）
 * 与 GraphQL 完整 introspection 原数据，经智能请求器（IndexedDB 缓存/TTL/SWR）加载；
 * 页面空闲后台预热全部 tag（左栏底部缓存进度条视觉感知）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { EMPTY_REQUEST, executeDebug } from "@/lib/debug-api";
import type { DebugRequest, DebugResult, HeaderRow } from "@/lib/debug-api";
import { loadHistory, addHistoryItem, clearHistory, type HistoryItem } from "@/lib/debug-store";
import {
  endpointToRequest,
  matchEndpoint,
  endpointStillMatches,
  type OpenApiEndpoint,
} from "@/lib/debug-openapi";
import { syncParamsFromUrl, type DocParams } from "@/lib/debug-params";
import { buildGqlSchemaContext } from "@/lib/debug-graphql";
import { cn } from "@/lib/utils";
import {
  loadGqlSchema,
  clearGqlSchema,
  getCachedGqlSchema,
  preloadAll,
  getAllEndpoints,
} from "./schema-loader";
import { LeftPanel } from "./LeftPanel";
import { RequestEditor } from "./RequestEditor";
import { ResponsePanel } from "./ResponsePanel";
import { EndpointDocDrawer } from "./EndpointDocDrawer";
import type { GraphQLSchema } from "graphql";

type ViewMode = "pretty" | "raw";

export default function DebugPage() {
  const { t } = useTranslation("debug");
  const { token, user } = useAuth();

  // ── 左栏折叠状态 ──
  const [leftHidden, setLeftHidden] = useState(false);
  // ── 响应区折叠状态：默认折叠（未发送时只留头部一行，请求区全高编辑）；
  //    发送响应数据后自动展开（run() 内 setRespCollapsed(false)） ──
  const [respCollapsed, setRespCollapsed] = useState(true);
  // ── 端点文档抽屉（URL 框 book icon 触发） ──
  const [docOpen, setDocOpen] = useState(false);

  // ── 请求模型 ──
  const [req, setReq] = useState<DebugRequest>(EMPTY_REQUEST);
  /** patch 或全量 updater（RequestEditor 方法切换需要读取当前值） */
  const set = (update: Partial<DebugRequest> | ((r: DebugRequest) => DebugRequest)) =>
    setReq((r) => (typeof update === "function" ? update(r) : { ...r, ...update }));

  // ── 响应 ──
  const [result, setResult] = useState<DebugResult | null>(null);
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("pretty");
  /** 响应 Tab（Body/Headers）——初始「响应头」；请求后按内容自动切换：
   * 有响应数据 → Body，无数据内容（Length 0）→ Headers */
  const [respTab, setRespTab] = useState<"body" | "headers">("headers");
  /** GitHub App 专属端点 401（需 App JWT，OAuth/PAT 无法访问） */
  const appJwt401 =
    result?.status === 401 && result.bodyText.includes("A JSON web token could not be decoded");

  // ── 身份（凭据已由 Headers 表格 Authorization 行控制）──
  const effectiveToken = token;
  const identityLabel = user?.login ?? "anonymous";

  // ── History ──
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const [autoSave, setAutoSave] = useState(true);

  // ── GraphQL Schema（完整本地产物；供 GqlTree 与编辑器补全共用）──
  const [gqlSchema, setGqlSchema] = useState<GraphQLSchema | null>(() => getCachedGqlSchema());
  const [gqlLoading, setGqlLoading] = useState(false);
  const [gqlError, setGqlError] = useState(false);
  /** 加载 schema（本地完整 introspection；reload=true 清缓存重拉） */
  const loadGql = useCallback(
    async (reload = false) => {
      if (gqlLoading) return;
      setGqlLoading(true);
      setGqlError(false);
      try {
        if (reload) clearGqlSchema();
        const schema = await loadGqlSchema();
        setGqlSchema(schema);
      } catch {
        setGqlError(true);
      } finally {
        setGqlLoading(false);
      }
    },
    [gqlLoading],
  );
  /** 切到 GraphQL 协议且无 schema/无错误时自动加载一次 */
  useEffect(() => {
    if (req.protocol !== "graphql" || gqlSchema || gqlLoading || gqlError) return;
    void loadGql(false);
  }, [req.protocol, gqlSchema, gqlLoading, gqlError, loadGql]);

  /** 后台预热全部 REST tag（首屏后异步，不阻塞交互；左栏底部进度条感知） */
  useEffect(() => {
    void preloadAll();
  }, []);

  /** form-data 文件上传（按 formRows 行索引；不持久化） */
  const [formFiles, setFormFiles] = useState<Record<number, File>>({});
  const setFormFile = (i: number, file: File | null) =>
    setFormFiles((files) => {
      const next = { ...files };
      if (file) next[i] = file;
      else delete next[i];
      return next;
    });

  // ── Authorization token 行 ──
  /** 占位文本（默认 filled；identity 变化时 effect 同步更新 label） */
  const tokenPlaceholder = useMemo(() => `Bearer •••••••••• (${identityLabel})`, [identityLabel]);

  // ── GraphQL 惰性字段层解析上下文（schema 就绪后构建；GqlTree 勾选树与查询生成共用） ──
  const gqlCtx = useMemo(() => (gqlSchema ? buildGqlSchemaContext(gqlSchema) : null), [gqlSchema]);
  /** 确保请求带 Authorization 行：缺失则补 filled 占位；已有保持原样 */
  const ensureAuthRow = (r: DebugRequest): DebugRequest => {
    if (r.headers.some((h) => h.token)) return r;
    return {
      ...r,
      headers: [
        ...r.headers,
        { key: "Authorization", value: "Bearer ••••••••••", enabled: true, token: true },
      ],
    };
  };
  /** 身份/登录变化 → 同步 token 行占位（仅占位态） */
  useEffect(() => {
    setReq((r) => {
      if (!r.headers.some((h) => h.token && h.value.startsWith("Bearer •"))) return r;
      return {
        ...r,
        headers: r.headers.map((h) =>
          h.token && h.value.startsWith("Bearer •") ? { ...h, value: tokenPlaceholder } : h,
        ),
      };
    });
  }, [tokenPlaceholder]);

  // ── 必填锁定请求头（自动填充，不可编辑；Authorization 由 token 行承载）──
  const requiredHeaders = useMemo((): HeaderRow[] => {
    const ua: HeaderRow = {
      key: "User-Agent",
      value: `PureGit Client (https://github.com/evil7/puregit) - debug by ${identityLabel}`,
      enabled: true,
      locked: true,
    };
    if (req.protocol === "graphql") {
      return [ua, { key: "Content-Type", value: "application/json", enabled: true, locked: true }];
    }
    return [
      ua,
      { key: "Accept", value: "application/vnd.github+json", enabled: true, locked: true },
    ];
  }, [req.protocol, identityLabel]);

  // ── 执行 ──
  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await executeDebug(req, effectiveToken, formFiles);
      setResult(r);
      // 响应数据到达 → 自动展开响应区（初始折叠态在发送后收起）
      setRespCollapsed(false);
      // 请求后优先显示响应数据；无数据内容（Length 0）→ 显示响应头
      setRespTab(r.bodyText.length > 0 ? "body" : "headers");
      if (autoSave) {
        addHistoryItem(req, r, identityLabel);
        setHistory(loadHistory());
      }
    } finally {
      setRunning(false);
    }
  };

  /** 历史条目点击 → 仅填充请求数据（不自动发送） */
  const replay = (item: HistoryItem) => {
    setReq(ensureAuthRow(item.request));
  };

  /** 手动保存当前请求到历史（autoSave 关闭时的兜底入口）；需已有响应结果 */
  const saveHistory = () => {
    if (!result) return;
    addHistoryItem(req, result, identityLabel);
    setHistory(loadHistory());
  };

  // ── 左栏 API 点按 → 填充请求 ──
  /** 当前 REST 端点的 requestBody schema（json content-type；Body 编辑器字段级补全数据源） */
  const [bodySchema, setBodySchema] = useState<Record<string, unknown> | null>(null);
  /** 当前选中 REST 端点（未发送时响应面板空状态展示端点文档；GraphQL 操作清空） */
  const [endpoint, setEndpoint] = useState<OpenApiEndpoint | null>(null);
  /** REST 端点点按 → 填充请求（并同步协议；缺 Authorization 行则补；同步 body schema 供补全） */
  const pickEndpoint = (ep: OpenApiEndpoint) => {
    setReq(ensureAuthRow(endpointToRequest(ep)));
    setBodySchema(
      (ep.op.body?.["application/json"] as Record<string, unknown> | undefined) ?? null,
    );
    setEndpoint(ep);
  };
  /** GraphQL 模板点按 → 填充请求（清空 REST 端点文档） */
  const pickGqlTemplate = (query: string, method: "query" | "mutation") => {
    setEndpoint(null);
    setReq(ensureAuthRow({ ...EMPTY_REQUEST, protocol: "graphql", method, query }));
  };
  /** GraphQL 勾选合并 → 同操作类型多字段拼接为单个查询（query 空字符串 = 清空） */
  const pickGqlMulti = (opType: "query" | "mutation", query: string) => {
    setEndpoint(null);
    setReq(
      ensureAuthRow({
        ...EMPTY_REQUEST,
        protocol: "graphql",
        method: opType,
        query: query || "",
      }),
    );
  };

  // ── URL + 方法 → 匹配端点文档（文档权威：端点确定后 URL 微编辑固化，结构变化才重匹配） ──
  /** 最新 URL/方法引用（防抖回调内读最新值 + 竞态检查） */
  const urlRef = useRef(req.url);
  const methodRef = useRef(req.method);
  const endpointRef = useRef(endpoint);
  urlRef.current = req.url;
  methodRef.current = req.method;
  endpointRef.current = endpoint;
  /** 端点匹配防抖（250ms）：仅当 无端点 / 当前端点与 URL 结构不再匹配 时触发——
   *  命中 → 加载文档 + 骨架对齐；未命中 → 清空文档（转显式行模式） */
  useEffect(() => {
    if (req.protocol !== "rest") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const url = urlRef.current;
        const method = methodRef.current;
        if (url.trim() === "") {
          // 空 URL → 无文档可匹配
          setEndpoint(null);
          setBodySchema(null);
          return;
        }
        // 端点固化：当前端点与 URL 结构 + 方法仍匹配 → 微编辑不重匹配，
        // 表格值已由 RequestEditor URL onChange（传 doc）同步，此处不动
        const cur = endpointRef.current;
        if (cur && endpointStillMatches(cur, url, method)) return;
        try {
          const eps = await getAllEndpoints();
          // 竞态：等待期间 URL/method 已变 → 丢弃本次结果（下次防抖重匹配）
          if (urlRef.current !== url || methodRef.current !== method) return;
          const ep = matchEndpoint(method, url, eps);
          if (ep) {
            const doc: DocParams = {
              path: ep.path,
              queryNames: (ep.op.params ?? []).filter((p) => p.in === "query").map((p) => p.name),
            };
            setEndpoint(ep);
            setBodySchema(
              (ep.op.body?.["application/json"] as Record<string, unknown> | undefined) ?? null,
            );
            // 合并参数：path 行对齐模板（补缺失/移多余）+ query 按文档全集（不改 URL）
            setReq((r) => {
              if (r.url !== url) return r; // 竞态（防抖期间 URL 又变）
              return { ...r, params: syncParamsFromUrl(r.params, r.url, doc) };
            });
          } else {
            // 未匹配：清空文档（保留参数表——用户可能继续输入使其匹配）
            setEndpoint(null);
            setBodySchema(null);
          }
        } catch {
          /* 端点索引加载失败 → 保持现状（不打断用户） */
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [req.url, req.method, req.protocol]);

  // ── 全局快捷键：Ctrl/Cmd+Enter 发送 ──
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    /* 全屏工具布局（用户要求）：不用 PAGE_SHELL/PageLayout——调试工具需铺满右侧、
       操作栏紧贴 navbar（顶部零间距，h 扣 navbar 高 57px = 3.5625rem），故自定义全高 flex；
       左栏 border-r 分隔，主区无圆角卡片直接铺满（上请求 / 下响应，border 分隔） */
    <div className="mx-auto flex h-[calc(100svh-3.5625rem-1px)] max-w-7xl px-4">
      {/* 左栏：History/API（工具型限高内滚；折叠保留 DOM 防状态丢失） */}
      <aside className={cn("w-60 shrink-0 border-r", leftHidden ? "hidden" : "hidden md:block")}>
        <div className="h-full">
          <LeftPanel
            t={t}
            protocol={req.protocol}
            history={history}
            autoSave={autoSave}
            setAutoSave={setAutoSave}
            onReplay={replay}
            onClearHistory={() => {
              clearHistory();
              setHistory([]);
            }}
            onPickEndpoint={pickEndpoint}
            onPickGqlMulti={pickGqlMulti}
            gqlEditorQuery={req.query}
            gqlSchema={gqlSchema}
            gqlCtx={gqlCtx}
            gqlLoading={gqlLoading}
            gqlError={gqlError}
            onGqlReload={() => void loadGql(true)}
            onPickGqlTemplate={pickGqlTemplate}
          />
        </div>
      </aside>

      {/* 主区：无圆角卡片直接铺满（上请求 / 下响应） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── 上部：请求编辑器（flex-1 内滚；无卡片） ── */}
        <div className="flex min-h-0 flex-1 flex-col">
          <RequestEditor
            t={t}
            req={req}
            set={set}
            tokenPlaceholder={tokenPlaceholder}
            requiredHeaders={requiredHeaders}
            gqlSchema={gqlSchema}
            bodySchema={bodySchema}
            endpoint={endpoint}
            docOpen={docOpen}
            onToggleDoc={() => setDocOpen((v) => !v)}
            setFormFile={setFormFile}
            running={running}
            onRun={() => void run()}
            onSaveHistory={saveHistory}
            canSaveHistory={!!result}
            autoSave={autoSave}
            leftHidden={leftHidden}
            onToggleLeft={() => setLeftHidden((v) => !v)}
          />
        </div>

        {/* ── 下部：响应面板（未发送时等待占位；文档已迁至右侧抽屉） ── */}
        <ResponsePanel
          t={t}
          result={result}
          respCollapsed={respCollapsed}
          setRespCollapsed={setRespCollapsed}
          respTab={respTab}
          setRespTab={setRespTab}
          viewMode={viewMode}
          setViewMode={setViewMode}
          appJwt401={appJwt401}
        />
      </div>

      {/* 端点文档抽屉（右侧；当前匹配端点时展示完整文档） */}
      <EndpointDocDrawer t={t} endpoint={endpoint} open={docOpen} onOpenChange={setDocOpen} />
    </div>
  );
}
