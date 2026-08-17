/**
 * Discussions 共享常量与工具 —— 自 DiscussionsPage 拆出。
 * emoji（shortcode → unicode）与 SORT_OPTIONS（官方排序枚举）被列表/详情/新建页共用。
 */
import { get as emojiGet } from "node-emoji";
import type { I18nKey } from "@/i18n";

/** :emoji: → unicode（GraphQL category.emoji 返回 shortcode） */
export const emoji = (code: string) => emojiGet(code) ?? code;

/** 官方排序（Latest activity / Top / Newest）→ GraphQL DiscussionOrder */
export const SORT_OPTIONS: {
  value: string;
  labelKey: I18nKey;
  order: { field: string; direction: "ASC" | "DESC" };
}[] = [
  {
    value: "latest",
    labelKey: "discussions.sort.latest",
    order: { field: "UPDATED_AT", direction: "DESC" },
  },
  {
    value: "top",
    labelKey: "discussions.sort.top",
    order: { field: "UPVOTE_COUNT", direction: "DESC" },
  },
  {
    value: "newest",
    labelKey: "discussions.sort.newest",
    order: { field: "CREATED_AT", direction: "DESC" },
  },
];
