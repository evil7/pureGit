# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Oxlint / Oxfmt 配置

本项目为 pnpm workspace monorepo（web + worker + scripts），oxlint 与 oxfmt 配置统一放在**仓库根目录**（`.oxlintrc.json` / `.oxfmtrc.json`），根命令 `pnpm lint`（全量零警告门禁）与 `pnpm format` / `pnpm format:check` 覆盖整个 monorepo。
