/**
 * GitHub REST API - discussions（拆分 + 改名；原 github.ts 板块）
 * Board file. See rest.ts barrel for full export surface & docs/api-compat.md.
 */

import type { GitHubUser } from "./rest-core";

// ===== Discussions（GraphQL only——REST 无 discussion 端点） =====

/** 讨论分类 */
export interface DiscussionCategory {
  id: string;
  name: string;
  emoji: string;
  description?: string | null;
}

/** 讨论摘要（列表行） */
export interface DiscussionSummary {
  number: number;
  title: string;
  createdAt: string;
  category: DiscussionCategory;
  author: GitHubUser;
  answered: boolean;
  commentsCount: number;
  upvoteCount: number;
}

/** 讨论搜索结果条目（跨仓库 search type: DISCUSSION；附来源仓库） */
export interface DiscussionSearchItem extends DiscussionSummary {
  repository: { full_name: string };
}

/** 讨论评论（详情） */
export interface DiscussionComment {
  id: string;
  body: string;
  createdAt: string;
  author: GitHubUser;
  isAnswer: boolean;
  repliesCount: number;
}

/** 讨论详情 */
export interface DiscussionDetail {
  id: string;
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  category: DiscussionCategory;
  author: GitHubUser;
  answered: boolean;
  upvoteCount: number;
  comments: DiscussionComment[];
}

/** Discussions 列表页完整数据 */
export interface DiscussionsData {
  totalCount: number;
  discussions: DiscussionSummary[];
  categories: DiscussionCategory[];
  pinned: DiscussionSummary[];
  /** Most helpful：最近讨论的评论作者聚合 top 5 */
  mostHelpful: { login: string; avatarUrl: string; count: number }[];
  codeOfConduct: { name: string; url: string } | null;
  /** 游标分页：续接游标 + 是否有下一页（列表模式；搜索模式恒 null/false） */
  endCursor: string | null;
  hasNextPage: boolean;
}
