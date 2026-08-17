/**
 * 仓库代码浏览路由路径解析（纯函数，供 RepoCode 与测试复用）
 *
 * 从路由 pathname 提取 tree/blob 段之后的当前文件/目录路径，
 * 供文件树高亮与面包屑使用；无匹配 → 空串 = 仓库根。
 */

/** 从路由 pathname 提取当前文件/目录路径（tree/blob 段；无匹配 → 空串 = 仓库根）
 * 历史实现：分支名假设为单段（不含 `/`）。分支名含 `/` 时分支段被误当路径——
 * 已被 resolveBranchPath（按分支列表最长前缀匹配）取代；本函数仅保留兼容旧调用。 */
export function parseTreePath(pathname: string): string {
  const match = pathname.match(/\/(?:tree|blob)\/[^/]+(?:\/(.+))?$/);
  return match?.[1] ?? "";
}

/**
 * 按分支列表解析 tree/blob splat 段 → { branch, path }（纯函数，供 useBranchPath 与测试复用）
 *
 * GitHub 分支名可含 `/`（如 fix/webfuzz-chunked-request-body-echo），URL 用字面斜杠：
 * `/owner/repo/tree/{branch}/{path}` 中 branch 与 path 的分界需按**已知分支列表最长前缀匹配**判定。
 * - 命中分支列表：取最长匹配分支为 branch，其余为 path
 * - 未命中（列表未加载/分支已删除）：退化为「首段 = branch」的旧行为
 * - 空 splat（仓库根）→ branch/path 均为空串，由调用方回退 default_branch
 */
export function resolveBranchPath(
  splat: string,
  branches: readonly string[],
): { branch: string; path: string } {
  if (!splat) return { branch: "", path: "" };
  let best: { branch: string; path: string } | null = null;
  for (const b of branches) {
    if (b && (splat === b || splat.startsWith(`${b}/`))) {
      if (!best || b.length > best.branch.length) {
        best = { branch: b, path: splat.slice(b.length).replace(/^\//, "") };
      }
    }
  }
  if (best) return best;
  const idx = splat.indexOf("/");
  return idx === -1
    ? { branch: splat, path: "" }
    : { branch: splat.slice(0, idx), path: splat.slice(idx + 1) };
}
