/**
 * CodeMirror 6 代码编辑器工厂（迁移，对齐官方 GitHub 的编辑器）
 *
 * 官方 GitHub 的 blob 编辑器就是 CodeMirror 6（cm-editor / cm-gutters / cm-line 等
 * class 全部来自 CM6）。迁移后能力天然对齐：
 * - 行号 gutter、语法高亮（Lezer）、自动缩进、Tab 缩进、括号匹配、软换行
 * - 自动补全、搜索、折叠、多光标、虚拟化渲染（超大文件流畅）
 * - **折叠符号**（GitHub 官方：行号右侧小三角，hover 高亮）
 *
 * 模块化（CM6 extension 体系）：
 * - 每项能力一个独立 extension，按需组合，配置集中在本文件
 * - 代码主题（lib/code-theme.ts 的 7 套配色）映射为 EditorView.theme +
 *   syntaxHighlighting（跟随页面明暗，与 Shiki 预览同源配色）
 * - 语言按 inferLang 映射到 CM6 LanguageSupport
 */
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
  tooltips as cmTooltips,
  Decoration,
} from "@codemirror/view";
import {
  indentUnit,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { indentWithTab, defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { jsonSchemaCompletion } from "@/lib/code/json-schema-completion";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { graphql as cmGraphql, lint as cmGraphqlLint } from "cm6-graphql";
import type { GraphQLSchema } from "graphql";
import type { HighlightTokens } from "@/lib/code/code-theme";

/**
 * 语言 id → CM6 语言扩展（linguist 全量匹配后映射，见 lib/languages.ts）。
 * 缺语言（text 或未收录）回退无高亮纯文本。LanguageSupport 均为 Extension。
 *
 * graphql 语言用官方 cm6-graphql（graphiql 同源）：Lezer 解析高亮 + schema 驱动补全/诊断
 * （补全 = completion，诊断 = 独立 lint 扩展，两者分离需分别挂载）。
 * 无 schema 时仅高亮（lint/补全自动降级为空，无噪音）；加载 schema 后补全字段/参数/枚举。
 *
 * showErrorOnInvalidSchema: false —— cm6-graphql 默认 true，会运行 validateSchema 把
 * GitHub 官方 schema 自身的结构不一致（如 Node.id 未弃用而 Project.id 弃用）标为 lint 错误；
 * GitHub 官方 explorer 同样忽略这些，故关闭，lint 仅保留查询本身的 getDiagnostics。
 */
const LANG_SUPPORT: Record<string, (graphqlSchema?: GraphQLSchema | null) => Extension> = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ typescript: true, jsx: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  css: () => css(),
  html: () => html(),
  python: () => python(),
  sql: () => sql(),
  java: () => java(),
  cpp: () => cpp(),
  rust: () => rust(),
  go: () => go(),
  php: () => php(),
  graphql: (schema) => [
    cmGraphql(schema ?? undefined, { showErrorOnInvalidSchema: false }),
    // 语法/语义诊断（非法字段/参数）：仅 hover tooltip + 行内标记展示（docs/debug-page.md §10.2）；
    // **不挂 lintGutter()**——调试面板 GraphQL 编辑框与 JSON/Raw 编辑框视觉一致
    // （行号 + 折叠 gutter 两列，不多出诊断 gutter 列）；诊断信息 hover 时可见不占布局
    cmGraphqlLint,
  ],
};

/** 获取语言扩展（未知语言返回 null，仅纯文本编辑；graphql 语言可带 schema 驱动补全） */
export function cmLanguageFor(
  inferLangId: string,
  graphqlSchema?: GraphQLSchema | null,
): Extension | null {
  const factory = LANG_SUPPORT[inferLangId];
  return factory ? factory(graphqlSchema) : null;
}

/**
 * 语法高亮规则（完整 token 调色板 修复「仅两色」：
 * 此前所有 token 都映射 accent/fg 二色 → 视觉只有 2 种颜色；
 * 现按 code-theme.ts 每主题的 HighlightTokens（keyword/string/number/function/type/comment/property）
 * 逐一映射，函数/变量/数字/类型/注释各自一色，与各主题真实配色一致）。
 */
function buildHighlightStyle(t: HighlightTokens): HighlightStyle {
  return HighlightStyle.define([
    // 关键字/控制流/运算符 → keyword
    { tag: tags.keyword, color: t.keyword, fontWeight: "600" },
    // 字符串/模板 → string
    { tag: [tags.string, tags.special(tags.string)], color: t.string },
    // 注释 → comment（斜体淡化）
    {
      tag: [tags.comment, tags.blockComment, tags.lineComment],
      color: t.comment,
      fontStyle: "italic",
    },
    // 数字/布尔/null → number
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: t.number },
    // 函数/方法名 → function（含定义与调用）
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.definition(tags.function(tags.variableName)),
      ],
      color: t.function,
    },
    // 类型/类名 → type
    {
      tag: [tags.typeName, tags.className, tags.definition(tags.typeName)],
      color: t.type,
    },
    // 运算符 → keyword 系（同官方加粗）
    { tag: tags.operator, color: t.keyword, fontWeight: "600" },
    // 属性名/变量 → property
    { tag: [tags.propertyName, tags.variableName], color: t.property },
    // 标点/括号 → 继承前景
    { tag: [tags.punctuation, tags.bracket], opacity: 0.75 },
    // —— Markdown 专用 ——
    { tag: tags.heading, color: t.function, fontWeight: "700" },
    { tag: [tags.emphasis, tags.strong], fontStyle: "italic", fontWeight: "600" },
    { tag: [tags.link, tags.url], color: t.type, textDecoration: "underline" },
    { tag: tags.monospace, color: t.string },
    { tag: tags.quote, color: t.comment, fontStyle: "italic" },
    { tag: [tags.processingInstruction, tags.meta], color: t.comment, opacity: 0.7 },
  ]);
}

export interface CmOptions {
  /** 初始内容 */
  value: string;
  /** 语言 id（inferLang 的返回值，如 "typescript"） */
  lang: string;
  /** 是否软换行（默认开） */
  wrap: boolean;
  /** 缩进模式：spaces（空格） | tab（Tab 键） */
  indentMode: "spaces" | "tab";
  /** 缩进宽度（2/4/8；tab 模式时也作为展示宽度） */
  indentSize: number;
  /** 占位符（空内容时显示） */
  placeholder?: string;
  /** 变化回调（只读模式不会触发） */
  onChange: (value: string) => void;
  /** 明暗模式（驱动主题映射） */
  dark: boolean;
  /** 代码主题色（bg/fg/accent + 完整 token 调色板） */
  colors: {
    bg: string;
    fg: string;
    accent: string;
    /** 语法高亮 token 色（keyword/string/number/function/type/comment/property） */
    tokens: HighlightTokens;
  };
  /** 只读模式（展示用；无光标/无输入/保留选择复制） */
  readOnly?: boolean;
  /** GraphQL 语言专属：运行时 schema（驱动字段/参数/枚举补全与诊断；null = 仅高亮） */
  graphqlSchema?: GraphQLSchema | null;
  /** JSON 语言专属：JSON-schema（驱动 REST body 字段级补全；见 json-schema-completion.ts） */
  jsonSchema?: unknown;
  /** diff 行类型映射：行索引 → add/del（为行加背景装饰） */
  diffLines?: Array<{ from: number; to: number; type: "add" | "del" }>;
}

/** 单行 diff 背景装饰（add 绿 / del 红，官方 GitHub PR Files changed 同款）
 * lines: {from, to, type} 中 from/to 为 1-based 行号；compute 时经 state.doc 换行位置 */
function diffDecorations(lines: NonNullable<CmOptions["diffLines"]>): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to, type } of lines) {
      const startLine = state.doc.line(Math.min(from, state.doc.lines));
      const endLine = state.doc.line(Math.min(to, state.doc.lines));
      builder.add(
        startLine.from,
        endLine.to,
        Decoration.line({
          attributes: {
            class: type === "add" ? "cm-diff-add" : "cm-diff-del",
          },
        }),
      );
    }
    return builder.finish();
  });
}

/**
 * 折叠符号（GitHub 官方样式：行号右侧 chevron 三角 改 lucide SVG——
 * 与文件树展开箭头同款：展开 chevron-down / 闭合 chevron-right；低对比，hover 高亮 + 可点击）。
 * foldGutter 的 markerDOM 自定义 DOM；CSS 定位（custom.css .cm-foldMarker）。
 */
function githubFoldGutter(): Extension {
  const NS = "http://www.w3.org/2000/svg";
  return foldGutter({
    markerDOM(open) {
      // foldGutter markerDOM 要求 HTMLElement → 外层 span（.cm-foldMarker 定位/颜色），内嵌 lucide chevron SVG
      const wrap = document.createElement("span");
      wrap.className = "cm-foldMarker";
      wrap.setAttribute("aria-hidden", "true");
      wrap.title = open ? "Fold line" : "Unfold line";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "12");
      svg.setAttribute("height", "12");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      // lucide chevron-down（展开态）：m6 9 6 6 6-6；chevron-right（闭合态）：m9 18 6-6-6-6
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
      svg.appendChild(path);
      wrap.appendChild(svg);
      return wrap;
    },
  });
}

/**
 * 构建 CM6 编辑器并挂载到容器。
 * 返回销毁函数（卸载时调用）；主题/换行变化由调用方重建或 dispatch。
 */
export function createCmEditor(
  container: HTMLElement,
  opts: CmOptions,
): {
  view: EditorView;
  destroy: () => void;
} {
  const {
    value,
    lang,
    wrap,
    indentMode,
    indentSize,
    placeholder,
    onChange,
    dark,
    colors,
    readOnly = false,
    graphqlSchema,
    jsonSchema,
    diffLines,
  } = opts;

  // —— 主题映射（code-theme → CM6）——
  // 背景/前景跟随明暗；语法高亮用完整 token 调色板（函数/变量/数字等各自一色）
  const themeExtension = EditorView.theme(
    {
      "&": {
        backgroundColor: colors.bg,
        color: colors.fg,
        fontSize: "13px",
        // 高度自适应外部容器：flex 父下 flex:1 撑满（minHeight 兜底，避免底部空白/塌陷）；
        // 独立高度容器由 height:100% 兜底（custom.css .cm-view .cm-editor）
        flex: "1 1 auto",
        minHeight: "0",
      },
      ".cm-content": {
        caretColor: colors.accent,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        lineHeight: "1.5rem",
      },
      ".cm-scroller": {
        // 撑满编辑器高度：flex-grow 相对 cm-editor（flex column）——不依赖 height:100% 百分比解析
        // （父 computed height auto 时百分比失败 → scroller 塌陷成内容高；flex-grow 任何高度链都稳）
        flex: "1 1 auto",
        minHeight: "0",
        // 交叉轴（垂直）stretch：content/行号 gutter 拉伸到 scroller 全高——
        // 绕开 CM6 默认 .cm-content{min-height:100%} 的百分比链（scroller computed height auto 时
        // 百分比解析失败 → content 塌陷成内容高；stretch 由 flex 布局拉伸，任何高度链都稳）
        alignItems: "stretch !important",
        // 横竖滚动条默认允许（内容超出即出现；代码浏览默认 no wrap 依赖横向滚动）
        overflow: "auto",
      },
      ".cm-gutters": {
        backgroundColor: colors.bg,
        color: colors.fg,
        borderRight: "1px solid var(--border)",
        fontSize: "12px",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: `${colors.accent}33`,
      },
      ".cm-activeLine": {
        backgroundColor: `${colors.bg === "#ffffff" ? "#f6f8fa" : "#ffffff08"}`,
      },
      // tooltip（补全/诊断）溢出编辑器边界时不被容器裁剪，且盖过页面 sticky 层（navbar/topbar）
      ".cm-tooltip": {
        zIndex: 1000,
      },
    },
    { dark },
  );

  // 语法高亮规则（完整 token 调色板注入当前主题）
  const highlightStyle = syntaxHighlighting(buildHighlightStyle(colors.tokens));

  // 语言扩展（有高亮则启用；调用一次避免重复实例；graphql 语言带 schema 驱动补全）
  const langExt = cmLanguageFor(lang, graphqlSchema);

  // 基础扩展（各能力独立，模块化组合）
  const baseExtensions: Extension[] = [
    // tooltip 定位：fixed + 挂 document.body——补全/诊断框脱离编辑器所在滚动容器，
    // 溢出编辑器顶部/底部不被 overflow 裁剪、不被 sticky 行遮挡（z-index 由 custom.css 提升）
    cmTooltips({ position: "fixed", parent: document.body }),
    // 行号
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    bracketMatching(),
    // 折叠（GitHub 官方：行号右侧小三角 ▸/▾）
    githubFoldGutter(),
    autocompletion(),
    highlightSelectionMatches(),
    // 缩进（对齐官方 Indent mode / Indent size 下拉）
    // 官方默认 spaces/2；Tab 键缩进由 indentWithTab keymap 提供
    indentUnit.of(indentMode === "tab" ? "\t" : " ".repeat(indentSize)),
    EditorState.tabSize.of(indentSize),
    // 换行
    wrap ? EditorView.lineWrapping : [],
    // 语言（有高亮则启用）
    ...(langExt ? [langExt] : []),
    // JSON-schema 驱动的字段级补全（REST body；json 语言 + 提供 schema 时挂载）
    ...(jsonSchema ? [jsonSchemaCompletion(jsonSchema)] : []),
    // 语法高亮规则
    highlightStyle,
    // 占位符（官方 placeholder 扩展；只读模式不显示）
    !readOnly && placeholder ? cmPlaceholder(placeholder) : [],
    // diff 行背景装饰
    diffLines && diffLines.length > 0 ? diffDecorations(diffLines) : [],
    // 只读模式（无光标/无输入/保留选择与复制；官方 blob 展示同款）
    readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
    // 主题
    themeExtension,
    // 键盘：Tab 缩进 + 默认 + 历史 + 补全 + 搜索 + 折叠（只读模式禁编辑键）
    keymap.of([
      ...(readOnly ? [] : [indentWithTab]),
      ...(readOnly
        ? defaultKeymap.filter((k) => !k.run?.name?.startsWith("insert"))
        : defaultKeymap),
      ...(readOnly ? [] : historyKeymap),
      ...(readOnly ? [] : completionKeymap),
      ...searchKeymap,
      ...(readOnly ? [] : foldKeymap),
      ...(readOnly ? [] : lintKeymap),
    ]),
    // 变化回调（只读模式不触发）
    readOnly
      ? []
      : EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
  ];

  const state = EditorState.create({ doc: value, extensions: baseExtensions });
  const view = new EditorView({ state, parent: container });

  return {
    view,
    destroy: () => view.destroy(),
  };
}
