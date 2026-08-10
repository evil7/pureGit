/**
 * 语言检测（linguist 全量方案，学习 Gitea/官方）
 *
 * GitHub 官方与 Gitea 均用 GitHub Linguist 数据做文件类型识别：
 * - Gitea 前端：@codemirror/language-data + linguist-languages 合并，matchFilename
 *   （文件名正则 > 扩展名）；文件名输入变化 → Compartment 无感切换语言
 * - 本模块：linguist-languages（GitHub 官方数据，几千扩展名 + 完整文件名）构建
 *   「扩展名/文件名 → CM6 语言 id」映射，供 inferLang 全量识别 + 友好名展示。
 *
 * 匹配优先级（官方/Gitea 一致）：
 *   1. 完整文件名（Snakefile → Python、Dockerfile → dockerfile、Makefile → make）
 *   2. 扩展名（.py → python），含冲突扩展默认（.h → c、.m → objective-c）
 *   3. 回退 text（纯文本，无高亮）
 */

import * as linguist from "linguist-languages";

/**
 * linguist 语言名 → CM6 语言 id（LANG_SUPPORT 键）。CM 与 linguist 命名差异在此归一。
 * 未列出的 linguist 语言 → 识别成功但无 CM 高亮（友好名仍显示，编辑器纯文本）。
 */
const LINGUIST_TO_CM: Record<string, string> = {
  Bash: "bash",
  Shell: "bash",
  Zsh: "bash",
  ShellSession: "bash",
  C: "c",
  "C++": "cpp",
  "Objective-C": "objective-c",
  "Objective-C++": "cpp",
  "C#": "csharp",
  CSS: "css",
  Go: "go",
  HTML: "html",
  Java: "java",
  JavaScript: "javascript",
  TypeScript: "typescript",
  TSX: "tsx",
  JSX: "jsx",
  JSON: "json",
  "JSON with Comments": "json",
  JSON5: "json",
  GraphQL: "graphql",
  Markdown: "markdown",
  MDX: "markdown",
  PHP: "php",
  Python: "python",
  Rust: "rust",
  SQL: "sql",
  YAML: "yaml",
  Dockerfile: "dockerfile",
  Makefile: "make",
  TOML: "toml",
  INI: "ini",
  Properties: "ini",
  Dotenv: "ini",
  Ruby: "ruby",
  Kotlin: "kotlin",
  Swift: "swift",
  Dart: "dart",
  Lua: "lua",
  Perl: "perl",
  R: "r",
  Scala: "scala",
  XML: "xml",
  Vue: "vue",
  Svelte: "svelte",
  Coffeescript: "coffeescript",
  Clojure: "clojure",
  Elixir: "elixir",
  Erlang: "erlang",
  Haskell: "haskell",
  Julia: "julia",
  Nim: "nim",
  OCaml: "ocaml",
  Zig: "zig",
  Solidity: "solidity",
};

/** 冲突扩展名默认（GitHub/Gitea 实测：多个语言共用扩展时选主流） */
const CONFLICT_EXT_DEFAULT: Record<string, string> = {
  h: "c", // C / C++ / Objective-C
  m: "objective-c", // Objective-C / Matlab / Mathematica
  mm: "cpp", // Objective-C++
  pl: "perl", // Perl / Prolog
  fs: "fsharp", // F# / Forth
  cs: "csharp",
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  pyi: "python",
  go: "go",
  java: "java",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  php: "php",
  rb: "ruby",
  sql: "sql",
  json: "json",
  jsonc: "json",
  graphql: "graphql",
  gql: "graphql",
  graphqls: "graphql",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  swift: "swift",
  kt: "kotlin",
  dart: "dart",
  lua: "lua",
  toml: "toml",
  ini: "ini",
  env: "ini",
  conf: "ini",
  cfg: "ini",
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  mk: "make",
  mak: "make",
  make: "make",
  xml: "xml",
  svg: "xml",
  gradle: "groovy",
  groovy: "groovy",
};

/** 完整文件名 → CM6 语言 id（官方/Gitea：文件名优先于扩展名） */
const FILENAME_TO_CM: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "make",
  gnumakefile: "make",
  bsdmakefile: "make",
  snakefile: "python",
  gemfile: "ruby",
  rakefile: "ruby",
  "cargo.lock": "toml",
  "pom.xml": "xml",
  "build.gradle": "groovy",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".zshrc": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
  ".env": "ini",
  ".gitignore": "text",
  ".gitattributes": "text",
  ".prettierrc": "json",
  "tsconfig.json": "json",
  "package.json": "json",
  "composer.json": "json",
};

/** linguist 扩展名映射表（由 linguist-languages 构建；key 小写去点） */
const linguistExtToCm = new Map<string, string>();
/** linguist 完整文件名映射表（key 小写） */
const linguistFileToCm = new Map<string, string>();

// 模块加载时构建一次（linguist-languages 是静态数据，无运行时开销）
for (const [linguistName, data] of Object.entries(linguist)) {
  const cm = LINGUIST_TO_CM[linguistName];
  if (!cm) continue; // 仅收录有 CM 高亮的语言
  const exts = (data as { extensions?: string[] }).extensions ?? [];
  for (const ext of exts) {
    const key = ext.replace(/^\./, "").toLowerCase();
    if (key && !linguistExtToCm.has(key)) linguistExtToCm.set(key, cm);
  }
  const files = (data as { filenames?: string[] }).filenames ?? [];
  for (const f of files) {
    const key = f.toLowerCase();
    if (key && !linguistFileToCm.has(key)) linguistFileToCm.set(key, cm);
  }
}

/** 从文件路径提取基础名（去掉目录） */
function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * 语言检测：文件名 > 扩展名（linguist 全量）> 冲突默认。
 * 返回 CM6 语言 id（LANG_SUPPORT 键）；未知返回 "text"（纯文本无高亮）。
 */
export function inferLang(path: string): string {
  const base = baseName(path);
  const lower = base.toLowerCase();

  // 1) 完整文件名（含点前缀如 .env / .bashrc；.gitignore 等工具文件）
  const byFile = FILENAME_TO_CM[lower] ?? linguistFileToCm.get(lower);
  if (byFile) return byFile;

  // 2) 扩展名（linguist 全量）
  const dot = lower.lastIndexOf(".");
  if (dot > 0) {
    const ext = lower.slice(dot + 1);
    // 冲突默认优先（.h → c 等，覆盖 linguist 的宽泛归属）
    const def = CONFLICT_EXT_DEFAULT[ext];
    if (def) return def;
    const byLinguist = linguistExtToCm.get(ext);
    if (byLinguist) return byLinguist;
  }

  // 3) 回退纯文本
  return "text";
}

/** 友好语言名（官方 Linguist 显示名，如 "Python" / "TypeScript"）；未知返回 null */
export function languageDisplayName(path: string): string | null {
  const base = baseName(path);
  const lower = base.toLowerCase();
  // 文件名优先
  const byFile = FILENAME_TO_CM[lower] ?? linguistFileToCm.get(lower);
  if (byFile) return displayNameFor(byFile);
  const dot = lower.lastIndexOf(".");
  if (dot > 0) {
    const ext = lower.slice(dot + 1);
    const def = CONFLICT_EXT_DEFAULT[ext];
    if (def) return displayNameFor(def);
    const byLinguist = linguistExtToCm.get(ext);
    if (byLinguist) return displayNameFor(byLinguist);
  }
  return null;
}

/** CM 语言 id → 友好显示名（反向映射；未收录回退 id 本身） */
const CM_DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  json: "JSON",
  graphql: "GraphQL",
  markdown: "Markdown",
  yaml: "YAML",
  css: "CSS",
  html: "HTML",
  python: "Python",
  sql: "SQL",
  bash: "Shell",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  objectivec: "Objective-C",
  go: "Go",
  java: "Java",
  php: "PHP",
  rust: "Rust",
  ruby: "Ruby",
  make: "Makefile",
  dockerfile: "Dockerfile",
  toml: "TOML",
  ini: "INI",
  xml: "XML",
  kotlin: "Kotlin",
  swift: "Swift",
  dart: "Dart",
  lua: "Lua",
  perl: "Perl",
  r: "R",
  scala: "Scala",
  vue: "Vue",
  svelte: "Svelte",
  coffeescript: "CoffeeScript",
  clojure: "Clojure",
  elixir: "Elixir",
  erlang: "Erlang",
  haskell: "Haskell",
  julia: "Julia",
  nim: "Nim",
  ocaml: "OCaml",
  zig: "Zig",
  solidity: "Solidity",
  fsharp: "F#",
  groovy: "Groovy",
};

function displayNameFor(cmId: string): string {
  return CM_DISPLAY_NAMES[cmId] ?? cmId;
}
