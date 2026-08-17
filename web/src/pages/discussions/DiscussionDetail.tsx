/**
 * 讨论详情页（/discussions/:number）—— 自 DiscussionsPage 拆出。
 * 官方 F 型：主帖 + 评论列表（isAnswer 徽标）+ 评论表单；右 metadata（分类/投票/参与者）。
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageSquare, ArrowUp, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchDiscussionDetailSmart, addDiscussionCommentSmart, categorySlug } from "@/lib/api";
import { apiErrorMessage, normalizeApiError, ApiError } from "@/lib/restapi";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { UserAvatar } from "@/components/UserAvatar";
import { LoginPrompt } from "@/components/LoginPrompt";
import { WriteGate } from "@/components/WriteGate";
import PageLayout from "@/components/PageLayout";
import type { DiscussionDetail, DiscussionComment } from "@/lib/restapi";
import { emoji } from "./constants";

export function DiscussionDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [discussion, setDiscussion] = useState<DiscussionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDiscussionDetailSmart(owner!, repo!, Number(number), token)
      .then((d) => {
        if (!cancelled) setDiscussion(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number, token]);

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // 整页级致命错误（discussion 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !discussion) throw error ?? new ApiError(404);

  const onCommentAdded = (c: DiscussionComment) => {
    setDiscussion((prev) => (prev ? { ...prev, comments: [...prev.comments, c] } : prev));
  };

  return (
    /* 官方 F 型：主讨论 + 右 metadata（分类/投票/参与 单列→两栏对齐） */
    <PageLayout
      gap="sm"
      right={{
        node: (
          <aside className="space-y-5 text-sm">
            {/* 分类 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("discussions.categories")}
              </h3>
              <Link
                to={`/${owner}/${repo}/discussions?category=${categorySlug(discussion.category.name)}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent/60 hover:text-foreground"
              >
                <span className="text-base">{emoji(discussion.category.emoji)}</span>
                <span className="truncate">{discussion.category.name}</span>
              </Link>
            </section>

            {/* 投票 */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("discussions.upvotes")}
              </h3>
              <Button variant="outline" className="w-full gap-1.5">
                <ArrowUp className="size-3.5" />
                {discussion.upvoteCount}
              </Button>
            </section>

            {/* 参与者（作者 + 评论者聚合） */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {t("issueDetail.participants")}
              </h3>
              <div className="flex items-center gap-1.5">
                <UserAvatar
                  src={discussion.author.avatar_url}
                  alt={discussion.author.login}
                  title={discussion.author.login}
                  className="size-6 ring-1 ring-border"
                />
                {discussion.comments
                  .map((c) => c.author)
                  .filter(
                    (a, i, arr) =>
                      a.login !== discussion.author.login &&
                      arr.findIndex((x) => x.login === a.login) === i,
                  )
                  .slice(0, 7)
                  .map((a) => (
                    <UserAvatar
                      key={a.login}
                      src={a.avatar_url}
                      alt={a.login}
                      title={a.login}
                      className="size-6 ring-1 ring-border"
                    />
                  ))}
              </div>
            </section>
          </aside>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      <div className="space-y-4">
        {/* 主帖头 */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {emoji(discussion.category.emoji)} {discussion.category.name}
            </Badge>
            {discussion.answered && (
              <Badge className="gap-1 bg-green-600 text-white">
                <CheckCircle2 className="size-3" />
                Answered
              </Badge>
            )}
            {discussion.locked && <Badge variant="secondary">Locked</Badge>}
          </div>
          <h1 className="text-2xl font-bold wrap-break-word">{discussion.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <UserAvatar src={discussion.author.avatar_url} alt={discussion.author.login} />
            <Link
              to={`/${discussion.author.login}`}
              className="font-medium text-foreground hover:underline"
            >
              {discussion.author.login}
            </Link>
            <span>
              {t("discussions.opened")} {fmt(discussion.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <ArrowUp className="size-3" />
              {discussion.upvoteCount}
            </span>
          </div>
        </header>

        {/* 主帖正文 */}
        {discussion.body && (
          <div className="rounded-lg border bg-card p-4">
            <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{discussion.body}</MarkdownView>
          </div>
        )}

        {/* 评论列表 */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {discussion.comments.length} {t("discussions.comments")}
          </h2>
          {discussion.comments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("discussions.noComments")}
            </p>
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {discussion.comments.map((c) => (
                <div key={c.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <UserAvatar src={c.author.avatar_url} alt={c.author.login} />
                    <span className="font-medium text-foreground">{c.author.login}</span>
                    <span>{fmt(c.createdAt)}</span>
                    {c.isAnswer && (
                      <Badge className="gap-1 bg-green-600 text-white">
                        <CheckCircle2 className="size-3" />
                        Answer
                      </Badge>
                    )}
                    {c.repliesCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="size-3" />
                        {c.repliesCount}
                      </span>
                    )}
                  </div>
                  <div className="">
                    <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{c.body}</MarkdownView>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 评论表单 */}
        <WriteGate>
          <DiscussionCommentForm
            discussionId={discussion.id}
            token={token}
            onCommentAdded={onCommentAdded}
          />
        </WriteGate>
      </div>
    </PageLayout>
  );
}

/** 讨论评论表单 */
function DiscussionCommentForm({
  discussionId,
  token,
  onCommentAdded,
}: {
  discussionId: string;
  token: string;
  onCommentAdded: (c: DiscussionComment) => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const c = await addDiscussionCommentSmart(discussionId, body.trim(), token);
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
    <form onSubmit={submit} className="space-y-2">
      <MarkdownEditor
        key={resetKey}
        defaultValue=""
        rows={5}
        placeholder={t("discussions.commentPlaceholder")}
        onChange={setBody}
      />
      {error && <InlineError message={error} size="sm" />}
      <div className="flex justify-end">
        <Button type="submit" disabled={!body.trim() || submitting}>
          {t("comments.submit")}
        </Button>
      </div>
    </form>
  );
}
