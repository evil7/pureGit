/**
 * 登录触发器锚点常量（从 LoginSpotlight.tsx 拆出）
 *
 * 原因：组件文件导出非组件常量 → React Fast Refresh 失效。
 * LoginSpotlight（高亮动画）与 LoginScopeDialog（登录按钮 id）共用。
 */
export const LOGIN_TRIGGER_ID = "topbar-login-btn";
