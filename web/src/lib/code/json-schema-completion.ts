/**
 * JSON-schema 驱动的 CodeMirror 6 补全（REST body 字段级提示）
 *
 * 调试面板 REST Body（json）编辑器挂载：光标位于对象 key 位置（前一个非空白
 * 字符是 `{` 或 `,`）时，沿 JSON 结构路径在 schema 的 properties 中提示字段名，
 * 附带类型、必填标记与 description（info）；嵌套对象逐层展开（输入 `{` 后自动
 * 提示下一层字段）；数组元素按 items 结构提示。
 *
 * 结构路径解析：轻量扫描器从文档开头扫到光标，维护对象/数组栈——正确跳过
 * 字符串（含转义）、数值、布尔，忽略 value 内容只追踪结构；对象 key 在
 * `"key":` 后遇到 `{`/`[` 时压栈携带。deref 产物无 $ref，但防御性处理 allOf。
 *
 * 触发时机限制：仅 `{`/`,` 后（对象 key 上下文）返回补全，避免在 value 位置
 * （字符串/数值）弹出噪音；与 CM6 默认补全（关键字）共存，互不干扰。
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

/** JSON 结构扫描器：返回光标处所在路径（对象 key / 数组 items 占位 0） */
function jsonPathAt(doc: string, pos: number): (string | number)[] {
  const stack: { type: "object" | "array"; key: string | null }[] = [];
  let pendingKey: string | null = null;
  let inString = false;
  let escaped = false;
  let i = 0;
  const n = Math.min(pos, doc.length);
  while (i < n) {
    const ch = doc[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      // 收集字符串内容（可能是 key）
      let j = i + 1;
      let s = "";
      while (j < n) {
        const c = doc[j];
        if (c === "\\") {
          s += doc[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (c === '"') break;
        s += c;
        j++;
      }
      // 字符串后跟 ':' → 是 key（暂存，待遇 `{`/`[` 时归属下一层）
      let k = j + 1;
      while (k < n && /\s/.test(doc[k])) k++;
      if (doc[k] === ":") pendingKey = s;
      i = Math.max(j + 1, i + 1);
      continue;
    }
    if (ch === "{") {
      stack.push({ type: "object", key: pendingKey });
      pendingKey = null;
    } else if (ch === "}") {
      stack.pop();
    } else if (ch === "[") {
      stack.push({ type: "array", key: pendingKey });
      pendingKey = null;
    } else if (ch === "]") {
      stack.pop();
    }
    i++;
  }
  const path: (string | number)[] = [];
  for (const item of stack) {
    if (item.type === "object") path.push(item.key ?? "");
    else path.push(0); // 数组元素位置 → items
  }
  return path;
}

/** 沿 JSON 路径在 schema 中取子 schema（空段 = 当前位置；数组 = items） */
function schemaAtPath(schema: unknown, path: (string | number)[]): unknown {
  let cur: unknown = schema;
  for (const seg of path) {
    if (!seg) return cur; // 空 key（当前对象自身）
    if (typeof cur !== "object" || cur === null) return undefined;
    const obj = cur as Record<string, unknown>;
    // deref 产物无 $ref，但防御性处理 allOf 单继承（OpenAPI 组件合成常见形态）
    const allOf = (obj.allOf as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
    const props =
      (obj.properties as Record<string, unknown> | undefined) ??
      (allOf?.properties as Record<string, unknown> | undefined);
    if (typeof seg === "number") {
      cur = obj.items ?? allOf?.items;
    } else {
      cur = props?.[seg];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** JSON-schema 推断类型（缺 type 时从结构推断，展示用） */
function inferType(s: Record<string, unknown>): string {
  if (typeof s.type === "string") return s.type;
  if (s.properties) return "object";
  if (s.items) return "array";
  if (Array.isArray(s.enum)) return "enum";
  if (typeof s.default !== "undefined") return typeof s.default;
  return "any";
}

/** 补全源：对象 key 上下文提示 properties 字段 */
function jsonSchemaCompletionSource(schema: unknown): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    // 匹配当前正在输入的 key 前缀（可为空：刚输入 `{`/`,` 时光标在空 key 位置）
    const word = context.matchBefore(/[A-Za-z0-9_$.-]*/);
    if (!word) return null;
    // 触发时机：word 之前（跳过空白）是 `{` 或 `,` → 处于对象 key 位置
    const before = context.state.sliceDoc(Math.max(0, word.from - 100), word.from).trimEnd();
    const lastChar = before[before.length - 1];
    if (lastChar !== "{" && lastChar !== ",") return null;

    const doc = context.state.doc.toString();
    const path = jsonPathAt(doc, context.pos);
    const node = schemaAtPath(schema, path);
    if (typeof node !== "object" || node === null) return null;
    const obj = node as Record<string, unknown>;
    const props = obj.properties as Record<string, unknown> | undefined;
    if (!props) return null;

    const required = new Set<string>(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    const options: Completion[] = Object.entries(props).map(([name, propSchema]) => {
      const ps = (propSchema ?? {}) as Record<string, unknown>;
      const type = inferType(ps);
      return {
        label: name,
        type: "property",
        detail: type,
        info: typeof ps.description === "string" ? ps.description : undefined,
        // 必填字段排前
        boost: required.has(name) ? 20 : 0,
        // 应用时带冒号，光标停在值位置（嵌套对象输入 `{` 后继续提示下一层）
        apply: `"${name}": `,
      };
    });
    return { from: word.from, to: word.to, options };
  };
}

/** 将 schema 包装为 CM6 补全扩展（仅覆盖字段补全，保留默认补全） */
export function jsonSchemaCompletion(schema: unknown): Extension {
  return autocompletion({
    override: [jsonSchemaCompletionSource(schema)],
  });
}
