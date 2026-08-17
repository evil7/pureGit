/**
 * /$debug 页面 lazy 入口（App.tsx: `lazy(() => import("@/pages/debug"))`）
 *
 * 单独文件而非直接在 App.tsx 内联 import 路径的原因：
 * App.tsx 的 `const DebugPage = lazy(() => import("@/pages/DebugPage"))` 会保留
 * 旧文件名的惰性引用；统一经本入口重导出后，目录内重构（文件名/拆分）不再波及 App.tsx。
 */
export { default } from "./DebugPage";
