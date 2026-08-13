/**
 * Code 首页（/:owner/:repo，自 RepoCode.tsx 拆出）
 *
 * GitHub 风格：归档横幅 + fork 信息条 + 最近推送提示条 + 操作栏（分支/Go to file/Code 克隆）
 * + 根文件列表 + README（全宽）。共享组件（RepoActionBar/FileList）自 RepoCode 导入。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CornerDownRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useRepoData } from "@/lib/repo/repo-context";
import { fetchReadmeSmart, fetchDirContentsSmart } from "@/lib/api";
import type { ReadmeInfo, DirEntry } from "@/lib/restapi";
import { ArchivedBanner } from "@/components/ArchivedBanner";
import { ForkInfoBar } from "@/components/ForkInfoBar";
import { RecentPushesBanner } from "@/components/RecentPushesBanner";
import { MarkdownView } from "@/components/MarkdownView";
import { RepoActionBar, FileList } from "./RepoCode";

export default function CodeIndex() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const repoData = useRepoData();
  const branch = repoData?.default_branch ?? "main";
  const [readme, setReadme] = useState<ReadmeInfo | null>(null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchReadmeSmart(owner, repo, token).catch(() => null),
      fetchDirContentsSmart(owner, repo, "", branch, token).catch(() => []),
    ]).then(([r, es]) => {
      if (cancelled) return;
      setReadme(r);
      setEntries(es);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  return (
    <div>
      {/* 归档仓库横幅（最顶；官方 archived 黄色条） */}
      <ArchivedBanner archivedAt={repoData?.archived_at} />
      {/* fork 对照信息条（仅 fork 仓库；官方 BranchInfoBar） */}
      <ForkInfoBar />
      {/* 最近推送分支提示条（官方 Recently touched branches；仅登录 + 14 天内非默认分支） */}
      <RecentPushesBanner />
      <RepoActionBar branch={branch} />
      {entries === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <FileList entries={entries} branch={branch} path="" />
      )}

      {readme && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CornerDownRight className="size-4" />
            README.md
          </div>
          <Card>
            {/*：边距对齐单文件 README（p-8，官方 markdown-body padding） */}
            <CardContent className="p-8">
              <MarkdownView rawBase={readme.rawBase}>{readme.content}</MarkdownView>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
