/**
 * GitHub API Schema 资产一键更新脚本（debug 面板数据源）
 *
 * **默认零下载（octokit 转录）**：从已安装的 octokit 包直接提取两种 schema
 * （REST：@octokit/openapi deref；GraphQL：@octokit/graphql-schema 原数据）→
 * build-schemas-octokit.mjs 转录 → web/public/debug/ 三层产物
 * （rest/index.json + <tag>.req/res-min/res-full.json + gql/schema.json）。
 * 与当前使用的 SDK 版本完全同步，离线可用。
 *
 * **可选下载刷新（官方最新快照）**：`pnpm update:schemas --download` 时下载官方源到
 * docs/ 快照（REST OpenAPI + GraphQL SDL）**仅作权威对照**——转录产物仍以 octokit
 * 为准（官方 REST 为带 $ref 的完整文档，body schema 需自解析器，非 deref 不可直接用；
 * 需要最新端点/描述时查 docs/ 快照人工比对）。候选 URL：github.com 直连受限自动降级
 * jsDelivr CDN。
 *
 * 下载用**流式读取** + 极简进度条（\r 覆盖单行，ASCII 字符兼容 Windows 终端，零依赖）。
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const useDownload = process.argv.includes("--download");

/** 下载清单：官方源候选 URL 列表（依次尝试）→ docs/ 本地快照路径 */
const SOURCES = [
  {
    name: "REST OpenAPI",
    urls: [
      "https://github.com/github/rest-api-description/raw/refs/heads/main/descriptions/api.github.com/api.github.com.json",
      "https://cdn.jsdelivr.net/gh/github/rest-api-description@main/descriptions/api.github.com/api.github.com.json",
    ],
    dest: join(root, "docs", "github-openapi.json"),
  },
  {
    name: "GraphQL SDL",
    urls: ["https://docs.github.com/public/fpt/schema.docs.graphql"],
    dest: join(root, "docs", "github-schema.graphql"),
  },
];

/**
 * 极简进度条：\r 覆盖单行 [####------] 45% 5.8/12.9MB
 * ASCII 块字符（#/-）而非 Unicode 块（█/░）——Windows cmd/PS 代码页兼容，不乱码；
 * 行尾 padEnd 固定宽度，覆盖上一次更长的输出（百分比位数变化不残留）。
 */
const BAR_W = 20;
function renderBar(name, received, total) {
  const pct = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
  const filled = Math.floor((pct / 100) * BAR_W);
  const bar = "#".repeat(filled) + "-".repeat(BAR_W - filled);
  const mb = (received / 1048576).toFixed(1);
  const tmb = total ? `/${(total / 1048576).toFixed(1)}MB` : "MB";
  process.stdout.write(`\r${name} [${bar}] ${String(pct).padStart(3)}% ${mb}${tmb}`.padEnd(72));
}

/**
 * 下载单个文件（**串行**：两条进度条同屏需 ANSI 光标控制，极简方案串行最稳；
 * 两文件共 ~14MB，串行体验可接受）：依次尝试候选 URL，全部失败抛错。
 * 流式读取响应体（fetch 默认 res.text() 拿不到中间进度）+ TextDecoder 累积 UTF-8。
 */
async function download({ name, urls, dest }) {
  let lastErr;
  for (const url of urls) {
    process.stdout.write(`\r${name} 连接中…`.padEnd(72));
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
        renderBar(name, received, total);
      }
      text += decoder.decode();
      writeFileSync(dest, text, "utf8");
      const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
      const rel = dest.slice(root.length + 1).replace(/\\/g, "/");
      console.log(`\r${name} ✓ ${kb} KB → ${rel}`.padEnd(72));
      return;
    } catch (e) {
      lastErr = e;
      console.log(
        `\r${name} 失败（${e.cause?.code ?? e.message.slice(0, 40)}）→ 试下一候选`.padEnd(72),
      );
    }
  }
  throw lastErr ?? new Error(`${name} 全部候选下载失败`);
}

if (useDownload) {
  for (const s of SOURCES) await download(s);

  console.log(
    "\n[build] 转录三层产物 → web/public/debug/（以 octokit 数据为准；docs/ 快照供对照）",
  );
  await import("./build-schemas-octokit.mjs");
  console.log("\n完成：官方快照 → docs/；三层产物 → web/public/debug/");
} else {
  console.log("[octokit] 转录已安装 SDK 的 schema → web/public/debug/（零下载）");
  await import("./build-schemas-octokit.mjs");
  console.log("\n提示：需要官方最新快照对照时用 `pnpm update:schemas --download`");
}
