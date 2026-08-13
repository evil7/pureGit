/**
 * 代码编辑器公共组件（迁移 CodeMirror 6，对齐官方 GitHub）
 *
 * 编辑态：CodeMirror 6（行号、语法高亮、自动缩进、括号匹配、软换行等原生能力）
 * 预览态：CodeMirror 6 只读（同引擎，官方 edit 页 Preview 同款）
 * 语言：按文件名推断（inferLang），编辑/预览自适应
 *
 * 用法：
 * <CodeEditor value={code} onChange={setCode} path="src/a.ts" placeholder="…" />
 */
import { useEffect, useRef, useState } from "react";
import { Eye, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inferLang } from "@/lib/code/shiki";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useTheme } from "@/hooks/useTheme";
import { createCmEditor } from "@/lib/code/codemirror";
import { cn } from "@/lib/utils";
import type { GraphQLSchema } from "graphql";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 文件名（推断语言；预览高亮用） */
  path: string;
  placeholder?: string;
  /** 最小高度（编辑/预览内容区） */
  minHeight?: string;
  /** 是否显示头部工具栏（编辑/预览切换 + 缩进 + 换行；默认 true，调试面板等精简场景传 false） */
  toolbar?: boolean;
  /** 附加到最外层容器（如 rounded-none 覆盖嵌套圆角） */
  className?: string;
  /** 撑满父容器高度（flex 布局、内部滚动；替代 minHeight） */
  fill?: boolean;
  /** 只读（调试面板返回体展示等；编辑态亦不可编辑、无光标） */
  readOnly?: boolean;
  /** GraphQL 语言专属：运行时 schema（调试面板 GraphQL 编辑器传 debug-graphql 的 schema，驱动智能补全/诊断） */
  graphqlSchema?: GraphQLSchema | null;
  /** JSON 语言专属：JSON-schema（调试面板 REST body 传 ReqOperation.body，驱动字段级补全） */
  jsonSchema?: unknown;
}

export function CodeEditor({
  value,
  onChange,
  path,
  placeholder = "// …",
  minHeight = "min-h-64",
  toolbar = true,
  className,
  fill,
  readOnly,
  graphqlSchema,
  jsonSchema,
}: Props) {
  const { codeThemeId, codeTheme } = useCodeTheme();
  const { theme } = useTheme();
  const [preview, setPreview] = useState(false);
  // 官方同款配置（Indent mode / Indent size / Line wrap）
  const [wrap, setWrap] = useState(true);
  const [indentMode, setIndentMode] = useState<"spaces" | "tab">("spaces");
  const [indentSize, setIndentSize] = useState(2);
  const editRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // CM6 实例（编辑/预览各一，由 useEffect 创建/销毁）
  const cmRef = useRef<ReturnType<typeof createCmEditor> | null>(null);
  const previewCmRef = useRef<ReturnType<typeof createCmEditor> | null>(null);
  // 外部受控值（用于区分"用户输入"与"外部 setState"）
  const lastValueRef = useRef(value);

  // 语言徽章
  const lang = inferLang(path);

  // 明暗模式（驱动 CM6 主题映射）
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const colors = {
    bg: dark ? codeTheme.preview.bgDark : codeTheme.preview.bgLight,
    fg: dark ? codeTheme.preview.fgDark : codeTheme.preview.fgLight,
    accent: codeTheme.preview.accent,
    // 完整 token 调色板（明暗各一套）
    tokens: dark ? codeTheme.preview.tokens.dark : codeTheme.preview.tokens.light,
  };

  // —— 编辑态：CM6 生命周期 ——
  useEffect(() => {
    if (preview) return;
    const el = editRef.current;
    if (!el) return;
    // 主题/换行/缩进/语言变化时重建（本组件低频切换，重建简单可靠）
    const cm = createCmEditor(el, {
      value,
      lang,
      wrap,
      indentMode,
      indentSize,
      placeholder,
      dark,
      colors,
      readOnly,
      graphqlSchema,
      jsonSchema,
      onChange: (v) => {
        lastValueRef.current = v;
        onChange(v);
      },
    });
    cmRef.current = cm;
    return () => {
      cm.destroy();
      cmRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preview,
    lang,
    wrap,
    indentMode,
    indentSize,
    dark,
    codeThemeId,
    readOnly,
    graphqlSchema,
    jsonSchema,
  ]);

  // 外部 value 变化时同步进 CM6（避免覆盖用户输入中/失焦回写）
  useEffect(() => {
    const cm = cmRef.current;
    if (!cm) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      cm.view.dispatch({
        changes: { from: 0, to: cm.view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // —— 预览态：CM6 只读生命周期（同引擎；内容/主题变化时重建）——
  useEffect(() => {
    if (!preview) return;
    const el = previewRef.current;
    if (!el) return;
    const cm = createCmEditor(el, {
      value,
      lang,
      wrap,
      indentMode: "spaces",
      indentSize: 2,
      dark,
      colors,
      readOnly: true,
      onChange: () => {},
    });
    previewCmRef.current = cm;
    return () => {
      cm.destroy();
      previewCmRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, value, lang, wrap, dark, codeThemeId]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        fill && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      {/* 文件头（官方 BlobEditHeader）：Edit/Preview 分段 + Indent mode/Indent size/Line wrap */}
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-1.5">
          {/* Edit / Preview 分段控件（官方 SegmentedControl） */}
          <div className="flex items-center rounded-md border bg-background p-0.5">
            <Button
              size="sm"
              variant={!preview ? "default" : "ghost"}
              className="h-6 gap-1 text-xs"
              onClick={() => setPreview(false)}
            >
              <PencilLine className="size-3" />
              编辑
            </Button>
            <Button
              size="sm"
              variant={preview ? "default" : "ghost"}
              className="h-6 gap-1 text-xs"
              onClick={() => setPreview(true)}
            >
              <Eye className="size-3" />
              预览
            </Button>
          </div>
          {/* 右侧控件（官方 CodeMirrorSpacingControls；仅编辑态显示缩进配置） */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {!preview && (
              <>
                {/* Indent mode */}
                <Select
                  value={indentMode}
                  onValueChange={(v) => setIndentMode(v as "spaces" | "tab")}
                >
                  <SelectTrigger size="sm" className="h-6 gap-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spaces">Spaces</SelectItem>
                    <SelectItem value="tab">Tabs</SelectItem>
                  </SelectContent>
                </Select>
                {/* Indent size */}
                <Select value={String(indentSize)} onValueChange={(v) => setIndentSize(Number(v))}>
                  <SelectTrigger size="sm" className="h-6 gap-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="8">8</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
            {/* Line wrap mode（官方 No wrap / Soft wrap；编辑/预览共用） */}
            <Select value={wrap ? "on" : "off"} onValueChange={(v) => setWrap(v === "on")}>
              <SelectTrigger size="sm" className="h-6 gap-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">No wrap</SelectItem>
                <SelectItem value="on">Soft wrap</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {preview ? (
        /* 预览：CodeMirror 6 只读（同引擎；无光标/无输入，保留选择复制） */
        <div
          ref={previewRef}
          className={cn("cm-host cm-view", fill ? "min-h-0 flex-1" : minHeight)}
          style={{ backgroundColor: colors.bg }}
        />
      ) : (
        /* 编辑态：CodeMirror 6（行号 + 语法高亮 + 缩进 + 括号匹配；readOnly 时无光标/无输入） */
        <div
          ref={editRef}
          className={cn("cm-host", readOnly && "cm-view", fill ? "min-h-0 flex-1" : minHeight)}
          style={{ backgroundColor: colors.bg }}
        />
      )}
    </div>
  );
}
