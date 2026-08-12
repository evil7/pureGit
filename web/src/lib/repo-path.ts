/**
 * 仓库代码浏览路由路径解析（纯函数，供 RepoCode 与测试复用）
 *
 * 从路由 pathname 提取 tree/blob 段之后的当前文件/目录路径，
 * 供文件树高亮与面包屑使用；无匹配 → 空串 = 仓库根。
 */

/** 从路由 pathname 提取当前文件/目录路径（tree/blob 段；无匹配 → 空串 = 仓库根） */
export function parseTreePath(pathname: string): string {
  const match = pathname.match(/\/(?:tree|blob)\/[^/]+(?:\/(.+))?$/);
  return match?.[1] ?? "";
}
