/**
 * Issue 详情页（从 IssuesPages 拆出，独立模块）
 *
 * 官方 F 型：主列（标题/作者卡/正文/关闭/评论）+ 右 metadata 侧栏（280px）。
 * 侧栏 = Assignees / Labels / Milestone（编辑）+ Participants + 底部订阅操作组；
 * 分区标题样式对齐仓库 About（SidebarSection），标题与内容视觉分层。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Link2, MessageSquare, User, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n, tStatic } from "@/i18n";
import {
  setIssueSubscriptionSmart,
  fetchIssueDetailWithCommentsSmart,
  updateIssueStateSmart,
} from "@/lib/api";
import {
  apiErrorMessage,
  fetchIssueSubscription,
  normalizeApiError,
  ApiError,
} from "@/lib/restapi";
import type { Issue, IssueComment } from "@/lib/restapi";
import { CommentsSection } from "@/components/CommentsSection";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { STATE_BADGE_SOLID } from "@/lib/ui/state-colors";
import { UserAvatar } from "@/components/UserAvatar";
import {
  AssigneesEditor,
  LabelsEditor,
  MilestoneEditor,
  ProjectsEditor,
  DevelopmentSection,
} from "@/components/MetadataEditors";
import { ParticipantsSection } from "@/components/ParticipantsSection";
import { SubscribeButton } from "@/components/SidebarSection";
import { cn } from "@/lib/utils";
import PageLayout from "@/components/PageLayout";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toastSuccess, toastError } from "@/lib/ui/toast";

export function IssueDetailPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const { token, canWrite, user } = useAuth();
  const { canCollaborate } = useRepoPermission();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIssue(null);
    setComments(null);
    Promise.all([fetchIssueDetailWithCommentsSmart(owner!, repo!, Number(number), token)])
      .then(([{ issue: data, comments: cs }]) => {
        if (!cancelled) {
          setIssue(data);
          setComments(cs);
          // 订阅状态：GraphQL 优先（viewerSubscription），REST 降级时补查
          if (data.subscription) {
            setSubscribed(data.subscription !== "UNSUBSCRIBED");
          } else if (token) {
            fetchIssueSubscription(owner!, repo!, Number(number), token)
              .then((s) => !cancelled && setSubscribed(Boolean(s?.subscribed)))
              .catch(() => {});
          }
        }
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

  // 切换订阅（需登录；订阅不要求写权限；GraphQL 首选，REST 兜底）
  const toggleSubscribe = async () => {
    if (!token) return;
    setSubscribing(true);
    try {
      const next = await setIssueSubscriptionSmart(
        owner!,
        repo!,
        Number(number),
        subscribed,
        token,
      );
      setSubscribed(next);
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.subscribeFailed")));
    } finally {
      setSubscribing(false);
    }
  };

  // 关闭 / 重新打开（需 write 权限；关闭前 AlertDialog 确认）
  const updateState = async (state: "closed" | "open") => {
    if (!token) return;
    setClosing(true);
    try {
      const updated = await updateIssueStateSmart(owner!, repo!, Number(number), state, token);
      setIssue((prev) =>
        prev ? { ...prev, state: updated.state, closed_at: updated.closed_at } : prev,
      );
      setConfirmClose(false);
      toastSuccess(state === "closed" ? t("issueDetail.closed") : t("issueDetail.reopened"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.stateFailed")));
    } finally {
      setClosing(false);
    }
  };

  // 复制链接（站内相对路径 + 官方 anchor）
  const copyLink = () => {
    const url = `${window.location.origin}/${owner}/${repo}/issues/${number}`;
    navigator.clipboard?.writeText(url).then(
      () => toastSuccess(t("issueDetail.copied")),
      () => undefined,
    );
  };

  if (loading) {
    return (
      <PageLayout
        gap="sm"
        right={{
          node: (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        <div className="space-y-4">
          {/* 返回按钮 */}
          <Skeleton className="h-6 w-32" />
          {/* 标题 + 状态徽标/meta 行 */}
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-6 w-1/3" />
          {/* 正文 + 评论列表 */}
          <Skeleton className="h-32 w-full rounded-lg border" />
          <Skeleton className="h-24 w-full rounded-lg border" />
          <Skeleton className="h-24 w-full rounded-lg border" />
        </div>
      </PageLayout>
    );
  }

  // 整页级致命错误（issue 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !issue) throw error ?? new ApiError(404);

  // 参与者 = 作者 + 指派人 + 评论者（去重，官方同源聚合）
  const participants = Array.from(
    new Map(
      [issue.user, ...(issue.assignees ?? []), ...(comments ?? []).map((c) => c.user)]
        .filter((u) => u?.login)
        .map((u) => [u!.login, u!] as const),
    ).values(),
  );

  return (
    /* 官方 F 型：主列 + 右 metadata（PageLayout 收编 GRID_2COL_ASIDE_280） */
    <PageLayout
      gap="sm"
      right={{
        node: (
          <aside className="space-y-5 text-sm">
            {/* Assignees */}
            <AssigneesEditor
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              current={issue.assignees ?? []}
              onChange={(users) =>
                setIssue((prev) => (prev ? { ...prev, assignees: users } : prev))
              }
              title={t("issueDetail.assignees")}
              emptyText={t("issueDetail.noAssignees")}
            />

            {/* Labels */}
            <LabelsEditor
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              current={issue.labels ?? []}
              onChange={(labels) => setIssue((prev) => (prev ? { ...prev, labels } : prev))}
              title={t("issueDetail.labels")}
              emptyText={t("issueDetail.noLabels")}
            />

            {/* Projects（GraphQL-only；齿轮添加/移除） */}
            <ProjectsEditor
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              kind="issue"
              title={t("issueDetail.projects")}
              emptyText={t("issueDetail.noProjects")}
            />

            {/* Milestone */}
            <MilestoneEditor
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              current={issue.milestone ?? null}
              onChange={(m) => setIssue((prev) => (prev ? { ...prev, milestone: m } : prev))}
              title={t("issueDetail.milestone")}
              emptyText={t("issueDetail.noMilestone")}
            />

            {/* Development（GraphQL-only 只读：关联 PR + linked branches） */}
            <DevelopmentSection
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              kind="issue"
              title={t("issueDetail.development")}
              emptyText={t("issueDetail.noDevelopment")}
            />

            {/* Participants */}
            <ParticipantsSection
              title={t("issueDetail.participants")}
              participants={participants}
            />

            {/* 底部操作组：订阅 + 关闭/重新打开（ghost 无框弱强调；不单独设通知板块） */}
            {token && (
              <div className="space-y-1 border-t pt-3">
                <SubscribeButton
                  subscribed={subscribed}
                  busy={subscribing}
                  onToggle={toggleSubscribe}
                  subscribeLabel={t("issueDetail.subscribe")}
                  unsubscribeLabel={t("issueDetail.unsubscribe")}
                />
                {/* 关闭 / 重新打开（需仓库协作权限 TRIAGE+ 或 issue 作者本人） */}
                {canWrite &&
                  (canCollaborate || user?.login === issue.user.login) &&
                  (issue.state === "open" ? (
                    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="w-full justify-start px-2 text-muted-foreground"
                          disabled={closing}
                        >
                          <XCircle className="size-3.5" />
                          {t("issueDetail.close")}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("issueDetail.closeConfirmTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("issueDetail.closeConfirmDesc")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => updateState("closed")}
                            disabled={closing}
                          >
                            {t("issueDetail.close")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      variant="ghost"
                      className="w-full justify-start px-2 text-muted-foreground"
                      disabled={closing}
                      onClick={() => updateState("open")}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {t("issueDetail.reopen")}
                    </Button>
                  ))}
              </div>
            )}
          </aside>
        ),
        width: 280,
        sticky: "nav",
      }}
    >
      {/* 主列 */}
      <div className="space-y-3">
        <Button variant="ghost" asChild>
          <Link to={`/${owner}/${repo}/issues`}>
            <ArrowLeft className="size-4" />
            {t("issueDetail.backToList")}
          </Link>
        </Button>

        <header className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 flex-1 text-2xl font-bold wrap-break-word">{issue.title}</h1>
            <span className="shrink-0 text-muted-foreground">#{issue.number}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={copyLink}
              title={t("issueDetail.copyLink")}
            >
              <Link2 className="size-4" />
            </Button>
          </div>

          {/* 状态徽标 + 作者 + 时间 + 评论数（官方：标题下方元信息行） */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={cn(
                "border-transparent text-xs",
                issue.state === "open" ? STATE_BADGE_SOLID.open : STATE_BADGE_SOLID["issue-closed"],
              )}
            >
              {issue.state === "open" ? "Open" : "Closed"}
            </Badge>
            <span className="flex items-center gap-1">
              <User className="size-3.5" />
              <Link
                to={`/${issue.user.login}`}
                className="font-medium text-foreground hover:underline"
              >
                {issue.user.login}
              </Link>
            </span>
            <span className="flex items-center gap-1">
              {issue.state === "open" ? "opened" : "closed"}{" "}
              {fmt
                ? fmt(
                    issue.state === "closed" && issue.closed_at
                      ? issue.closed_at
                      : issue.created_at,
                  )
                : ""}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {issue.comments} {t("issues.comments")}
            </span>
          </div>
        </header>

        {/* 主帖作者卡 + 正文（官方：作者卡在上，正文在下） */}
        <Card className="mt-4">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3 border-b pb-3 text-xs text-muted-foreground">
              <UserAvatar src={issue.user.avatar_url} alt={issue.user.login} className="size-8" />{" "}
              <span className="flex flex-wrap items-center gap-x-1.5">
                <Link
                  to={`/${issue.user.login}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {issue.user.login}
                </Link>
                <span>
                  {issue.state === "open" ? tStatic("issues.opened") : tStatic("issues.closed")}{" "}
                  {fmt(
                    issue.state === "closed" && issue.closed_at
                      ? issue.closed_at
                      : issue.created_at,
                  )}
                </span>
              </span>
            </div>
            {issue.body ? (
              <div className="">
                <MarkdownView rawBase={repoRawBase(owner!, repo!)}>{issue.body}</MarkdownView>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description provided.</p>
            )}
          </CardContent>
        </Card>

        {/* 评论区（官方风格：编号 + hover 操作 + 发表） */}
        {comments && (
          <div className="mt-4">
            <CommentsSection
              owner={owner!}
              repo={repo!}
              number={Number(number)}
              comments={comments}
              onCommentAdded={(c) => setComments((prev) => [...(prev ?? []), c])}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
