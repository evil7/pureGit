/**
 * 双进程 dev（pnpm dev）—— 唯一开发模式
 *
 * 架构（定稿，替代 @cloudflare/vite-plugin 单进程）：
 * - worker：pnpm --filter worker dev（wrangler dev，端口 8787）
 * - web：pnpm --filter web dev（vite，端口 5173；静态资源直连 vite，
 *   仅 /$auth、/$wiki、/$raw、/$healthz、git 端点经 server.proxy 转发到 8787；
 *   /$debug 为纯前端路由直连 vite，不转发 worker——定稿）
 * - 实测：首屏 22s → ~0.5s，10 并发 27.6s → 8.3s
 *
 * 职责（纯 Node.js 跨平台，保持简单只做统一启动）：
 * - 启动前以 Node 原生方式清理 8787/5173 端口占用（残留进程/上次崩溃遗留），保证干净启动
 * - 统一启动顺序：清空端口 → 启动 worker → 启动 web（不做健康检查与自动重启）
 * - 无 PowerShell/bash 专属语法，全部经 Node child_process + 平台通用命令，
 *   保证 Windows/macOS/Linux 普遍适用
 *
 * 退出：Ctrl+C 或任一进程退出即全部终止。
 */
import { spawn, spawnSync, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const isWin = process.platform === "win32";
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

const WORKER_PORT = 8787;
const WEB_PORT = 5173;

/* ── 端口工具（纯 Node 跨平台） ───────────────────────────── */

/** 探测端口是否被占用（TCP 连接成功 = 占用） */
function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve_) => {
    const sock = createConnection({ port, host, timeout: 1500 });
    sock.once("connect", () => {
      sock.destroy();
      resolve_(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve_(false);
    });
    sock.once("error", () => resolve_(false));
  });
}

/** 按端口查找占用进程 PID（跨平台：Windows netstat / Unix lsof） */
function findPidsByPort(port) {
  return new Promise((resolve_) => {
    const pids = new Set();
    if (isWin) {
      // netstat -ano → 行尾 PID；仅取 LISTENING 的 TCP 连接
      execFile("netstat", ["-ano"], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve_([...pids]);
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/\s+(\S+):(\d+)\s+\S+:\d+\s+LISTENING\s+(\d+)/);
          if (m && Number(m[2]) === port && m[3] !== "0") pids.add(m[3]);
        }
        resolve_([...pids]);
      });
    } else {
      // lsof -ti :port → 直接输出 PID 列表
      execFile("lsof", ["-ti", `:${port}`], (err, stdout) => {
        if (err) return resolve_([...pids]); // 无结果即无占用
        for (const line of stdout.split(/\r?\n/)) {
          const pid = line.trim();
          if (/^\d+$/.test(pid)) pids.add(pid);
        }
        resolve_([...pids]);
      });
    }
  });
}

/** 结束进程（Windows taskkill / Unix kill） */
function killPid(pid) {
  return new Promise((resolve_) => {
    const args = isWin ? ["/F", "/PID", String(pid)] : ["-9", String(pid)];
    execFile(isWin ? "taskkill" : "kill", args, { windowsHide: true }, () => resolve_());
  });
}

/** 等待端口释放（最多 timeoutMs） */
async function waitPortFree(port, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortInUse(port))) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return !(await isPortInUse(port));
}

/** 启动前清理：端口被占用则查找 PID 并强制结束 */
async function clearPort(port, label) {
  if (!(await isPortInUse(port))) {
    console.log(`[setup] ${label} 端口 ${port} 空闲`);
    return;
  }
  console.log(`[setup] ${label} 端口 ${port} 被占用，尝试清理残留进程...`);
  const pids = await findPidsByPort(port);
  if (pids.length === 0) {
    console.warn(`[warn] 未找到占用 ${port} 的进程 PID，跳过（可能为外部服务）`);
    return;
  }
  for (const pid of pids) {
    console.log(`[setup] 结束进程 ${pid}（占用 ${port}）`);
    await killPid(pid);
  }
  // 等端口释放（可能有多层子进程需逐一结束，最多等 10s）
  const freed = await waitPortFree(port);
  if (!freed) {
    console.warn(`[warn] 端口 ${port} 未能释放，可能仍有子进程残留，继续尝试启动`);
  } else {
    console.log(`[setup] ${label} 端口 ${port} 已清理`);
  }
}

/* ── 子进程管理 ─────────────────────────────────────────── */

const children = new Map(); // label → child
let shuttingDown = false;

function run(label, args) {
  // shell: true + 命令字符串（避免 DEP0190 警告）；参数均为硬编码，无注入风险
  const child = spawn(`${pnpm} ${args.join(" ")}`, { cwd: root, shell: true });
  children.set(label, child);

  // 按行输出：readline 缓冲到换行符再回调，避免 chunk 在行中被切断导致
  // 两个子进程输出交错、出现 [worker] [web] 这类双标签/错标签（修复）
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => process.stdout.write(`[${label}] ${line}\n`));
  }

  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited with code ${code} signal ${signal ?? ""}`);
    shutdown();
  });

  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children.values()) {
    if (!child.killed) child.kill("SIGTERM");
  }
  // 给子进程一点收尾时间后强制退出
  setTimeout(() => process.exit(0), 800);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* ── 主流程 ─────────────────────────────────────────────── */

async function main() {
  // 0) 清理端口占用（残留进程/上次崩溃遗留）
  await clearPort(WORKER_PORT, "worker");
  await clearPort(WEB_PORT, "web");

  // 1) 生成 Worker 类型（wrangler types → worker-configuration.d.ts），确保与 bindings 同步。
  //    已有类型文件则跳过（网络受限时 wrangler 下载 workerd 会长时间挂起，实测）
  //    类型需刷新时手动 `pnpm --filter worker cf-typegen`。
  const typeFile = join(root, "worker", "worker-configuration.d.ts");
  if (!existsSync(typeFile)) {
    console.log(">>> 生成 Worker 类型（wrangler types）...");
    try {
      const typegen = spawnSync(`${pnpm} --filter worker cf-typegen`, {
        cwd: root,
        shell: true,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (typegen.status !== 0) {
        console.warn(
          `[warn] wrangler types 失败（不影响启动）: ${
            (typegen.stderr || typegen.stdout || "").trim().split("\n")[0]
          }`,
        );
      } else {
        console.log(">>> Worker 类型已更新");
      }
    } catch {
      console.warn("[warn] wrangler types 超时跳过（不影响启动）");
    }
  }

  // 2) 检查 worker 的 ASSETS binding 依赖（wrangler.jsonc assets.directory → web/dist/client）
  const distClient = join(root, "web", "dist", "client");
  if (!existsSync(distClient)) {
    console.warn("[warn] web/dist/client 不存在：worker 的 ASSETS binding 将不可用。");
    console.warn("       若仅前端调试可忽略；需要完整功能请先 `pnpm --filter web build`。");
  }

  // 3) 统一启动：worker → web（顺序固定，不做健康检查与自动重启）
  run("worker", ["--filter", "worker", "dev"]);
  run("web", ["--filter", "web", "dev"]);
}

main().catch((e) => {
  console.error("[dev] 启动失败:", e);
  process.exit(1);
});
