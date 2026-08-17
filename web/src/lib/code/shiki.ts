/**
 * 语言推断（迁移：linguist 全量方案，见 lib/languages.ts）
 *
 * - inferLang：文件路径 → CM6 语言 id（linguist 文件名/扩展名全量匹配，GitHub 官方/Gitea 同源）
 * - languageDisplayName：友好语言名（官方 Linguist 显示名，如 "Python"）
 * - CM6 语言映射见 lib/codemirror.ts（LANG_SUPPORT）；shiki 不再用于代码展示
 */
export { inferLang, languageDisplayName } from "./languages";
