---
name: cli-git-mirror
description: "Use when: 开发 PureGit 的 git 镜像端点自动代理——clone/pull/push 转发、info/refs、upload-pack、receive-pack、git 智能 HTTP 协议、insteadOf 配置。触发词：git、clone、pull、push、镜像、proxy、insteadOf、mirror"
argument-hint: "需要实现/调试哪个 CLI 代理端点或协议细节"
---

# PureGit CLI git 镜像端点自动代理

Worker 的第二个职责：将 git CLI 流量**自动代理**转发到 GitHub。用户通过 `insteadOf` 接入，无需安装额外客户端。

## 用户接入方式

```bash
git config --global url.https://<worker域名>/.insteadOf https://github.com/
```

效果：`git clone https://github.com/owner/repo.git` 实际请求 `https://<worker域名>/owner/repo.git`。

## git 智能 HTTP 协议要点

代理端点必须正确处理以下请求：

| 请求 | 说明 |
|------|------|
| `GET /<owner>/<repo>.git/info/refs?service=git-upload-pack` | fetch/clone 的第一步，返回 refs（smart 协议） |
| `GET /<owner>/<repo>.git/info/refs?service=git-receive-pack` | push 的第一步 |
| `POST /<owner>/<repo>.git/git-upload-pack` | 发送 fetch 数据，body 为 `application/x-git-upload-pack-request` |
| `POST /<owner>/<repo>.git/git-receive-pack` | 发送 push 数据，body 为 `application/x-git-receive-pack-request` |

## 转发实现要点

1. **路径重写**：原样保留 path，替换 host 为 `github.com`，转发到 `https://github.com<path>`
2. **header 透传**：`Content-Type`、`Accept`、`User-Agent` 按 git 协议要求透传；移除 `Host`/`Content-Length` 由 fetch 重算
3. **响应透传**：保留 `Content-Type`（`application/x-git-upload-pack-result` 等）、`Content-Length` 或 chunked（`Transfer-Encoding`）
4. **请求数据**：POST 体须原样转发（`request.body` 直通）
5. **错误处理**：404 仓库不存在 / 403 无权限，透传 GitHub 状态码与 body

## 鉴权（push）

- git 凭据使用 **PAT**：用户配置 `git credential` 或 URL 内嵌 `https://<user>:<PAT>@<worker域名>/...`
- Worker 将 `Authorization: Basic <user:PAT>`（或从 URL 取凭据）透传给 GitHub
- 只读（clone/pull）可不带凭据（公开仓库）

## 调试清单

- [ ] `curl "<镜像>/owner/repo.git/info/refs?service=git-upload-pack"` 返回 refs 与 `Git-Protocol` 头
- [ ] clone 公开仓库成功
- [ ] push 带 PAT 成功；错误状态码透传正确
- [ ] 大仓库传输无截断（关注 chunked 与 Content-Length 一致性）
- [ ] `git ls-remote <镜像>/owner/repo.git` 可列出远程引用
