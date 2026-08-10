import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 双进程 dev（pnpm dev → scripts/dev-fast.mjs）：
// 纯 vite 前端（5173）+ 独立 wrangler dev worker（8787）。
// 静态资源直连 vite（首屏 ~0.5s）；仅 /$auth 与 git 端点经 server.proxy 转发到 worker。
// 曾用 @cloudflare/vite-plugin 单进程（所有请求经 workerd 串行中转，首屏 22s），
// 2026-08-07 实测后废弃，pnpm dev 统一走快速双进程模式。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // worker 独立跑在 8787（wrangler dev 默认端口）；proxy 只转发 worker 职责：
    // 1) OAuth（/$auth/*）；2) CLI git 镜像端点（owner/repo.git/...，git 智能 HTTP）
    proxy: {
      // 鉴权系统（worker /$auth → OAuth 登录/恢复/登出/PAT/会话/偏好）
      '/$auth': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // Wiki 内容代理（worker /$wiki → raw.githubusercontent.com/wiki）
      '/$wiki': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // Raw 内容代理（worker /$raw → raw.githubusercontent.com；README 图片降级，2026-08-09）
      '/$raw': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // 健康检查探活（worker /$healthz；2026-08-10，通用在线探活 + 浏览器调试）
      '/$healthz': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // ⚠️ 注意：/$debug 为纯前端路由（App.tsx lazy 页），vite SPA 直连，不转发 worker
      // （2026-08-10 简化：worker 不再参与 debug，/debug/session 与 DEBUG_ROUTE_ENABLE 已删除）
      '^/[^/]+/[^/]+\\.git/': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
    // 本地 OAuth 调试：GitHub loopback 回调推荐 127.0.0.1（RFC 8252 §7.3），
    // 与 .dev.vars 的 GITHUB_OAUTH_CALLBACK/FRONTEND_URL（http://127.0.0.1:5173）严格同步。
    // host 固定 '127.0.0.1'：默认 'localhost' 在 Node ≥17 只解析为 ::1、127.0.0.1 不可达
    // → OAuth 回调挂起（2026-08-07 定位）；浏览器访问一律用 http://127.0.0.1:5173
    // （用 localhost 会先撞 IPv6 ::1 失败再回退，奇慢，勿用）。
    // port 固定 5173：.dev.vars 回调硬编码 5173，端口漂移会失效。
    host: '127.0.0.1',
    port: 5173,
    // 浏览器 console → 本地终端（vite 8 server.forwardConsole）
    // 默认仅转发 error/warn；加入 'log' 让 [PureGit API] 请求日志（rest.ts/api.ts
    // 的 console.log）实时显示在终端，本地排障不用开 DevTools
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ['log', 'warn', 'error'],
    },
  },
  // dev 依赖预构建优化（堵点修复 2）
  optimizeDeps: {
    // shiki 走原生 ESM 动态 import（bundle/web 语言按需加载），
    // 不预构建全量语言（原 34.5MB / 439 模块 → 按需）
    exclude: ['shiki/bundle/web', 'shiki'],
    // 稳定大依赖预打包，避免首次请求时才逐个构建
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'i18next',
      'react-i18next',
      'lucide-react',
      'radix-ui',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    // 强制 react/react-dom 单实例：@uiw/react-markdown-preview 等库若解析到
    // 自己的 react 副本会出现 "Invalid hook call"（useRef null），2026-08-08 实测
    dedupe: ['react', 'react-dom'],
  },
  // 构建产物输出到 dist/client：worker 的 ASSETS binding（wrangler.jsonc
  // assets.directory → ../web/dist/client）依赖此目录（原 @cloudflare/vite-plugin
  // 隐式设置，插件移除后需显式声明）。部署前必须 `pnpm --filter web build`。
  build: {
    outDir: 'dist/client',
    rolldownOptions: {
      output: {
        // 重依赖分片（/$debug 懒加载触发时并行加载；docs/debug-page.md §12）：
        // - graphql-vendor：graphql-js（schema 解析）+ cm6-graphql（补全/悬停）——
        //   仅 debug 页（补全）使用，独立 chunk 避免打进共享 codemirror chunk
        // - codemirror-vendor：CM6 全站编辑器工厂（CodeEditor）及其语言扩展、
        //   lezer 解析器，独立 chunk（首屏不进，首次编辑页触发时加载）
        // rolldown 按 groups 将匹配 node_modules 的模块归入命名 chunk；未匹配的
        // 小依赖仍随使用方合并，避免碎片化。
        codeSplitting: {
          groups: [
            {
              name: 'graphql-vendor',
              test: /node_modules\/(graphql|cm6-graphql)\//,
              priority: 30,
            },
            {
              name: 'codemirror-vendor',
              test: /node_modules\/@?(codemirror|lezer|style-mod|w3c-keyname|crelt)\//,
              priority: 20,
            },
          ],
        },
      },
    },
  },
})
