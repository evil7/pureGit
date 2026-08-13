/**
 * API 调试工具 —— 统一请求模型与执行引擎
 *
 * 类似 Postman/Scalar 的统一请求面板：GraphQL 与 REST 共用同一 DebugRequest 模型，
 * 执行时按 protocol 分发到对应通道。**直连 api.github.com**（浏览器端），
 * 返回原始 HTTP 状态/响应头/响应体——调试工具的价值就是展示真实行为
 * （匿名 GraphQL 恒 403、错误响应结构、状态码语义等），因此绕过 Octokit SDK
 * 的标准化包装（SDK 会吞掉部分细节）。请求头手动构造（调试工具特殊性，绕过 SDK 类型化封装）。
 *
 * 身份：token 为空 = 匿名；否则 Bearer 携带。匿名 REST 有 60/h 配额，GraphQL 恒 403
 * （GitHub 官方行为，正好用于验证鉴权边界）。
 */
export type DebugProtocol = "graphql" | "rest";

/** GraphQL 操作类型 / REST HTTP 方法（统一选择器） */
export type DebugMethod =
  | "query"
  | "mutation"
  | "GET"
  | "HEAD"
  | "POST"
  | "PATCH"
  | "PUT"
  | "DELETE"
  | "OPTIONS";

/** 请求头 K/V 行（Postman 风格表格；enabled=false 时该行不发送） */
export interface HeaderRow {
  key: string;
  value: string;
  enabled?: boolean;
  /** 锁定行（必填请求头自动填充，不可编辑/删除） */
  locked?: boolean;
  /** token 注入行（Authorization）：默认 filled 占位 → 发送时替换为真实 token；
   *  清空（value 为空）→ 该行不发送（匿名）；手输非占位值 → 原样发送 */
  token?: boolean;
}

/** REST 请求参数行（Params tab）：path 参数绑定 URL 占位段，query 参数绑定 URL query string */
export interface DebugParam {
  name: string;
  in: "path" | "query";
  value: string;
  enabled?: boolean;
  /** path 参数在 URL 模板中的段位置（split('/') 索引，静态来自端点模板；`path[n]` 徽章显示） */
  index?: number;
  /** 段内占位序号（0 起；单占位段恒 0；复合段如 `{base}...{head}` → base=0、head=1）。
   *  与 `index` 共同唯一定位参数在 URL 模板中的位置 */
  segPos?: number;
  /** 所在段占位符总数（单占位段恒 1；复合段 = 段内占位符个数） */
  segCount?: number;
  /** 段内字面分隔符数组（含前导/后缀；`{base}...{head}` → ["","...",""]；
   *  `{aaa}...{bbb}---{ccc}` → ["","...","---",""]）。复合段渲染时展示中间分隔符 */
  segSeparators?: string[];
  /** query 行「显式存在」标记：true = 已在 URL 中显式出现（反向解析写入/同步），
   *  空值也输出裸名 `name`（`?aa&bb` 保持不丢）；URL 移除该 key → 本行从表格移除
   *  （文档参数自动转为待选 badge）。false = 编辑中行（端点文档填充 / 手动添加），
   *  空值不输出 URL，反向解析保留（不因 URL 无此 key 而移除） */
  explicit?: boolean;
  /** 必填标记（path 恒必填；query 仅 required query 自动行带 true）——锁定行语义：
   *  checkbox 恒开、key 只读、操作列 Lock 不可删除；**未填值时警告样式 + 占位提示** */
  required?: boolean;
  /** OpenAPI 参数类型（string/integer/number/boolean/array…；来自 op.params.type）——
   *  必填未填时的占位提示：数字类 → `1`，其余 → `{name}` */
  type?: string;
}

/** REST 请求数据类型（快速切换发送内容格式；form-urlencoded/form-data 均走表格） */
export type BodyType = "none" | "json" | "form-urlencoded" | "form-data" | "text";

export interface DebugRequest {
  protocol: DebugProtocol;
  method: DebugMethod;
  /** REST：相对路径（/repos/{owner}/{repo}，自动补全 api.github.com）；GraphQL 忽略 */
  url: string;
  /** GraphQL 查询体 */
  query: string;
  /** M6：多 operation 时当前选中的 operation 名（body 附带 operationName；空 = 不附带） */
  operationName: string;
  /** GraphQL variables（JSON 文本） */
  variables: string;
  /** 附加请求头（Postman 风格 K/V 表格行） */
  headers: HeaderRow[];
  /** REST 请求数据内容类型 */
  bodyType: BodyType;
  /** REST 请求数据 */
  body: string;
  /** bodyType=form 时的 K/V 行（表格填写） */
  formRows: HeaderRow[];
  /** REST 请求参数（Params tab：path/query；编辑联动 URL，见 debug-params.ts） */
  params: DebugParam[];
}

export const EMPTY_REQUEST: DebugRequest = {
  protocol: "rest",
  method: "GET",
  // 默认路径直接进根路径 `/`（placeholder 仍提示典型端点模板）
  url: "/",
  // GraphQL 默认空——仅 placeholder 提示示例（queryPlaceholder），不自动填写
  query: "",
  operationName: "",
  variables: "",
  // 默认 Authorization 行（filled 占位）：渲染后由 DebugPage 补 identityLabel
  headers: [{ key: "Authorization", value: "Bearer ••••••••••", enabled: true, token: true }],
  bodyType: "none",
  body: "",
  formRows: [],
  params: [],
};

export interface DebugResult {
  /** HTTP 状态码（0 = 网络层失败） */
  status: number;
  ok: boolean;
  durationMs: number;
  bodyText: string;
  contentType: string;
  /** 响应头（响应头区块；key 全小写，fetch Headers 规范化） */
  responseHeaders: Record<string, string>;
  /** 网络层失败详情（fetch 抛错） */
  networkError?: string;
}

const GQL_ENDPOINT = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";

/** 解析 JSON 文本（空串/非法返回 null） */
export function tryParseJson(text: string): Record<string, unknown> | null {
  if (!text?.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 旧数据兼容：bodyType 归一化（旧 "form" → "form-urlencoded"） */
export function normalizeBodyType(bt: unknown): BodyType {
  if (bt === "form") return "form-urlencoded";
  const all: BodyType[] = ["none", "json", "form-urlencoded", "form-data", "text"];
  return all.includes(bt as BodyType) ? (bt as BodyType) : "none";
}

/** 解析附加请求头（K/V 行；忽略空 key 与 disabled 行；token 注入行特殊处理）
 *
 * - token 行 value 为占位（`Bearer •…`）→ 替换为真实 token（无 token 则跳过 → 匿名）
 * - token 行 value 为空 → 跳过（匿名）
 * - token 行手输非占位值 → 原样发送
 */
function parseExtraHeaders(rows: HeaderRow[], token: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const k = row.key?.trim();
    if (!k) continue;
    let v = row.value ?? "";
    if (row.token) {
      if (v.startsWith("Bearer •")) {
        if (!token) continue;
        v = `Bearer ${token}`;
      } else if (!v.trim()) {
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/** 统一执行引擎（GraphQL / REST；form-data 文件上传经 files 传入） */
export async function executeDebug(
  req: DebugRequest,
  token: string | null,
  files?: Record<number, File>,
): Promise<DebugResult> {
  const started = performance.now();
  // Authorization 完全由请求头 token 行控制：占位 → 真实 token；空/删除 → 匿名。
  // 不再自动注入 token，保证「去除 Authorization = 匿名」成立；
  // User-Agent 亦由请求头表格的 UA 锁定行承载（浏览器 fetch 对 UA 为 forbidden header 会忽略，
  // 保留表格行仅作展示约定）。
  const extraHeaders = parseExtraHeaders(req.headers, token);
  const baseHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  try {
    let res: Response;
    if (req.protocol === "graphql") {
      const body: Record<string, unknown> = { query: req.query };
      // M6：operationName 附带（多 operation 只发选中项；空则全量发送）
      if (req.operationName) body.operationName = req.operationName;
      const vars = tryParseJson(req.variables);
      if (vars) body.variables = vars;
      res = await fetch(GQL_ENDPOINT, {
        method: "POST",
        headers: { ...baseHeaders, ...extraHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // REST：URL 自动补全（http 开头原样；否则拼 REST_BASE）
      const url = /^https?:\/\//.test(req.url.trim())
        ? req.url.trim()
        : `${REST_BASE}${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
      // 按 bodyType 构造请求数据与 Content-Type（Postman 风格快速切换）
      const formRows = req.formRows ?? [];
      // form 行有效：非空 key 即可（form-data 下已选文件的行也算）
      const hasFormRows = formRows.some((r) => r && r.enabled !== false && r.key?.trim());
      const isFormType = req.bodyType === "form-urlencoded" || req.bodyType === "form-data";
      const hasBody =
        req.bodyType !== "none" && (req.body?.trim().length > 0 || (isFormType && hasFormRows));
      const sendHeaders: Record<string, string> = {
        ...baseHeaders,
        ...extraHeaders,
      };
      let body: BodyInit | undefined;
      if (hasBody) {
        if (req.bodyType === "json") {
          if (!sendHeaders["Content-Type"]) sendHeaders["Content-Type"] = "application/json";
          body = req.body;
        } else if (req.bodyType === "form-urlencoded") {
          if (!sendHeaders["Content-Type"])
            sendHeaders["Content-Type"] = "application/x-www-form-urlencoded";
          const params = new URLSearchParams();
          for (const row of formRows) {
            if (!row || row.enabled === false) continue;
            const k = row.key?.trim();
            if (k) params.append(k, row.value ?? "");
          }
          body = params.toString();
        } else if (req.bodyType === "form-data") {
          // multipart/form-data：不设 Content-Type（浏览器自动带 boundary）；
          // 点选类型自动设置的 multipart Content-Type 行忽略（无 boundary 会解析失败）
          if ((sendHeaders["Content-Type"] ?? "").startsWith("multipart/form-data")) {
            delete sendHeaders["Content-Type"];
          }
          // 行已选文件 → append 文件；否则 append 文本（视觉一致方案）
          const fd = new FormData();
          for (let i = 0; i < formRows.length; i++) {
            const row = formRows[i];
            if (!row || row.enabled === false) continue;
            const k = row.key?.trim();
            if (!k) continue;
            const file = files?.[i];
            if (file) fd.append(k, file, file.name);
            else fd.append(k, row.value ?? "");
          }
          body = fd;
        } else {
          // text
          if (!sendHeaders["Content-Type"]) sendHeaders["Content-Type"] = "text/plain";
          body = req.body;
        }
      }
      res = await fetch(url, {
        method: req.method,
        headers: sendHeaders,
        ...(body !== undefined ? { body } : {}),
      });
    }
    const bodyText = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      durationMs: Math.round(performance.now() - started),
      bodyText,
      contentType: res.headers.get("content-type") ?? "",
      responseHeaders: Object.fromEntries(res.headers.entries()),
    };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      bodyText: "",
      contentType: "",
      responseHeaders: {},
      networkError: e instanceof Error ? e.message : String(e),
    };
  }
}

/** pretty JSON（非法 JSON 原样返回） */
export function prettyJson(bodyText: string): string {
  try {
    return JSON.stringify(JSON.parse(bodyText), null, 2);
  } catch {
    return bodyText;
  }
}

/**
 * GraphQL 轻量格式化（调试面板手动格式化按钮用）
 *
 * 不解析 AST（避免引依赖）：
 * 1. 拆行：`{`/`(`/`[` 合并到当前行尾后换行；`}`/`)`/`]` 与逗号单独成行
 *    （字符串/块字符串/`#` 注释内的结构字符不拆）→ 单行输入也能展开为多行
 * 2. 缩进：逐行 trim → 行首闭括号先减缩进 → 输出 → 整行开-闭净增更新深度
 * 非法/空输入返回 null（调用方不写入）。
 */
export function formatGraphQL(src: string): string | null {
  if (!src?.trim()) return null;

  // ── 1) 按结构边界拆行 ──
  const rawLines: string[] = [];
  {
    let current = "";
    const flush = () => {
      if (current.trim()) rawLines.push(current);
      current = "";
    };
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      // 块字符串 """..."""（整体一行，不拆内部）
      if (src.startsWith('"""', i)) {
        flush();
        const end = src.indexOf('"""', i + 3);
        rawLines.push(src.slice(i, end === -1 ? n : end + 3).trim());
        i = end === -1 ? n : end + 3;
        continue;
      }
      // 普通字符串（跳过，含 \" 转义；内部结构字符不拆）
      if (ch === '"') {
        current += ch;
        i++;
        while (i < n) {
          current += src[i];
          if (src[i] === "\\" && i + 1 < n) {
            current += src[i + 1];
            i += 2;
            continue;
          }
          if (src[i] === '"') {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      // `#` 注释：并入当前行到行尾
      if (ch === "#") {
        let j = i;
        while (j < n && src[j] !== "\n") j++;
        current += src.slice(i, j);
        i = j;
        continue;
      }
      // 开括号：并入当前行尾后换行（query { → "query {"）
      if (ch === "{" || ch === "(" || ch === "[") {
        current += ch;
        flush();
        i++;
        continue;
      }
      // 闭括号 / 逗号 / 分号：先收当前行，再单独成行
      if (ch === "}" || ch === ")" || ch === "]" || ch === "," || ch === ";") {
        flush();
        if (ch !== ",") rawLines.push(ch);
        i++;
        continue;
      }
      // 换行 / 空白边界
      if (ch === "\n" || ch === "\r") {
        flush();
        i++;
        continue;
      }
      current += ch;
      i++;
    }
    flush();
  }
  if (rawLines.length === 0) return null;

  // ── 2) 按括号深度缩进 ──
  let depth = 0;
  const out: string[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    // 统计括号（忽略 " 字符串内的括号）
    let opens = 0;
    let closes = 0;
    let inStr = false;
    for (const ch of line) {
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{" || ch === "(" || ch === "[") opens++;
      else if (ch === "}" || ch === ")" || ch === "]") closes++;
    }
    // 行首闭括号 → 该行缩进先减
    const first = line[0];
    const leadingClose = first === "}" || first === ")" || first === "]" ? closes : 0;
    const indent = Math.max(0, depth - leadingClose);
    out.push("  ".repeat(indent) + line);
    depth = Math.max(0, depth + opens - closes);
  }
  return out.join("\n");
}
