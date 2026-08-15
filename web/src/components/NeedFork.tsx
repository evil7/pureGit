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
import { useI18n } from "@/i18n";

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
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <GitFork className="size-7 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold">{t("fork.needTitle")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("fork.needDesc", { owner, action })}
        </p>
      </div>
      {/* 简单引导：跳转官方 fork 复刻页（选择目标/改名/是否仅复制默认分支） */}
      <Button variant="outline" onClick={() => navigate(`/${owner}/${repo}/fork`)}>
        {t("fork.howTo")}
      </Button>
    </div>
  );
}
