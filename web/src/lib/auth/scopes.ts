/**
 * 权限范围（scope）工具 —— 查漏补缺核心（仅读写二档权限分级）
 *
 * 背景：GitHub OAuth 用户可在授权页编辑/少授 scope（官方文档明示），
 * 且 GitHub 会规范化 scope（隐含子 scope 被丢弃，如请求 `user,user:email` 只存 `user`）。
 * 因此「所需 vs 已授」比对必须做**隐含等价判断**，不能字符串精确匹配。
 *
 * 依据：GitHub Scopes for OAuth apps（官方文档核对）——
 *   - `repo` 已涵盖仓库 projects（含 Projects v2 GraphQL 访问）、私有库、hooks 等
 *   - `admin:X` ⊇ `write:X` ⊇ `read:X`；`user` ⊇ `read:user`/`user:email`/`user:follow`
 *   - `admin:org` ⊇ `write:org` ⊇ `read:org`
 *
 * 本项目所需 scope 集合（与 worker/src/auth.ts buildGitHubScope 保持一致）：
 *   read 模式：repo read:org read:user user:email read:public_key read:gpg_key
 *   write 模式：repo admin:org user gist admin:public_key delete_repo workflow notifications admin:gpg_key
 */

/** 各模式所需 scope 集合（查漏补缺基准；与 worker buildGitHubScope 同步维护） */
export const REQUIRED_SCOPES: Record<"read" | "write", string[]> = {
  read: [
    "repo", // 私有库 + 代码读写
    "read:org", // 组织信息只读
    "read:user", // 用户资料只读
    "user:email", // 邮箱只读
    "read:public_key", // SSH keys 只读
    "read:gpg_key", // GPG keys 只读
    "read:project", // Projects v2 只读（实测 GraphQL 强制要求，repo 不涵盖）
  ],
  write: [
    "repo", // 仓库全权
    "admin:org", // 组织全权（隐含 read:org）
    "user", // 资料读写（隐含 read:user/user:email/user:follow）
    "gist", // Gist 创建/编辑
    "admin:public_key", // SSH keys 完整管理
    "delete_repo", // 删除仓库
    "workflow", // 编辑 Actions workflow 文件
    "notifications", // 通知已读/订阅
    "admin:gpg_key", // GPG keys 完整管理
    "project", // Projects v2 读写（实测 GraphQL 强制要求）
  ],
};

/** 管理层级前缀（admin:X ⊇ write:X ⊇ read:X） */
const ADMIN_LEVELS = ["admin", "write", "read"] as const;

/** 父 scope → 隐含子 scope 集合（GitHub normalized scopes 等价关系） */
const IMPLIES: Record<string, readonly string[]> = {
  admin: [], // 占位（由 ADMIN_LEVELS 通用规则处理）
  write: [],
  read: [],
  user: ["read:user", "user:email", "user:follow"],
  admin_org: ["write:org", "read:org"],
  write_org: ["read:org"],
  admin_public_key: ["write:public_key", "read:public_key"],
  write_public_key: ["read:public_key"],
  admin_gpg_key: ["write:gpg_key", "read:gpg_key"],
  write_gpg_key: ["read:gpg_key"],
  admin_repo_hook: ["write:repo_hook", "read:repo_hook"],
  write_repo_hook: ["read:repo_hook"],
  repo: ["repo:status", "repo_deployment", "public_repo", "repo:invite"],
  // ⚠️ 注意：repo 不涵盖 read:project/project！（实测 GraphQL projectsV2 字段
  // 强制要求 read:project/project scope（官方 scopes 文档虽称 repo 含 projects，但运行时强制）
};

/** 单个 granted scope 是否满足 required scope（隐含等价） */
function scopeCovers(granted: string, required: string): boolean {
  if (granted === required) return true;
  // admin:X ⊇ write:X ⊇ read:X
  const [gKind, gArea] = granted.split(":");
  const [rKind, rArea] = required.split(":");
  if (gArea && rArea && gArea === rArea) {
    const gi = ADMIN_LEVELS.indexOf(gKind as (typeof ADMIN_LEVELS)[number]);
    const ri = ADMIN_LEVELS.indexOf(rKind as (typeof ADMIN_LEVELS)[number]);
    if (gi !== -1 && ri !== -1 && gi <= ri) return true;
  }
  // 父 scope 隐含子 scope（user / repo / 各管理域）
  const subs = IMPLIES[granted] ?? [];
  if (subs.includes(required)) return true;
  // 再深一层（admin:org 隐含 write:org 隐含 read:org 已由通用规则覆盖；这里处理 write:org → read:org 特例）
  for (const s of subs) {
    if (scopeCovers(s, required)) return true;
  }
  return false;
}

/**
 * 计算缺失 scope 列表（granted 相对 required 中不满足的项，已做隐含等价）
 * @param granted 已授予 scope（null/undefined → 视为全部缺失，调用方决定）
 * @param required 所需 scope 集合（默认按 mode）
 */
export function computeMissingScopes(
  granted: string[] | null | undefined,
  mode: "read" | "write",
): string[] {
  if (!granted || granted.length === 0) return [...REQUIRED_SCOPES[mode]];
  return REQUIRED_SCOPES[mode].filter((r) => !granted.some((g) => scopeCovers(g, r)));
}

import i18n from "@/i18n";

/** 缺失 scope 的人类可读描述（用于提示条；经 i18n 翻译，未知 scope 回退原名） */
export function describeScopes(scopes: string[]): string {
  const keys: Record<string, string> = {
    repo: "scopes.repo",
    "read:org": "scopes.readOrg",
    "read:user": "scopes.readUser",
    "user:email": "scopes.userEmail",
    "read:public_key": "scopes.readPublicKey",
    "read:gpg_key": "scopes.readGpgKey",
    "admin:org": "scopes.adminOrg",
    user: "scopes.user",
    gist: "scopes.gist",
    "admin:public_key": "scopes.adminPublicKey",
    delete_repo: "scopes.deleteRepo",
    workflow: "scopes.workflow",
    notifications: "scopes.notifications",
    "admin:gpg_key": "scopes.adminGpgKey",
    "read:project": "scopes.readProject",
    project: "scopes.project",
  };
  return scopes.map((s) => (keys[s] ? i18n.t(keys[s]) : s)).join("、");
}
