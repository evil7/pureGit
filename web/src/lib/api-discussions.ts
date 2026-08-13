/**
 * GitHub API smart layer - discussions（自 api-issue 拆出）
 * Board file. See api.ts barrel & docs/api-compat.md.
 */

import { graphqlRequest, hasGraphQLErrors } from "./api-core";
import type { GraphQLResponse } from "./api-core";
import { buildSearchQuery } from "./search-syntax";
import {
  DISCUSSIONS_QUERY,
  DISCUSSION_SEARCH_QUERY,
  DISCUSSION_DETAIL_QUERY,
  CREATE_DISCUSSION_MUTATION,
  ADD_DISCUSSION_COMMENT_MUTATION,
} from "./graphql";
import type {
  DiscussionSummary,
  DiscussionDetail,
  DiscussionComment,
  DiscussionsData,
} from "./rest";
// ===== Discussions（GraphQL only——REST 无 discussion 端点） =====

/** GraphQL 讨论列表节点（含评论作者聚合，Most helpful 用） */
interface GraphQLDiscussionNode {
  number: number;
  title: string;
  createdAt: string;
  category: { id: string; name: string; emoji: string; description?: string | null };
  author: { login: string; avatarUrl: string } | null;
  answerChosenAt: string | null;
  comments: {
    totalCount: number;
    nodes: { author: { login: string; avatarUrl: string } | null }[];
  };
  upvoteCount: number;
}

/** 分类 slug（官方 URL /discussions/categories/{slug}；GraphQL 无 slug 字段 → name kebab-case 派生） */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDiscussionSummary(g: GraphQLDiscussionNode): DiscussionSummary {
  return {
    number: g.number,
    title: g.title,
    createdAt: g.createdAt,
    category: {
      id: g.category.id,
      name: g.category.name,
      emoji: g.category.emoji,
      description: g.category.description,
    },
    author: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl ?? "" },
    answered: Boolean(g.answerChosenAt),
    commentsCount: g.comments?.totalCount ?? 0,
    upvoteCount: g.upvoteCount,
  };
}

/** 搜索语法 → GitHub 搜索 query 串（discussions search 端点用） */
export function buildDiscussionSearchQuery(owner: string, repo: string, raw: string): string {
  // 复用统一语法系统：type:discussion + 默认 is:open + repo 限定
  return buildSearchQuery(raw, {
    type: "discussion",
    repo: `${owner}/${repo}`,
    defaultState: "open",
  });
}

/**
 * 智能获取 Discussions 列表数据（GraphQL only——REST 无端点）。
 * 支持 categoryId / states / orderBy 过滤；rawQuery 非空时走 search 端点。
 */
export async function fetchDiscussionsSmart(
  owner: string,
  repo: string,
  token?: string | null,
  categoryId?: string | null,
  states?: string[] | null,
  orderBy?: { field: string; direction: "ASC" | "DESC" } | null,
  rawQuery?: string | null,
  cursor?: string | null,
): Promise<DiscussionsData> {
  // 搜索模式：GraphQL search 端点（type: DISCUSSION）
  if (rawQuery) {
    const q = buildDiscussionSearchQuery(owner, repo, rawQuery);
    const resp: GraphQLResponse<{
      search: {
        discussionCount: number;
        nodes: (GraphQLDiscussionNode & { comments?: { totalCount: number } })[];
      };
    }> = await graphqlRequest(DISCUSSION_SEARCH_QUERY, { query: q, first: 20 }, token);
    if (hasGraphQLErrors(resp) || !resp.data?.search) {
      throw new Error(resp.errors?.[0]?.message ?? "discussions 搜索失败");
    }
    const { discussionCount, nodes } = resp.data.search;
    // 搜索模式不带 pinned/categories → 重新拉一次完整列表供左栏用
    const base = await fetchDiscussionsSmart(owner, repo, token, null, null, null, null);
    return {
      ...base,
      totalCount: discussionCount,
      discussions: nodes
        .filter((n): n is GraphQLDiscussionNode => "number" in n)
        .map(toDiscussionSummary),
      // 搜索模式不做游标续接（保持现状）
      endCursor: null,
      hasNextPage: false,
    };
  }

  const resp: GraphQLResponse<{
    repository: {
      discussions: {
        totalCount: number;
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
        nodes: GraphQLDiscussionNode[];
      };
      discussionCategories: {
        nodes: { id: string; name: string; emoji: string; description?: string | null }[];
      };
      pinnedDiscussions: { nodes: { discussion: GraphQLDiscussionNode }[] };
      codeOfConduct: { name: string; url: string } | null;
    } | null;
  }> = await graphqlRequest(
    DISCUSSIONS_QUERY,
    {
      owner,
      name: repo,
      first: 20,
      after: cursor ?? null,
      categoryId: categoryId ?? null,
      states: states ?? null,
      orderBy: orderBy ?? { field: "UPDATED_AT", direction: "DESC" },
    },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.repository) {
    throw new Error(resp.errors?.[0]?.message ?? "discussions 加载失败");
  }
  const repoData = resp.data.repository;
  // Most helpful：聚合最近讨论的评论作者
  const authorCount = new Map<string, { login: string; avatarUrl: string; count: number }>();
  for (const d of repoData.discussions.nodes) {
    for (const c of d.comments.nodes) {
      if (!c.author) continue;
      const cur = authorCount.get(c.author.login);
      if (cur) cur.count += 1;
      else
        authorCount.set(c.author.login, {
          login: c.author.login,
          avatarUrl: c.author.avatarUrl,
          count: 1,
        });
    }
  }
  const mostHelpful = [...authorCount.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  return {
    totalCount: repoData.discussions.totalCount,
    discussions: repoData.discussions.nodes.map(toDiscussionSummary),
    categories: repoData.discussionCategories.nodes.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      description: c.description,
    })),
    pinned: repoData.pinnedDiscussions.nodes.map((p) => toDiscussionSummary(p.discussion)),
    mostHelpful,
    codeOfConduct: repoData.codeOfConduct,
    endCursor: repoData.discussions.pageInfo?.endCursor ?? null,
    hasNextPage: repoData.discussions.pageInfo?.hasNextPage ?? false,
  };
}

/** GraphQL 讨论详情节点 */
interface GraphQLDiscussionCommentNode {
  id: string;
  body: string;
  createdAt: string;
  author: { login: string; avatarUrl: string } | null;
  isAnswer: boolean;
  replies: { totalCount: number; nodes: GraphQLDiscussionCommentNode[] };
}

interface GraphQLDiscussionDetailNode {
  id: string;
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  category: { id: string; name: string; emoji: string; description?: string | null };
  author: { login: string; avatarUrl: string } | null;
  answerChosenAt: string | null;
  upvoteCount: number;
  comments: { totalCount: number; nodes: GraphQLDiscussionCommentNode[] };
}

/** 智能获取讨论详情（GraphQL only） */
export async function fetchDiscussionDetailSmart(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<DiscussionDetail> {
  const resp: GraphQLResponse<{
    repository: { discussion: GraphQLDiscussionDetailNode | null } | null;
  }> = await graphqlRequest(DISCUSSION_DETAIL_QUERY, { owner, name: repo, number }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.repository?.discussion) {
    throw new Error(resp.errors?.[0]?.message ?? "discussion 加载失败");
  }
  const g = resp.data.repository.discussion;
  const toComment = (c: GraphQLDiscussionCommentNode): DiscussionComment => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: { login: c.author?.login ?? "ghost", avatar_url: c.author?.avatarUrl ?? "" },
    isAnswer: c.isAnswer,
    repliesCount: c.replies.totalCount,
  });
  return {
    id: g.id,
    number: g.number,
    title: g.title,
    body: g.body,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    locked: g.locked,
    category: {
      id: g.category.id,
      name: g.category.name,
      emoji: g.category.emoji,
      description: g.category.description,
    },
    author: { login: g.author?.login ?? "ghost", avatar_url: g.author?.avatarUrl ?? "" },
    answered: Boolean(g.answerChosenAt),
    upvoteCount: g.upvoteCount,
    comments: g.comments.nodes.map(toComment),
  };
}

/** 新建讨论（createDiscussion mutation；需 repositoryId 与 categoryId） */
export async function createDiscussionSmart(
  repositoryId: string,
  categoryId: string,
  title: string,
  body: string,
  token: string,
): Promise<number> {
  const resp: GraphQLResponse<{
    createDiscussion: { discussion: { number: number } | null } | null;
  }> = await graphqlRequest(
    CREATE_DISCUSSION_MUTATION,
    { repositoryId, categoryId, title, body },
    token,
  );
  if (hasGraphQLErrors(resp) || !resp.data?.createDiscussion?.discussion) {
    throw new Error(resp.errors?.[0]?.message ?? "创建讨论失败");
  }
  return resp.data.createDiscussion.discussion.number;
}

/** 发表讨论评论（addDiscussionComment mutation） */
export async function addDiscussionCommentSmart(
  discussionId: string,
  body: string,
  token: string,
): Promise<DiscussionComment> {
  const resp: GraphQLResponse<{
    addDiscussionComment: { comment: GraphQLDiscussionCommentNode | null } | null;
  }> = await graphqlRequest(ADD_DISCUSSION_COMMENT_MUTATION, { discussionId, body }, token);
  if (hasGraphQLErrors(resp) || !resp.data?.addDiscussionComment?.comment) {
    throw new Error(resp.errors?.[0]?.message ?? "评论失败");
  }
  const c = resp.data.addDiscussionComment.comment;
  return {
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: { login: c.author?.login ?? "ghost", avatar_url: c.author?.avatarUrl ?? "" },
    isAnswer: c.isAnswer,
    repliesCount: c.replies.totalCount,
  };
}
