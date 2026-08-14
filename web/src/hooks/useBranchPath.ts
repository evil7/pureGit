/**
 * tree/blob 路由分支解析 hook
 *
 * 背景：tree/blob 路由改为 splat（tree/*、blob/*），因为 GitHub 分支名可含 `/`
 * （如 fix/webfuzz-chunked-request-body-echo），单段 :branch 参数会把分支误拆成「分支+路径」。
 * 本 hook 拉取分支列表后，用 resolveBranchPath 按**最长前缀匹配**拆出 branch 与 path。
 *
 * 返回：
 * - branch：解析出的分支名（splat 为空时回退 default_branch）
 * - path：分支之后相对仓库根的文件/目录路径
 * - branches：已拉取的分支名列表（供 BranchPicker 等复用，避免重复请求；octokit 层已去重缓存）
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRepoData } from "@/lib/repo/repo-context";
import { resolveBranchPath } from "@/lib/repo/repo-path";
import { fetchBranchesSmart } from "@/lib/api";

export function useBranchPath(): {
  branch: string;
  path: string;
  branches: string[];
} {
  const { owner = "", repo = "", "*": splat = "" } = useParams();
  const { token } = useAuth();
  const repoData = useRepoData();
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchBranchesSmart(owner, repo, token)
      .then((bs) => !cancelled && setBranches(bs.map((b) => b.name)))
      .catch(() => !cancelled && setBranches([]));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  const { branch, path } = resolveBranchPath(splat, branches);
  return {
    branch: branch || repoData?.default_branch || "main",
    path,
    branches,
  };
}
