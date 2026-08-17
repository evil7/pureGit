/**
 * Topics 标签输入组件（新建仓库 / 仓库设置共用）
 *
 * 对齐官方 topic 输入体验：
 * - 输入停顿 1s 自动搜索联想（GET /search/topics，REST 唯一通道——GraphQL 无 topic 搜索）
 * - 选中主题显示为胶囊 Badge，可点击 X 移除；回车/逗号直接添加；退格删除末尾
 * - 最多 20 个（GitHub 硬上限），去重 + 小写归一
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { searchRepoTopics, type TopicSearchItem } from "@/lib/api";
import { useI18n } from "@/i18n";

const DEBOUNCE_MS = 1000;
const MAX_TOPICS = 20;

export function TopicsInput({
  value,
  onChange,
  token,
  placeholder,
  disabled,
  max = MAX_TOPICS,
}: {
  /** 已选 topics（小写，去重） */
  value: string[];
  onChange: (topics: string[]) => void;
  token?: string | null;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<TopicSearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runSearch = (q: string) => {
    if (!q.trim()) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    searchRepoTopics(token, q.trim())
      .then((items) => {
        if (seq !== seqRef.current) return;
        setSuggestions(items.filter((it) => !value.includes(it.name)));
        setOpen(true);
      })
      .catch(() => {
        if (seq !== seqRef.current) return;
        setSuggestions([]);
        setOpen(false);
      })
      .finally(() => {
        if (seq === seqRef.current) setSearching(false);
      });
  };

  const onTextChange = (v: string) => {
    setText(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(v), DEBOUNCE_MS);
  };

  const addTopic = (raw: string) => {
    const n = raw.trim().toLowerCase();
    if (!n || value.includes(n) || value.length >= max) return;
    onChange([...value, n]);
    setText("");
    setSuggestions([]);
    setOpen(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const removeTopic = (name: string) => {
    onChange(value.filter((topic) => topic !== name));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTopic(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      removeTopic(value[value.length - 1]);
    }
  };

  const showPanel = open && (searching || suggestions.length > 0);

  return (
    <div
      className="relative"
      onBlur={(e) => {
        // 焦点移出整个组件后延迟关闭，保证点选建议项先触发 onClick
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setTimeout(() => setOpen(false), 150);
        }
      }}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {value.map((topic) => (
          <Badge key={topic} variant="secondary" className="gap-1 pr-1">
            {topic}
            <button
              type="button"
              onClick={() => removeTopic(topic)}
              disabled={disabled}
              className="ml-0.5 rounded-full text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("topics.remove").replace("{name}", topic)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => text.trim() && setOpen(true)}
          disabled={disabled || value.length >= max}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>

      {showPanel && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {searching && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("topics.searching")}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("topics.empty")}</div>
          ) : (
            suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTopic(s.name)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{s.name}</span>
                {s.curated && <span className="text-xs text-muted-foreground">curated</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
