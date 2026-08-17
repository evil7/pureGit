/**
 * 仓库分支保护设置页（官方 github.com/:owner/:repo/settings/branches）
 *
 * 官方结构：分支列表（含「受保护」标记）+ 点击分支进入保护规则编辑（Require PR
 * review / status checks / signed commits / linear history / restrict push 等开关）。
 * 整体 REST-only（GraphQL 无经典 branch protection 适配，见 api-branch-protection.ts）。
 *
 * 交互：列表 → 点击「编辑」打开 Dialog（加载该分支保护规则回填表单）→ 保存时
 * 组装规则经 saveBranchProtectionSmart 编排（全空 → 删除；否则 PUT + 签名同步）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GitBranch, Shield, Pencil, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/InlineError";
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
import { toastSuccess } from "@/lib/ui/toast";
import { apiErrorMessage } from "@/lib/restapi";
import {
  fetchBranchesWithProtectionSmart,
  fetchBranchProtectionSmart,
  saveBranchProtectionSmart,
  deleteBranchProtectionSmart,
} from "@/lib/api";
import type { BranchProtection, BranchListItem } from "@/lib/restapi";
import type { SaveBranchProtectionInput } from "@/lib/api";

/** 将逗号/空白分隔字符串解析为字符串数组（空 → []） */
function parseList(s: string): string[] {
  return s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function RepoBranchesSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [branches, setBranches] = useState<BranchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 编辑弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [hasProtection, setHasProtection] = useState(false);
  const [loadingProtection, setLoadingProtection] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单状态（对齐官方核心保护开关）
  const [requireReviews, setRequireReviews] = useState(false);
  const [reviewCount, setReviewCount] = useState("1");
  const [dismissStale, setDismissStale] = useState(false);
  const [codeOwner, setCodeOwner] = useState(false);
  const [requireStatusChecks, setRequireStatusChecks] = useState(false);
  const [strictChecks, setStrictChecks] = useState(false);
  const [checkContexts, setCheckContexts] = useState("");
  const [requireConversation, setRequireConversation] = useState(false);
  const [requireSigned, setRequireSigned] = useState(false);
  const [requireLinear, setRequireLinear] = useState(false);
  const [enforceAdmins, setEnforceAdmins] = useState(false);
  const [restrictPush, setRestrictPush] = useState(false);
  const [restrictUsers, setRestrictUsers] = useState("");
  const [restrictTeams, setRestrictTeams] = useState("");
  const [allowForce, setAllowForce] = useState(false);
  const [allowDeletions, setAllowDeletions] = useState(false);

  // 删除确认
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setBranches(null);
    setError(null);
    fetchBranchesWithProtectionSmart(owner, repo, token)
      .then(setBranches)
      .catch((e) => setError(apiErrorMessage(e, t("repoBranches.loadFailed"))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  /** 用规则回填表单（null → 全部默认关闭，即未启用态） */
  const applyProtection = (p: BranchProtection | null) => {
    setRequireReviews(p?.required_pull_request_reviews != null);
    setReviewCount(String(p?.required_pull_request_reviews?.required_approving_review_count ?? 1));
    setDismissStale(p?.required_pull_request_reviews?.dismiss_stale_reviews ?? false);
    setCodeOwner(p?.required_pull_request_reviews?.require_code_owner_reviews ?? false);
    setRequireStatusChecks(p?.required_status_checks != null);
    setStrictChecks(p?.required_status_checks?.strict ?? false);
    setCheckContexts(p?.required_status_checks?.contexts.join(", ") ?? "");
    setRequireConversation(p?.required_conversation_resolution?.enabled ?? false);
    setRequireSigned(p?.required_signatures?.enabled ?? false);
    setRequireLinear(p?.required_linear_history?.enabled ?? false);
    setEnforceAdmins(p?.enforce_admins?.enabled ?? false);
    setRestrictPush(p?.restrictions != null);
    setRestrictUsers(p?.restrictions?.users.map((u) => u.login).join(", ") ?? "");
    setRestrictTeams(p?.restrictions?.teams.map((team) => team.slug).join(", ") ?? "");
    setAllowForce(p?.allow_force_pushes?.enabled ?? false);
    setAllowDeletions(p?.allow_deletions?.enabled ?? false);
  };

  const openEdit = (name: string) => {
    setBranchName(name);
    setFormError(null);
    setBusy(false);
    setHasProtection(false);
    setFormOpen(true);
    setLoadingProtection(true);
    // 先清空，加载后回填
    applyProtection(null);
    fetchBranchProtectionSmart(owner, repo, name, token)
      .then((p) => {
        applyProtection(p);
        setHasProtection(p != null);
      })
      .catch((e) => setFormError(apiErrorMessage(e, t("repoBranches.loadFailed"))))
      .finally(() => setLoadingProtection(false));
  };

  const assembleInput = (): SaveBranchProtectionInput => ({
    required_status_checks: requireStatusChecks
      ? { strict: strictChecks, contexts: parseList(checkContexts) }
      : null,
    enforce_admins: enforceAdmins ? true : null,
    required_pull_request_reviews: requireReviews
      ? {
          dismiss_stale_reviews: dismissStale,
          require_code_owner_reviews: codeOwner,
          required_approving_review_count: Number(reviewCount) || 0,
          require_last_push_approval: false,
        }
      : null,
    restrictions: restrictPush
      ? { users: parseList(restrictUsers), teams: parseList(restrictTeams), apps: [] }
      : null,
    required_linear_history: requireLinear,
    allow_force_pushes: allowForce ? true : null,
    allow_deletions: allowDeletions,
    block_creations: false,
    required_conversation_resolution: requireConversation,
    lock_branch: false,
    allow_fork_syncing: false,
    requireSignedCommits: requireSigned,
  });

  const submit = async () => {
    if (!token || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await saveBranchProtectionSmart(owner, repo, branchName, assembleInput(), token);
      toastSuccess(t("repoBranches.saved"));
      setFormOpen(false);
      load();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("repoBranches.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || deleteBusy) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteBranchProtectionSmart(owner, repo, branchName, token);
      toastSuccess(t("repoBranches.deleted"));
      setDeleteOpen(false);
      setFormOpen(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("repoBranches.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("repoBranches.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("repoBranches.desc")}</p>
      </div>

      {error && <InlineError message={error} />}

      {branches === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="rounded-lg border">
          {branches.map((b) => (
            <div
              key={b.name}
              className="flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-sm">{b.name}</span>
                {b.protected && (
                  <Badge variant="secondary">
                    <Shield className="mr-1 size-3" />
                    {t("repoBranches.protected")}
                  </Badge>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => openEdit(b.name)}>
                <Pencil className="size-3.5" />
                {t("repoBranches.edit")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 编辑保护规则弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("repoBranches.editTitle", { branch: branchName })}</DialogTitle>
            <DialogDescription>{t("repoBranches.editDesc")}</DialogDescription>
          </DialogHeader>

          {formError && <InlineError message={formError} />}

          {loadingProtection ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-5 py-2">
              {/* Require PR review */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t("repoBranches.requireReviews")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("repoBranches.requireReviewsDesc")}
                  </p>
                </div>
                <Switch checked={requireReviews} onCheckedChange={setRequireReviews} />
              </div>
              {requireReviews && (
                <div className="ml-4 flex flex-col gap-3 border-l pl-4">
                  <div>
                    <Label className="mb-1.5 block text-xs">{t("repoBranches.reviewCount")}</Label>
                    <Select value={reviewCount} onValueChange={setReviewCount}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["0", "1", "2", "3", "4", "5", "6"].map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={dismissStale} onCheckedChange={setDismissStale} />
                    {t("repoBranches.dismissStale")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={codeOwner} onCheckedChange={setCodeOwner} />
                    {t("repoBranches.codeOwner")}
                  </label>
                </div>
              )}

              {/* Require status checks */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t("repoBranches.requireStatusChecks")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("repoBranches.requireStatusChecksDesc")}
                  </p>
                </div>
                <Switch checked={requireStatusChecks} onCheckedChange={setRequireStatusChecks} />
              </div>
              {requireStatusChecks && (
                <div className="ml-4 flex flex-col gap-3 border-l pl-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={strictChecks} onCheckedChange={setStrictChecks} />
                    {t("repoBranches.strictChecks")}
                  </label>
                  <div>
                    <Label htmlFor="bp-contexts" className="mb-1.5 block text-xs">
                      {t("repoBranches.checkContexts")}
                    </Label>
                    <Input
                      id="bp-contexts"
                      value={checkContexts}
                      onChange={(e) => setCheckContexts(e.target.value)}
                      placeholder={t("repoBranches.checkContextsPlaceholder")}
                    />
                  </div>
                </div>
              )}

              {/* 其余布尔开关 */}
              <ToggleRow
                label={t("repoBranches.requireConversation")}
                checked={requireConversation}
                onChange={setRequireConversation}
              />
              <ToggleRow
                label={t("repoBranches.requireSigned")}
                checked={requireSigned}
                onChange={setRequireSigned}
              />
              <ToggleRow
                label={t("repoBranches.requireLinear")}
                checked={requireLinear}
                onChange={setRequireLinear}
              />
              <ToggleRow
                label={t("repoBranches.enforceAdmins")}
                desc={t("repoBranches.enforceAdminsDesc")}
                checked={enforceAdmins}
                onChange={setEnforceAdmins}
              />

              {/* Restrict push */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t("repoBranches.restrictPush")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("repoBranches.restrictPushDesc")}
                  </p>
                </div>
                <Switch checked={restrictPush} onCheckedChange={setRestrictPush} />
              </div>
              {restrictPush && (
                <div className="ml-4 flex flex-col gap-3 border-l pl-4">
                  <div>
                    <Label htmlFor="bp-users" className="mb-1.5 block text-xs">
                      {t("repoBranches.restrictUsers")}
                    </Label>
                    <Input
                      id="bp-users"
                      value={restrictUsers}
                      onChange={(e) => setRestrictUsers(e.target.value)}
                      placeholder={t("repoBranches.restrictUsersPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bp-teams" className="mb-1.5 block text-xs">
                      {t("repoBranches.restrictTeams")}
                    </Label>
                    <Input
                      id="bp-teams"
                      value={restrictTeams}
                      onChange={(e) => setRestrictTeams(e.target.value)}
                      placeholder={t("repoBranches.restrictTeamsPlaceholder")}
                    />
                  </div>
                </div>
              )}

              <ToggleRow
                label={t("repoBranches.allowForce")}
                checked={allowForce}
                onChange={setAllowForce}
              />
              <ToggleRow
                label={t("repoBranches.allowDeletions")}
                checked={allowDeletions}
                onChange={setAllowDeletions}
              />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              disabled={busy || loadingProtection || !hasProtection}
              onClick={() => setDeleteOpen(true)}
            >
              {t("repoBranches.removeProtection")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={busy || loadingProtection} onClick={() => void submit()}>
              {busy ? t("common.submitting") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除保护确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("repoBranches.deleteTitle", { branch: branchName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("repoBranches.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteBusy ? t("common.submitting") : t("repoBranches.removeProtection")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 单行开关（标签 + 可选描述 + 开关） */
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
