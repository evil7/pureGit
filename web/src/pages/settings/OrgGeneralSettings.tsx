/**
 * 组织设置 —— General（组织资料 + 成员权限 + 危险区）
 *
 * 路径：/organizations/:org/settings（官方同路径 profile 页）
 * - 组织资料编辑（名称/描述/网站/邮箱/位置；GraphQL updateOrganization 首选 + REST PATCH 降级）
 * - 成员权限（default_repository_permission + members_allowed_repository_creation_type，仅 REST）
 * - 危险区：退出组织（DELETE /orgs/{org}/memberships/{login}，确认框）
 * 注意：组织管理需 admin:org（登录勾选「管理 organization 账号」），未授权时置灰
 * （PermissionGate permission="org"）。Rename/Archive/Delete 官方 UI 专属，API 未开放，不做。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PermissionGate } from "@/components/WriteGate";
import { useI18n } from "@/i18n";
import {
  fetchOrgDetailSmart,
  updateOrganizationSmart,
  leaveOrganization,
  apiErrorMessage,
  type OrgDetail,
} from "@/lib/api";

type RepoPerm = "read" | "write" | "admin" | "none";
type RepoCreate = "all" | "public" | "private" | "none";

export default function OrgGeneralSettings() {
  const { org = "" } = useParams();
  const { token, user, canWrite } = useAuth();
  const { t } = useI18n();
  const login = user?.login;

  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [leaveBusy, setLeaveBusy] = useState(false);
  // 编辑表单
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [email, setEmail] = useState("");
  // 成员权限（增补；仅 REST PATCH，GraphQL mutation 无此字段）
  const [repoPerm, setRepoPerm] = useState<RepoPerm>("read");
  const [repoCreate, setRepoCreate] = useState<RepoCreate>("all");
  const [privSaving, setPrivSaving] = useState(false);
  const [privSaved, setPrivSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOrgDetailSmart(org, token)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setName(d.name ?? "");
        setDescription(d.description ?? "");
        setWebsiteUrl(d.blog ?? "");
        setLocation(d.location ?? "");
        setEmail(d.email ?? "");
        setRepoPerm(d.default_repository_permission ?? "read");
        setRepoCreate(d.members_allowed_repository_creation_type ?? "all");
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [token, org]);

  const save = async () => {
    if (!token || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateOrganizationSmart(org, token, {
        name,
        description,
        websiteUrl,
        location,
        email,
      });
      setDetail(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgSettings.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const savePrivileges = async () => {
    if (!token || privSaving) return;
    setPrivSaving(true);
    setPrivSaved(false);
    setError(null);
    try {
      await updateOrganizationSmart(org, token, {
        default_repository_permission: repoPerm,
        members_allowed_repository_creation_type: repoCreate,
      });
      setPrivSaved(true);
      setTimeout(() => setPrivSaved(false), 3000);
    } catch (e) {
      setError(apiErrorMessage(e, t("orgPrivileges.saveFailed")));
    } finally {
      setPrivSaving(false);
    }
  };

  const leave = async () => {
    if (!token || !login || leaveBusy) return;
    setLeaveBusy(true);
    setError(null);
    try {
      await leaveOrganization(org, login, token);
      // 退出成功 → 返回个人设置
      window.location.href = "/settings/profile";
    } catch (e) {
      setError(apiErrorMessage(e, t("orgSettings.leaveFailed")));
      setLeaveBusy(false);
    }
  };

  if (!token) return null;

  return (
    // 内容区扁平 region（官方 General：表单 + 开关 + 危险区堆叠，无卡片包裹、无大标题——
    // 去顶部大标题/描述，信息在左卡；对齐个人设置扁平结构）
    <div className="flex flex-col gap-8">
      {error && <InlineError message={error} />}

      {/* 组织资料（需完全控制） */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("orgSettings.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="org-name" className="mb-1.5 block">
              {t("orgSettings.name")}
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="org-location" className="mb-1.5 block">
              {t("orgSettings.location")}
            </Label>
            <Input
              id="org-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="org-desc" className="mb-1.5 block">
              {t("orgSettings.descLabel")}
            </Label>
            <Input
              id="org-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="org-site" className="mb-1.5 block">
              {t("orgSettings.website")}
            </Label>
            <Input
              id="org-site"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="org-email" className="mb-1.5 block">
              {t("orgSettings.email")}
            </Label>
            <Input
              id="org-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <p className="text-sm text-chart-1">{t("orgSettings.saved")}</p>}
          <PermissionGate permission="org">
            <Button onClick={() => void save()} disabled={saving || !detail || !canWrite}>
              {saving ? t("common.saving") : t("orgSettings.saveButton")}
            </Button>
          </PermissionGate>
        </div>
      </section>

      {/* 成员权限（增补；官方 Member privileges 精简两字段） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("orgPrivileges.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("orgPrivileges.desc")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="org-repo-perm" className="mb-1.5 block">
              {t("orgPrivileges.defaultRepoPermission")}
            </Label>
            <Select
              value={repoPerm}
              onValueChange={(v) => setRepoPerm(v as RepoPerm)}
              disabled={!canWrite}
            >
              <SelectTrigger id="org-repo-perm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("perm.read")}</SelectItem>
                <SelectItem value="write">{t("perm.write")}</SelectItem>
                <SelectItem value="admin">{t("perm.admin")}</SelectItem>
                <SelectItem value="none">{t("perm.defaultNone")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("orgPrivileges.defaultRepoPermissionHint")}
            </p>
          </div>
          <div>
            <Label htmlFor="org-repo-create" className="mb-1.5 block">
              {t("orgPrivileges.repoCreation")}
            </Label>
            <Select
              value={repoCreate}
              onValueChange={(v) => setRepoCreate(v as RepoCreate)}
              disabled={!canWrite}
            >
              <SelectTrigger id="org-repo-create" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("perm.createAll")}</SelectItem>
                <SelectItem value="public">{t("perm.createPublic")}</SelectItem>
                <SelectItem value="private">{t("perm.createPrivate")}</SelectItem>
                <SelectItem value="none">{t("perm.createNone")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("orgPrivileges.repoCreationHint")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {privSaved && <p className="text-sm text-chart-1">{t("orgPrivileges.saved")}</p>}
          <PermissionGate permission="org">
            <Button
              variant="outline"
              onClick={() => void savePrivileges()}
              disabled={privSaving || !detail || !canWrite}
            >
              {privSaving ? t("common.saving") : t("orgPrivileges.save")}
            </Button>
          </PermissionGate>
        </div>
      </section>

      {/* 危险区（对齐凭据管理/仓库设置统一样式：标题在外层 + 卡片 mt-3 间隔，
          行内 text-sm font-medium + 描述 mt-1；Rename/Archive/Delete 官方 UI 专属，API 未开放，不做） */}
      {detail && (
        <section>
          <div>
            <h2 className="text-lg font-semibold text-destructive">{t("orgSettings.danger")}</h2>
          </div>
          <div className="mt-3 rounded-lg border border-destructive/40">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("orgSettings.leaveCurrent")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("orgSettings.leaveHint")}</p>
              </div>
              <div className="shrink-0">
                <PermissionGate permission="org">
                  {/* 退出组织：危险操作必须 AlertDialog（红线） */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">{t("orgSettings.leave")}</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("orgSettings.leaveConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("orgSettings.leaveConfirmDesc").replace("{name}", detail.login)}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={detail.login}
                        autoFocus
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={confirmText !== detail.login || leaveBusy}
                          onClick={() => void leave()}
                        >
                          {leaveBusy ? t("orgSettings.leaveBusy") : t("orgSettings.leaveConfirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </PermissionGate>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
