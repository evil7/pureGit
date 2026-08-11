/**
 * REST 请求参数（Params tab）与 URL 的双向联动（全量实时解析）
 *
 * 权威原则：**URL 是 query 参数的权威源，端点文档是 path 参数与可选参数的权威源**。
 * 表格行按来源区分（DebugParam.explicit）：
 * - `explicit=true`（显式行）：已在 URL 中出现——反向解析同步值/移除，空值也输出裸名
 * - `explicit=false`（编辑中行）：端点文档填充 / 手动添加——空值不输出，反向解析保留
 *
 * - **正向（参数 → URL）** `buildUrlFromParams`：path 按 `index` 段位覆盖 URL 对应段；
 *   query enabled 即输出（值非空 → `name=value`；值空但显式 → 裸名 `name`，`?aa&bb`
 *   循环不丢）；disabled / 空值非显式 → 不输出
 * - **反向（URL → 参数）** `syncParamsFromUrl`：URL 出现的 query key → 行显式同步；
 *   显式行被 URL 移除 → 表格移除（若属文档参数，由 ParamsTable 推导为待选 badge）；
 *   disabled 行保留；编辑中行（explicit=false）——**提供 doc 时若不在文档 query
 *   参数集则移除**（切换端点清残留：旧端点的文档参数行不属于新端点），在文档集内
 *   保留待填；URL 新 key 补显式行。path 按模板 index 同步段值，
 *   并提供 doc 模板时补齐缺失的 path 行（手写 URL 匹配端点后补锁定行）
 *
 * 事件驱动防循环：参数编辑（ParamsTable onChange）与 URL 编辑（URL 输入框 onChange）
 * 各自在事件处理器内同步对方；端点匹配（DebugPage 防抖）只补 path 行/文档，不改 URL。
 */
import type { DebugParam } from "./debug-api";

/** 解析 URL query string → [key, value][]（手动解码，兼容 `+` 为空格之外的原样） */
export function parseQuery(qs: string): [string, string][] {
  if (!qs) return [];
  return qs
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return [decodeURIComponent(pair), ""];
      return [decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1))];
    });
}

/**
 * 正向：参数表 → URL
 * - path：按段位置 `index` 覆盖 URL 对应段（不依赖 `{name}` 占位符——占位符被替换后
 *   仍正确联动）；**段内含 `{name}` 子占位（复合段 `{base}...{head}`）→ 只替换该子串**
 *   （共享 index 的多个 path 参数互不破坏，其余部分保留），否则整体覆盖段；
 *   值空或段缺失 → 保留当前段；值为 `{name}` 占位符 → 保持占位
 * - **复合占位段分次编辑**：先填 base（段变 `main...{head}`）后再填 head 时，段已不含
 *   `{base}` 子串 → 子串替换失效、整体覆盖会毁掉其余子占位。**doc 提供模板时，复合段
 *   直接从模板段重建**（模板永远含全部 `{name}`，各行值替换各自子占位；缺失行保留
 *   子占位）；无 doc（自定义 URL）维持子串替换/整体覆盖语义
 * - query：enabled 即输出——值非空 → `name=value`；值空但 explicit（显式存在）→ 裸名
 *   `name`（`?aa&bb` 无值 query 保持不丢）；disabled 或空值非显式 → 不输出
 */
export function buildUrlFromParams(url: string, params: DebugParam[], doc?: DocParams): string {
  const pathPart = url.split("?")[0];
  const segments = pathPart.split("/");
  const pathRows = params.filter(
    (p): p is DebugParam & { index: number } =>
      p.in === "path" &&
      p.enabled === true &&
      typeof p.index === "number" &&
      (p.value?.trim() ?? "") !== "",
  );

  // 复合占位段（doc 模板段含多个占位符）：从模板段重建——模板永远含全部 `{name}` 子占位，
  // 各行替换各自子串；缺失的参数行其子占位保留（如只填 base → `main...{head}`）
  const compoundIdx = new Set<number>();
  if (doc) {
    for (const row of pathRows) {
      const tplSeg = doc.path.split("/")[row.index];
      if (tplSeg && /\{[^}]+\}.*\{[^}]+\}/.test(tplSeg)) compoundIdx.add(row.index);
    }
    for (const idx of compoundIdx) {
      let seg = doc.path.split("/")[idx];
      for (const row of pathRows) {
        if (row.index !== idx) continue;
        const v = row.value?.trim() ?? "";
        seg = seg.split(`{${row.name}}`).join(v);
      }
      segments[idx] = seg;
    }
  }

  for (const p of pathRows) {
    if (compoundIdx.has(p.index)) continue; // 复合段已由模板重建
    const v = p.value?.trim() ?? "";
    const seg = segments[p.index];
    if (seg === undefined || seg === "") continue; // 段缺失（URL 被改短/改路径）→ 不动
    const sub = `{${p.name}}`;
    if (seg.includes(sub)) {
      // 段含该参数子占位（单占位段）：替换后其余部分保留
      segments[p.index] = seg.split(sub).join(v !== sub ? v : sub);
    } else {
      segments[p.index] = v; // 普通段整体覆盖（实际值或占位符）
    }
  }
  const path = segments.join("/");
  // enabled 且（值非空 或 显式存在）→ 输出；空值显式行输出裸名（无 `=`）
  const queryParams = params.filter(
    (p) => p.in === "query" && p.enabled && (p.value?.trim() !== "" || p.explicit),
  );
  const qs = queryParams
    .map((p) => {
      const v = p.value?.trim() ?? "";
      return v
        ? `${encodeURIComponent(p.name)}=${encodeURIComponent(v)}`
        : encodeURIComponent(p.name);
    })
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

/** 端点文档的 path/query 参数信息（反向解析对照物） */
export interface DocParams {
  /** 端点模板路径（如 `/orgs/{org}/repos`）——用于补齐 path 行及 index */
  path: string;
  /** 文档 query 参数名集合（badges 候选判定） */
  queryNames: string[];
}

/** 从端点模板路径提取 path 参数（name + split('/') 段索引；兼容 `{base}...{head}` 复合占位） */
function extractPathParams(tplPath: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  tplPath.split("/").forEach((seg, i) => {
    const re = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      out.push({ name: m[1], index: i });
    }
  });
  return out;
}

/**
 * 复合占位段按字面分隔符切分 URL 段值
 * - `{base}...{head}` 模板 + `main...dev` URL 段 → { base: "main", head: "dev" }
 * - 单占位段（`{org}`）→ { org: 整段 }（统一入口，行为一致）
 * - 切分失败（URL 段不含分隔符）→ null（调用方回退整段）
 */
function splitCompoundUrlSeg(tplSeg: string, urlSeg: string): Record<string, string> | null {
  const names: string[] = [];
  const separators: string[] = [];
  let m: RegExpExecArray | null;
  const re = /\{([^}]+)\}/g;
  let last = 0;
  while ((m = re.exec(tplSeg)) !== null) {
    separators.push(tplSeg.slice(last, m.index));
    names.push(m[1]);
    last = m.index + m[0].length;
  }
  separators.push(tplSeg.slice(last));
  const out: Record<string, string> = {};
  let rest = urlSeg;
  for (let i = 0; i < names.length; i++) {
    const pre = separators[i];
    const post = separators[i + 1] ?? "";
    if (pre) {
      if (!rest.startsWith(pre)) return null;
      rest = rest.slice(pre.length);
    }
    if (i === names.length - 1) {
      if (post && !rest.endsWith(post)) return null;
      out[names[i]] = post ? rest.slice(0, -post.length) : rest;
    } else {
      const idx = post ? rest.indexOf(post) : -1;
      if (idx === -1) return null;
      out[names[i]] = rest.slice(0, idx);
      rest = rest.slice(idx);
    }
  }
  return out;
}

/**
 * 反向：URL → 参数表（全量实时解析）
 *
 * query 规则：
 * - URL 出现的 key → 行显式同步（value、enabled=true、explicit=true）
 * - 不在 URL 的行：disabled（enabled=false）保留；explicit=true（显式行）移除
 *   （若属文档 query 参数，ParamsTable 推导为待选 badge）；explicit=false（编辑中行）保留
 * - URL 新增 key → 补显式行
 *
 * path 规则（doc 提供模板时）：
 * - 已有 path 行 → 按 index 同步 URL 段值（占位段 → 占位符；实际值 → decode 回写）
 * - 模板有但表格缺失 → 补锁定行（value = URL 段实际值或 `{name}` 占位符）
 *
 * 展示排序（返回前统一重排）：path 恒在前按 index 升序；query 按 URL 出现顺序
 * （URL 中无此行 → 保持相对顺序排末尾）。排序不影响语义与正向构建循环稳定。
 */
export function syncParamsFromUrl(
  params: DebugParam[],
  url: string,
  doc?: DocParams,
): DebugParam[] {
  const urlPath = url.split("?")[0];
  const segments = urlPath.split("/");
  const entries = parseQuery(url.split("?")[1] ?? "");
  const docPathParams = doc ? extractPathParams(doc.path) : [];

  const next: DebugParam[] = params
    .map((p) => {
      if (p.in === "query") {
        const hit = entries.find(([k]) => k === p.name);
        if (hit) return { ...p, value: hit[1], enabled: true, explicit: true };
        // 不在 URL：
        // - disabled 保留（用户主动关闭，意图明确）
        // - explicit=true（显式行）移除（URL 移除该 key；属文档参数则转 badge）
        // - explicit=false（编辑中行）：doc 提供时若不在文档 query 参数集 → 移除
        //   （切换端点清残留——旧端点的文档参数行不属于新端点）；在文档集中 → 保留待填
        if (p.enabled === false) return p;
        if (p.explicit === true) return null;
        if (doc && !doc.queryNames.includes(p.name)) return null;
        return p;
      }
      if (p.in === "path") {
        // doc 提供模板时：path 行集合完全对齐模板（path 行只能来自端点，手动不可增删）
        if (doc && !docPathParams.some((d) => d.name === p.name)) return null;
        const docIdx = docPathParams.find((d) => d.name === p.name)?.index;
        const idx = docIdx ?? p.index;
        if (typeof idx !== "number") return p;
        const seg = segments[idx];
        if (seg === undefined || seg === "") return { ...p, index: idx };
        try {
          const decoded = decodeURIComponent(seg);
          // 复合占位（共享 index 的多个 path 参数）：按模板段字面分隔符切分各自子串
          // （`{base}...{head}` → base=main / head=dev）；单占位段整段即值
          if (doc) {
            const tplSeg = doc.path.split("/")[idx];
            const vals = tplSeg ? splitCompoundUrlSeg(tplSeg, decoded) : null;
            if (vals && vals[p.name] !== undefined) {
              return { ...p, value: vals[p.name], index: idx };
            }
          }
          return { ...p, value: decoded, index: idx };
        } catch {
          return { ...p, value: seg, index: idx };
        }
      }
      return p;
    })
    .filter((p): p is DebugParam => p !== null);

  // 补齐文档模板的 path 行（手写 URL 匹配端点后补锁定行；值取 URL 段实际值或占位符）
  for (const d of docPathParams) {
    if (!doc) break; // docPathParams 非空即 doc 存在（TS 无法推断，防御）
    if (next.some((p) => p.in === "path" && p.name === d.name)) continue;
    const seg = segments[d.index];
    const placeholder = `{${d.name}}`;
    let value = seg && seg !== placeholder ? seg : placeholder;
    // 复合占位补齐行：按模板段切分取该参数子串（`main...dev` → base 行 "main"）
    if (seg && seg !== placeholder) {
      const tplSeg = doc.path.split("/")[d.index];
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        decoded = seg;
      }
      const vals = tplSeg ? splitCompoundUrlSeg(tplSeg, decoded) : null;
      if (vals && vals[d.name] !== undefined) value = vals[d.name];
    }
    next.push({
      name: d.name,
      in: "path",
      value,
      enabled: true,
      index: d.index,
    });
  }

  // URL 中出现的 query key 但参数表缺失 → 补显式行；重复 key（`?a=1&a=2`）只补首个
  // （表格单 key 模型——已有行同步也取首个，行为一致；多余重复值被忽略）
  const seen = new Set<string>();
  for (const [k, v] of entries) {
    if (seen.has(k)) continue;
    seen.add(k);
    if (!next.some((p) => p.in === "query" && p.name === k)) {
      next.push({ name: k, in: "query", value: v, enabled: true, explicit: true });
    }
  }
  return sortParamsForDisplay(next, entries);
}

/**
 * 表格展示排序（path 优先 → query 按 URL 顺序）：
 * - path 行：恒在前，按段位置 index 升序（模板顺序）
 * - query 行：URL 中出现的 key 按 URL 出现顺序（parseQuery 保序）；不在 URL 的行
 *   （disabled 保留 / 文档待填）保持相对顺序排在末尾
 * - 排序只影响展示顺序与正向构建输出顺序（buildUrlFromParams 按数组序输出 →
 *   表格序 = URL 序 → 循环稳定），不改变任何语义（path 按 index、query 按 enabled+value）
 */
function sortParamsForDisplay(params: DebugParam[], entries: [string, string][]): DebugParam[] {
  const urlOrder = new Map(entries.map(([k], i) => [k, i]));
  const paths = params
    .filter((p) => p.in === "path")
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const queries = params.filter((p) => p.in === "query");
  const inUrl = queries
    .filter((q) => urlOrder.has(q.name))
    .sort((a, b) => (urlOrder.get(a.name) ?? 0) - (urlOrder.get(b.name) ?? 0));
  const notInUrl = queries.filter((q) => !urlOrder.has(q.name));
  return [...paths, ...inUrl, ...notInUrl];
}
