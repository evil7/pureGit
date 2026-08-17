/**
 * 清理缓存与构建产物（pnpm clean / pnpm clean:cache）
 *
 * clean:cache（日常卡顿首选，最安全——完全不动 .wrangler）：
 * - web/node_modules/.vite  —— vite 依赖预构建缓存
 * - 递归 *.tsbuildinfo     —— TypeScript 增量构建缓存
 * 保留：
 * - web/dist —— dev 的 ASSETS binding 指向 dist/client，删了 dev 起 500 需重 build
 * - worker/.wrangler —— wrangler 运行时状态（KV 会话 + bundle 临时文件 + 缓存）。
 *   ⚠️ 运行中删除会导致 worker 构建崩溃（middleware-loader.entry.ts 找不到）且 KV 会话丢失
 *
 * clean（彻底重建，先停 dev）：
 * - 上述全部 + web/dist + worker/.wrangler（含 KV 会话，需重新登录）
 *
 * 用法：node scripts/clean.mjs [--all]
 * 纯 Node 实现，跨平台（Windows PS / macOS / Linux 一致）。
 */
import { rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const all = process.argv.includes("--all");

// 常规缓存（clean:cache 删除）——仅 vite 缓存与 tsbuildinfo，不动 .wrangler
const cacheTargets = [join(root, "web", "node_modules", ".vite")];
// 全清追加：web/dist 与整个 .wrangler（含 KV 会话，删后需重新登录；先停 dev）
const allTargets = [join(root, "web", "dist"), join(root, "worker", ".wrangler")];

let removed = 0;
const targets = all ? [...cacheTargets, ...allTargets] : cacheTargets;
for (const dir of targets) {
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
      console.log(`  removed ${dir}`);
      removed++;
    } catch (e) {
      // dev 进程运行中占用（Windows EPERM）→ 跳过，不阻断其余清理
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  [warn] 跳过（被占用）: ${dir} — ${msg}`);
    }
  }
}

// 递归删除所有 *.tsbuildinfo（跳过 node_modules 与 .wrangler——避免删 KV 会话）
function walkTsbuildinfo(dir, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".wrangler") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walkTsbuildinfo(p, depth + 1);
    } else if (e.name.endsWith(".tsbuildinfo")) {
      rmSync(p, { force: true });
      console.log(`  removed ${p}`);
      removed++;
    }
  }
}
walkTsbuildinfo(root);

console.log(`\nclean${all ? " (all)" : " (cache)"}: ${removed} item(s) removed`);
if (all) {
  console.log(
    "提示：已清除 dist/client 与 KV 会话（登录状态）——先停 dev、`pnpm --filter web build`，登录需重新进行",
  );
} else {
  console.log(
    "提示：仅清 vite 缓存，KV 会话（登录状态）与 .wrangler 运行时状态完整保留，dev 可直接继续",
  );
}
