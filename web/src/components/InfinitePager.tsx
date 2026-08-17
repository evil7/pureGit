import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, tStatic } from "@/i18n";

/**
 * 无限翻页器（总数未知的分页式搜索专用：首页动态/热点/搜索）
 *
 * 与 Pager（有 totalPages 的页码窗口）互补：
 * - 总数未知（至多 999 页）时无「末页页码」可显示 → 用 [上一页][下一页] + 输入跳页
 * - 布局：`[<上一页] [下一页>]  ……  第 [输入] 页`（justify-between）
 * - 上一页 disabled = page<=1；下一页 disabled = endReached（父组件探测到末页传入）
 * - 输入框：数字 1~999，Enter/失焦跳转，非法输入回退当前页
 * 样式对齐共享 Pager（shadcn Pagination）：按钮 ghost + 默认尺寸（h-9）+ 图标内联 +
 * 文字 sm 隐藏，输入框 h-9 对等按钮高度——两个翻页组件视觉统一。
 * 父组件职责：page 变化 → 按新条件重新发起搜索；末页探测（空页/不足一页）→ endReached=true。
 */
export function InfinitePager({
  page,
  endReached = false,
  onChange,
}: {
  page: number;
  /** 已探测到末页（下一页禁用） */
  endReached?: boolean;
  onChange: (p: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(page));
  // 外部页码变化同步输入框（翻页/回退）
  useEffect(() => setDraft(String(page)), [page]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n <= 999) {
      if (n !== page) onChange(n);
    } else {
      // 非法输入回退当前页
      setDraft(String(page));
    }
  };

  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      {/* 上/下页：样式对齐 Pager 的 PaginationPrevious/Next（ghost + 默认尺寸 + 图标内联 + 文字 sm 隐藏） */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          className="pl-1.5!"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:block">{tStatic("common.previous")}</span>
        </Button>
        <Button
          variant="ghost"
          className="pr-1.5!"
          disabled={endReached}
          onClick={() => onChange(page + 1)}
        >
          <span className="hidden sm:block">{tStatic("common.next")}</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {/* 第 [输入] 页：输入框 h-8（32px）对等按钮/下拉默认高度 */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <span>{t("pager.pagePrefix")}</span>
        <Input
          type="number"
          min={1}
          max={999}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="h-8 w-16 text-center"
          aria-label={t("pager.goto")}
        />
        <span>{t("pager.pageSuffix")}</span>
      </div>
    </div>
  );
}
