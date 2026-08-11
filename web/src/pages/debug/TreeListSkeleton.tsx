/**
 * 集合树列表加载占位（共享组件：GqlTree / RestTree 左栏树刷新/首载时统一骨架）
 *
 * 统一两棵树「刷新时列表占位」的样式——行数与宽度模式一致（此前 GqlTree 3 行 /
 * RestTree 4 行各自手写，观感分裂）。骨架行宽交错模拟真实 tag/字段行分布，
 * 加载完成后替换为真实列表（虚拟滚动区）。
 */
import { Skeleton } from "@/components/ui/skeleton";

/** 树列表加载占位：4 行骨架（宽度交错，与真实树行节奏一致） */
export function TreeListSkeleton() {
  return (
    <div className="space-y-1.5 px-1.5 py-1">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
