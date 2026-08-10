---
name: cf-worker-auth
description: "Use when: 开发 PureGit 的 Cloudflare Pages Worker 鉴权——GitHub OAuth2 登录、/$auth 端点、KV 会话、token 恢复/登出、client_secret 安全。触发词：oauth、auth、worker、KV、cookie、token、登录"
argument-hint: "需要实现/修改哪个鉴权端点或会话逻辑"
---

# PureGit Worker OAuth2 令牌管理

Worker 位于 `worker/`，共四件事 + 探活（架构红线 2，详见 `architecture.md`）：① **OAuth2 令牌管理**（本文档）；② **CLI git 镜像代理**（见 `cli-git-mirror` 技能）；③ **Wiki 内容代理**（`/$wiki/*`）；④ **Raw 内容代理**（`/$raw/*`）；另含 `/$healthz` 健康检查探活（dev-fast.mjs 专用）。**API 调试工具（`/$debug`）为纯前端路由**（App.tsx lazy 页，worker 不参与、无鉴权）。

## 架构约束（红线）

- `client_secret` **只允许**存 Worker 环境变量/Secret，禁止出现在前端与仓库
- access token 由 Worker 换取后存 **KV**（键 = 会话 id）；前端经 `/$auth/session` 取回 token 存内存
- httpOnly cookie 只存**会话 id**（非 token 本身）；**不写 localStorage 明文**
- GitHub OAuth 无 refresh token：token 被撤销/过期 → 需重新登录（**token 本身永不过期**，KV 会话 TTL 7 天仅防会话滞留/死键膨胀）

## 环境变量（`worker/wrangler.jsonc`，本地覆盖 `.dev.vars`）

| 变量 | 说明 | 类型 |
|------|------|------|
| `GITHUB_CLIENT_ID` | OAuth App Client ID | 普通 |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret | **Secret** |
| `GITHUB_OAUTH_CALLBACK` | 回调地址（`https://<域名>/$auth/callback`） | 普通 |
| `FRONTEND_URL` | 前端域名（CORS 白名单） | 普通 |
| `SESSION_COOKIE_NAME` | 会话 cookie 名（如 `puregit_session`） | 普通 |
| `PROXY_ALLOW_ANON` | `/$wiki`/`/$raw` 匿名闸：`"false"` 强制登录，默认允许匿名 | 普通 |
| ~~`DEBUG_ROUTE_ENABLE`~~ | **已删除**：`/$debug` 为纯前端路由（worker 不参与），调试工具无后端鉴权——前端复用主站会话 token 直连 api.github.com，权限继承主站 session | — |

## 端点设计

| 端点 | 方法 | 行为 |
|------|------|------|
| `/$auth/login` | GET | 302 跳转 GitHub 授权页（scope 按 mode：只读 `repo read:org read:user user:email read:public_key read:gpg_key` / 完全控制 `repo admin:org user gist admin:public_key delete_repo workflow notifications admin:gpg_key`） |
| `/$auth/callback` | GET | 校验 `code` → POST github token 端点换取 token → 存 KV（新会话 id，TTL 7 天）→ 下发 httpOnly cookie → 302 回前端 |
| `/$auth/pat` | POST | **PAT 直接登录**：body `{ pat, deviceId? }` → `GET /user`（Bearer PAT）验证 + 读 `X-OAuth-Scopes` 推断读写 → 存 KV（`authMethod: "pat"`）→ 下发 httpOnly cookie → 返回 `{ token, user, scopes, grantedScopes, expiresAt }`。GitHub 主站受限时绕过 OAuth 授权页；PAT 只存 KV（服务端），前端不落 localStorage |
| `/$auth/session` | GET | 读 cookie → 查 KV 取 token → 返回 `{ token, user, scopes, grantedScopes, expiresAt }`（供前端恢复内存令牌；`lastSeenAt` 节流 ≥1h 更新） |
| `/$auth/session` | **POST** | **补全用户元数据**：OAuth 回调网络受限时 `/user` 降级（login/userId 空）→ 前端补全后写回 KV。body `{ login, userId, avatarUrl }`；**worker 用会话 token 请求 `GET /user` 验证声称身份与真实一致才写回**，不一致 403 `identity_mismatch`（防任意登录用户冒充任意 userId）；仅补缺省不覆盖 |
| `/$healthz` | GET | 健康检查探活：无条件轻量 JSON `{ ok, service, ts }`，无业务逻辑（dev-fast.mjs 探活专用，防误判 worker 卡死） |
| `/$auth/logout` | POST | 删除 KV 键 + 清除 cookie → 前端清内存令牌 |
| `/$auth/sessions` | GET | 当前用户全部会话**元数据**（含 isCurrent，**绝不返回 token**） |
| `/$auth/sessions/:id/logout` | POST | 本地登出指定设备——仅删 KV 会话（GitHub 端授权保留）；登出当前设备顺带清 cookie |
| `/$auth/revoke` | POST | **危险区**：GitHub 端真撤销——`DELETE /applications/{client_id}/token`（Basic Auth，Worker 侧）→ 删该用户全部本地 KV 会话 + 清 cookie（所有设备立即退出） |
| `/$auth/prefs` | POST/GET | 偏好云同步（localStorage 偏好 → KV `prefs:{userId}` 跨设备恢复；键用数字 ID——改名/换登录名不变，旧 login 键读时兼容；白名单 theme/lang/codeTheme/apiMode/dateFormat） |

## KV 绑定

- namespace 名：`SESSIONS`（`wrangler.jsonc` 绑定），键：`session:<会话id>`，值：`SessionData`（token/login/mode/scopes/grantedScopes/authMethod/deviceId/ua/ip/createdAt/lastSeenAt）
- TTL：**7 天**（安全收紧：GitHub OAuth App token 本身永不过期，同设备 7 天内免重新授权）

## OAuth 流程要点

1. **登录**：`/$auth/login` 拼接 GitHub 授权 URL（scope 两档见上，`state` 防 CSRF 经 KV 短期键）
2. **回调**：`/$auth/callback?code=...&state=...` → 校验 state → POST `https://github.com/login/oauth/access_token`（`Accept: application/json`）换取 `access_token`；记录真实授予 `grantedScopes`（token 响应 `scope` 字段）
3. **PAT 登录**（`/$auth/pat`）：GitHub 主站（github.com）受限时 OAuth 授权页不可达，但 api.github.com 可达——前端登录框可粘贴 PAT 直接登录。Worker 用 PAT 调 `GET /user` 验证（Bearer），读 `X-OAuth-Scopes` 头（classic PAT 返回，逗号分隔）推断 mode（含 `admin:org/user/gist/admin:public_key/delete_repo/workflow/notifications/admin:gpg_key` 任一 → write，否则 read）；**fine-grained PAT 不返回该头 → 保守判 read**。PAT 存 KV 会话（等效 OAuth token），httpOnly cookie 仅会话 id；响应 `token` 字段即 PAT 本身（前端调用 API 需要），与 OAuth token 同等对待；登出即删 KV（PAT 随之移除）
4. **恢复**：前端启动调 `/$auth/session`；403/无效 → 前端引导重新登录
5. **登出**：删除 KV 键与 cookie（本地登出仅删 KV；危险区 revoke 才撤销 GitHub 端授权）

## 会话元数据

- `SessionData.authMethod?: "oauth" | "pat"`（旧会话缺失 = oauth）；`grantedScopes?: string[]`（真实授予，兼容逗号/空格分隔）；`deviceId/ua/ip/createdAt/lastSeenAt`（会话列表展示）；前端会话列表为 PAT 会话显示 PAT 徽标

## 安全注意

- CORS：`corsHeaders(env.FRONTEND_URL)`（同域部署可简化，见 architecture.md）
- cookie 属性：`HttpOnly; SameSite=Lax; Secure`（生产强制）
- 前端鉴权失败（401/403）统一走登录引导
- 系统路由优先级：`/$auth` → `/$wiki`/`/$raw`/`/$healthz`（含匿名闸）→ git → SPA fallback（`$` 前缀永不被用户路由占用）；**`/$debug` 为纯前端路由，worker 不参与**
