/**
 * NeedFork 占位提示（非本人仓库的编辑/新建/删除直接访问时展示）
 *
 * 官方语义：无权限用户访问编辑页 → 引导先 fork。本组件仅做**简单提示语句**
 * （2026-08-14 用户要求：不做复杂交互）——fork 操作统一跳官方 fork 复刻页
 * （/:owner/:repo/fork：选择本人/组织、改名、是否仅复制默认分支）。
 *
 * 用法：
 * <NeedFork owner={owner} action="编辑" />
 */
import { GitFork } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NeedFork({
  owner,
  action = "编辑",
}: {
  /** 仓库 owner（提示语中展示） */
  owner: string;
  /** 被拦截的操作名（编辑/新建/删除） */
  action?: string;
}) {
  const { repo = "" } = useParams();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <GitFork className="size-7 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold">需要先 Fork 仓库</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          你正在操作 <span className="font-medium text-foreground">{owner}</span>{" "}
          的仓库——非本人管理的项目不能直接{action}文件。请先 Fork 该仓库，在 fork 副本中完成{action}
          后，通过 Pull Request 将改动提交回原仓库。
        </p>
      </div>
      {/* 简单引导：跳转官方 fork 复刻页（选择目标/改名/是否仅复制默认分支） */}
      <Button variant="outline" onClick={() => navigate(`/${owner}/${repo}/fork`)}>
        如何 Fork？进入 Fork 页面
      </Button>
    </div>
  );
}
