/**
 * 新建仓库整页（复刻官方 /new）
 *
 * 官方路径：/new（替换域名即可访问官方同页）
 * - Owner 下拉（个人 + 组织）+ 仓库名/描述/Public/Private + README 初始化
 * - 组织创建走 REST POST /orgs/{org}/repos；个人 GraphQL 首选 + REST 降级
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
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  createRepositorySmart,
  fetchUserOrgsSmart,
  apiErrorMessage,
  type UserOrgItem,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/layout";
import { LoginPrompt } from "@/components/LoginPrompt";

export default function NewRepositoryPage() {
  const { token, user, canWrite } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoInit, setAutoInit] = useState(true);
  const [owner, setOwner] = useState(user?.login ?? "");
  const [orgs, setOrgs] = useState<UserOrgItem[]>([]);
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
          private: isPrivate,
          autoInit,
          owner: owner || user?.login,
        },
        user?.login,
      );
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
          {/* Owner + 仓库名 */}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label>Owner</Label>
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
              <Label htmlFor="repo-name">仓库名称</Label>
              <Input
                id="repo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-repo"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repo-desc">描述（可选）</Label>
            <Input
              id="repo-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述这个仓库…"
            />
          </div>

          {/* 可见性 */}
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

          {/* README 初始化 */}
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">使用 README 初始化</p>
              <p className="text-xs text-muted-foreground">
                创建后自动生成 README.md（需提交权限）。
              </p>
            </div>
            <Switch checked={autoInit} onCheckedChange={setAutoInit} />
          </div>

          {error && <InlineError message={error} size="sm" />}

          <div className="flex justify-end">
            <Button onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "创建中…" : "创建仓库"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
