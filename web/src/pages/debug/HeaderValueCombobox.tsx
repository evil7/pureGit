/**
 * 请求头值组合框（KeyValueTable 值输入：匹配预设枚举 → 下拉选择；无枚举 → 普通输入）
 *
 * 替代浏览器原生 datalist：datalist 无下拉指示器、原生弹出样式不可控（深色 UI 下
 * 不协调）、无统一键盘导航——用户难以感知/触发枚举下拉。改用 shadcn Combobox 模式
 * （Popover + Command）：输入框右侧 ChevronDown 箭头按钮，点击弹出预设值命令面板，
 * 点选填充；输入框仍可自由输入任意值（可选也可自定义，语义与 datalist 等价）。
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface HeaderValueComboboxProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 枚举值列表（undefined/空数组 → 纯输入，无下拉箭头） */
  values?: string[];
  className?: string;
}

export function HeaderValueCombobox({
  value,
  onChange,
  placeholder,
  values,
  className,
}: HeaderValueComboboxProps) {
  const [open, setOpen] = useState(false);
  const hasValues = (values?.length ?? 0) > 0;
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-7 w-full pr-6 font-mono text-xs", className)}
      />
      {hasValues && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 h-6 w-6 -translate-y-1/2 rounded px-0 text-muted-foreground hover:text-foreground"
              title="常用取值"
            >
              <ChevronDown className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start" sideOffset={2}>
            <Command>
              <CommandList>
                <CommandGroup>
                  {values!.map((v) => (
                    <CommandItem
                      key={v}
                      value={v}
                      onSelect={() => {
                        onChange(v);
                        setOpen(false);
                      }}
                      className="font-mono text-xs"
                    >
                      {v}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
