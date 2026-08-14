/**
 * 仓库级权限派生 hook（基于 repo context 的 viewer_permission）
 *
 * GitHub 对每个仓库给当前登录用户一个权限级：ADMIN > MAINTAIN > WRITE > TRIAGE > READ。
 * 本项目以「三档」粒度在 UI 层区分：
 * - canCollaborate（TRIAGE 及以上）：可编辑 issue/PR 元数据（标签/指派/里程碑）、锁定、评审、关闭/重开
 * - canWrite（WRITE 及以上）：可新建/编辑/删除文件、请求评审
 * - canAdmin（ADMIN）：可进仓库设置
 *
 * 与令牌级 canWrite（useAuth，登录 scope 是否「完全控制」）互补：
 * 写操作需同时满足「令牌有写 scope」+「本仓库权限够高」；本 hook 仅承担后者。
 * 匿名/未登录（viewer_permission 为 null）→ 三档全 false（写操作按钮隐藏，只读浏览）。
 */
import { useRepoData } from "@/lib/repo/repo-context";
import type { RepoPermission } from "@/lib/restapi";

/** 权限级别排序（用于比较高低） */
const ORDER: RepoPermission[] = ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"];

/** 权限级 → 序号（null/未知 → -1，低于 READ） */
function rank(p: RepoPermission | null | undefined): number {
  return p ? ORDER.indexOf(p) : -1;
}

export interface RepoPermissionState {
  /** 仓库级权限（null = 匿名/未登录/未知） */
  permission: RepoPermission | null;
  /** 协作权限（TRIAGE 及以上） */
  canCollaborate: boolean;
  /** 写权限（WRITE 及以上） */
  canWrite: boolean;
  /** 管理权限（ADMIN） */
  canAdmin: boolean;
}

/** 派生当前登录用户对当前仓库的权限三档布尔（供写操作 UI 门控） */
export function useRepoPermission(): RepoPermissionState {
  const data = useRepoData();
  const permission = data?.viewer_permission ?? null;
  return {
    permission,
    canCollaborate: rank(permission) >= rank("TRIAGE"),
    canWrite: rank(permission) >= rank("WRITE"),
    canAdmin: rank(permission) >= rank("ADMIN"),
  };
}
