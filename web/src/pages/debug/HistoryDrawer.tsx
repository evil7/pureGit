/**
 * 执行历史 Drawer（右侧抽屉，`/$debug` 历史请求记录展示）
 *
 * 历史从左侧栏迁入独立右侧抽屉（触发：请求区常驻「打开历史」icon 按钮）。
 * 自动保存为唯一默认行为（无开关）；列表展示请求 + 结果摘要 + 身份 + 耗时，
 * 点击条目 → 填充请求数据到编辑器（不自动发送，用户可改后再发送）。
 */
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { REST_METHOD_COLOR, statusColorClass } from "./rest-meta";
import type { HistoryItem } from "@/lib/debug/debug-store";

interface HistoryDrawerProps {
  t: (k: string) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryItem[];
  /** 历史条目点击 → 填充请求到编辑器（不自动发送） */
  onReplay: (item: HistoryItem) => void;
  onClearHistory: () => void;
}

/** 右侧历史抽屉：请求列表 + 计数 + 清空（正常宽度，无需全宽） */
export function HistoryDrawer({
  t,
  open,
  onOpenChange,
  history,
  onReplay,
  onClearHistory,
}: HistoryDrawerProps) {
  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        <div className="flex h-full flex-col">
          {/* 头部：标题 + 计数徽章 ｜ 清空 */}
          <DrawerHeader className="border-b">
            <div className="flex items-center justify-between gap-2">
              <DrawerTitle className="flex items-center gap-1.5 text-sm">
                <HistoryIcon className="size-3.5" />
                {t("left.history")}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-4 text-muted-foreground">
                  {history.length}
                </span>
              </DrawerTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 rounded px-0 text-muted-foreground hover:text-foreground"
                onClick={onClearHistory}
                title={t("history.clear")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </DrawerHeader>

          {/* 列表：请求摘要行（method 徽章 + URL/查询 + 状态码 · 耗时 · 身份） */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                {t("history.empty")}
              </p>
            ) : (
              <div className="space-y-1">
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
                                  (REST_METHOD_COLOR[item.request.method] ??
                                    "text-muted-foreground"),
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
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
