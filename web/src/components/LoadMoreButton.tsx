import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tStatic } from "@/i18n";

/**
 * 「加载更多」按钮（瀑布流 append 翻页专用：首页动态/热点）
 *
 * 与 Pager / InfinitePager（页码跳转）互补：适合**连续追加**浏览（瀑布流），
 * 点击后父组件按当前条件从 API 游标续拉一页 append 到列表。
 * - loading：spinner + 禁用（防重复点击）
 * - endReached：隐藏（已到末页，无更多数据；或渲染「已全部加载」提示）
 */
export function LoadMoreButton({
  loading,
  endReached,
  onClick,
  className,
}: {
  loading: boolean;
  /** 已到末页（隐藏按钮；可选展示「已全部加载」） */
  endReached: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (endReached) return null;
  return (
    <div className={className}>
      <Button
        variant="outline"
        className="w-full"
        disabled={loading}
        onClick={onClick}
        aria-label={tStatic("home.loadMore")}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : tStatic("home.loadMore")}
      </Button>
    </div>
  );
}
