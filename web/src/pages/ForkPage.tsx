/**
 * Fork 页面（/:owner/:repo/fork，官方 Create fork 页复刻）
 *
 * 官方结构：标题「Fork {owner}/{repo}」+ Owner 下拉（本人/组织）+ 仓库名输入 + 描述（可修改，
 * 因 createFork 不支持 description，fork 后 PATCH 同步）+「Copy the {default_branch} branch only」
 * 复选框（默认勾选）+「Create fork」按钮。视觉语言对齐 NewRepositoryPage（max-w-2xl 卡片 + 居中主按钮）。
 *
 * 已 fork 检测：detectExistingForkSmart（GraphQL viewer.repositories(isFork:true) 按
 * parent 精确匹配，支持改名 fork；REST 降级同名检测）。检测到已 fork → 顶部提示 + 前往查看，
 * 避免重复 fork 的 422 报错。
 *
 * 数据通道：forkRepositorySmart（REST POST /forks，支持 organization/name/default_branch_only）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GitFork, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/InlineError";
import { LoginPrompt } from "@/components/LoginPrompt";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useRepoData } from "@/lib/repo/repo-context";
import {
  detectExistingForkSmart,
  fetchUserOrgsSmart,
  forkRepositorySmart,
  updateRepositorySmart,
  apiErrorMessage,
} from "@/lib/api";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { PAGE_SHELL } from "@/lib/ui/layout";

/** fork 目标（本人或组织） */
interface ForkTarget {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  isOrg: boolean;
}

export default function ForkPage() {
  const { owner = "", repo = "" } = useParams();
  const { token, user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const repoData = useRepoData();
  const defaultBranch = repoData?.default_branch ?? "main";

  // 目标列表：本人 + 组织（登录后加载组织）
  const [targets, setTargets] = useState<ForkTarget[]>([]);
  const [target, setTarget] = useState<string>(user?.login ?? "");
  const [name, setName] = useState(repo);
  const [description, setDescription] = useState("");
  const [defaultBranchOnly, setDefaultBranchOnly] = useState(true);
  // 已 fork 检测结果（full_name；null = 未 fork；undefined = 检测中）
  const [existingFork, setExistingFork] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 目标列表初始化（本人 + 组织）
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    setTargets([{ login: user.login, name: null, avatarUrl: null, isOrg: false }]);
    setTarget(user.login);
    fetchUserOrgsSmart(token)
      .then((orgs) => {
        if (cancelled) return;
        setTargets((prev) => [
          ...prev,
          ...orgs.map((o) => ({
            login: o.login,
            name: o.name,
            avatarUrl: o.avatarUrl,
            isOrg: true,
          })),
        ]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  // 描述初始值回填源仓库描述（RepoLayout 异步加载后同步；之后可自由修改）
  useEffect(() => {
    setDescription(repoData?.description ?? "");
  }, [repoData?.description]);

  // 已 fork 检测
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    setExistingFork(undefined);
    detectExistingForkSmart(token, owner, repo, user.login)
      .then((full) => !cancelled && setExistingFork(full))
      .catch(() => !cancelled && setExistingFork(null));
    return () => {
      cancelled = true;
    };
  }, [token, user, owner, repo]);

  const selectedTarget = useMemo(
    () => targets.find((tg) => tg.login === target) ?? targets[0],
    [targets, target],
  );

  const submit = async () => {
    if (!token || busy) return;
    if (!name.trim()) {
      setError(t("fork.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const organization = selectedTarget?.isOrg ? selectedTarget.login : undefined;
      const fullName = await forkRepositorySmart(
        token,
        owner,
        repo,
        organization,
        name.trim(),
        defaultBranchOnly,
      );
      // 描述与源仓库不一致（修改/清空）→ fork 后 PATCH 同步（createFork API 无 description 参数）
      const newDesc = description.trim();
      if (newDesc !== (repoData?.description ?? "").trim()) {
        const [fo, fr] = fullName.split("/");
        try {
          await updateRepositorySmart(fo, fr, token, { description: newDesc });
        } catch {
          /* 描述更新失败不阻断跳转 */
        }
      }
      toastSuccess(t("fork.success").replace("{name}", fullName));
      navigate(`/${fullName}`);
    } catch (e) {
      setError(apiErrorMessage(e, t("fork.failed")));
      // REST 降级漏检（改名 fork）→ createFork 422，额外 sonner 提醒（用户指定：事后报错）
      toastError(t("fork.failed"));
    } finally {
      setBusy(false);
    }
  };

  // 未登录 → 登录墙
  if (!token) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt title={t("fork.loginRequired")} desc={t("fork.loginRequiredDesc")} />
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">
          {t("fork.title")} {owner}/{repo}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("fork.subtitle")}</p>

        {/* 已 fork 提示（官方：You already have a fork + 前往查看） */}
        {existingFork && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border bg-muted px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              {t("fork.alreadyForked")}{" "}
              <span className="font-medium text-foreground">{existingFork}</span>
            </span>
            <Button variant="outline" asChild>
              <Link to={`/${existingFork}`}>{t("fork.viewFork")}</Link>
            </Button>
          </div>
        )}

        <div className="space-y-6 rounded-lg border bg-card p-6">
          {/* Owner + 仓库名（官方左右并排） */}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label>
                {t("fork.owner")}
                <span className="ml-0.5 align-super text-xs text-destructive">*</span>
              </Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("fork.ownerPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((tg) => (
                    <SelectItem key={tg.login} value={tg.login}>
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar src={tg.avatarUrl} alt={tg.login} className="size-5" />
                        <span className="truncate">{tg.login}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fork-name">
                {t("fork.repoName")}
                <span className="ml-0.5 align-super text-xs text-destructive">*</span>
              </Label>
              <Input
                id="fork-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={repo}
                required
              />
            </div>
          </div>

          {/* 描述（可修改：createFork 无 description 参数，fork 后 PATCH 同步） */}
          <div className="space-y-1.5">
            <Label htmlFor="fork-desc">{t("fork.description")}</Label>
            <Textarea
              id="fork-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("fork.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          {/* 仅复制默认分支（默认勾选） */}
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={defaultBranchOnly}
              onCheckedChange={(v) => setDefaultBranchOnly(v === true)}
              className="mt-0.5"
            />
            <span>{t("fork.defaultBranchOnly").replace("{branch}", defaultBranch)}</span>
          </div>

          {error && <InlineError message={error} size="sm" />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy || !name.trim() || existingFork === undefined}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              {t("fork.create")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
