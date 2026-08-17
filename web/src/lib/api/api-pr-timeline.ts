/**
 * GitHub API smart layer - PR Conversation 时间线（自 api-review.ts 拆出）
 * timelineItems 归一化事件流（comment / review / review-thread / commit / 各类状态事件），
 * GraphQL-only（REST 无 timeline 通道），失败降级 null → 页面回退评论+评审拼接渲染。
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { logWarn } from "./api-log";
import { PR_TIMELINE_QUERY } from "../graphql";

/** 表情反应组（官方 ReactionGroup：content 为 ReactionContent 枚举，count 为 reactors 总数） */
export interface PullReaction {
  content: string;
  count: number;
}

/** 行内评审评论（review 内嵌 / review-thread 内的单条评论，均含 diff hunk 代码片段）。 */
export interface PullReviewComment {
  id: string;
  author: { login: string; avatarUrl: string | null } | null;
  authorAssociation: string | null;
  createdAt: string;
  lastEditedAt: string | null;
  body: string;
  diffHunk: string | null;
  path: string | null;
  line: number | null;
  reactions: PullReaction[];
}

/** 时间线事件（归一后的轻量结构，覆盖官方 Conversation 常用事件类型）。 */
export type PullTimelineEvent =
  | {
      kind: "comment";
      id: string;
      author: { login: string; avatarUrl: string | null } | null;
      authorAssociation: string | null;
      createdAt: string;
      lastEditedAt: string | null;
      body: string;
      reactions: PullReaction[];
    }
  | {
      kind: "review";
      id: string;
      author: { login: string; avatarUrl: string | null } | null;
      authorAssociation: string | null;
      createdAt: string;
      submittedAt: string | null;
      state: string;
      body: string | null;
      reactions: PullReaction[];
      comments: PullReviewComment[];
    }
  | {
      kind: "review-thread";
      id: string;
      isResolved: boolean;
      path: string | null;
      line: number | null;
      originalLine: number | null;
      startLine: number | null;
      comments: PullReviewComment[];
    }
  | {
      kind: "commit";
      id: string;
      oid: string;
      messageHeadline: string;
      committedDate: string;
      author: { login: string | null; avatarUrl: string | null; name: string | null } | null;
    }
  | {
      kind: "merged";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      mergeRefName: string | null;
      commit: { oid: string; abbreviatedOid: string; url: string | null } | null;
    }
  | {
      kind: "closed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "reopened";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "assigned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      assignee: string | null;
    }
  | {
      kind: "unassigned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      assignee: string | null;
    }
  | {
      kind: "labeled";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      label: { name: string; color: string } | null;
    }
  | {
      kind: "unlabeled";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      label: { name: string; color: string } | null;
    }
  | {
      kind: "milestoned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      milestoneTitle: string | null;
    }
  | {
      kind: "demilestoned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      milestoneTitle: string | null;
    }
  | {
      kind: "review-requested";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "review-request-removed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "locked";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "unlocked";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "renamed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      previousTitle: string;
      currentTitle: string;
    }
  | {
      kind: "force-pushed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      beforeCommit: string | null;
      afterCommit: string | null;
    }
  | {
      kind: "ready-for-review";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "head-ref-deleted";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      headRefName: string;
    }
  | {
      kind: "mentioned";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
    }
  | {
      kind: "deployed";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      environment: string | null;
      environmentUrl: string | null;
    }
  | {
      kind: "cross-referenced";
      id: string;
      actor: { login: string; avatarUrl: string | null } | null;
      createdAt: string;
      isCrossRepository: boolean;
      source: { number: number; title: string; url: string | null } | null;
    };

/** 时间线分页结果（events 本页事件 / endCursor 下一页游标 / hasNextPage 是否还有更多） */
export interface PullTimelinePage {
  events: PullTimelineEvent[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/** 时间线查询（GraphQL-only：REST 无 timeline 通道；失败返回 null → 页面回退评论+评审拼接渲染）。 */
export async function fetchPullTimelineSmart(
  owner: string,
  repo: string,
  number: number,
  token: string,
  cursor?: string,
): Promise<PullTimelinePage | null> {
  if (!token) return null;
  try {
    const resp: GraphQLResponse<{
      repository: {
        pullRequest: {
          timelineItems: {
            nodes: unknown[];
            pageInfo: { endCursor: string | null; hasNextPage: boolean } | null;
          } | null;
        } | null;
      } | null;
    }> = await graphqlRequest(PR_TIMELINE_QUERY, { owner, name: repo, number, cursor }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.repository?.pullRequest?.timelineItems) {
      // GraphQL errors → 降级 null（页面回退三段式渲染），补 [Warn] 保留错误详情
      logWarn("fetchPullTimelineSmart", `GraphQL errors: ${resp.errors?.[0]?.message ?? "未知"}`);
      return null;
    }
    const timeline = resp.data.repository.pullRequest.timelineItems;
    const nodes = timeline.nodes;
    const pageInfo = timeline.pageInfo;
    const events: PullTimelineEvent[] = [];
    for (const raw of nodes) {
      const n = raw as Record<string, unknown> & { __typename?: string };
      // 方括号访问规避 no-underscore-dangle（GraphQL 类型名标识）
      const t = n["__typename"];
      const actor = (a: unknown) => {
        if (!a) return null;
        const x = a as { login?: string; avatarUrl?: string | null };
        return { login: x.login ?? "", avatarUrl: x.avatarUrl ?? null };
      };
      const at = (v: unknown) => (typeof v === "string" ? v : "");
      // reactionGroups 为 LIST（非连接），直接 map 出 content + reactors.totalCount
      const reactionsOf = (v: unknown): PullReaction[] => {
        if (!Array.isArray(v)) return [];
        return v
          .map((g) => {
            const x = g as { content?: unknown; reactors?: { totalCount?: unknown } | null };
            const count = x.reactors?.totalCount;
            return {
              content: typeof x.content === "string" ? x.content : "",
              count: typeof count === "number" ? count : 0,
            };
          })
          .filter((r) => r.content && r.count > 0);
      };
      // 行内评论节点解析（review.comments 与 reviewThread.comments 同构，复用同一映射）
      const commentOf = (c: unknown): PullReviewComment => {
        const cc = c as Record<string, unknown> & { author?: unknown };
        return {
          id: String(cc.id),
          author: actor(cc.author),
          authorAssociation: typeof cc.authorAssociation === "string" ? cc.authorAssociation : null,
          createdAt: typeof cc.createdAt === "string" ? cc.createdAt : "",
          lastEditedAt: typeof cc.lastEditedAt === "string" ? cc.lastEditedAt : null,
          body: typeof cc.body === "string" ? cc.body : "",
          diffHunk: typeof cc.diffHunk === "string" ? cc.diffHunk : null,
          path: typeof cc.path === "string" ? cc.path : null,
          line: typeof cc.line === "number" ? cc.line : null,
          reactions: reactionsOf(cc.reactionGroups),
        };
      };
      if (t === "IssueComment") {
        const body = typeof n.body === "string" ? n.body : "";
        if (body.trim()) {
          events.push({
            kind: "comment",
            id: String(n.id),
            author: actor(n.author),
            authorAssociation: typeof n.authorAssociation === "string" ? n.authorAssociation : null,
            createdAt: at(n.createdAt),
            lastEditedAt: typeof n.lastEditedAt === "string" ? n.lastEditedAt : null,
            body,
            reactions: reactionsOf(n.reactionGroups),
          });
        }
      } else if (t === "PullRequestReview") {
        const reviewCommentsRaw = (n.comments as { nodes?: unknown[] } | null)?.nodes ?? [];
        events.push({
          kind: "review",
          id: String(n.id),
          author: actor(n.author),
          authorAssociation: typeof n.authorAssociation === "string" ? n.authorAssociation : null,
          createdAt: at(n.createdAt),
          submittedAt: typeof n.submittedAt === "string" ? n.submittedAt : null,
          state: String(n.state),
          body: typeof n.body === "string" && n.body ? n.body : null,
          reactions: reactionsOf(n.reactionGroups),
          comments: reviewCommentsRaw.map(commentOf),
        });
      } else if (t === "PullRequestReviewThread") {
        const commentsRaw = (n.comments as { nodes?: unknown[] } | null)?.nodes ?? [];
        events.push({
          kind: "review-thread",
          id: String(n.id),
          isResolved: Boolean(n.isResolved),
          path: typeof n.path === "string" ? n.path : null,
          line: typeof n.line === "number" ? n.line : null,
          originalLine: typeof n.originalLine === "number" ? n.originalLine : null,
          startLine: typeof n.startLine === "number" ? n.startLine : null,
          comments: commentsRaw.map(commentOf),
        });
      } else if (t === "PullRequestCommit") {
        const commit = n.commit as {
          oid?: unknown;
          messageHeadline?: unknown;
          committedDate?: unknown;
          author?: unknown;
        } | null;
        const ca = commit?.author as {
          user?: { login?: string; avatarUrl?: string | null } | null;
          name?: string | null;
        } | null;
        events.push({
          kind: "commit",
          id: String(n.id),
          oid: String(commit?.oid ?? "").slice(0, 7),
          messageHeadline: String(commit?.messageHeadline ?? ""),
          committedDate: typeof commit?.committedDate === "string" ? commit.committedDate : "",
          author: ca?.user
            ? { login: ca.user.login ?? null, avatarUrl: ca.user.avatarUrl ?? null, name: null }
            : { login: null, avatarUrl: null, name: ca?.name ?? null },
        });
      } else if (t === "MergedEvent") {
        const mc = n.commit as { oid?: unknown; abbreviatedOid?: unknown; url?: unknown } | null;
        events.push({
          kind: "merged",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          mergeRefName: typeof n.mergeRefName === "string" ? n.mergeRefName : null,
          commit: mc
            ? {
                oid: typeof mc.oid === "string" ? mc.oid : "",
                abbreviatedOid: typeof mc.abbreviatedOid === "string" ? mc.abbreviatedOid : "",
                url: typeof mc.url === "string" ? mc.url : null,
              }
            : null,
        });
      } else if (t === "ClosedEvent") {
        events.push({
          kind: "closed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "ReopenedEvent") {
        events.push({
          kind: "reopened",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "AssignedEvent") {
        events.push({
          kind: "assigned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          assignee: extractLogin(n.assignee),
        });
      } else if (t === "UnassignedEvent") {
        events.push({
          kind: "unassigned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          assignee: extractLogin(n.assignee),
        });
      } else if (t === "LabeledEvent" || t === "UnlabeledEvent") {
        const label = n.label as { name?: string; color?: string } | null;
        events.push({
          kind: t === "LabeledEvent" ? "labeled" : "unlabeled",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          label: label
            ? { name: String(label.name ?? ""), color: String(label.color ?? "") }
            : null,
        });
      } else if (t === "MilestonedEvent" || t === "DemilestonedEvent") {
        events.push({
          kind: t === "MilestonedEvent" ? "milestoned" : "demilestoned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          milestoneTitle: typeof n.milestoneTitle === "string" ? n.milestoneTitle : null,
        });
      } else if (t === "ReviewRequestedEvent") {
        events.push({
          kind: "review-requested",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "ReviewRequestRemovedEvent") {
        events.push({
          kind: "review-request-removed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "LockedEvent") {
        events.push({
          kind: "locked",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "UnlockedEvent") {
        events.push({
          kind: "unlocked",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "RenamedTitleEvent") {
        events.push({
          kind: "renamed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          previousTitle: String(n.previousTitle ?? ""),
          currentTitle: String(n.currentTitle ?? ""),
        });
      } else if (t === "HeadRefForcePushedEvent") {
        const before = (n.beforeCommit as { oid?: unknown } | null)?.oid;
        const after = (n.afterCommit as { oid?: unknown } | null)?.oid;
        events.push({
          kind: "force-pushed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          beforeCommit: typeof before === "string" ? before : null,
          afterCommit: typeof after === "string" ? after : null,
        });
      } else if (t === "ReadyForReviewEvent") {
        events.push({
          kind: "ready-for-review",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "HeadRefDeletedEvent") {
        events.push({
          kind: "head-ref-deleted",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          headRefName: typeof n.headRefName === "string" ? n.headRefName : "",
        });
      } else if (t === "MentionedEvent") {
        events.push({
          kind: "mentioned",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
        });
      } else if (t === "DeployedEvent") {
        const dep = n.deployment as {
          environment?: unknown;
          latestStatus?: { environmentUrl?: unknown } | null;
        } | null;
        events.push({
          kind: "deployed",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          environment: typeof dep?.environment === "string" ? dep.environment : null,
          environmentUrl:
            typeof dep?.latestStatus?.environmentUrl === "string"
              ? dep.latestStatus.environmentUrl
              : null,
        });
      } else if (t === "CrossReferencedEvent") {
        const src = n.source as {
          number?: unknown;
          title?: unknown;
          url?: unknown;
        } | null;
        events.push({
          kind: "cross-referenced",
          id: String(n.id),
          actor: actor(n.actor),
          createdAt: at(n.createdAt),
          isCrossRepository: Boolean(n.isCrossRepository),
          source: src
            ? {
                number: typeof src.number === "number" ? src.number : 0,
                title: typeof src.title === "string" ? src.title : "",
                url: typeof src.url === "string" ? src.url : null,
              }
            : null,
        });
      }
    }
    return {
      events,
      endCursor: pageInfo?.endCursor ?? null,
      hasNextPage: pageInfo?.hasNextPage ?? false,
    };
  } catch (e) {
    // 时间线 GraphQL-only，失败降级 null → 页面回退评论拼接；补 [Warn] 保留诊断
    logWarn("fetchPullTimelineSmart", `PR 时间线查询失败（降级 null）: ${String(e)}`);
    return null;
  }
}

/** 从 Assignee union 节点提取 login */
function extractLogin(v: unknown): string | null {
  if (!v) return null;
  const x = v as { login?: string };
  return typeof x.login === "string" ? x.login : null;
}
