/**
 * PR 变更文件 diff 视图（复刻 GitHub「Files changed」）
 *
 * 官方 3 列表格（非 CM6）：旧行号 / 旧代码 / 新行号 / 新代码
 * - 行号自 hunk 头推导（lib/diff-lines.ts）；add 旧列空、del 新列空
 * - hunk 头独立行；左侧 Expand 按钮 → 拉 base/head raw → jsdiff 全量对比（全部上下文）
 * - 行内评论（Gitea 简化）：add/ctx 行 hover [+] → MarkdownEditor 表单 → POST review comments
 */
import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FilePlus2,
  FileMinus2,
  File,
  MessageSquare,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PullFile, ReviewComment } from "@/lib/restapi";
import { apiErrorMessage } from "@/lib/restapi";
import { fetchPullReviewCommentsSmart, addPullReviewCommentSmart } from "@/lib/api";
import { fetchRepoFileRaw, repoRawBase } from "@/lib/repo/repo-raw";
import { diffLinesToRows, parsePatch, type DiffRow } from "@/lib/code/diff-lines";
import { MarkdownView } from "@/components/MarkdownView";
import { InlineError } from "@/components/InlineError";
import { MarkdownEditor } from "@/components/MarkdownEditor";

function FileStatusIcon({ status }: { status: string }) {
  //：增删状态用 diff 独立色板（--diff-*，不依赖 shadcn chart/destructive）
  if (status === "added")
    return <FilePlus2 className="size-4 shrink-0" style={{ color: "var(--diff-add-fg)" }} />;
  if (status === "removed")
    return <FileMinus2 className="size-4 shrink-0" style={{ color: "var(--diff-del-fg)" }} />;
  if (status === "modified") return <FileDiff className="size-4 shrink-0 text-foreground" />;
  return <File className="size-4 shrink-0 text-muted-foreground" />;
}

/** 行号单元格（纯展示；无点击锚点/高亮） */
function LineNumber({ line, className }: { line?: number; className?: string }) {
  if (!line) {
    return <td className={cn("diff-cell-num diff-cell-empty", className)} />;
  }
  return (
    <td
      data-line-number={line}
      className={cn(
        "diff-cell-num select-none font-mono text-xs text-muted-foreground/70",
        className,
      )}
    >
      {line}
    </td>
  );
}

/** 单个 diff 文件卡 */
function DiffFile({
  file,
  owner,
  repo,
  number,
  baseSha,
  headSha,
}: {
  file: PullFile;
  owner?: string;
  repo?: string;
  number?: number;
  baseSha?: string;
  headSha?: string;
}) {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  // rows：patch 解析结果；expanded=true 时是全量对比结果
  const [rows, setRows] = useState<DiffRow[]>(() => parsePatch(file.patch));
  const [expanded, setExpanded] = useState(false);
  const [expandBusy, setExpandBusy] = useState(false);
  const [expandFailed, setExpandFailed] = useState(false);
  // 行内评论（按 path 拉取一次）
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentKey, setCommentKey] = useState(0); // 表单重建（提交后清空）
  // 当前打开评论表单的行（newLine + side）
  const [formRow, setFormRow] = useState<{ line: number; side: "LEFT" | "RIGHT" } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentsReloadKey, setCommentsReloadKey] = useState(0);
  const [threadBusyId, setThreadBusyId] = useState<string | null>(null);

  /* 行内评论数据（已有评论展示） */
  useMemo(() => {
    if (!owner || !repo || !number) return;
    fetchPullReviewCommentsSmart(owner, repo, number, token)
      .then((cs) => setComments(cs.filter((c) => c.path === file.filename)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number, file.filename, commentsReloadKey]);

  /** 线程解决/取消解决：成功后重拉该文件评论（刷新 isResolved 状态） */
  const toggleThread = async (c: ReviewComment) => {
    if (!token || !c.threadId || threadBusyId) return;
    setThreadBusyId(c.threadId);
    try {
      const m = await import("@/lib/api");
      await m.setReviewThreadResolvedSmart(c.threadId, !c.threadResolved, token);
      setCommentsReloadKey((k) => k + 1);
    } catch {
      /* 静默 */
    } finally {
      setThreadBusyId(null);
    }
  };

  /* Expand：拉 base/head raw → jsdiff 全量对比 */
  const expand = async () => {
    if (!owner || !repo || !baseSha || !headSha || expandBusy) return;
    setExpandBusy(true);
    setExpandFailed(false);
    const [oldText, newText] = await Promise.all([
      fetchRepoFileRaw(owner, repo, baseSha, file.filename, token),
      fetchRepoFileRaw(owner, repo, headSha, file.filename, token),
    ]);
    if (oldText === null || newText === null) {
      setExpandFailed(true);
    } else {
      setRows(diffLinesToRows(oldText, newText));
      setExpanded(true);
    }
    setExpandBusy(false);
  };

  /** 打开评论表单（add/ctx 新列行） */
  const openForm = (line: number) => {
    setFormRow({ line, side: "RIGHT" });
    setCommentBody("");
    setCommentError(null);
    setCommentKey((k) => k + 1);
  };

  const submitComment = async () => {
    if (!owner || !repo || !number || !headSha || !token || !formRow || !commentBody.trim()) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      const c = await addPullReviewCommentSmart(
        owner,
        repo,
        number,
        {
          body: commentBody.trim(),
          commit_id: headSha,
          path: file.filename,
          line: formRow.line,
          side: formRow.side,
        },
        token,
      );
      setComments((prev) => [...prev, c]);
      setFormRow(null);
      setCommentBody("");
    } catch (err) {
      setCommentError(apiErrorMessage(err, "评论发表失败"));
    } finally {
      setCommentBusy(false);
    }
  };

  /** 该新行上的评论（展示用） */
  const lineComments = (line?: number) =>
    line ? comments.filter((c) => c.line === line && c.side === "RIGHT") : [];

  const markerOf = (type: DiffRow["type"]) =>
    type === "add" ? "+" : type === "del" ? "-" : type === "ctx" ? " " : "";

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* 文件头 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <FileStatusIcon status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.filename}</span>
        <Badge variant="outline" className="gap-1 text-xs">
          <FilePlus2 className="size-3" style={{ color: "var(--diff-add-fg)" }} />
          {file.additions}
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs">
          <FileMinus2 className="size-3" style={{ color: "var(--diff-del-fg)" }} />
          {file.deletions}
        </Badge>
      </button>

      {open && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="diff-table w-full border-collapse text-sm">
            <tbody>
              {rows.map((row, i) => {
                if (row.type === "hunk") {
                  return (
                    <tr key={`h-${i}`} className="diff-hunk border-y bg-muted/40">
                      <td className="px-2 py-0.5 text-right" colSpan={4}>
                        <span className="inline-flex items-center gap-2">
                          {!expanded && baseSha && headSha && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[11px] text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                void expand();
                              }}
                              disabled={expandBusy}
                            >
                              {expandBusy ? "…" : t("diff.expand")}
                            </Button>
                          )}
                          <code className="font-mono text-xs text-muted-foreground">
                            {row.hunkHeader}
                          </code>
                        </span>
                        {expandFailed && (
                          <span className="ml-2 text-[11px] text-destructive">展开失败</span>
                        )}
                      </td>
                    </tr>
                  );
                }
                if (row.type === "empty") {
                  return <tr key={`e-${i}`} />;
                }
                if (row.type === "add") {
                  const cls = "diff-cell-add";
                  const myComments = lineComments(row.newLine);
                  const isFormRow =
                    formRow !== null && formRow.line === row.newLine && formRow.side === "RIGHT";
                  return (
                    <tr key={`r-${i}`} className="diff-row group" data-new-line={row.newLine}>
                      <LineNumber className={cls} />
                      <td className={cn("diff-cell-code diff-cell-empty", cls)} />
                      <LineNumber className={cls} line={row.newLine} />
                      <td className={cn("diff-cell-code", cls)}>
                        <span className="diff-marker">{markerOf("add")}</span>
                        <code>{row.newContent}</code>
                        {/* 行内评论入口（hover 显示） */}
                        {canWrite && owner && repo && number && headSha && row.newLine && (
                          <button
                            type="button"
                            title={t("diff.commentLine")}
                            onClick={() => openForm(row.newLine!)}
                            className="diff-comment-btn ml-1 align-middle text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        )}
                      </td>
                      {isFormRow && (
                        <InlineCommentForm
                          key={commentKey}
                          owner={owner}
                          repo={repo}
                          busy={commentBusy}
                          error={commentError}
                          defaultValue={commentBody}
                          onChange={setCommentBody}
                          onSubmit={() => void submitComment()}
                          onCancel={() => setFormRow(null)}
                        />
                      )}
                      {myComments.length > 0 && (
                        <CommentRows
                          comments={myComments}
                          owner={owner}
                          repo={repo}
                          token={token}
                          busyThreadId={threadBusyId}
                          onToggleThread={toggleThread}
                        />
                      )}
                    </tr>
                  );
                }
                if (row.type === "del") {
                  return (
                    <tr key={`r-${i}`} className="diff-row group">
                      <LineNumber className="diff-cell-del" line={row.oldLine} />
                      <td className={cn("diff-cell-code", "diff-cell-del")}>
                        <span className="diff-marker">{markerOf("del")}</span>
                        <code>{row.oldContent}</code>
                      </td>
                      <LineNumber className="diff-cell-del" />
                      <td className="diff-cell-code diff-cell-empty diff-cell-del" />
                    </tr>
                  );
                }
                // ctx
                return (
                  <tr key={`r-${i}`} className="diff-row group">
                    <LineNumber line={row.oldLine} />
                    <td className="diff-cell-code">
                      <span className="diff-marker">{markerOf("ctx")}</span>
                      <code>{row.oldContent}</code>
                    </td>
                    <LineNumber line={row.newLine} />
                    <td className="diff-cell-code">
                      <span className="diff-marker">{markerOf("ctx")}</span>
                      <code>{row.newContent}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && rows.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">（patch 不可用）</p>
      )}
    </div>
  );
}

/** 行内评论表单（MarkdownEditor 紧凑版） */
function InlineCommentForm({
  owner,
  repo,
  busy,
  error,
  defaultValue,
  onChange,
  onSubmit,
  onCancel,
}: {
  owner?: string;
  repo?: string;
  busy: boolean;
  error: string | null;
  defaultValue: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <td colSpan={4} className="border-t bg-muted/20 p-3">
      <div className="space-y-2">
        <MarkdownEditor
          owner={owner}
          repo={repo}
          defaultValue={defaultValue}
          placeholder="评论此行…"
          rows={3}
          onChange={onChange}
        />
        {error && <InlineError message={error} size="sm" />}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy || !defaultValue.trim()}
          >
            <MessageSquare className="size-3.5" />
            {busy ? t("comments.submitting") : t("comments.submit")}
          </Button>
        </div>
      </div>
    </td>
  );
}

/** 行内已有评论列表（含线程解决/取消解决——GraphQL-only，见 setReviewThreadResolvedSmart） */
function CommentRows({
  comments,
  owner,
  repo,
  token,
  busyThreadId,
  onToggleThread,
}: {
  comments: ReviewComment[];
  owner?: string;
  repo?: string;
  token?: string | null;
  busyThreadId?: string | null;
  onToggleThread?: (c: ReviewComment) => void;
}) {
  return (
    <td colSpan={4} className="border-t bg-muted/10 p-3">
      <div className="space-y-2">
        {comments.map((c) => (
          // key 优先 nodeId（GraphQL 唯一；id 恒 -1），REST 通道回退数字 id
          <div key={c.nodeId ?? c.id} className="flex items-start gap-2">
            <img
              src={c.user.avatar_url}
              alt={c.user.login}
              className="size-5 shrink-0 rounded-full"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.user.login}</span>
                <span>{new Date(c.created_at).toLocaleString()}</span>
                {c.threadResolved && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Check className="size-3 text-emerald-500" />
                    已解决
                  </Badge>
                )}
              </div>
              <div className="mt-1">
                <MarkdownView rawBase={owner && repo ? repoRawBase(owner, repo) : undefined}>
                  {c.body}
                </MarkdownView>
              </div>
            </div>
            {token && c.threadId && onToggleThread && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                disabled={busyThreadId === c.threadId}
                onClick={() => onToggleThread(c)}
              >
                {busyThreadId === c.threadId ? "…" : c.threadResolved ? "取消解决" : "解决"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </td>
  );
}

/** PR diff 列表（Files changed tab 内容） */
export function DiffView({
  files,
  owner,
  repo,
  number,
  baseSha,
  headSha,
}: {
  files: PullFile[];
  owner?: string;
  repo?: string;
  number?: number;
  baseSha?: string;
  headSha?: string;
}) {
  if (files.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">没有可显示的变更文件</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {files.map((f) => (
        <DiffFile
          key={f.filename}
          file={f}
          owner={owner}
          repo={repo}
          number={number}
          baseSha={baseSha}
          headSha={headSha}
        />
      ))}
    </div>
  );
}
