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
 * v2：纯 Node.js 跨平台增强
 * - 启动前自动清理 8787/5173 端口占用（残留进程/上次崩溃遗留），保证干净启动
 * - worker 健康检查 + 自动重启：每 3s 探活 8787，连续 3 次失败判定卡死 →
 *   强制结束并自动拉起（wrangler dev 偶发卡死问题，实测两次）
 * - 启动顺序：worker 就绪（健康检查通过）后再起 web，消除首请求 500/502
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
import { get as httpGet } from "node:http";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const isWin = process.platform === "win32";
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

const WORKER_PORT = 8787;
const WEB_PORT = 5173;
// 健康检查探活 worker 专用端点（/$healthz）：
// 之前探 "/" 会走 ASSETS/SPA fallback（读构建产物，冷启动/热重载时 >2s 超时）
// → 误判卡死反复 SIGKILL 重启。专用端点无业务逻辑即时返回，杜绝误杀。
const HEALTH_PATH = "/$healthz";
const HEALTH_INTERVAL_MS = 5000; // 健康检查间隔
const HEALTH_MAX_FAIL = 5; // 连续失败次数 → 判定卡死（放宽：wrangler 热重载/冷启动偶发慢）
const START_TIMEOUT_MS = 90_000; // 启动等待上限（wrangler 首次启动下载 workerd 可能较慢）

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

/* ── 健康检查 ───────────────────────────────────────────── */

/** HTTP GET 探活：2s 超时内返回任意响应即视为存活 */
function httpPing(port, path, timeoutMs = 2000) {
  return new Promise((resolve_) => {
    const req = httpGet({ host: "127.0.0.1", port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve_(res.statusCode !== undefined);
    });
    req.once("timeout", () => req.destroy());
    req.once("error", () => resolve_(false));
  });
}

/** 等待服务就绪（健康检查通过） */
async function waitReady(port, label, timeoutMs = START_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await httpPing(port, HEALTH_PATH)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn(`[warn] ${label} 启动超时（${timeoutMs / 1000}s），继续但不保障就绪`);
  return false;
}

/* ── 子进程管理 ─────────────────────────────────────────── */

const children = new Map(); // label → { child, restart, port }
let shuttingDown = false;

function run(label, args, { restart = false } = {}) {
  // shell: true + 命令字符串（避免 DEP0190 警告）；参数均为硬编码，无注入风险
  const child = spawn(`${pnpm} ${args.join(" ")}`, { cwd: root, shell: true });
  children.set(label, { child, restart, port: null });

  // 按行输出：readline 缓冲到换行符再回调，避免 chunk 在行中被切断导致
  // 两个子进程输出交错、出现 [worker] [web] 这类双标签/错标签（修复）
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => process.stdout.write(`[${label}] ${line}\n`));
  }

  child.on("exit", (code, signal) => {
    const entry = children.get(label);
    console.log(`[${label}] exited with code ${code} signal ${signal ?? ""}`);
    if (entry?.restart && !shuttingDown) {
      console.log(`[${label}] 自动重启中...`);
      // 等端口释放再拉起（避免 EADDRINUSE）
      setTimeout(async () => {
        if (shuttingDown) return;
        const port = entry.port;
        if (port) await waitPortFree(port);
        run(label, args, { restart: true });
      }, 500);
    } else {
      shutdown();
    }
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

  // 3) 启动 worker（健康检查通过后再起 web）
  const workerEntry = run("worker", ["--filter", "worker", "dev"], {
    restart: true,
  });
  workerEntry.port = WORKER_PORT;

  console.log(`[setup] 等待 worker（${WORKER_PORT}）就绪...`);
  await waitReady(WORKER_PORT, "worker");
  console.log(`[setup] worker 就绪，启动 web（${WEB_PORT}）...`);
  const webEntry = run("web", ["--filter", "web", "dev"], { restart: false });
  webEntry.port = WEB_PORT;

  // 4) worker 健康检查：每 3s 探活，连续失败 → 判定卡死 → 重启
  let failCount = 0;
  setInterval(async () => {
    const entry = children.get("worker");
    if (!entry || shuttingDown) return;
    const alive = await httpPing(WORKER_PORT, HEALTH_PATH);
    if (alive) {
      failCount = 0;
      return;
    }
    failCount += 1;
    if (failCount >= HEALTH_MAX_FAIL) {
      failCount = 0;
      console.log(`[worker] 健康检查连续 ${HEALTH_MAX_FAIL} 次失败，判定卡死，重启中...`);
      const { child } = entry;
      if (!child.killed) child.kill("SIGKILL"); // 卡死进程 SIGTERM 可能无效，直接 SIGKILL
    }
  }, HEALTH_INTERVAL_MS);
}

main().catch((e) => {
  console.error("[dev] 启动失败:", e);
  process.exit(1);
});
