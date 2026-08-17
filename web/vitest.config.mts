import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * web 测试配置（node 环境）
 *
 * 被测对象：debug 页纯函数模块（debug-params.ts / debug-openapi.ts）——只 import type，
 * 无浏览器 API 依赖，node 环境即可跑。全量真实产物验证（schema-integration.spec.ts）
 * 通过 fs 读取 web/public/debug/rest/*.req.json，断言「文档参数 → 表格/URL」提取规则。
 *
 * @ 别名与 vite.config.ts 保持一致（src 内部相对导入）。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // React 19 新 JSX Transform：esbuild 默认 classic 会要求 React 在作用域内 → 指定 automatic
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts", "test/**/*.spec.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
