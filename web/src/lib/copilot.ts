/**
 * Copilot 账号常量（官方头像 + login 识别）
 *
 * 官方 Copilot 账号（github.com 实测）：头像 avatars.githubusercontent.com/in/946600，
 * review 作者 login 为 "Copilot"，bot 账号为 "copilot-pull-request-reviewer[bot]"。
 * 独立文件供 PullReviewPanel（审计者栏）与 PullsPages（参与者聚合）共用，
 * 避免组件文件导出非组件触发 fast-refresh 警告。
 */
export const COPILOT_AVATAR = "https://avatars.githubusercontent.com/in/946600?v=4&size=48";

/** 识别 Copilot 账号（统一名称/头像/effort 下拉；REST 可能返回无 [bot] 后缀的 login） */
export const isCopilotLogin = (login: string) =>
  login === "Copilot" ||
  login === "copilot-pull-request-reviewer[bot]" ||
  login === "copilot-pull-request-reviewer";

/** Copilot 显示名（官方统一显示 "Copilot"，其余原样） */
export const copilotDisplayName = (login: string) => (isCopilotLogin(login) ? "Copilot" : login);
