/**
 * 新建仓库整页（复刻官方 /new）
 *
 * 官方路径：/new（替换域名即可访问官方同页）
 * - Owner 下拉（个人 + 组织）+ 仓库名/描述/homepage/Public/Private
 * - Features（issues/wiki/projects/discussions）+ README/gitignore/license 初始化
 * - topics（输入联想 + 胶囊 badge）+ merge options + 模板仓库
 * - 组织创建走 REST POST /orgs/{org}/repos；个人 GraphQL 首选 + REST 降级
 * - topics 无 create 参数 → 创建后 PUT /repos/{owner}/{repo}/topics 补写
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Globe, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TopicsInput } from "@/components/TopicsInput";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  createRepositorySmart,
  fetchUserOrgsSmart,
  fetchGitignoreTemplates,
  fetchLicenseTemplates,
  replaceRepoTopicsSmart,
  apiErrorMessage,
  type UserOrgItem,
  type LicenseTemplate,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { LoginPrompt } from "@/components/LoginPrompt";

export default function NewRepositoryPage() {
  const { token, user, canWrite } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoInit, setAutoInit] = useState(false);
  const [owner, setOwner] = useState(user?.login ?? "");
  const [orgs, setOrgs] = useState<UserOrgItem[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [features, setFeatures] = useState({
    issues: true,
    discussions: false,
    wiki: false,
    projects: false,
  });
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [gitignoreOptions, setGitignoreOptions] = useState<string[]>([]);
  const [licenseOptions, setLicenseOptions] = useState<LicenseTemplate[]>([]);
  const [merge, setMerge] = useState({
    squash: true,
    mergeCommit: true,
    rebase: true,
    autoMerge: false,
    deleteOnMerge: false,
  });
  const [isTemplate, setIsTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setOwner(user?.login ?? "");
    setError(null);
    fetchUserOrgsSmart(token)
      .then((o) => !cancelled && setOrgs(o))
      .catch(() => !cancelled && setOrgs([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 模板列表（gitignore/license 匿名可拉；GraphQL 无适配 → REST 唯一通道）
  useEffect(() => {
    let cancelled = false;
    fetchGitignoreTemplates(token)
      .then((list) => !cancelled && setGitignoreOptions(list))
      .catch(() => undefined);
    fetchLicenseTemplates(token)
      .then((list) => !cancelled && setLicenseOptions(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!token || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { full_name } = await createRepositorySmart(
        token,
        {
          name: name.trim(),
          description: description.trim() || undefined,
          homepage: homepage.trim() || undefined,
          private: isPrivate,
          hasIssues: features.issues,
          hasDiscussions: features.discussions,
          hasWiki: features.wiki,
          hasProjects: features.projects,
          autoInit,
          gitignoreTemplate: gitignore || undefined,
          licenseTemplate: license || undefined,
          allowSquashMerge: merge.squash,
          allowMergeCommit: merge.mergeCommit,
          allowRebaseMerge: merge.rebase,
          allowAutoMerge: merge.autoMerge,
          deleteBranchOnMerge: merge.deleteOnMerge,
          isTemplate,
          owner: owner || user?.login,
        },
        user?.login,
      );
      // topics 无 create 参数 → 创建后补写（PUT /repos/{owner}/{repo}/topics）
      if (topics.length > 0) {
        const [fo, fr] = full_name.split("/");
        try {
          await replaceRepoTopicsSmart(fo, fr, token, topics);
        } catch {
          /* topics 补写失败不阻断跳转 */
        }
      }
      navigate(`/${full_name}`);
    } catch (e) {
      setError(apiErrorMessage(e, t("newRepo.createFailed")));
    } finally {
      setBusy(false);
    }
  };

  const ownerOptions = [
    { login: user?.login ?? "", name: user?.login ?? "", avatar: user?.avatarUrl },
    ...orgs.map((o) => ({
      login: o.login,
      name: o.name ?? o.login,
      avatar: o.avatarUrl ?? undefined,
    })),
  ];
  const currentOwner = ownerOptions.find((o) => o.login === owner);

  if (!token) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt title="新建仓库" desc="登录后可创建仓库，仓库归属你的 GitHub 账号。" />
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt title="新建仓库" desc="只读模式无法创建，请切换完全控制后重试。" />
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">新建仓库</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          创建一个新的仓库，用于存放你的代码与版本历史。
        </p>

        <div className="space-y-6 rounded-lg border bg-card p-6">
          {/* Owner + 仓库名（必填） */}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label>
                Owner
                <span className="ml-0.5 align-super text-xs text-destructive">*</span>
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="flex min-w-0 items-center gap-2">
                      {currentOwner?.avatar && (
                        <Avatar className="size-5">
                          <AvatarImage src={currentOwner.avatar} alt={currentOwner.login} />
                          <AvatarFallback>
                            {currentOwner.login.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="truncate">{currentOwner?.name}</span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {ownerOptions.map((o) => (
                    <DropdownMenuItem key={o.login} onClick={() => setOwner(o.login)}>
                      <span className="flex min-w-0 items-center gap-2">
                        {o.avatar && (
                          <Avatar className="size-5">
                            <AvatarImage src={o.avatar} alt={o.login} />
                            <AvatarFallback>{o.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                        )}
                        <span className="truncate">{o.name}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo-name">
                仓库名称
                <span className="ml-0.5 align-super text-xs text-destructive">*</span>
              </Label>
              <Input
                id="repo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-repo"
                required
              />
            </div>
          </div>

          {/* 可见性（第二行：Public / Private） */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setIsPrivate(false)}
              className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                !isPrivate ? "border-foreground bg-accent/40" : "hover:bg-accent/30"
              }`}
            >
              <Globe className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">Public</span>
                <span className="block text-xs text-muted-foreground">任何人都能查看此仓库。</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsPrivate(true)}
              className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                isPrivate ? "border-foreground bg-accent/40" : "hover:bg-accent/30"
              }`}
            >
              <Lock className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">Private</span>
                <span className="block text-xs text-muted-foreground">只有你能查看此仓库。</span>
              </span>
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repo-desc">描述</Label>
            <Input
              id="repo-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述这个仓库…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repo-homepage">首页</Label>
            <Input
              id="repo-homepage"
              value={homepage}
              onChange={(e) => setHomepage(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          {/* Topics（输入联想 + 胶囊 badge） */}
          <div className="space-y-1.5">
            <Label>Topics</Label>
            <TopicsInput
              value={topics}
              onChange={setTopics}
              token={token}
              placeholder="如：ai、typescript、cli"
            />
          </div>

          {/* 初始化（README/gitignore/license） */}
          <div className="space-y-4">
            <p className="text-sm font-medium">初始化仓库</p>
            <SwitchRow
              title="使用 README 初始化"
              desc="创建后自动生成 README.md（需提交权限）。"
              checked={autoInit}
              onChange={setAutoInit}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>.gitignore 模板</Label>
                <Select value={gitignore} onValueChange={setGitignore}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="无" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    {gitignoreOptions.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>许可证</Label>
                <Select value={license} onValueChange={setLicense}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="无" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    {licenseOptions.map((l) => (
                      <SelectItem key={l.key} value={l.key}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Features（对齐官方：创建时一并设定） */}
          <div className="space-y-3">
            <p className="text-sm font-medium">功能</p>
            <SwitchRow
              title="Issues"
              desc="跟踪 bug 与功能请求。"
              checked={features.issues}
              onChange={(v) => setFeatures((f) => ({ ...f, issues: v }))}
            />
            <SwitchRow
              title="Discussions"
              desc="开放的社区讨论空间。"
              checked={features.discussions}
              onChange={(v) => setFeatures((f) => ({ ...f, discussions: v }))}
            />
            <SwitchRow
              title="Wiki"
              desc="仓库文档与协作空间。"
              checked={features.wiki}
              onChange={(v) => setFeatures((f) => ({ ...f, wiki: v }))}
            />
            <SwitchRow
              title="Projects"
              desc="用看板与视图组织工作。"
              checked={features.projects}
              onChange={(v) => setFeatures((f) => ({ ...f, projects: v }))}
            />
          </div>

          {/* Merge options */}
          <div className="space-y-3">
            <p className="text-sm font-medium">合并选项</p>
            <SwitchRow
              title="允许 squash merge"
              desc="将 PR 合并为单个提交。"
              checked={merge.squash}
              onChange={(v) => setMerge((m) => ({ ...m, squash: v }))}
            />
            <SwitchRow
              title="允许 merge commit"
              desc="创建合并提交。"
              checked={merge.mergeCommit}
              onChange={(v) => setMerge((m) => ({ ...m, mergeCommit: v }))}
            />
            <SwitchRow
              title="允许 rebase merge"
              desc="将提交 rebase 到目标分支。"
              checked={merge.rebase}
              onChange={(v) => setMerge((m) => ({ ...m, rebase: v }))}
            />
            <SwitchRow
              title="允许 auto-merge"
              desc="满足条件后自动合并 PR。"
              checked={merge.autoMerge}
              onChange={(v) => setMerge((m) => ({ ...m, autoMerge: v }))}
            />
            <SwitchRow
              title="合并后自动删除分支"
              desc="PR 合并后自动删除源分支。"
              checked={merge.deleteOnMerge}
              onChange={(v) => setMerge((m) => ({ ...m, deleteOnMerge: v }))}
            />
          </div>

          {/* 模板仓库 */}
          <SwitchRow
            title="模板仓库"
            desc="标记为模板，供他人从此仓库生成新仓库。"
            checked={isTemplate}
            onChange={setIsTemplate}
          />

          {error && <InlineError message={error} size="sm" />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "创建中…" : "创建仓库"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 开关行（标题 + 说明 + Switch） */
function SwitchRow({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
