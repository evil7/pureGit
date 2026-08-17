/**
 * 表情反应选择器（官方 reaction picker）
 *
 * - 笑脸按钮：未登录点击触发登录；已登录点击弹出 8 emoji 选择
 * - reaction pills（emoji + count）：当前用户已反应的 pill 高亮，点击撤销
 * - 乐观更新：addReaction / removeReaction GraphQL 成功后经 onUpdated 回写父组件
 */

import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { addReactionSmart, removeReactionSmart } from "@/lib/api";
import { apiErrorMessage } from "@/lib/restapi";
import type { ReactionGroup } from "@/lib/restapi";
import { toastError } from "@/lib/ui/toast";
import { cn } from "@/lib/utils";

/** ReactionContent 枚举 → emoji（官方 8 表情，顺序固定） */
const REACTIONS: { content: string; emoji: string }[] = [
  { content: "THUMBS_UP", emoji: "👍" },
  { content: "THUMBS_DOWN", emoji: "👎" },
  { content: "LAUGH", emoji: "😄" },
  { content: "HOORAY", emoji: "🎉" },
  { content: "CONFUSED", emoji: "😕" },
  { content: "HEART", emoji: "❤️" },
  { content: "ROCKET", emoji: "🚀" },
  { content: "EYES", emoji: "👀" },
];

const EMOJI: Record<string, string> = Object.fromEntries(
  REACTIONS.map((r) => [r.content, r.emoji]),
);

export function ReactionPicker({
  subjectId,
  reactions,
  onUpdated,
}: {
  /** Reactable 的 GraphQL node id（issue / PR / 评论等通用） */
  subjectId: string;
  reactions: ReactionGroup[];
  /** 反应变化后回写（乐观更新父组件 state） */
  onUpdated: (reactions: ReactionGroup[], viewerHasReacted: boolean) => void;
}) {
  const { token, login } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const handlePick = async (content: string) => {
    setOpen(false);
    if (!token) {
      login({ mode: "write" });
      return;
    }
    if (busy) return;
    setBusy(true);
    const existed = reactions.find((r) => r.content === content)?.viewerHasReacted;
    try {
      const next = existed
        ? await removeReactionSmart(subjectId, content, token)
        : await addReactionSmart(subjectId, content, token);
      onUpdated(next.reactions, next.viewerHasReacted);
    } catch (e) {
      toastError(apiErrorMessage(e, t("reactions.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // 未登录：点击笑脸直接引导登录，不打开空选择器
          if (!token) {
            login({ mode: "write" });
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t("reactions.add")}
            aria-label={t("reactions.add")}
            className="inline-flex size-7 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SmilePlus className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1">
          <div className="flex items-center gap-0.5">
            {REACTIONS.map((r) => (
              <button
                key={r.content}
                type="button"
                disabled={busy}
                onClick={() => handlePick(r.content)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-muted",
                  reactions.find((x) => x.content === r.content)?.viewerHasReacted &&
                    "bg-primary/10",
                )}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {reactions.map((r) => (
        <button
          key={r.content}
          type="button"
          disabled={busy}
          onClick={() => handlePick(r.content)}
          title={`${EMOJI[r.content] ?? r.content} ${r.count}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
            r.viewerHasReacted
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
          )}
        >
          <span className="text-sm leading-none">{EMOJI[r.content] ?? r.content}</span>
          <span className="font-medium">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
