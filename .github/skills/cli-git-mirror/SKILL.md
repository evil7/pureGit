---
name: cli-git-mirror
description: "Use when: 开发 PureGit 的 git 镜像端点自动代理——clone/pull/push 转发、info/refs、upload-pack、receive-pack、git 智能 HTTP 协议、insteadOf 配置。触发词：git、clone、pull、push、镜像、proxy、insteadOf、mirror"
argument-hint: "需要实现/调试哪个 CLI 代理端点或协议细节"
---

# CLI git 镜像端点自动代理

Worker 职责之一：将 git CLI 流量**自动代理**转发到 GitHub。用户通过 `insteadOf` 接入，无需安装额外客户端。

## 用户接入

```bash
git config --global url.https://<worker域名>/.insteadOf https://github.com/
```

## git 智能 HTTP 协议

| 请求 | 说明 |
|------|------|
| `GET /<owner>/<repo>.git/info/refs?service=git-upload-pack` | fetch/clone 第一步 |
| `GET /<owner>/<repo>.git/info/refs?service=git-receive-pack` | push 第一步 |
| `POST /<owner>/<repo>.git/git-upload-pack` | fetch 数据 |
| `POST /<owner>/<repo>.git/git-receive-pack` | push 数据 |

## 转发要点

1. 路径重写：替换 host 为 `github.com`，转发 `https://github.com<path>`
2. header 透传：Content-Type / Accept / User-Agent 按 git 协议要求；移除 Host / Content-Length 由 fetch 重算
3. 响应透传：保留 Content-Type / Content-Length 或 chunked
4. POST 体原样转发（`request.body` 直通）
5. 错误处理：404/403 透传 GitHub 状态码与 body

## 鉴权（push）

- git 凭据使用 **PAT**（URL 内嵌或 git credential）
- Worker 将 `Authorization: Basic <user:PAT>` 透传给 GitHub；只读公开仓库无需凭据
