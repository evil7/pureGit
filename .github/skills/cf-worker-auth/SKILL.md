---
name: cf-worker-auth
description: "Use when: 开发 PureGit 的 Cloudflare Pages Worker 鉴权——GitHub OAuth2 登录、/$auth 端点、KV 会话、token 恢复/登出、client_secret 安全。触发词：oauth、auth、worker、KV、cookie、token、登录"
argument-hint: "需要实现/修改哪个鉴权端点或会话逻辑"
---

# Worker OAuth2 令牌管理

> Worker 四职责之一（详见 `docs/architecture.md`）：OAuth2 令牌管理；其余三件（CLI git 代理 / wiki 代理 / raw 代理）+ 探活见对应 skill/文档。

## 安全红线

- `client_secret` **只允许**存 Worker 环境变量/Secret，禁止出现在前端与仓库
- access token 由 Worker 换取后存 **KV**（键 = 会话 id）；前端经 `/$auth/session` 取回 token 存**内存**
- httpOnly cookie 只存**会话 id**（非 token 本身）；**不写 localStorage 明文**
- GitHub OAuth 无 refresh token：token 被撤销/过期 → 重新登录

## 端点概览（`/$auth/*`）

| 端点 | 行为 |
|------|------|
| `/$auth/login` | 302 跳转 GitHub 授权页（scope 按 mode 分只读/完全控制两档） |
| `/$auth/callback` | 校验 code → 换 token → 存 KV → 下发 httpOnly cookie → 回前端 |
| `/$auth/pat` | **PAT 直接登录**（GitHub 主站受限时绕过授权页；PAT 验证后存 KV + cookie） |
| `/$auth/session` | GET 恢复 token / POST 补全用户元数据（token 验证防伪造） |
| `/$auth/logout` | 删除 KV 键 + 清 cookie |
| `/$auth/sessions` | 会话列表（元数据，绝不返回 token） |
| `/$auth/revoke` | 撤销 GitHub 端授权（危险区） |

## OAuth 流程要点

1. 登录：拼接授权 URL（scope 两档，`state` 防 CSRF）
2. 回调：校验 state → POST token 端点换取 access_token
3. PAT 登录：用 PAT 调 `GET /user` 验证（读 `X-OAuth-Scopes` 推断读写；fine-grained PAT 无此头 → 保守判只读）
4. 恢复：前端启动调 `/$auth/session`；无效 → 引导重新登录
5. 登出：删 KV + cookie（revoke 才撤销 GitHub 端授权）

## 会话与安全

- KV 会话 TTL 有限期（token 本身永不过期，仅 GitHub 端撤销才失效）
- cookie 属性：`HttpOnly; SameSite=Lax; Secure`（生产强制）
- 系统路由优先级：`/$auth` → `/$wiki`/`/$raw`/`/$healthz` → git → SPA fallback；`$` 前缀永不被用户路由占用
