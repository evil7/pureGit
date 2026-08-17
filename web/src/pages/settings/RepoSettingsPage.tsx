/**
 * 仓库设置页（官方 github.com/:owner/:repo/settings 同路径）
 *
 * 路径：/:owner/:repo/settings（官方 github.com/owner/repo/settings 同路径）
 * - 基本信息编辑（描述/首页/默认分支，PATCH /repos/{owner}/{repo}）
 * - 危险区：归档/迁移/删除仓库（官方 Danger Zone 语义）
 * 注意：仅仓库所有者/管理员可编辑（写操作 403 时提示）。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  updateRepositorySmart,
  deleteRepositorySmart,
  setWebCommitSignoffSmart,
  checkImmutableReleasesSmart,
  setImmutableReleasesSmart,
  renameBranchSmart,
  deleteBranchProtectionSmart,
  fetchBranchesSmart,
  apiErrorMessage,
} from "@/lib/api";
import {
  fetchRepository,
  fetchRepoTopicsSmart,
  replaceRepoTopicsSmart,
  transferRepository,
  type Repository,
} from "@/lib/api";
import { TopicsInput } from "@/components/TopicsInput";
import { useRepoData, useRepoUpdate } from "@/lib/repo/repo-context";
import { WriteGate } from "@/components/WriteGate";

/** merge commit 标题选项（官方枚举：PR_TITLE/MERGE_MESSAGE） */
const MERGE_TITLE_OPTIONS = [
  { value: "PR_TITLE", label: "repoSettings.merge.opt.prTitle" },
  { value: "MERGE_MESSAGE", label: "repoSettings.merge.opt.mergeMessage" },
] as const;
/** merge commit 消息选项（官方枚举：PR_BODY/PR_TITLE/BLANK） */
const MERGE_MESSAGE_OPTIONS = [
  { value: "PR_BODY", label: "repoSettings.merge.opt.prBody" },
  { value: "PR_TITLE", label: "repoSettings.merge.opt.prTitle" },
  { value: "BLANK", label: "repoSettings.merge.opt.blank" },
] as const;
/** squash commit 标题选项（官方枚举：PR_TITLE/COMMIT_OR_PR_TITLE） */
const SQUASH_TITLE_OPTIONS = [
  { value: "PR_TITLE", label: "repoSettings.merge.opt.prTitle" },
  { value: "COMMIT_OR_PR_TITLE", label: "repoSettings.merge.opt.commitOrPrTitle" },
] as const;
/** squash commit 消息选项（官方枚举：PR_BODY/COMMIT_MESSAGES/BLANK） */
const SQUASH_MESSAGE_OPTIONS = [
  { value: "PR_BODY", label: "repoSettings.merge.opt.prBody" },
  { value: "COMMIT_MESSAGES", label: "repoSettings.merge.opt.commitMessages" },
  { value: "BLANK", label: "repoSettings.merge.opt.blank" },
] as const;

/** 官方专属设置（无公开 API → 预留外链引导至官方 settings 页对应锚点） */
const OFFICIAL_ONLY_LINKS: { key: string; labelKey: I18nKey }[] = [
  { key: "features", labelKey: "repoSettings.officialOnly.socialPreview" },
  { key: "features", labelKey: "repoSettings.officialOnly.preserveRepo" },
  { key: "features", labelKey: "repoSettings.officialOnly.allowCommitComments" },
  { key: "features", labelKey: "repoSettings.officialOnly.gitLfs" },
  { key: "merge", labelKey: "repoSettings.officialOnly.limitPush" },
  { key: "pull", labelKey: "repoSettings.officialOnly.autoCloseIssues" },
  { key: "pull", labelKey: "repoSettings.officialOnly.prPermissions" },
  { key: "features", labelKey: "repoSettings.officialOnly.wikiRestrict" },
];

export default function RepoSettingsPage() {
  // URL 参数：/:owner/:repo/settings（RepoLayout 提供 owner/repo）
  const { owner = "", repo: repoName = "" } = useParams();
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  // RepoLayout 的 fetchRepositorySmart（GraphQL 首选）已把仓库数据放 context，
  // 直接消费即可，避免重复拉取同端点（原动态 import REST fetchRepository）
  const repoData = useRepoData();
  const updateRepo = useRepoUpdate();

  // 路由级权限：仅仓库管理员（ADMIN）可访问设置（与 RepoHeader 的 Settings tab 显示条件一致）。
  // 即使直接输入 URL 也拦截，防止非 admin 看到设置表单（写操作本就 403，但页面不该呈现）。
  // 组织仓库由组织 admin 成员持有 ADMIN 权限（viewer_permission 已反映）。
  const isOwner = repoData?.viewer_permission === "ADMIN";

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
  // topics（标签数组）；归档状态（危险区）
  const [topics, setTopics] = useState<string[]>([]);
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
  // Features 开关（官方勾选即改，PATCH has_*；sponsorships 走 GraphQL hasSponsorshipsEnabled）
  const [features, setFeatures] = useState({
    issues: true,
    discussions: false,
    wiki: true,
    projects: true,
    sponsorships: false,
  });
  const [featuresBusy, setFeaturesBusy] = useState(false);
  // Releases immutability（官方 Releases 区；REST-only 开关）
  const [immutableReleases, setImmutableReleases] = useState(false);
  const [immutableBusy, setImmutableBusy] = useState(false);
  // 默认分支切换/重命名（官方 Default branch 区；branches 列表供下拉切换）
  const [branches, setBranches] = useState<string[]>([]);
  const [branchBusy, setBranchBusy] = useState(false);
  const [renameBranchOpen, setRenameBranchOpen] = useState(false);
  const [renameBranchNewName, setRenameBranchNewName] = useState("");
  const [renameBranchBusy, setRenameBranchBusy] = useState(false);
  // 危险区：Disable branch protection（官方 Danger Zone 项）
  const [disableProtectionOpen, setDisableProtectionOpen] = useState(false);
  const [disableProtectionBusy, setDisableProtectionBusy] = useState(false);
  // merge options（设置页 Merge 区，仅 REST 字段）：布尔开关 + commit 标题/消息格式下拉
  const [merge, setMerge] = useState({
    squash: true,
    mergeCommit: true,
    rebase: true,
    autoMerge: false,
    deleteOnMerge: false,
    mergeCommitTitle: "MERGE_MESSAGE",
    mergeCommitMessage: "PR_BODY",
    squashCommitTitle: "PR_TITLE",
    squashCommitMessage: "PR_BODY",
  });
  // Pull Requests 区（官方：auto-merge/delete head branch 已并入 merge；补 update branch + signoff）
  const [pull, setPull] = useState({
    updateBranch: false,
    signoff: false,
  });
  const [isTemplate, setIsTemplate] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
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
        sponsorships: repoData.has_sponsorships ?? false,
      });
    }
    // topics（单独端点）
    fetchRepoTopicsSmart(owner, repoName, token)
      .then((names) => !cancelled && setTopics(names))
      .catch(() => undefined);
    // immutable releases（REST-only）+ 分支列表（默认分支切换下拉）
    checkImmutableReleasesSmart(owner, repoName, token)
      .then((enabled) => !cancelled && setImmutableReleases(enabled))
      .catch(() => undefined);
    fetchBranchesSmart(owner, repoName, token)
      .then((bs) => !cancelled && setBranches(bs.map((b) => b.name)))
      .catch(() => undefined);
    // merge options / template / Pull Requests（GraphQL 查询未含，REST 单独拉取）
    fetchRepository(owner, repoName, token)
      .then((r) => {
        if (cancelled) return;
        setMerge({
          squash: r.allow_squash_merge ?? true,
          mergeCommit: r.allow_merge_commit ?? true,
          rebase: r.allow_rebase_merge ?? true,
          autoMerge: r.allow_auto_merge ?? false,
          deleteOnMerge: r.delete_branch_on_merge ?? false,
          mergeCommitTitle: r.merge_commit_title ?? "MERGE_MESSAGE",
          mergeCommitMessage: r.merge_commit_message ?? "PR_BODY",
          squashCommitTitle: r.squash_merge_commit_title ?? "PR_TITLE",
          squashCommitMessage: r.squash_merge_commit_message ?? "PR_BODY",
        });
        setPull({
          updateBranch: r.allow_update_branch ?? false,
          signoff: r.web_commit_signoff_required ?? false,
        });
        setIsTemplate(Boolean(r.is_template));
      })
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
      const updated = await updateRepositorySmart(owner, repoName, token, {
        name: renameName.trim() || undefined,
        description,
        homepage: homepage || undefined,
        default_branch: defaultBranch || undefined,
        archived,
      });
      // topics 单独端点（PUT /repos/{owner}/{repo}/topics，最多 20 个）
      await replaceRepoTopicsSmart(owner, repoName, token, topics.slice(0, 20));
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
        sponsorships: "has_sponsorships",
      }[key] as "has_issues" | "has_discussions" | "has_wiki" | "has_projects" | "has_sponsorships";
      await updateRepositorySmart(owner, repoName, token, { [field]: !prev });
      // 同步 context → RepoHeader tabs 立即反映（Issues/Discussions/Projects 显隐）
      updateRepo({ [field]: !prev } as Partial<Repository>);
    } catch (e) {
      setFeatures((f) => ({ ...f, [key]: prev }));
      setError(apiErrorMessage(e, t("repoSettings.features.failed")));
    } finally {
      setFeaturesBusy(false);
    }
  };

  // Releases immutability 开关（官方 Releases 区；REST-only，乐观更新 + 失败回滚）
  const toggleImmutableReleases = async () => {
    if (!token || !owner || immutableBusy) return;
    setImmutableBusy(true);
    setError(null);
    const prev = immutableReleases;
    setImmutableReleases(!prev);
    try {
      await setImmutableReleasesSmart(owner, repoName, !prev, token);
    } catch (e) {
      setImmutableReleases(prev);
      setError(apiErrorMessage(e, t("repoSettings.features.failed")));
    } finally {
      setImmutableBusy(false);
    }
  };

  // 切换默认分支（官方 Default branch 下拉；PATCH default_branch）
  const switchDefaultBranch = async (branch: string) => {
    if (!token || !owner || branchBusy || branch === defaultBranch) return;
    setBranchBusy(true);
    setError(null);
    const prev = defaultBranch;
    setDefaultBranch(branch);
    try {
      await updateRepositorySmart(owner, repoName, token, { default_branch: branch });
      updateRepo({ default_branch: branch } as Partial<Repository>);
    } catch (e) {
      setDefaultBranch(prev);
      setError(apiErrorMessage(e, t("repoSettings.features.failed")));
    } finally {
      setBranchBusy(false);
    }
  };

  // 重命名当前默认分支（官方 Default branch 区的 Rename；POST branches/{branch}/rename）
  const confirmRenameBranch = async () => {
    if (!token || !owner || renameBranchBusy || !renameBranchNewName.trim()) return;
    setRenameBranchBusy(true);
    setError(null);
    try {
      await renameBranchSmart(owner, repoName, defaultBranch, renameBranchNewName.trim(), token);
      setBranches((bs) => bs.map((b) => (b === defaultBranch ? renameBranchNewName.trim() : b)));
      setDefaultBranch(renameBranchNewName.trim());
      setRenameBranchOpen(false);
      setRenameBranchNewName("");
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.renameBranchFailed")));
    } finally {
      setRenameBranchBusy(false);
    }
  };

  // 禁用分支保护规则（危险区 Disable branch protection；DELETE branches/{branch}/protection）
  const confirmDisableProtection = async () => {
    if (!token || !owner || disableProtectionBusy) return;
    setDisableProtectionBusy(true);
    setError(null);
    try {
      await deleteBranchProtectionSmart(owner, repoName, defaultBranch, token);
      setDisableProtectionOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoSettings.disableProtectionFailed")));
    } finally {
      setDisableProtectionBusy(false);
    }
  };

  // Merge options 布尔开关（官方勾选即改：乐观更新 + PATCH allow_*；失败回滚）
  const toggleMerge = async (
    key: "squash" | "mergeCommit" | "rebase" | "autoMerge" | "deleteOnMerge",
  ) => {
    if (!token || !owner || mergeBusy) return;
    setMergeBusy(true);
    setError(null);
    const prev = merge[key];
    setMerge((m) => ({ ...m, [key]: !m[key] }));
    try {
      const field = {
        squash: "allow_squash_merge",
        mergeCommit: "allow_merge_commit",
        rebase: "allow_rebase_merge",
        autoMerge: "allow_auto_merge",
        deleteOnMerge: "delete_branch_on_merge",
      }[key] as
        | "allow_squash_merge"
        | "allow_merge_commit"
        | "allow_rebase_merge"
        | "allow_auto_merge"
        | "delete_branch_on_merge";
      await updateRepositorySmart(owner, repoName, token, { [field]: !prev });
    } catch (e) {
      setMerge((m) => ({ ...m, [key]: prev }));
      setError(apiErrorMessage(e, t("repoSettings.merge.failed")));
    } finally {
      setMergeBusy(false);
    }
  };

  // 模板仓库开关（官方 Template repository：乐观更新 + PATCH is_template；失败回滚）
  const toggleTemplate = async () => {
    if (!token || !owner || mergeBusy) return;
    setMergeBusy(true);
    setError(null);
    const prev = isTemplate;
    setIsTemplate(!prev);
    try {
      await updateRepositorySmart(owner, repoName, token, { is_template: !prev });
    } catch (e) {
      setIsTemplate(prev);
      setError(apiErrorMessage(e, t("repoSettings.merge.failed")));
    } finally {
      setMergeBusy(false);
    }
  };

  // Merge button 提交格式下拉（官方 commit message 下拉；PATCH merge_commit_* / squash_merge_commit_*）
  const changeMergeSelect = async (
    key: "mergeCommitTitle" | "mergeCommitMessage" | "squashCommitTitle" | "squashCommitMessage",
    value: string,
  ) => {
    if (!token || !owner || mergeBusy) return;
    setMergeBusy(true);
    setError(null);
    const prev = merge[key];
    setMerge((m) => ({ ...m, [key]: value }));
    try {
      const field = {
        mergeCommitTitle: "merge_commit_title",
        mergeCommitMessage: "merge_commit_message",
        squashCommitTitle: "squash_merge_commit_title",
        squashCommitMessage: "squash_merge_commit_message",
      }[key] as
        | "merge_commit_title"
        | "merge_commit_message"
        | "squash_merge_commit_title"
        | "squash_merge_commit_message";
      // field 为联合键 + value 为 string → 断言为 smart 层入参类型（value 来自受控 Select 枚举）
      await updateRepositorySmart(owner, repoName, token, {
        [field]: value,
      } as Parameters<typeof updateRepositorySmart>[3]);
    } catch (e) {
      setMerge((m) => ({ ...m, [key]: prev }));
      setError(apiErrorMessage(e, t("repoSettings.merge.failed")));
    } finally {
      setMergeBusy(false);
    }
  };

  // Pull Requests 区开关（allow_update_branch 走 REST；signoff 走独立 GraphQL mutation）
  const togglePull = async (key: "updateBranch" | "signoff") => {
    if (!token || !owner || mergeBusy) return;
    setMergeBusy(true);
    setError(null);
    const prev = pull[key];
    setPull((p) => ({ ...p, [key]: !p[key] }));
    try {
      if (key === "signoff") {
        // signoff：GraphQL updateRepositoryWebCommitSignoffSetting 主通道 + REST 降级
        await setWebCommitSignoffSmart(owner, repoName, !prev, token);
      } else {
        await updateRepositorySmart(owner, repoName, token, { allow_update_branch: !prev });
      }
    } catch (e) {
      setPull((p) => ({ ...p, [key]: prev }));
      setError(apiErrorMessage(e, t("repoSettings.merge.failed")));
    } finally {
      setMergeBusy(false);
    }
  };

  // 归档（危险区，官方 Archive this repository；输入 owner/repo 确认后 PATCH archived）
  const confirmArchive = async () => {
    if (!token || !owner || archiveBusy) return;
    setArchiveBusy(true);
    setError(null);
    try {
      const updated = await updateRepositorySmart(owner, repoName, token, {
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
      const updated = await updateRepositorySmart(owner, repoName, token, {
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
              {/* Template repository（官方位置：Repository name 之后，独立于 Features/Pull Requests 区） */}
              <FeatureSwitch
                label={t("repoSettings.template")}
                desc={t("repoSettings.template.desc")}
                checked={isTemplate}
                disabled={mergeBusy || !canWrite}
                onToggle={() => void toggleTemplate()}
              />
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
              {/* Default branch（官方：下拉切换 + Rename 按钮） */}
              <div>
                <Label htmlFor="branch" className="mb-1.5 block">
                  {t("repoSettings.defaultBranch")}
                </Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={defaultBranch}
                    onValueChange={(v) => void switchDefaultBranch(v)}
                    disabled={!canWrite || branchBusy}
                  >
                    <SelectTrigger id="branch" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.length > 0 ? (
                        branches.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value={defaultBranch}>{defaultBranch}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      setRenameBranchNewName(defaultBranch);
                      setRenameBranchOpen(true);
                    }}
                    disabled={!canWrite}
                  >
                    {t("repoSettings.renameBranch")}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("repoSettings.defaultBranchHint")}
                </p>
              </div>
              {/* Topics（官方 topics 区：输入联想 + 胶囊 badge） */}
              <div>
                <Label className="mb-1.5 block">Topics</Label>
                <TopicsInput
                  value={topics}
                  onChange={setTopics}
                  token={token}
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
          <FeatureSwitch
            label={t("repoSettings.features.sponsorships")}
            desc={t("repoSettings.features.sponsorships.desc")}
            checked={features.sponsorships}
            disabled={featuresBusy || !canWrite}
            onToggle={() => void toggleFeature("sponsorships")}
          />
          {/* 子项站内链接（官方 Features 区右侧 link；issue templates 站内新建、discussions 站内设置） */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs">
            {features.issues && (
              <Link
                to={`/${owner}/${repoName}/issues/new`}
                className="text-primary hover:underline"
              >
                {t("repoSettings.features.links.issueTemplates")}
              </Link>
            )}
            {features.discussions && (
              <Link
                to={`/${owner}/${repoName}/discussions`}
                className="text-primary hover:underline"
              >
                {t("repoSettings.features.links.discussions")}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Releases immutability（官方 Releases 区；REST-only 开关） */}
      {repo && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.immutable.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.immutable.desc")}</p>
          </div>
          <FeatureSwitch
            label={t("repoSettings.immutable.switch")}
            desc={t("repoSettings.immutable.switch.desc")}
            checked={immutableReleases}
            disabled={immutableBusy || !canWrite}
            onToggle={() => void toggleImmutableReleases()}
          />
        </section>
      )}

      {/* Merge button（官方 Merge 区：勾选即改 + commit 格式下拉） */}
      {repo && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.merge.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.merge.desc")}</p>
          </div>
          {/* Allow merge commits + 提交标题/消息格式下拉 */}
          <FeatureSwitch
            label={t("repoSettings.merge.commit")}
            desc={t("repoSettings.merge.commit.desc")}
            checked={merge.mergeCommit}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void toggleMerge("mergeCommit")}
          />
          {merge.mergeCommit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <MergeCommitSelect
                label={t("repoSettings.merge.commitTitle")}
                value={merge.mergeCommitTitle}
                options={MERGE_TITLE_OPTIONS}
                disabled={mergeBusy || !canWrite}
                onChange={(v) => void changeMergeSelect("mergeCommitTitle", v)}
              />
              <MergeCommitSelect
                label={t("repoSettings.merge.commitMessage")}
                value={merge.mergeCommitMessage}
                options={MERGE_MESSAGE_OPTIONS}
                disabled={mergeBusy || !canWrite}
                onChange={(v) => void changeMergeSelect("mergeCommitMessage", v)}
              />
            </div>
          )}
          {/* Allow squash merging + squash 提交格式下拉 */}
          <FeatureSwitch
            label={t("repoSettings.merge.squash")}
            desc={t("repoSettings.merge.squash.desc")}
            checked={merge.squash}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void toggleMerge("squash")}
          />
          {merge.squash && (
            <div className="grid gap-3 sm:grid-cols-2">
              <MergeCommitSelect
                label={t("repoSettings.merge.squashTitle")}
                value={merge.squashCommitTitle}
                options={SQUASH_TITLE_OPTIONS}
                disabled={mergeBusy || !canWrite}
                onChange={(v) => void changeMergeSelect("squashCommitTitle", v)}
              />
              <MergeCommitSelect
                label={t("repoSettings.merge.squashMessage")}
                value={merge.squashCommitMessage}
                options={SQUASH_MESSAGE_OPTIONS}
                disabled={mergeBusy || !canWrite}
                onChange={(v) => void changeMergeSelect("squashCommitMessage", v)}
              />
            </div>
          )}
          {/* Allow rebase merging */}
          <FeatureSwitch
            label={t("repoSettings.merge.rebase")}
            desc={t("repoSettings.merge.rebase.desc")}
            checked={merge.rebase}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void toggleMerge("rebase")}
          />
        </section>
      )}

      {/* Pull Requests（官方 Pull Requests 区：auto-merge / delete head branch / update branch） */}
      {repo && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.pull.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.pull.desc")}</p>
          </div>
          <FeatureSwitch
            label={t("repoSettings.merge.auto")}
            desc={t("repoSettings.merge.auto.desc")}
            checked={merge.autoMerge}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void toggleMerge("autoMerge")}
          />
          <FeatureSwitch
            label={t("repoSettings.merge.deleteOnMerge")}
            desc={t("repoSettings.merge.deleteOnMerge.desc")}
            checked={merge.deleteOnMerge}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void toggleMerge("deleteOnMerge")}
          />
          <FeatureSwitch
            label={t("repoSettings.pull.updateBranch")}
            desc={t("repoSettings.pull.updateBranch.desc")}
            checked={pull.updateBranch}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void togglePull("updateBranch")}
          />
        </section>
      )}

      {/* Commits（官方 Commits 区：web 提交签名；allow commit comments 无 API → 后续预留外链） */}
      {repo && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.commits.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.commits.desc")}</p>
          </div>
          <FeatureSwitch
            label={t("repoSettings.pull.signoff")}
            desc={t("repoSettings.pull.signoff.desc")}
            checked={pull.signoff}
            disabled={mergeBusy || !canWrite}
            onToggle={() => void togglePull("signoff")}
          />
        </section>
      )}

      {/* 官方专属设置（无公开 API，预留外链引导至官方 settings；参考 actions 页 ManagementLink 模式） */}
      {repo && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("repoSettings.officialOnly.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("repoSettings.officialOnly.desc")}</p>
          </div>
          <ul className="flex flex-col gap-1">
            {OFFICIAL_ONLY_LINKS.map((item) => (
              <li key={item.key}>
                <a
                  href={`https://github.com/${owner}/${repoName}/settings#${item.key}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span>{t(item.labelKey)}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {t("repoSettings.officialOnly.tag")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
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

            {/* Disable branch protection rules（官方 Danger Zone；删除当前默认分支保护规则） */}
            <div className="flex items-start justify-between gap-4 border-t p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("repoSettings.disableProtection")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("repoSettings.disableProtection.desc")}
                </p>
              </div>
              <WriteGate>
                <Button
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive hover:text-white"
                  onClick={() => setDisableProtectionOpen(true)}
                  disabled={!canWrite}
                >
                  {t("repoSettings.disableProtectionButton")}
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

          {/* 重命名默认分支（官方 Default branch 区 Rename dialog） */}
          <Dialog open={renameBranchOpen} onOpenChange={setRenameBranchOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("repoSettings.renameBranchDialog.title")}</DialogTitle>
                <DialogDescription>{t("repoSettings.renameBranchDialog.desc")}</DialogDescription>
              </DialogHeader>
              <Input
                value={renameBranchNewName}
                onChange={(e) => setRenameBranchNewName(e.target.value)}
                placeholder={t("repoSettings.renameBranchDialog.placeholder")}
                autoFocus
              />
              <DialogFooter>
                <Button
                  variant="default"
                  disabled={renameBranchBusy || !renameBranchNewName.trim()}
                  onClick={() => void confirmRenameBranch()}
                >
                  {renameBranchBusy
                    ? t("common.saving")
                    : t("repoSettings.renameBranchDialog.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 禁用分支保护规则（危险区 Disable branch protection 确认） */}
          <AlertDialog open={disableProtectionOpen} onOpenChange={setDisableProtectionOpen}>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("repoSettings.disableProtectionDialog.title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("repoSettings.disableProtectionDialog.desc", { branch: defaultBranch })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => void confirmDisableProtection()}
                  disabled={disableProtectionBusy}
                >
                  {disableProtectionBusy
                    ? t("common.loading")
                    : t("repoSettings.disableProtectionButton")}
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
                    ? t("common.deleting")
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

/** Merge button 提交格式下拉（label + Select；options 的 label 为 i18n key，渲染时解析） */
function MergeCommitSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: I18nKey }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {t(o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
