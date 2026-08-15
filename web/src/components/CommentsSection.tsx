/**
 * issue/PR 评论区（官方风格）
 *
 * - 评论卡：头像 + 作者 + 时间 + 编号（#N）+ hover 复制链接操作
 * - 分隔线（divide-y）分隔评论
 * - 底部「发表评论」编辑器（WriteGate 门控；写操作 POST /issues/{n}/comments）
 * - 未登录：显示 LoginPrompt 登录引导（触发聚光灯，指引右上角登录按钮）——官方匿名「Sign in to comment」
 */
import { useState, type FormEvent } from "react";
import { Link2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { apiErrorMessage, type IssueComment } from "@/lib/restapi";
import { addIssueCommentSmart } from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { InlineError } from "@/components/InlineError";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { UserAvatar } from "@/components/UserAvatar";
import { LoginPrompt } from "@/components/LoginPrompt";

export function CommentsSection({
  owner,
  repo,
  number,
  comments,
  onCommentAdded,
}: {
  owner: string;
  repo: string;
  number: number;
  comments: IssueComment[];
  /** 发表成功回调（父组件追加评论并刷新计数） */
  onCommentAdded: (c: IssueComment) => void;
}) {
  const { token, login, canWrite } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [body, setBody] = useState("");
  // MarkdownEditor 重建键（提交成功后 ++ 清空编辑器，非受控 textarea 无法直接重置）
  const [resetKey, setResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyLink = (htmlUrl: string) => {
    navigator.clipboard?.writeText(htmlUrl).catch(() => undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const c = await addIssueCommentSmart(owner, repo, number, body.trim(), token);
      setBody("");
      setResetKey((k) => k + 1);
      onCommentAdded(c);
    } catch (err) {
      setError(apiErrorMessage(err, t("comments.addFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {comments.map((c, i) => (
            <div key={c.id} className="group flex flex-col">
              {/* 评论头：头像 + 作者 + 时间 + 编号 + hover 复制链接 */}
              <div className="flex items-center gap-x-3 gap-y-1 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                <UserAvatar src={c.user.avatar_url} alt={c.user.login} />
                <span className="font-medium text-foreground">{c.user.login}</span>
                <span className="min-w-0 flex-1 truncate">{fmt(c.created_at)}</span>
                <span className="shrink-0 font-mono">#{i + 1}</span>
                <button
                  type="button"
                  onClick={() => copyLink(c.html_url)}
                  title={t("comments.copyLink")}
                  className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                >
                  <Link2 className="size-3.5" />
                </button>
              </div>
              {/* 评论正文 */}
              <div className="p-4">
                {c.body ? (
                  <MarkdownView rawBase={repoRawBase(owner, repo)}>{c.body}</MarkdownView>
                ) : (
                  <p className="text-muted-foreground italic">{t("comments.emptyBody")}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 发表评论（WriteGate 门控：只读模式不显示；未登录显示登录引导——官方「Sign in to comment」） */}
      {!token ? (
        <LoginPrompt
          title={t("comments.loginToComment")}
          desc={t("comments.loginToCommentDesc")}
          className="py-10"
        />
      ) : canWrite ? (
        <form onSubmit={submit} className="space-y-2">
          {/* MarkdownEditor（工具栏 + 补全 + Write/Preview；key 重建用于提交后清空；
              标题「发表评论」经 titleSlot 入工具栏行最左——官方编辑器标题与 Write/Preview 同排） */}
          <MarkdownEditor
            key={resetKey}
            owner={owner}
            repo={repo}
            defaultValue=""
            placeholder={t("comments.placeholder")}
            rows={5}
            onChange={setBody}
            titleSlot={
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
                <MessageSquare className="size-4" />
                {t("comments.leaveComment")}
              </span>
            }
          />
          {error && <InlineError message={error} size="sm" />}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !body.trim()}>
              <Send className="size-3.5" />
              {submitting ? t("common.submitting") : t("comments.submit")}
            </Button>
          </div>
        </form>
      ) : token ? (
        <p className="text-sm text-muted-foreground">{t("comments.writeRequired")}</p>
      ) : (
        <Button variant="outline" onClick={() => login({ mode: "write" })}>
          {t("comments.loginToComment")}
        </Button>
      )}
    </div>
  );
}
