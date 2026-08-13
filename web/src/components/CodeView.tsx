/**
 * 代码只读展示组件（新增，统一所有代码展示场景为 CM6）
 *
 * 能力（与官方 GitHub blob 页同源）：
 * - CodeMirror 6 只读模式：行号、语法高亮（Lezer）、选择/复制、搜索、软换行
 * - 跟随代码配色（code-theme）与页面明暗，与编辑器 CodeEditor 完全同引擎
 * - 支持 diff 行背景装饰（add 绿 / del 红，官方 PR Files changed 同款）
 *
 * 用法：
 * <CodeView code={rawContent} path="src/a.ts" minHeight="min-h-96" />
 * <CodeView code={content} path="a.ts" diffLines={[{from,to,type}]} />
 */
import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { createCmEditor } from "@/lib/code/codemirror";
import { inferLang } from "@/lib/code/shiki";
import { collectSymbols, type SymbolInfo } from "@/lib/code/symbols";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface Props {
  /** 代码内容 */
  code: string;
  /** 文件名（推断语言与高亮） */
  path: string;
  /** 最小高度 */
  minHeight?: string;
  /** diff 行背景装饰（行号 → add/del） */
  diffLines?: Array<{ from: number; to: number; type: "add" | "del" }>;
  /** 符号列表回调（CM6 就绪后提取 lezer 语法树符号，供 symbols 面板） */
  onSymbolsChange?: (symbols: SymbolInfo[]) => void;
  /** CM6 view 就绪回调（symbols 点击需 dispatch 选区 + 提取引用，父组件持 view） */
  onViewReady?: (view: EditorView) => void;
}

export function CodeView({
  code,
  path,
  minHeight = "min-h-64",
  diffLines,
  onSymbolsChange,
  onViewReady,
}: Props) {
  const { codeThemeId, codeTheme } = useCodeTheme();
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<ReturnType<typeof createCmEditor> | null>(null);

  const lang = inferLang(path);
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // 容器背景 = 编辑器背景（代码主题）：行少时空白区同色，避免视觉断层
  const bg = dark ? codeTheme.preview.bgDark : codeTheme.preview.bgLight;

  // CM6 只读实例（主题/语言/内容变化时重建）
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const cm = createCmEditor(el, {
      value: code,
      lang,
      wrap: true,
      indentMode: "spaces",
      indentSize: 2,
      dark,
      colors: {
        bg: dark ? codeTheme.preview.bgDark : codeTheme.preview.bgLight,
        fg: dark ? codeTheme.preview.fgDark : codeTheme.preview.fgLight,
        accent: codeTheme.preview.accent,
        // 完整 token 调色板（明暗各一套）
        tokens: dark ? codeTheme.preview.tokens.dark : codeTheme.preview.tokens.light,
      },
      readOnly: true,
      diffLines,
      onChange: () => {},
    });
    cmRef.current = cm;
    // 符号提取（官方 symbols 面板同语义：遍历 lezer 语法树；仅需在实例就绪时算一次）
    onSymbolsChange?.(collectSymbols(cm.view));
    // view 就绪回调（symbols 点击 dispatch 选区 / 提取引用用）
    onViewReady?.(cm.view);
    return () => {
      cm.destroy();
      cmRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, dark, codeThemeId, path]);

  return (
    <div
      ref={hostRef}
      className={cn("cm-host cm-view overflow-hidden", minHeight)}
      style={{ backgroundColor: bg }}
    />
  );
}
