/**
 * 树搜索输入框（共享组件：GqlTree / RestTree 左栏集合树搜索）
 *
 * 提取两个树组件的搜索框差异为统一组件：
 * - `/` 快捷键聚焦（insomnia 式；输入框/文本域/contentEditable 中不拦截）
 * - X 清除按钮（清除后恢复正常浏览）
 * - 统一样式（h-6 紧凑、font-mono、focus ring）
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface TreeSearchInputProps {
  value: string;
  onChange: (v: string) => void;
  /** placeholder 文本（调用方传 t 结果，如「搜索端点…」） */
  placeholder: string;
  /** 清除按钮 title（调用方传 t 结果） */
  clearTitle: string;
}

export function TreeSearchInput({
  value,
  onChange,
  placeholder,
  clearTitle,
}: TreeSearchInputProps) {
  /** 搜索输入框 ref（/ 快捷键聚焦） */
  const searchRef = useRef<HTMLInputElement>(null);

  /** / 快捷键聚焦搜索框（输入中 / 不拦截；textarea/contentEditable 中不拦截） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || searchRef.current === document.activeElement) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <input
        ref={searchRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${placeholder}  /`}
        className="h-6 w-full rounded-md border border-border/60 bg-background/60 px-2 pr-6 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
      />
      {value && (
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          title={clearTitle}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
