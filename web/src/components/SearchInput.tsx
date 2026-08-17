/**
 * 通用搜索框（简化：去语法高亮，保持纯粹）
 *
 * 形态：左搜索图标 + 输入框 + 右侧 Clear 按钮。
 * 搜索页大框（size="lg"）、仓库 Issues/Pulls/Discussions 列表框（size="md"，经 RepoSearchInput）。
 * 语法 qualifier 不做高亮渲染——用户可在输入框直接输入 GitHub 搜索语法，API 原生支持。
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/Tip";

export function SearchInput({
  defaultValue = "",
  placeholder = "Search…",
  onSubmit,
  className,
  size = "md",
  inputRef,
}: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (raw: string) => void;
  className?: string;
  /** md = 列表行内（h-8 text-sm）；lg = 搜索页大框（h-10 text-base） */
  size?: "md" | "lg";
  /** 外部聚焦控制（如 chips 点击后聚焦输入框补全值） */
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [value, setValue] = useState(defaultValue);

  // defaultValue 变化（URL 驱动）时同步
  useEffect(() => setValue(defaultValue), [defaultValue]);

  const submit = () => onSubmit(value.trim());

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      setValue("");
      onSubmit("");
    }
  };

  const boxCls = size === "lg" ? "h-10 pl-9 pr-9 text-base" : "h-8 pl-7 pr-8 text-sm";

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search
        className={cn(
          "pointer-events-none absolute text-muted-foreground",
          size === "lg" ? "left-3 size-4" : "left-2.5 size-3.5",
        )}
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className={boxCls}
      />
      {value && (
        <Tip label="Clear search">
          <button
            type="button"
            onClick={() => {
              setValue("");
              onSubmit("");
            }}
            aria-label="Clear search"
            className={cn(
              "absolute flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
              size === "lg" ? "right-3" : "right-2",
            )}
          >
            <X className="size-3" />
          </button>
        </Tip>
      )}
    </div>
  );
}
