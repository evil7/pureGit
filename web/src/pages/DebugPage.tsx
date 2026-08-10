/**
 * API 调试工具页面（/$debug 纯前端路由）
 *
 * 参考 Postman/Apifox 重构：上下分栏 + 请求 Tabs（Params/Headers/Body），
 * 精简掉右栏——鉴权并入请求行、额度并入响应状态条、选项并入左栏/响应视图。
 * - 左栏：History（执行历史）/ API（REST OpenAPI 端点树 + GraphQL 模板）
 * - 上部：请求编辑器（请求行 sticky + 请求 Tabs + 当前 Tab 内容）
 * - 下部：响应面板（状态条 + 响应 Tabs Body/Headers + 内容，固定高度常驻可视）
 *
 * **纯前端路由（用户明确）**：Worker 完全不参与，无任何鉴权/闸门——
 * 前端直接复用已登录 token（或匿名）经 debug-api.ts 直连 api.github.com 快速调试。
 * 权限继承主站自身 session（token 经 /$auth/session 恢复），无额外安全面。
 * 请求执行：前端直连 api.github.com（debug-api.ts），不经 Worker 代理。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Braces,
  ChevronDown,
  ChevronUp,
  Copy,
  Globe,
  History as HistoryIcon,
  KeyRound,
  List,
  Lock,
  Plus,
  Save,
  Send,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SegmentedControl } from "@/components/SegmentedControl";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  EMPTY_REQUEST,
  executeDebug,
  prettyJson,
  formatGraphQL,
  type DebugProtocol,
  type DebugRequest,
  type DebugResult,
  type HeaderRow,
  type BodyType,
} from "@/lib/debug-api";
import {
  PRESET_COLLECTION,
  loadHistory,
  addHistoryItem,
  clearHistory,
  type HistoryItem,
} from "@/lib/debug-store";
import {
  loadOpenApi,
  buildOpenApiGroups,
  endpointToRequest,
  type OpenApiGroup,
  type OpenApiEndpoint,
} from "@/lib/debug-openapi";

type ViewMode = "pretty" | "raw";

const REST_METHODS = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] as const;
const GQL_METHODS = ["query", "mutation"] as const;

/** REST 方法 → 彩色徽标类（Postman 语义） */
const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-orange-600 dark:text-orange-400",
  PATCH: "text-purple-600 dark:text-purple-400",
  PUT: "text-sky-600 dark:text-sky-400",
  DELETE: "text-red-600 dark:text-red-400",
  HEAD: "text-teal-600 dark:text-teal-400",
  OPTIONS: "text-slate-600 dark:text-slate-400",
  query: "text-sky-600 dark:text-sky-400",
  mutation: "text-orange-600 dark:text-orange-400",
};

/**
 * GraphQL 官方 Logo（仅 debug 页使用）
 * 封装与站点 Logo 一致：fill 用 currentColor、尺寸/颜色由 className 控制
 */ function GraphQLLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="currentColor"
      className={cn("text-foreground", className)}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M50 6.90308L87.323 28.4515V71.5484L50 93.0968L12.677 71.5484V28.4515L50 6.90308ZM16.8647 30.8693V62.5251L44.2795 15.0414L16.8647 30.8693ZM50 13.5086L18.3975 68.2457H81.6025L50 13.5086ZM77.4148 72.4334H22.5852L50 88.2613L77.4148 72.4334ZM83.1353 62.5251L55.7205 15.0414L83.1353 30.8693V62.5251Z"
      />
      <circle cx="50" cy="9.3209" r="8.82" />
      <circle cx="85.2292" cy="29.6605" r="8.82" />
      <circle cx="85.2292" cy="70.3396" r="8.82" />
      <circle cx="50" cy="90.6791" r="8.82" />
      <circle cx="14.7659" cy="70.3396" r="8.82" />
      <circle cx="14.7659" cy="29.6605" r="8.82" />
    </svg>
  );
}

/** 响应状态码 → 字体色彩：2xx 绿 / 3xx 蓝 / 4xx 琥珀 / 5xx 红 / 0 网络错误红（仅字体色，无胶囊） */
function statusColorClass(status: number): string {
  if (status === 0) return "text-red-600 dark:text-red-400";
  if (status < 300) return "text-emerald-600 dark:text-emerald-400";
  if (status < 400) return "text-sky-600 dark:text-sky-400";
  if (status < 500) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** GitHub API REST 基地址（URL 输入框固定前缀 addon） */
const REST_API_BASE = "https://api.github.com";

/**
 * 规整 REST URL 为 path 形式（保留 query）：完整 URL（含基地址）→ `/path?query`；
 * 已是 path 则原样。切 REST 时若残留 GraphQL 完整 URL（https://api.github.com/graphql）
 * 会被规整为 `/graphql`（用户自行改）
 */
function normalizeRestUrl(url: string): string {
  const t = url.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      // 仅当主机是 api.github.com 才规整；否则保留完整 URL（自定义端点直连仍可用）
      if (u.hostname === "api.github.com") {
        return u.pathname + u.search + u.hash;
      }
      return t;
    } catch {
      return t;
    }
  }
  return t;
}

/**
 * K/V 表格（请求头 / form-urlencoded / form-data 共用）
 * 用真实 `<table>` 布局（colgroup 定列宽比例）：
 * [checkbox] [key] [value] [操作]，所有行（锁定/编辑/添加）列宽自动一致对齐。
 * - required：锁定行（必填请求头自动填充；checkbox 恒开、不可编辑/删除）——操作列以 Lock 图标占位
 * - token 行（Authorization）：key 固定只读；value 为空时框内靠右显示 Key 图标（点击填充已登录 token 占位），
 *   填充后图标变 Trash（点击清空还原），可任意手输；行尾 X 照常删除（匿名）
 * - fileMode（form-data）：Value 单元格内 Upload 前缀 icon（视觉一致）——
 *   可正常输入文本，也可点 icon 上传文件（选文件后 value 显示文件名并记录 File）
 * - + 添加按钮位于表格最底部一行、**靠左**；删除经 onDeleteRow 回调（文件索引同步）
 */
function KeyValueTable({
  rows,
  onChange,
  required,
  fileMode,
  onFileChange,
  onDeleteRow,
  onAddRow,
  keyPlaceholder,
  valuePlaceholder,
  enabledTitle,
  deleteTitle,
  addTitle,
  lockTitle,
  uploadTitle,
  fileHint,
  tokenValue,
  fillTokenTitle,
  clearTokenTitle,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  required?: HeaderRow[];
  fileMode?: boolean;
  onFileChange?: (index: number, file: File | null) => void;
  onDeleteRow: (index: number) => void;
  onAddRow: () => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  enabledTitle: string;
  deleteTitle: string;
  addTitle: string;
  lockTitle: string;
  uploadTitle?: string;
  fileHint?: string;
  /** token 行占位文本（点击 Key 填充） */
  tokenValue?: string;
  fillTokenTitle?: string;
  clearTokenTitle?: string;
}) {
  // 隐藏文件输入 ref（按行索引；点 Upload icon 触发）
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <div>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {/* 列宽自动控制：checkbox（24px 槽居中，与添加按钮同宽对齐）/ key / value / 操作 */}
          <col className="w-11" />
          <col className="w-1/3" />
          <col />
          <col className="w-7" />
        </colgroup>
        <tbody>
          {/* 必填锁定行（不可修改；操作列 Lock 图标占位） */}
          {required &&
            required.length > 0 &&
            required.map((h, i) => (
              <tr key={`req-${i}`} className="border-b bg-muted/30 last:border-b-0">
                <td className="py-1 pl-3 pr-2">
                  {/* 24px 槽居中：与底部添加按钮（同宽同起点）中心对齐 */}
                  <div className="flex h-6 w-6 items-center justify-center">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="size-3.5"
                      title={enabledTitle}
                    />
                  </div>
                </td>
                <td className="py-1 pr-1.5">
                  <Input value={h.key} readOnly className="h-7 w-full font-mono text-xs" />
                </td>
                <td className="py-1 pr-1.5">
                  <Input value={h.value} readOnly className="h-7 w-full font-mono text-xs" />
                </td>
                <td className="py-1 pr-3">
                  <div
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                    title={lockTitle}
                  >
                    <Lock className="size-3.5" />
                  </div>
                </td>
              </tr>
            ))}
          {/* 用户可编辑行 */}
          {rows.length > 0 &&
            rows.map((h, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-1 pl-3 pr-2">
                  {/* 24px 槽居中：与底部添加按钮（同宽同起点）中心对齐 */}
                  <div className="flex h-6 w-6 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={h.enabled !== false}
                      onChange={(e) =>
                        onChange(
                          rows.map((x, xi) => (xi === i ? { ...x, enabled: e.target.checked } : x)),
                        )
                      }
                      className="size-3.5"
                      title={enabledTitle}
                    />
                  </div>
                </td>
                <td className="py-1 pr-1.5">
                  <Input
                    value={h.key}
                    onChange={(e) =>
                      onChange(rows.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)))
                    }
                    placeholder={keyPlaceholder}
                    readOnly={h.token}
                    className="h-7 w-full font-mono text-xs"
                  />
                </td>
                <td className="py-1 pr-1.5">
                  {h.token ? (
                    /* token 行：value 框内靠右 Key/Trash 切换按钮；
                       占位态（Bearer • 开头）只读，必须先清空才能手动编辑 */
                    <div className="relative">
                      <Input
                        value={h.value}
                        onChange={(e) =>
                          onChange(
                            rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                        placeholder={valuePlaceholder}
                        readOnly={h.value.startsWith("Bearer •")}
                        className={cn(
                          "h-7 w-full pr-7 font-mono text-xs",
                          h.value.startsWith("Bearer •") &&
                            "cursor-not-allowed text-muted-foreground opacity-80",
                        )}
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          onChange(
                            rows.map((x, xi) =>
                              xi === i ? { ...x, value: h.value ? "" : (tokenValue ?? "") } : x,
                            ),
                          )
                        }
                        title={h.value ? clearTokenTitle : fillTokenTitle}
                      >
                        {h.value ? (
                          <Trash2 className="size-3.5" />
                        ) : (
                          <KeyRound className="size-3.5" />
                        )}
                      </button>
                    </div>
                  ) : fileMode ? (
                    /* form-data：Upload 前缀 icon（文件上传） */
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
                        onClick={() => fileRefs.current[i]?.click()}
                        title={uploadTitle}
                      >
                        <Upload className="size-3.5" />
                      </Button>
                      <input
                        ref={(el) => {
                          fileRefs.current[i] = el;
                        }}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          onFileChange?.(i, f);
                          if (f) {
                            // 选文件后 value 显示文件名（仍可手改）
                            onChange(rows.map((x, xi) => (xi === i ? { ...x, value: f.name } : x)));
                          }
                          e.target.value = "";
                        }}
                      />
                      <Input
                        value={h.value}
                        onChange={(e) =>
                          onChange(
                            rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                        placeholder={valuePlaceholder}
                        className="h-7 min-w-0 flex-1 font-mono text-xs"
                      />
                    </div>
                  ) : (
                    <Input
                      value={h.value}
                      onChange={(e) =>
                        onChange(
                          rows.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                      placeholder={valuePlaceholder}
                      className="h-7 w-full font-mono text-xs"
                    />
                  )}
                </td>
                <td className="py-1 pr-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteRow(i)}
                    title={deleteTitle}
                  >
                    <X className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          {/* 添加按钮行：横跨全宽、按钮靠左（与 checkbox 槽同起点同宽 → 中心对齐） */}
          <tr>
            <td colSpan={4} className="py-1 pl-3 pr-3">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                onClick={onAddRow}
                title={addTitle}
              >
                <Plus className="size-3.5" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      {fileMode && rows.length > 0 && (
        <p className="px-3 py-1 text-[10px] leading-4 text-muted-foreground">{fileHint}</p>
      )}
    </div>
  );
}

/** 响应体字节数格式化（B/KB/MB） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function DebugPage() {
  const { t } = useTranslation("debug");
  const { token, user } = useAuth();

  // ── 左栏折叠状态 ──
  const [leftHidden, setLeftHidden] = useState(false);

  // ── 响应区折叠状态（返回头前方开合按钮） ──
  const [respCollapsed, setRespCollapsed] = useState(false);

  // ── 请求模型 ──
  const [req, setReq] = useState<DebugRequest>(EMPTY_REQUEST);
  const set = (patch: Partial<DebugRequest>) => setReq((r) => ({ ...r, ...patch }));

  // ── 请求 Tab（Postman 风格：REST Headers/Body（无 Params）；GraphQL Query/Variables/Headers） ──
  type ReqTab = "headers" | "body" | "query" | "variables";
  const [reqTab, setReqTab] = useState<ReqTab>("query");
  // 协议/方法变化时重置到默认 Tab（GraphQL→Query，REST→Headers）
  useEffect(() => {
    setReqTab(req.protocol === "graphql" ? "query" : "headers");
  }, [req.protocol, req.method]);
  /** GET/HEAD/OPTIONS 无请求体（不渲染 Body tab） */
  const noBodyMethod =
    req.protocol === "rest" &&
    (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS");

  // ── 响应 ──
  const [result, setResult] = useState<DebugResult | null>(null);
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("pretty");
  /** 响应 Tab（Body/Headers） */
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  /** GitHub App 专属端点 401（需 App JWT，OAuth/PAT 无法访问）——
   *  GitHub 对非 JWT 的 Bearer 访问 /app 等端点返回该固定 message，实测 /user 正常 */
  const appJwt401 =
    result?.status === 401 && result.bodyText.includes("A JSON web token could not be decoded");

  // ── 身份（凭据已由 Headers 表格 Authorization 行控制，删除身份下拉/PAT 输入）──
  // 登录 token 仅用于 Authorization 占位行替换；匿名 = 删除/清空该行
  const effectiveToken = token;
  /** 身份标识：用于 token 占位 label 与 UA 锁定行的 login_id、历史记录 identity 字段 */
  const identityLabel = user?.login ?? "anonymous";

  // ── History ──
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const [autoSave, setAutoSave] = useState(true);

  // ── REST API 集合（OpenAPI 解析） ──
  const [openApiGroups, setOpenApiGroups] = useState<OpenApiGroup[] | null>(null);
  const [openApiError, setOpenApiError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadOpenApi().then((doc) => {
      if (cancelled) return;
      if (!doc) {
        setOpenApiError(true);
        return;
      }
      setOpenApiGroups(buildOpenApiGroups(doc));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 额度（已从响应区移除，仅保留全局 octokit 自身跟踪） ──

  /** form-data 文件上传（按 formRows 行索引；不持久化） */
  const [formFiles, setFormFiles] = useState<Record<number, File>>({});

  // ── Authorization token 行 ──
  /** 占位文本（默认 filled；identity 变化时 effect 同步更新 label） */
  const tokenPlaceholder = useMemo(() => `Bearer •••••••••• (${identityLabel})`, [identityLabel]);
  /** 确保请求带 Authorization 行：缺失则补 filled 占位；已有（清空/手输/占位）保持原样 */
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
  /** 身份/登录变化 → 同步 token 行占位（仅占位态；手输/清空态不动） */
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

  // ── 必填锁定请求头（自动填充，不可编辑；Authorization 由 token 行承载） ──
  // UA 锁定行：`PureGit Client (...) - debug by {login_id}`（用户要求）
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

  // ── 表格行操作（请求头 / form） ──
  const addHeaderRow = () =>
    set({ headers: [...req.headers, { key: "", value: "", enabled: true }] });
  const deleteHeaderRow = (i: number) => set({ headers: req.headers.filter((_, xi) => xi !== i) });

  /** bodyType → 自动 Content-Type（点选自动设置请求头）；Raw 不自动设 */
  const CT_BY_BODY: Partial<Record<BodyType, string>> = {
    json: "application/json",
    "form-urlencoded": "application/x-www-form-urlencoded",
    "form-data": "multipart/form-data",
  };
  /** 点选请求体类型：设 bodyType + 自动写/更新 Content-Type 请求头（用户可改可删） */
  const applyBodyType = (v: BodyType) => {
    setReq((r) => {
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
  /** 删除 form 行时同步移除/位移文件映射（索引错位修复） */
  const deleteFormRow = (i: number) => {
    set({ formRows: (req.formRows ?? []).filter((_, xi) => xi !== i) });
    setFormFiles((files) => {
      const next: Record<number, File> = {};
      for (const [k, v] of Object.entries(files)) {
        const ki = Number(k);
        next[ki > i ? ki - 1 : ki] = v;
      }
      return next;
    });
  };
  const setFormFile = (i: number, file: File | null) =>
    setFormFiles((files) => {
      const next = { ...files };
      if (file) next[i] = file;
      else delete next[i];
      return next;
    });

  // ── 执行 ──
  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await executeDebug(req, effectiveToken, formFiles);
      setResult(r);
      if (autoSave) {
        addHistoryItem(req, r, identityLabel);
        setHistory(loadHistory());
      }
    } finally {
      setRunning(false);
    }
  };

  /** 历史条目点击 → 仅填充请求数据（不自动发送，用户可修改后再手动发送） */
  const replay = (item: HistoryItem) => {
    const rq = ensureAuthRow(item.request);
    setReq(rq);
    // 注意：不调用 executeDebug，避免自动重放——用户可能需要先修改请求
  };

  /** 手动保存当前请求到历史（autoSave 关闭时的兜底入口）；需已有响应结果 */
  const saveHistory = () => {
    if (!result) return;
    addHistoryItem(req, result, identityLabel);
    setHistory(loadHistory());
  };

  /** GraphQL 模板 / REST 端点点按 → 填充请求（并同步协议；缺 Authorization 行则补） */
  const pickTemplate = (template: DebugRequest) => {
    setReq(ensureAuthRow({ ...template }));
  };

  /** 手动格式化当前请求体（GraphQL → formatGraphQL；JSON → prettyJson；） */
  const formatBody = () => {
    if (req.protocol === "graphql") {
      const out = formatGraphQL(req.query);
      if (out !== null) set({ query: out });
    } else if (req.bodyType === "json") {
      const out = prettyJson(req.body);
      if (out !== req.body) set({ body: out });
    }
    // text/form 无格式化语义
  };

  /** 是否显示格式化按钮（GraphQL 与 REST json 的 format 均在 tabs 行右侧） */

  // ── 全局快捷键 ──
  // Ctrl/Cmd+Enter → 快速发送；Alt+Shift+F → 格式化请求体
  const runRef = useRef(run);
  runRef.current = run;
  const formatBodyRef = useRef(formatBody);
  formatBodyRef.current = formatBody;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void runRef.current();
        return;
      }
      if (e.altKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        formatBodyRef.current();
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
            openApiGroups={openApiGroups}
            openApiError={openApiError}
            onPickEndpoint={(ep) => setReq(ensureAuthRow(endpointToRequest(ep)))}
            onPickGqlTemplate={pickTemplate}
          />
        </div>
      </aside>

      {/* 主区：无圆角卡片直接铺满（上请求 / 下响应） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── 上部：请求编辑器（flex-1 内滚；无卡片） ── */}
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
                    <Globe className="size-3.5 text-emerald-600 dark:text-emerald-400" />
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
                    <Globe className="size-3 text-emerald-600 dark:text-emerald-400" />
                    RESTful
                  </DropdownMenuLabel>
                  {REST_METHODS.map((m) => (
                    <DropdownMenuItem
                      key={m}
                      onClick={() =>
                        setReq((r) => ({
                          ...r,
                          method: m,
                          protocol: "rest",
                          // 切 REST：完整 URL（如残留 GraphQL 完整地址）规整为 path
                          url: normalizeRestUrl(r.url),
                          // POST/PUT 自动切到 Body tab 并默认 JSON
                          ...(m === "POST" || m === "PUT" ? { bodyType: "json" as BodyType } : {}),
                          // GET/HEAD/OPTIONS 无请求体
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
                      onClick={() => set({ method: m, protocol: "graphql" })}
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
                <InputGroupText className="font-mono text-xs">{REST_API_BASE}</InputGroupText>
              </InputGroupAddon>
              {req.protocol === "rest" ? (
                <InputGroupInput
                  value={req.url}
                  onChange={(e) => set({ url: e.target.value })}
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
            </InputGroup>
            {/* Send（凭据已由 Headers 表格 Authorization 行控制，身份下拉已删） */}
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              onClick={run}
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
                onClick={saveHistory}
                disabled={!result}
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
              onClick={() => setLeftHidden((v) => !v)}
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
                  // 请求头放最前方
                  { value: "headers", label: t("headers") },
                  // GET/HEAD/OPTIONS 无请求体：不渲染 Body tab
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
              </button>
            ))}
            {/* 请求体类型选项栏：tabs 右侧（JSON/FormUrl/FormData/Raw，无「无」；
                  点选自动设置 Content-Type；Raw 不自动设。） */}
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
            {reqTab === "headers" && (
              /* Headers：必填锁定行（Lock 占位）+ token 行（Authorization）+ 用户行；添加按钮在表格底部 */
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
              /* Body：类型选项栏在 tabs 右侧；none 提示；form 表格；json/text 编辑器（fill 撑满） */
              <div className="p-2">
                {req.bodyType === "none" ? (
                  <p className="px-1 py-2 text-[11px] text-muted-foreground">
                    {t("body.noneHint")}
                  </p>
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
                  <div className="flex min-h-full flex-col">
                    <CodeEditor
                      value={req.body}
                      onChange={(v) => set({ body: v })}
                      path={`body.${req.bodyType === "json" ? "json" : "txt"}`}
                      placeholder={t("bodyPlaceholder")}
                      fill
                      toolbar={false}
                      className="flex-1 rounded-md"
                    />
                  </div>
                )}
              </div>
            )}
            {reqTab === "query" && req.protocol === "graphql" && (
              /* GraphQL 查询体（format 按钮在 tabs 右侧；编辑器 fill 撑满） */
              <div className="flex min-h-full flex-col p-2">
                <CodeEditor
                  value={req.query}
                  onChange={(v) => set({ query: v })}
                  path="query.graphql"
                  placeholder={t("queryPlaceholder")}
                  fill
                  toolbar={false}
                  className="flex-1 rounded-md"
                />
              </div>
            )}
            {reqTab === "variables" && req.protocol === "graphql" && (
              /* GraphQL Variables（fill 撑满） */
              <div className="flex min-h-full flex-col p-2">
                <CodeEditor
                  value={req.variables}
                  onChange={(v) => set({ variables: v })}
                  path="variables.json"
                  placeholder={t("variablesPlaceholder")}
                  fill
                  toolbar={false}
                  className="flex-1 rounded-md"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── 下部：响应面板（固定高度常驻可视；border-t 与请求区分隔） ──
              折叠时仅保留头部一行（开合按钮收起内容） */}
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
              onClick={() => setRespCollapsed((v) => !v)}
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
                <p className="flex h-full items-center justify-center px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("response.waiting")}
                </p>
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
                        <span className="min-w-0 flex-[1.5] break-all font-mono text-[11px]">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* 返回体：与上方请求编辑区一致的 p-2 边距；
                     pretty 态用只读 CodeEditor（已格式化）+ 编辑器内右上角复制按钮；raw 态原样 pre */
                <div className="h-full min-h-0 p-2">
                  {viewMode === "pretty" ? (
                    <div className="relative h-full min-h-0">
                      <CodeEditor
                        value={
                          result.networkError ? result.networkError : prettyJson(result.bodyText)
                        }
                        onChange={() => {}}
                        path="body.json"
                        fill
                        readOnly
                        toolbar={false}
                        className="rounded-md"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute right-2 top-2 z-10 h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(result.networkError ?? result.bodyText)
                            .catch(() => {});
                        }}
                        title={t("response.copy")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <pre
                        className={cn(
                          "m-0 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all",
                          !result.ok && "text-destructive",
                        )}
                      >
                        {result.networkError ? result.networkError : result.bodyText}
                      </pre>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute right-2 top-2 z-10 h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(result.networkError ?? result.bodyText)
                            .catch(() => {});
                        }}
                        title={t("response.copy")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 左栏：历史 / API（API 按协议切换内容） ─────── */

function LeftPanel({
  t,
  protocol,
  history,
  autoSave,
  setAutoSave,
  onReplay,
  onClearHistory,
  openApiGroups,
  openApiError,
  onPickEndpoint,
  onPickGqlTemplate,
}: {
  t: (k: string) => string;
  protocol: DebugProtocol;
  history: HistoryItem[];
  autoSave: boolean;
  setAutoSave: (v: boolean) => void;
  onReplay: (item: HistoryItem) => void;
  onClearHistory: () => void;
  openApiGroups: OpenApiGroup[] | null;
  openApiError: boolean;
  onPickEndpoint: (ep: OpenApiEndpoint) => void;
  onPickGqlTemplate: (req: DebugRequest) => void;
}) {
  // OpenAPI 分组手风琴展开态（tag → open）
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // GraphQL 模板（PRESET_COLLECTION 中 graphql 项）
  const gqlTemplates = useMemo(
    () => PRESET_COLLECTION.filter((c) => c.request.protocol === "graphql"),
    [],
  );
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
              <Globe className="size-3.5 text-emerald-600 dark:text-emerald-400" />
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
                                (METHOD_COLOR[item.request.method] ?? "text-muted-foreground"),
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
            /* GraphQL：内省/常用模板（PRESET_COLLECTION） */
            <div className="p-1.5">
              <p className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                GraphQL 模板
              </p>
              {gqlTemplates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                  onClick={() => onPickGqlTemplate(item.request)}
                  title={item.request.query.slice(0, 80)}
                >
                  <span className="w-9 shrink-0 font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                    GQL
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                </button>
              ))}
            </div>
          ) : openApiError ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {t("openapi.loadFailed")}
            </p>
          ) : !openApiGroups ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {t("openapi.loading")}
            </p>
          ) : (
            /* REST：OpenAPI 端点树（按 tag 手风琴） */
            <div className="p-1.5">
              {openApiGroups.map((g) => {
                const open = openGroups[g.tag] ?? false;
                return (
                  <div key={g.tag} className="mb-0.5">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium hover:bg-accent"
                      onClick={() => setOpenGroups((s) => ({ ...s, [g.tag]: !open }))}
                    >
                      <ChevronDown
                        className={cn(
                          "size-3 text-muted-foreground transition-transform",
                          !open && "-rotate-90",
                        )}
                      />
                      <span className="truncate">{g.tag}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {g.items.length}
                      </span>
                    </button>
                    {open && (
                      <div className="ml-2 border-l pl-1">
                        {g.items.map((ep, i) => (
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
                                METHOD_COLOR[ep.method.toUpperCase()] ?? "text-muted-foreground",
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
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── 左栏：历史 / API（API 按协议切换内容） ─────── */
