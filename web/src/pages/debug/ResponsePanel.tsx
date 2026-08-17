/**
 * 响应面板（下部：响应状态条 + Body/Headers，固定高度常驻可视）
 *
 * - 响应头部一行：开合按钮 + 响应头/响应体 tabs + 右侧 statusCode/耗时/大小/美化
 * - 响应体：pretty 态用只读 CodeEditor（已格式化）+ 编辑器内右上角复制按钮；raw 态原样 pre
 * - 响应头：K/V 列表
 * - GitHub App 专属端点 401（需 App JWT）顶部提示条
 * - 端点文档已迁移至右侧 EndpointDocDrawer（左栏对应端点行 hover 触发），本面板不再承载
 */
import { ChevronDown, ChevronUp, Copy, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { CodeEditor } from "@/components/CodeEditor";
import { cn } from "@/lib/utils";
import type { DebugResult } from "@/lib/debug/debug-api";

/** 响应体字节数格式化（B/KB/MB） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type ViewMode = "pretty" | "raw";

interface ResponsePanelProps {
  t: (k: string) => string;
  result: DebugResult | null;
  respCollapsed: boolean;
  setRespCollapsed: (v: boolean) => void;
  respTab: "body" | "headers";
  setRespTab: (v: "body" | "headers") => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  /** GitHub App 专属端点 401 提示 */
  appJwt401: boolean;
}

export function ResponsePanel({
  t,
  result,
  respCollapsed,
  setRespCollapsed,
  respTab,
  setRespTab,
  viewMode,
  setViewMode,
  appJwt401,
}: ResponsePanelProps) {
  return (
    /* 折叠时仅保留头部一行（开合按钮收起内容） */
    <div
      className={cn(
        "shrink-0 flex-col overflow-hidden border-t",
        respCollapsed ? "flex" : "flex h-[42%] min-h-60",
      )}
    >
      {/* 响应头部一行：开合按钮 + 响应头/响应体 tabs（响应头在前，默认仍选中响应体）
            + 右侧 statusCode/耗时/大小/视图 */}
      <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
        {/* 响应区开合按钮：展开态 ChevronDown（点击向下关闭），折叠态 ChevronUp */}
        <Button
          variant="ghost"
          size="icon"
          className="mr-0.5 h-7 w-7 shrink-0 rounded-full px-0 text-muted-foreground hover:text-foreground"
          onClick={() => setRespCollapsed(!respCollapsed)}
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
            /* 空状态：等待发送占位（端点文档已迁至右侧 EndpointDocDrawer） */
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
                    <span className="min-w-0 flex-[1.5] break-all font-mono text-[11px]">{v}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* 返回体：pretty 态用只读 CodeEditor（已格式化）+ 编辑器内右上角复制按钮；raw 态原样 pre */
            <div className="h-full min-h-0 p-2">
              {viewMode === "pretty" ? (
                <div className="relative h-full min-h-0">
                  <CodeEditor
                    value={result.networkError ? result.networkError : prettyJson(result.bodyText)}
                    onChange={() => {}}
                    path="body.json"
                    readOnly
                    toolbar={false}
                    className="rounded-md"
                  />
                  <CopyButton
                    text={result.networkError ?? result.bodyText}
                    title={t("response.copy")}
                  />
                </div>
              ) : (
                /* raw 态：pre 撑满响应内容区（min-h-full——内容少时占满容器，
                   内容多时自然撑高、外层 overflow-auto 滚动），右上角复制按钮 */
                <div className="relative h-full min-h-0">
                  <pre
                    className={cn(
                      "m-0 min-h-full px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all",
                      !result.ok && "text-destructive",
                    )}
                  >
                    {result.networkError ? result.networkError : result.bodyText}
                  </pre>
                  <CopyButton
                    text={result.networkError ?? result.bodyText}
                    title={t("response.copy")}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 复制按钮（pretty/raw 右上角共用） */
function CopyButton({ text, title }: { text: string; title: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="absolute right-2 top-2 z-10 h-6 w-6 px-0 text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => {});
      }}
      title={title}
    >
      <Copy className="size-3.5" />
    </Button>
  );
}

/** JSON 美化（网络错误原样返回；非法 JSON 原样返回） */
function prettyJson(text: string): string {
  if (!text?.trim()) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
