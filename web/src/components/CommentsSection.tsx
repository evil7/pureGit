/**
 * issue/PR 评论区（官方风格）
 *
 * - 评论卡：头像 + 作者 + 时间 + 编号（#N）+ hover 复制链接操作
 * - 分隔线（divide-y）分隔评论
 * - 底部「发表评论」编辑器（WriteGate 门控；写操作 POST /issues/{n}/comments）
 * - 未登录：显示 LoginPrompt 登录引导（触发聚光灯，指引右上角登录按钮）——官方匿名「Sign in to comment」
 */
import { useState, type FormEvent } from "react";
import { Link2, MessageSquare, Send, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { apiErrorMessage, type IssueComment, type ReactionGroup } from "@/lib/restapi";
import { addIssueCommentSmart, updateIssueCommentSmart, deleteIssueCommentSmart } from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { ReactionPicker } from "@/components/ReactionPicker";
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
  const { token, login, canWrite, user } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [body, setBody] = useState("");
  // MarkdownEditor 重建键（提交成功后 ++ 清空编辑器，非受控 textarea 无法直接重置）
  const [resetKey, setResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 本次会话对评论 reactions 的乐观覆盖（nodeId → 最新反应组；初始无覆盖时回退 c.reactions）
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, ReactionGroup[]>>({});
  // 评论编辑/删除乐观状态（key = nodeId ?? `id-${id}`）
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

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

  /** 评论唯一 key：nodeId 优先（GraphQL 通道 id=-1 会重复），回退 REST 数字 id */
  const commentKey = (c: IssueComment) => c.nodeId ?? `id-${c.id}`;

  const startEdit = (c: IssueComment) => {
    const key = commentKey(c);
    setEditingKey(key);
    setEditBody(editedBodies[key] ?? c.body ?? "");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditBody("");
  };

  const saveEdit = async () => {
    if (!token || !editingKey || editSubmitting) return;
    const c = comments.find((x) => commentKey(x) === editingKey);
    if (!c) return;
    setEditSubmitting(true);
    setError(null);
    try {
      await updateIssueCommentSmart(
        owner,
        repo,
        { nodeId: c.nodeId, id: c.id },
        editBody.trim(),
        token,
      );
      setEditedBodies((prev) => ({ ...prev, [editingKey]: editBody.trim() }));
      setEditingKey(null);
      setEditBody("");
    } catch (e) {
      setError(apiErrorMessage(e, t("comments.editFailed")));
    } finally {
      setEditSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleteKey || deleteSubmitting) return;
    const c = comments.find((x) => commentKey(x) === deleteKey);
    if (!c) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      await deleteIssueCommentSmart(owner, repo, { nodeId: c.nodeId, id: c.id }, token);
      setDeletedKeys((prev) => new Set(prev).add(deleteKey));
      setDeleteKey(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("comments.deleteFailed")));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {comments.map((c, i) => {
            const nodeId = c.nodeId;
            const key = commentKey(c);
            if (deletedKeys.has(key)) return null;
            const isAuthor = user?.login === c.user.login;
            const displayBody = editedBodies[key] ?? c.body ?? "";
            return (
              <div key={c.id} className="group flex flex-col">
                {/* 评论头：头像 + 作者 + 时间 + 编号 + hover 操作 */}
                <div className="flex items-center gap-x-3 gap-y-1 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                  <UserAvatar src={c.user.avatar_url} alt={c.user.login} />
                  <span className="font-medium text-foreground">{c.user.login}</span>
                  <span className="min-w-0 flex-1 truncate">{fmt(c.created_at)}</span>
                  <span className="shrink-0 font-mono">#{i + 1}</span>
                  {isAuthor && canWrite && editingKey !== key && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        title={t("comments.edit")}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteKey(key)}
                        title={t("comments.delete")}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
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
                  {editingKey === key ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={4}
                        placeholder={t("comments.placeholder")}
                      />
                      {error && <InlineError message={error} size="sm" />}
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEdit}>
                          {t("common.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void saveEdit()}
                          disabled={editSubmitting || !editBody.trim()}
                        >
                          {editSubmitting ? t("common.submitting") : t("common.save")}
                        </Button>
                      </div>
                    </div>
                  ) : displayBody ? (
                    <MarkdownView rawBase={repoRawBase(owner, repo)}>{displayBody}</MarkdownView>
                  ) : (
                    <p className="text-muted-foreground italic">{t("comments.emptyBody")}</p>
                  )}
                  {nodeId && editingKey !== key && (
                    <ReactionPicker
                      subjectId={nodeId}
                      reactions={reactionOverrides[nodeId] ?? c.reactions ?? []}
                      onUpdated={(reactions) =>
                        setReactionOverrides((prev) => ({ ...prev, [nodeId]: reactions }))
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
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

      {/* 删除评论确认 */}
      <AlertDialog open={deleteKey !== null} onOpenChange={(open) => !open && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("comments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("comments.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
              disabled={deleteSubmitting}
            >
              {deleteSubmitting ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
