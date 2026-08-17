/**
 * 用户头像（业务公共组件 统一 13 处裸 <img> 头像）
 *
 * 统一 ui/avatar 用法：圆形 + 暗色 blend 边框 + 加载失败首字母回退。
 * 尺寸经 className 控制（size-5/size-6/size-8/size-10…）。
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function UserAvatar({
  src,
  alt,
  title,
  className,
}: {
  src?: string | null;
  alt?: string | null;
  /** 原生 title（头像叠加组 hover 提示） */
  title?: string;
  className?: string;
}) {
  const name = alt ?? "";
  return (
    <Avatar className={cn("size-5 shrink-0", className)} title={title}>
      <AvatarImage src={src ?? undefined} alt={name} />
      <AvatarFallback className="text-[10px]">
        {name.slice(0, 1).toUpperCase() || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
