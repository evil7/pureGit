/**
 * 仓库列表搜索框（官方 Search all issues/discussions 同款）
 *
 * 官方形态：左搜索图标 + 输入框（支持 GitHub 搜索语法）+ 右侧 Clear 按钮。
 * issues / pulls / discussions 三处列表共用。
 *
 * 基于 SearchInput 实现 → 自动获得 qualifier token 高亮（聚焦时）。
 */
import { SearchInput } from "@/components/SearchInput";

export function RepoSearchInput({
  defaultValue = "",
  placeholder = "Search…",
  onSubmit,
  className,
}: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (raw: string) => void;
  className?: string;
}) {
  return (
    <SearchInput
      defaultValue={defaultValue}
      placeholder={placeholder}
      onSubmit={onSubmit}
      className={className}
      size="md"
    />
  );
}
