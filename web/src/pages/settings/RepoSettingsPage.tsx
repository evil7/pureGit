/**
 * 仓库设置页（官方 github.com/:owner/:repo/settings 同路径）
 *
 * 路径：/:owner/:repo/settings（官方 github.com/owner/repo/settings 同路径）
 * - 基本信息编辑（描述/首页/默认分支，PATCH /repos/{owner}/{repo}）
 * - 危险区：归档/迁移/删除仓库（官方 Danger Zone 语义）
 * 注意：仅仓库所有者/管理员可编辑（写操作 403 时提示）。
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { updateRepository, deleteRepositorySmart, apiErrorMessage } from "@/lib/api";
import {
  fetchRepoTopicsSmart,
  replaceRepoTopicsSmart,
  transferRepository,
  type Repository,
} from "@/lib/api";
import { useRepoData, useRepoUpdate } from "@/lib/repo-context";
import { WriteGate } from "@/components/WriteGate";

export default function RepoSettingsPage() {
  // URL 参数：/:owner/:repo/settings（RepoLayout 提供 owner/repo）
  const { owner = "", repo: repoName = "" } = useParams();
  const { token, canWrite, user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  // RepoLayout 的 fetchRepositorySmart（GraphQL 首选）已把仓库数据放 context，
  // 直接消费即可，避免重复拉取同端点（原动态 import REST fetchRepository）
  const repoData = useRepoData();
  const updateRepo = useRepoUpdate();

  // 路由级权限：仅仓库所有者可访问设置（与 RepoHeader 的 Settings tab 显示条件一致）。
  // 即使直接输入 URL 也拦截，防止非 owner 看到设置表单（写操作本就 403，但页面不该呈现）
  const isOwner = Boolean(token && repoData && user && repoData.owner.login === user.login);

  const [repo, setRepo] = useState<{
    name: string;
    full_name: string;
    description: string | null;
    homepage: string | null;
    default_branch: string;
    private: boolean;
    archived: boolean;
  } | null>(null);
  // General 区仓库名（官方最新布局：可编辑输入框，随保存提交 PATCH name）
  const [renameName, setRenameName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  // topics（逗号分隔输入）；归档状态（危险区）
  const [topicsText, setTopicsText] = useState("");
  const [archived, setArchived] = useState(false);
  // 私有化/公开（危险区第一项，官方 Change repository visibility；3 步确认 dialog）
  const [isPrivate, setIsPrivate] = useState(false);
  const [visOpen, setVisOpen] = useState(false);
  const [visStep, setVisStep] = useState(1); // 1 了解 → 2 阅读警告 → 3 确认
  const [visBusy, setVisBusy] = useState(false);
  // 归档（危险区，官方 Archive this repository；输入 owner/repo 确认）
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  // 删除（危险区，官方 Delete this repository；3 步确认 dialog）
  const [delOpen, setDelOpen] = useState(false);
  const [delStep, setDelStep] = useState(1); // 1 了解 → 2 阅读警告 → 3 输入确认
  // Features 开关（官方勾选即改，PATCH has_*）
  const [features, setFeatures] = useState({
    issues: true,
    discussions: false,
    wiki: true,
    projects: true,
  });
  const [featuresBusy, setFeaturesBusy] = useState(false);
  // 迁移仓库（危险区）
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNewOwner, setTransferNewOwner] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!token || !owner) return;
    let cancelled = false;
    // 仓库数据直接来自 RepoLayout context（GraphQL 首选，含 default_branch/archived），
    // 仅 topics 是单独端点需额外拉取
    if (repoData) {
      setRepo({
        name: repoData.name,
        full_name: repoData.full_name,
        description: repoData.description,
        homepage: repoData.homepage,
        default_branch: repoData.default_branch,
        private: repoData.private,
        archived: Boolean(repoData.archived),
      });
      setRenameName(repoData.name);
      setDescription(repoData.description ?? "");
      setHomepage(repoData.homepage ?? "");
      setDefaultBranch(repoData.default_branch);
      setArchived(Boolean(repoData.archived));
      setIsPrivate(Boolean(repoData.private));
      setFeatures({
        issues: repoData.has_issues ?? true,
        discussions: repoData.has_discussions ?? false,
        wiki: repoData.has_wiki ?? true,
        projects: repoData.has_projects ?? true,
      });
    }
    // topics（单独端点）
    fetchRepoTopicsSmart(owner, repoName, token)
      .then((names) => !cancelled && setTopicsText(names.join(", ")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, owner, repoName, repoData]);

  const save = async () => {
    if (!token || !owner || busy) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateRepository(owner, repoName, token, {
        name: renameName.trim() || undefined,
        description,
        homepage: homepage || undefined,
        default_branch: defaultBranch || undefined,
        archived,
      });
      // topics 单独端点（PUT /repos/{owner}/{repo}/topics，最多 20 个）
      const topics = topicsText
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);
      await replaceRepoTopicsSmart(owner, repoName, token, topics);
      setRepo({
        name: updated.name,
        full_name: updated.full_name,
        description: updated.description,
        homepage: updated.homepage,
        default_branch: updated.default_branch,
        private: updated.private,
        archived: Boolean(updated.archived),
      });
      // 改名后仓库 URL 变更 → 跳转新路径（官方保留旧路径重定向）
      if (updated.name !== repoName) {
        navigate(`/${owner}/${updated.name}/settings`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!token || !owner || deleteBusy) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteRepositorySmart(owner, repoName, token);
      // 删除后仓库不存在，回用户仓库管理页
      navigate("/settings/repositories");
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.deleteFailed")));
      setDeleteBusy(false);
    }
  };

  // 迁移仓库（危险区，官方 Transfer ownership；目标为组织需 admin:org）
  const transfer = async () => {
    if (!token || !owner || transferBusy || !transferNewOwner.trim()) return;
    setTransferBusy(true);
    setError(null);
    try {
      await transferRepository(owner, repoName, token, {
        new_owner: transferNewOwner.trim(),
      });
      setTransferOpen(false);
      setTransferNewOwner("");
      // 迁移后仓库归属新 owner，跳转到新路径
      navigate(`/${transferNewOwner.trim()}/${repoName}`);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.transferFailed")));
      setTransferBusy(false);
    }
  };

  // Features 开关（官方勾选即改：乐观更新 + PATCH has_*；失败回滚）
  const toggleFeature = async (key: keyof typeof features) => {
    if (!token || !owner || featuresBusy) return;
    setFeaturesBusy(true);
    setError(null);
    const prev = features[key];
    setFeatures((f) => ({ ...f, [key]: !f[key] }));
    try {
      const field = {
        issues: "has_issues",
        discussions: "has_discussions",
        wiki: "has_wiki",
        projects: "has_projects",
      }[key] as "has_issues" | "has_discussions" | "has_wiki" | "has_projects";
      await updateRepository(owner, repoName, token, { [field]: !prev });
      // 同步 context → RepoHeader tabs 立即反映（Issues/Discussions/Projects 显隐）
      updateRepo({ [field]: !prev } as Partial<Repository>);
    } catch (e) {
      setFeatures((f) => ({ ...f, [key]: prev }));
      setError(apiErrorMessage(e, t("repoSettings.features.failed")));
    } finally {
      setFeaturesBusy(false);
    }
  };

  // 归档（危险区，官方 Archive this repository；输入 owner/repo 确认后 PATCH archived）
  const confirmArchive = async () => {
    if (!token || !owner || archiveBusy) return;
    setArchiveBusy(true);
    setError(null);
    try {
      const updated = await updateRepository(owner, repoName, token, {
        archived: true,
      });
      setArchived(Boolean(updated.archived));
      setRepo((r) => (r ? { ...r, archived: Boolean(updated.archived) } : r));
      setArchiveOpen(false);
      setArchiveConfirm("");
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.archiveFailed")));
    } finally {
      setArchiveBusy(false);
    }
  };

  // 私有化/公开（危险区第一项，官方 Change repository visibility；3 步确认最后一步执行 PATCH private）
  const confirmVisibility = async () => {
    if (!token || !owner || visBusy) return;
    setVisBusy(true);
    setError(null);
    const next = !isPrivate;
    try {
      const updated = await updateRepository(owner, repoName, token, {
        private: next,
      });
      setIsPrivate(Boolean(updated.private));
      setRepo((r) => (r ? { ...r, private: Boolean(updated.private) } : r));
      // 同步 context → RepoHeader 的 Public/Private 徽标立即反映
      updateRepo({ private: Boolean(updated.private) } as Partial<Repository>);
      setVisOpen(false);
      setVisStep(1);
    } catch (e) {
      setError(
        apiErrorMessage(
          e,
          isPrivate ? t("repoSettings.makePublicFailed") : t("repoSettings.makePrivateFailed"),
        ),
      );
    } finally {
      setVisBusy(false);
    }
  };

  if (!token || !owner) {
    return <p className="text-sm text-muted-foreground">{t("repoSettings.loginFirst")}</p>;
  }

  // 非仓库所有者（直接输入 URL 访问别人的设置）→ 无权限提示
  if (!isOwner) {
    return <InlineError message={t("repoSettings.noAccess")} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <InlineError message={error} />}
      {saved && <p className="text-sm text-chart-1">{t("common.saved")}</p>}

      {/* 基本信息（官方 region，标题已去掉：表单直入主题） */}
      <section>
        <div className="flex flex-col gap-4">
          {repo ? (
            <>
              <div>
                <Label htmlFor="repoName" className="mb-1.5 block">
                  {t("repoSettings.repoName")}
                </Label>
                <Input
                  id="repoName"
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  disabled={!canWrite}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("repoSettings.repoNameHint")}
                </p>
              </div>
              <div>
                <Label htmlFor="desc" className="mb-1.5 block">
                  {t("repoSettings.desc")}
                </Label>
                <Input
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("repoSettings.placeholderDesc")}
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="homepage" className="mb-1.5 block">
                  {t("repoSettings.homepage")}
                </Label>
                <Input
                  id="homepage"
                  value={homepage}
                  onChange={(e) => setHomepage(e.target.value)}
                  placeholder="https://example.com"
                  disabled={!canWrite}
                />
              </div>
              <div>
                <Label htmlFor="branch" className="mb-1.5 block">
                  {t("repoSettings.defaultBranch")}
                </Label>
                <Input
                  id="branch"
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  disabled={!canWrite}
                />
              </div>
              {/* Topics（官方 topics 区；逗号分隔，最多 20 个） */}
              <div>
                <Label htmlFor="topics" className="mb-1.5 block">
                  Topics
                </Label>
                <Input
                  id="topics"
                  value={topicsText}
                  onChange={(e) => setTopicsText(e.target.value)}
                  placeholder={t("repoSettings.topics.placeholder")}
                  disabled={!canWrite}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("repoSettings.topics.hint")}
                </p>
              </div>
              <div>
                <WriteGate>
                  <Button onClick={() => void save()} disabled={busy || !canWrite}>
                    {busy ? t("common.saving") : t("common.save")}
                  </Button>
                </WriteGate>
              </div>
            </>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
      </section>

      {/* Features 开关（官方 Features 区：勾选即改） */}
      {repo && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.features")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.features.desc")}</p>
          </div>
          <FeatureSwitch
            label={t("repoSettings.features.issues")}
            desc={t("repoSettings.features.issues.desc")}
            checked={features.issues}
            disabled={featuresBusy || !canWrite}
            onToggle={() => void toggleFeature("issues")}
          />
          <FeatureSwitch
            label={t("repoSettings.features.discussions")}
            desc={t("repoSettings.features.discussions.desc")}
            checked={features.discussions}
            disabled={featuresBusy || !canWrite}
            onToggle={() => void toggleFeature("discussions")}
          />
          <FeatureSwitch
            label={t("repoSettings.features.wiki")}
            desc={t("repoSettings.features.wiki.desc")}
            checked={features.wiki}
            disabled={featuresBusy || !canWrite}
            onToggle={() => void toggleFeature("wiki")}
          />
          <FeatureSwitch
            label={t("repoSettings.features.projects")}
            desc={t("repoSettings.features.projects.desc")}
            checked={features.projects}
            disabled={featuresBusy || !canWrite}
            onToggle={() => void toggleFeature("projects")}
          />
        </section>
      )}

      {/* 危险区（官方 Danger Zone：Box.color-border-danger 红描边卡片 + Box-row 列表；
          条目顺序 Visibility → Transfer → Archive → Delete；全部 Button--danger 描边按钮） */}
      {repo && (
        <section>
          <div>
            <h2 className="text-lg font-semibold text-destructive">{t("repoSettings.danger")}</h2>
          </div>
          <div className="mt-3 rounded-lg border border-destructive/40">
            {/* Change repository visibility（官方第一项；描述动态显示当前状态） */}
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("repoSettings.visibility")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isPrivate
                    ? t("repoSettings.visibility.private")
                    : t("repoSettings.visibility.public")}
                </p>
              </div>
              <WriteGate>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive hover:text-white"
                  onClick={() => {
                    setVisStep(1);
                    setVisOpen(true);
                  }}
                  disabled={!canWrite}
                >
                  {t("repoSettings.visibilityButton")}
                </Button>
              </WriteGate>
            </div>

            {/* Transfer ownership（官方 Transfer；链接式 danger 按钮） */}
            <div className="flex items-start justify-between gap-4 border-t p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("repoSettings.transfer")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("repoSettings.transfer.desc")}
                </p>
              </div>
              <WriteGate>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive hover:text-white"
                  onClick={() => setTransferOpen(true)}
                  disabled={!canWrite}
                >
                  {t("repoSettings.transferButton")}
                </Button>
              </WriteGate>
            </div>

            {/* Archive this repository（官方 Archive；输入 owner/repo 确认） */}
            <div className="flex items-start justify-between gap-4 border-t p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("repoSettings.archive")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("repoSettings.archive.desc")}
                </p>
              </div>
              <WriteGate>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive hover:text-white"
                  onClick={() => {
                    setArchiveConfirm("");
                    setArchiveOpen(true);
                  }}
                  disabled={!canWrite || archived}
                >
                  {t("repoSettings.archiveButton")}
                </Button>
              </WriteGate>
            </div>

            {/* Delete this repository（官方 Delete；3 步确认） */}
            <div className="flex items-start justify-between gap-4 border-t p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("repoSettings.delete")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("repoSettings.delete.desc")}
                </p>
              </div>
              <WriteGate>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive hover:text-white"
                  onClick={() => {
                    setDelStep(1);
                    setDelOpen(true);
                  }}
                  disabled={!canWrite}
                >
                  {t("repoSettings.deleteButton")}
                </Button>
              </WriteGate>
            </div>
          </div>
        </section>
      )}

      {/* 危险区确认对话框（repo 加载后才渲染；官方多步确认） */}
      {repo && (
        <>
          {/* Change repository visibility（官方 3 步确认：了解 → 阅读警告 → 最终 danger 按钮） */}
          <AlertDialog open={visOpen} onOpenChange={setVisOpen}>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isPrivate
                    ? t("repoSettings.visDialog.title.public").replace("{name}", repo.full_name)
                    : t("repoSettings.visDialog.title.private").replace("{name}", repo.full_name)}
                </AlertDialogTitle>
              </AlertDialogHeader>

              {visStep === 1 && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-md border bg-muted/40 p-4 text-center">
                    <Lock className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-2 font-medium">{repo.full_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("repoSettings.visDialog.step1.stats")
                        .replace("{stars}", "0")
                        .replace("{watchers}", "0")}
                    </p>
                  </div>
                  <p className="text-muted-foreground">
                    {isPrivate
                      ? t("repoSettings.visDialog.step1.desc.public")
                      : t("repoSettings.visDialog.step1.desc.private")}
                  </p>
                </div>
              )}

              {visStep === 2 && (
                <div className="space-y-2 text-sm">
                  {(isPrivate
                    ? [
                        t("repoSettings.visDialog.step2.public.1"),
                        t("repoSettings.visDialog.step2.public.2"),
                        t("repoSettings.visDialog.step2.public.3"),
                        t("repoSettings.visDialog.step2.public.4"),
                        t("repoSettings.visDialog.step2.public.5"),
                      ]
                    : [
                        t("repoSettings.visDialog.step2.private.1"),
                        t("repoSettings.visDialog.step2.private.2"),
                        t("repoSettings.visDialog.step2.private.3"),
                        t("repoSettings.visDialog.step2.private.4"),
                      ]
                  ).map((w) => (
                    <div key={w} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                      <span className="text-muted-foreground">{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {visStep === 3 && (
                <p className="text-sm text-muted-foreground">
                  {isPrivate
                    ? t("repoSettings.visDialog.step3.desc.public")
                    : t("repoSettings.visDialog.step3.desc.private")}
                </p>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={visBusy}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant={visStep === 3 ? "destructive" : "default"}
                  disabled={visBusy}
                  onClick={(e) => {
                    if (visStep < 3) {
                      e.preventDefault();
                      setVisStep(visStep + 1);
                    } else {
                      void confirmVisibility();
                    }
                  }}
                >
                  {visBusy
                    ? t("repoSettings.visDialog.busy")
                    : visStep === 1
                      ? isPrivate
                        ? t("repoSettings.visDialog.btn.step1.public")
                        : t("repoSettings.visDialog.btn.step1.private")
                      : visStep === 2
                        ? t("repoSettings.visDialog.btn.step2")
                        : isPrivate
                          ? t("repoSettings.visDialog.btn.step3.public")
                          : t("repoSettings.visDialog.btn.step3.private")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Transfer ownership（官方 Transfer dialog：输入目标用户/组织） */}
          <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {t("repoSettings.transferDialog.title").replace("{name}", repoName)}
                </DialogTitle>
                <DialogDescription>{t("repoSettings.transferDialog.desc")}</DialogDescription>
              </DialogHeader>
              <Input
                value={transferNewOwner}
                onChange={(e) => setTransferNewOwner(e.target.value)}
                placeholder={t("repoSettings.transferDialog.placeholder")}
                autoFocus
              />
              <DialogFooter>
                <Button
                  variant="default"
                  disabled={transferBusy || !transferNewOwner.trim()}
                  onClick={() => void transfer()}
                >
                  {transferBusy
                    ? t("repoSettings.transferDialog.busy")
                    : t("repoSettings.transferDialog.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Archive this repository（官方 Archive dialog：警告 + 输入 owner/repo 确认） */}
          <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("repoSettings.archiveDialog.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("repoSettings.archiveDialog.desc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-3">
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    {t("repoSettings.archiveDialog.warning")}
                  </p>
                </div>
                <Input
                  value={archiveConfirm}
                  onChange={(e) => setArchiveConfirm(e.target.value)}
                  placeholder={repo.full_name}
                  aria-label={t("repoSettings.archiveDialog.confirmLabel").replace(
                    "{name}",
                    repo.full_name,
                  )}
                  autoFocus
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={archiveBusy}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={archiveBusy || archiveConfirm !== repo.full_name}
                  onClick={() => void confirmArchive()}
                >
                  {archiveBusy
                    ? t("repoSettings.archiveDialog.busy")
                    : t("repoSettings.archiveDialog.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Delete this repository（官方 3 步确认：了解 → 阅读警告 → 输入 owner/repo 删除） */}
          <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("repoSettings.deleteDialog.title").replace("{name}", repo.full_name)}
                </AlertDialogTitle>
              </AlertDialogHeader>

              {delStep === 1 && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-md border bg-muted/40 p-4 text-center">
                    <Lock className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-2 font-medium">{repo.full_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("repoSettings.visDialog.step1.stats")
                        .replace("{stars}", "0")
                        .replace("{watchers}", "0")}
                    </p>
                  </div>
                  <p className="text-muted-foreground">
                    {t("repoSettings.deleteDialog.step1.desc")}
                  </p>
                </div>
              )}

              {delStep === 2 && (
                <div className="space-y-2 text-sm">
                  {[
                    t("repoSettings.deleteDialog.step2.1"),
                    t("repoSettings.deleteDialog.step2.2"),
                  ].map((w) => (
                    <div key={w} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                      <span className="text-muted-foreground">{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {delStep === 3 && (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("repoSettings.deleteDialog.step3.desc").replace("{name}", repo.full_name)}
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={repo.full_name}
                    autoFocus
                  />
                </div>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteBusy}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant={delStep === 3 ? "destructive" : "default"}
                  disabled={deleteBusy || (delStep === 3 && confirmText !== repo.full_name)}
                  onClick={(e) => {
                    if (delStep < 3) {
                      e.preventDefault();
                      setDelStep(delStep + 1);
                    } else {
                      void del();
                    }
                  }}
                >
                  {deleteBusy
                    ? t("repoSettings.deleteDialog.busy")
                    : delStep === 1
                      ? t("repoSettings.deleteDialog.step1.btn")
                      : delStep === 2
                        ? t("repoSettings.deleteDialog.step2.btn")
                        : t("repoSettings.deleteDialog.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

/** Features 开关行（标题 + 说明 + Switch） */
function FeatureSwitch({
  label,
  desc,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onToggle} disabled={disabled} />
    </div>
  );
}
