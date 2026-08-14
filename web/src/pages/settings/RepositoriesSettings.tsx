/**
 * 账户设置 —— 仓库管理
 *
 * 可管理仓库列表（自己 + 自己所属组织）：GraphQL viewer.repositories 首选 + REST /user/repos 降级。
 * 聚焦管理：名称/可见性 + 设置入口（浏览信息见用户级 All repos 页，不重复）。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings, GitBranch } from "lucide-react";
import { RepoVisibilityBadge } from "@/components/RepoVisibilityBadge";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/WriteGate";
import { Tip } from "@/components/Tip";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { fetchMyReposSmart, apiErrorMessage, type Repository } from "@/lib/api";
import { updateDefaultBranch } from "@/lib/restapi";

/** KB → 人类可读大小（官方显示 532 KB / 12.5 MB 风格） */
function formatSize(kb?: number): string | null {
  if (kb === undefined || kb === null) return null;
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

export default function RepositoriesSettings() {
  const { token, user, canWrite } = useAuth();
  const { t } = useI18n();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 默认分支名（官方 Repository default branch）
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [branchSaved, setBranchSaved] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchMyReposSmart(token)
      .then((r) => !cancelled && setRepos(r.repos))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 默认分支名保存（官方 Repository default branch：PATCH /user master_branch）
  const saveBranch = async () => {
    if (!token || branchSaving || !defaultBranch.trim()) return;
    setBranchSaving(true);
    setBranchSaved(false);
    setError(null);
    try {
      await updateDefaultBranch(token, defaultBranch.trim());
      setBranchSaved(true);
      setTimeout(() => setBranchSaved(false), 3000);
    } catch (e) {
      setError(apiErrorMessage(e, "更新默认分支失败"));
    } finally {
      setBranchSaving(false);
    }
  };

  // 可管理 = 自己拥有（组织仓库已移至组织设置页单独管理）
  const canManageRepo = (r: Repository) => {
    const l = user?.login;
    return Boolean(l && r.owner.login === l);
  };

  // 个人仓库 = owner 为当前登录用户（组织仓库已移除，见组织设置 /organizations/:org/settings/repositories）
  const login = user?.login;
  const personalRepos = (repos ?? []).filter((r) => r.owner.login === login);

  return (
    <div className="flex flex-col gap-8">
      {error && <InlineError message={t("common.loadFailed").replace("{error}", error)} />}

      {/* 默认分支名（官方 Repository default branch region） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("reposSettings.defaultBranch")}</h2>
          <p className="text-sm text-muted-foreground">{t("reposSettings.defaultBranchHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder={t("reposSettings.defaultBranchPlaceholder")}
            disabled={!canWrite}
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && void saveBranch()}
          />
          <PermissionGate>
            <Button
              onClick={() => void saveBranch()}
              disabled={branchSaving || !defaultBranch.trim() || !canWrite}
            >
              {branchSaving ? t("common.saving") : t("reposSettings.update")}
            </Button>
          </PermissionGate>
        </div>
        {branchSaved && <p className="text-sm text-chart-1">{t("reposSettings.branchSaved")}</p>}
      </section>

      {/* 仓库列表（仅个人仓库——组织仓库已移至组织设置页单独管理） */}
      {repos !== null && (
        <div className="flex flex-col gap-6">
          {/* 个人仓库卡片 */}
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("reposSettings.personal")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("reposSettings.repoCount").replace("{count}", String(personalRepos.length))}
              </p>
            </div>
            <RepoCard
              repos={personalRepos}
              loading={repos === null}
              canManageRepo={canManageRepo}
              emptyText={t("reposSettings.personalEmpty")}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** 仓库卡片（列表行：名称 + Private 徽章 + 描述 + 大小 + 设置按钮） */
function RepoCard({
  repos,
  loading,
  canManageRepo,
  emptyText,
}: {
  repos: Repository[];
  loading: boolean;
  canManageRepo: (r: Repository) => boolean;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (repos.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {repos.map((r) => (
        <div key={r.full_name} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50">
          <div className="min-w-0 flex-1">
            <Link to={`/${r.full_name}`} className="font-medium hover:underline">
              {r.name}
            </Link>
            {/* 状态徽章（私有/归档，i18n；公开不显示） */}
            <RepoVisibilityBadge repo={r} />
            {r.description && (
              <p className="truncate text-sm text-muted-foreground">{r.description}</p>
            )}
            {formatSize(r.size) && (
              <p className="text-xs text-muted-foreground">{formatSize(r.size)}</p>
            )}
          </div>
          {/* 设置入口：可管理（自己/自己组织）→ 有写权限可点；否则置灰 */}
          {canManageRepo(r) ? (
            <PermissionGate>
              <Button variant="ghost" className="gap-1" asChild>
                <Link to={`/${r.owner.login}/${r.name}/settings`}>
                  <Settings className="size-3.5" />
                  设置
                </Link>
              </Button>
            </PermissionGate>
          ) : (
            <Tip label="仅仓库所有者可设置">
              <span className="inline-flex cursor-not-allowed opacity-40">
                <Button variant="ghost" className="gap-1" disabled>
                  <Settings className="size-3.5" />
                  设置
                </Button>
              </span>
            </Tip>
          )}
        </div>
      ))}
    </div>
  );
}
