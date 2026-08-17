# 部署指南（Cloudflare Workers）

> 本文档说明如何将 PureGit 部署到 Cloudflare Workers，含**一键脚本**与**手动步骤**两种方式。
> 一键脚本 `scripts/deploy.sh`（Linux/macOS）与 `scripts/deploy.ps1`（Windows）会自动完成
> 环境检测 → 登录 → 创建 KV → 部署的全流程。

## 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 20 | 运行时 |
| pnpm | 任意（项目锁定 pnpm workspace） | 依赖安装 + workspace 构建 |
| wrangler | ≥ 4 | Cloudflare Workers CLI（随 `pnpm install` 装入 `node_modules/.bin`，也支持全局安装） |
| Cloudflare 账号 | — | 部署目标 |

## 一键部署（推荐）

### Linux / macOS

```bash
# 首次部署
./scripts/deploy.sh

# 更新：pull 本仓库到最新后重新部署
./scripts/deploy.sh --update
```

### Windows（PowerShell）

```powershell
# 首次部署
.\scripts\deploy.ps1

# 更新：pull 本仓库到最新后重新部署
.\scripts\deploy.ps1 --update
```

脚本会依次执行：

1. **（`--update` 时）`git pull --ff-only`** 拉取最新代码
2. **环境检测**：Node / pnpm / wrangler（本地 `node_modules/.bin` 优先，其次全局）
3. **`pnpm install`**（首次无 `node_modules` 时）
4. **登录检测**：`wrangler whoami` 未登录则自动 `wrangler login`（浏览器授权）
5. **生成配置**：`worker/wrangler.jsonc` 不存在时从 `wrangler.jsonc.example` 复制
6. **创建 KV**：若 `kv_namespaces[0].id` 仍为占位符，运行 `wrangler kv namespace create SESSIONS` 并回填 id
7. **配置 Secret**：若尚未配置 `GITHUB_CLIENT_SECRET`，交互式 `wrangler secret put`（隐藏输入）
8. **部署**：`pnpm --filter web build`（前端构建）→ `wrangler deploy`（创建/更新 Worker）

> 首次运行前请先编辑 `worker/wrangler.jsonc`，填入你自己的 `GITHUB_CLIENT_ID` 与域名
> （脚本生成配置后会提示，也可提前手动生成）。

## 手动步骤

等价于脚本做的事，逐条执行：

```bash
# 1. 安装依赖
pnpm install

# 2. 基于示例模板生成部署配置（从 wrangler.jsonc.example 复制）
cp worker/wrangler.jsonc.example worker/wrangler.jsonc

# 3. 登录 Cloudflare
cd worker && npx wrangler login

# 4. 创建 KV namespace，把输出的 id 填入 wrangler.jsonc 的 kv_namespaces[0].id
npx wrangler kv namespace create SESSIONS

# 5. 配置生产密钥（仅 Worker 端持有，前端零密钥）
npx wrangler secret put GITHUB_CLIENT_SECRET

# 6. 构建前端 + 部署 Worker（根目录 pnpm deploy 已串联两步）
cd .. && pnpm deploy
```

## 配置项说明（`worker/wrangler.jsonc`）

部署前**必须修改**以下内容（完整模板见 `worker/wrangler.jsonc.example`）：

```jsonc
"vars": {
  "GITHUB_CLIENT_ID": "<你的 GitHub OAuth App Client ID>",
  "GITHUB_OAUTH_CALLBACK": "https://<你的域名>/$auth/callback",
  "FRONTEND_URL": "https://<你的域名>"
}
```

| 配置 | 说明 |
|------|------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID（`https://github.com/settings/developers`） |
| `GITHUB_OAUTH_CALLBACK` | OAuth 回调地址，须与 OAuth App 的 Authorization callback URL **精确一致** |
| `FRONTEND_URL` | 前端生产域名（登录后跳转 + CORS 允许源） |
| `GITHUB_CLIENT_SECRET` | **不写入文件**，用 `wrangler secret put` 注入 |
| `kv_namespaces[0].id` | 会话 KV 的 namespace id（`wrangler kv namespace create` 输出） |
| `routes` | 自定义域名；不用自定义域名则**删除整个 routes 块**（默认 `*.workers.dev`） |

> 同时把 GitHub OAuth App 的 **Authorization callback URL** 改为 `https://<你的域名>/$auth/callback`。
> 前端 git 镜像 clone 命令会自动取当前访问域名（`window.location.host`），无需额外配置。

## 更新部署

功能更新后重新部署：

```bash
# 方式一：脚本（pull + 重部署）
./scripts/deploy.sh --update        # Windows: .\scripts\deploy.ps1 --update

# 方式二：手动
git pull && pnpm install && pnpm deploy
```

> `--update` 等价于 `git pull --ff-only` 后重新走完整部署流程（KV 已存在则跳过创建、已登录则跳过登录）。
