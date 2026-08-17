/**
 * Code 首页（/:owner/:repo，自 RepoCode.tsx 拆出）
 *
 * GitHub 风格：归档横幅 + fork 信息条 + 最近推送提示条 + 根目录视图（操作栏 + 根文件列表 + README）。
 * 根目录渲染（操作栏/文件列表/README）复用 RepoCode 导出的 RepoRootView，与 TreePage 分支根一致。
 */
import { useRepoData } from "@/lib/repo/repo-context";
import { ForkInfoBar } from "@/components/ForkInfoBar";
import { RecentPushesBanner } from "@/components/RecentPushesBanner";
import { RepoRootView } from "./RepoCode";

export default function CodeIndex() {
  const repoData = useRepoData();
  const branch = repoData?.default_branch ?? "main";

  return (
    <div>
      {/* fork 对照信息条（仅 fork 仓库；官方 BranchInfoBar） */}
      <ForkInfoBar />
      {/* 最近推送分支提示条（官方 Recently touched branches；仅登录 + 14 天内非默认分支） */}
      <RecentPushesBanner />
      {/* 根目录视图：操作栏（分支/Go to file/Code）+ 根文件列表 + README */}
      <RepoRootView branch={branch} />
    </div>
  );
}
