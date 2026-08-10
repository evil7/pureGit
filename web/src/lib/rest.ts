/**
 * GitHub REST API - barrel (拆分 + 改名)
 *
 * 原单文件 2829 行已按业务板块拆分为（原 github-*.ts 改名 rest-*.ts）：
 * - rest-core.ts      底层（restRequest/githubFetch/ApiError/通用类型）
 * - rest-account.ts   账户（emails/SSH/GPG/blocked/saved-replies）
 * - rest-user-org.ts  用户主页 + 关注 + 组织
 * - rest-repo.ts      仓库浏览/管理 + 代码内容 + Release
 * - rest-issue-pr.ts  Issue/PR + 评论 + 类型
 * - rest-user-nav.ts  用户导航（Gist/通知/邀请/Feed/搜索）
 * - rest-actions.ts   Actions 全家
 * - rest-discussions.ts Discussions 类型
 * 本文件仅 re-export，页面 import 面零改动。
 */
export * from "./rest-core";
export * from "./rest-account";
export * from "./rest-user-org";
export * from "./rest-repo";
export * from "./rest-issue-pr";
export * from "./rest-user-nav";
export * from "./rest-actions";
export * from "./rest-discussions";
