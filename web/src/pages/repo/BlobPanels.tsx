/**
 * Blob 页右侧面板（SymbolsPanel / OutlinePanel）—— 自 BlobPage 拆出。
 * 均为纯展示面板（props 驱动），复用 SYMBOL_KIND_STYLE 色板常量。
 */
import { useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/Tip";
import { cn } from "@/lib/utils";
import type { SymbolInfo, SymbolRef } from "@/lib/code/symbols";
import type { OutlineItem } from "@/lib/markdown/markdown-outline";

/** 符号 kind → 文本色（官方 symbols 面板 kind 标签配色） */
const SYMBOL_KIND_STYLE: Record<string, string> = {
  function: "text-purple-500",
  method: "text-purple-500",
  class: "text-orange-500",
  interface: "text-orange-500",
  type: "text-amber-500",
  enum: "text-amber-500",
  impl: "text-cyan-500",
  variable: "text-blue-500",
  property: "text-blue-500",
  field: "text-blue-500",
  const: "text-emerald-500",
};

/** Symbols 面板（官方 blob 页代码符号目录 + 选中符号的 Definition/References 视图） */
export function SymbolsPanel({
  symbols,
  filter,
  onFilterChange,
  onSelect,
  onClose,
  selectedSym,
  onBack,
  onJumpLine,
}: {
  symbols: SymbolInfo[];
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (s: SymbolInfo) => void;
  onClose: () => void;
  /** 选中符号详情（官方：点击 symbol → Definition/References 视图） */
  selectedSym: { symbol: SymbolInfo; defText: string; refs: SymbolRef[] } | null;
  onBack: () => void;
  onJumpLine: (line: number) => void;
}) {
  const { owner = "", repo = "" } = useParams();
  const { t } = useI18n();
  // 详情视图（官方：Back to all symbols + kind/名称 + Definitions + References + Search）
  if (selectedSym) {
    const { symbol, defText, refs } = selectedSym;
    return (
      <div className="overflow-hidden rounded-md border">
        {/* 详情头：返回全部符号 + 关闭 */}
        <div className="flex items-center justify-between border-b bg-muted/50 px-2 py-1.5">
          <Button variant="ghost" className="gap-1 px-2" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            {t("blob.symbols.allSymbols")}
          </Button>
          <Tip label={t("blob.closeSymbols")}>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              aria-label={t("blob.closeSymbols")}
            >
              <X className="size-3.5" />
            </Button>
          </Tip>
        </div>
        {/* 符号标题（官方 heading：kind 标签 + 名称） */}
        <div className="border-b px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] uppercase",
                SYMBOL_KIND_STYLE[symbol.kind] ?? "text-muted-foreground",
              )}
            >
              {symbol.kind}
            </span>
            <span className="min-w-0 truncate font-mono text-sm font-semibold">{symbol.label}</span>
          </div>
        </div>
        {/* Definitions in this file（官方：定义所在行） */}
        <div className="border-b px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("blob.symbols.definitions")}
        </div>
        <button
          onClick={() => onJumpLine(symbol.line)}
          className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-xs hover:bg-accent"
        >
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {symbol.line}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{defText}</span>
        </button>
        {/* References in this file（官方：引用行列表） */}
        <div className="border-b px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("blob.symbols.references")}
          {refs.length > 0 && (
            <span className="ml-1 font-normal normal-case text-muted-foreground/80">
              ({refs.length})
            </span>
          )}
        </div>
        {refs.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("blob.noRefs")}</p>
        ) : (
          <div className="max-h-[38vh] overflow-y-auto pb-1">
            {refs.map((r) => (
              <button
                key={r.line}
                onClick={() => onJumpLine(r.line)}
                className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-xs hover:bg-accent"
              >
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {r.line}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{r.text}</span>
              </button>
            ))}
          </div>
        )}
        {/* Search for this symbol（官方：全仓库搜索该符号） */}
        <a
          href={`/search?q=${encodeURIComponent(
            `repo:${owner}/${repo} ${symbol.label}`,
          )}&type=code`}
          className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-primary hover:underline"
        >
          {t("blob.symbols.search")}
          <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      {/* 标题行（官方：Symbols + 关闭按钮） */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <h2 className="text-sm font-semibold">{t("blob.symbols.title")}</h2>
        <Tip label={t("blob.closeSymbols")}>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("blob.closeSymbols")}>
            <X className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {/* 过滤框（官方：Filter symbols） */}
      <div className="border-b px-2 py-2">
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t("blob.symbols.filter")}
          aria-label={t("blob.symbols.filter")}
        />
      </div>
      {/* 符号树列表（官方：kind 标签 + 名称 + 行号；点击跳 #L{n}） */}
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {symbols.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t("blob.noSymbols")}</p>
        ) : (
          symbols.map((s) => (
            <button
              key={s.from}
              onClick={() => onSelect(s)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
            >
              <span
                className={cn(
                  "w-14 shrink-0 font-mono text-[10px] uppercase",
                  SYMBOL_KIND_STYLE[s.kind] ?? "text-muted-foreground",
                )}
              >
                {s.kind}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{s.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Outline 面板（官方 blob 页 markdown 目录——Outline + Filter headings + 层级缩进列表） */
export function OutlinePanel({
  outline,
  filter,
  onFilterChange,
  onSelect,
  onClose,
}: {
  outline: OutlineItem[];
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (o: OutlineItem) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-md border">
      {/* 标题行（官方：Outline + 关闭按钮） */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <h2 className="text-sm font-semibold">{t("blob.outline.title")}</h2>
        <Tip label={t("blob.closeOutline")}>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("blob.closeOutline")}>
            <X className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {/* 过滤框（官方：Filter headings） */}
      <div className="border-b px-2 py-2">
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t("blob.outline.filter")}
          aria-label={t("blob.outline.filter")}
        />
      </div>
      {/* 标题树列表（官方：层级缩进；点击滚动到标题） */}
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {outline.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t("blob.noHeadings")}</p>
        ) : (
          outline.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect(o)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
              style={{ paddingLeft: `${Math.min(o.level - 1, 4) * 12 + 8}px` }}
            >
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {"#".repeat(o.level)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{o.text}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
