/**
 * Projects 页（官方 Projects v2，仅 GraphQL 可用——legacy REST 已随官方公告下线）。
 *
 * 权限区分（官方对齐）：访问他人仓库 = 只读视图（列表 + items 计数，无 New 按钮）；
 * 自己仓库（repo admin + 令牌 project scope）额外显示「New project ▾」下拉：
 *   - New project：在 owner 下创建 project 并直接链接到当前仓库（createProjectV2）
 *   - Link project：按 URL 解析 owner+number → 查询 node id → 链接到仓库（linkProjectV2ToRepository）
 * 数据源：fetchRepoProjectsV2Smart（含 repositoryId/ownerId 上下文）+ 两个 mutation。
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  fetchRepoProjectsV2Smart,
  createProjectV2Smart,
  linkProjectV2ToRepositorySmart,
  resolveProjectV2NodeId,
  apiErrorMessage,
  type RepoProjectV2,
} from "@/lib/api";
import { LoginPrompt } from "@/components/LoginPrompt";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { Plus, SquareKanban, Globe, Lock, ChevronDown, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 解析 project URL（/orgs/{login}/projects/{n} 或 /users/{login}/projects/{n}） */
function parseProjectUrl(url: string): { login: string; number: number } | null {
  const m = url.trim().match(/github\.com\/(?:orgs|users)\/([^/]+)\/projects\/(\d+)/);
  return m ? { login: m[1], number: Number(m[2]) } : null;
}

export default function ProjectsPage() {
  const { owner = "", repo = "" } = useParams<{ owner: string; repo: string }>();
  const { token, canWrite } = useAuth();
  const { canAdmin } = useRepoPermission();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [projects, setProjects] = useState<RepoProjectV2[] | null>(null);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // New/Link dialog 状态
  const [newOpen, setNewOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // 管理权限（官方 New project 门槛）：repo admin + 令牌完全控制（project scope）
  const canManage = canAdmin && canWrite;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setProjects([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRepoProjectsV2Smart(owner, repo, token)
      .then((ctx) => {
        if (cancelled) return;
        setProjects(ctx.projects);
        setRepositoryId(ctx.repositoryId);
        setOwnerId(ctx.ownerId);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  /** 刷新列表（新建/链接成功后） */
  const refresh = async () => {
    if (!token) return;
    const ctx = await fetchRepoProjectsV2Smart(owner, repo, token);
    setProjects(ctx.projects);
  };

  /** 新建 project（owner 下创建并链接到当前仓库） */
  const createProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !ownerId || !title.trim() || busy) return;
    setBusy(true);
    try {
      await createProjectV2Smart(ownerId, title.trim(), repositoryId, token);
      toastSuccess(t("projects.created"));
      setNewOpen(false);
      setTitle("");
      await refresh();
    } catch (err) {
      toastError(apiErrorMessage(err, t("projects.createFailed")));
    } finally {
      setBusy(false);
    }
  };

  /** 链接已有 project（解析 URL → node id → link） */
  const linkProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !repositoryId || busy) return;
    const parsed = parseProjectUrl(linkUrl);
    if (!parsed) {
      toastError(t("projects.urlInvalid"));
      return;
    }
    setBusy(true);
    try {
      const nodeId = await resolveProjectV2NodeId(parsed.login, parsed.number, token);
      if (!nodeId) {
        toastError(t("projects.linkFailed"));
        return;
      }
      await linkProjectV2ToRepositorySmart(nodeId, repositoryId, token);
      toastSuccess(t("projects.linked"));
      setLinkOpen(false);
      setLinkUrl("");
      await refresh();
    } catch (err) {
      toastError(apiErrorMessage(err, t("projects.linkFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return <LoginPrompt title={t("projects.loginTitle")} />;
  }

  return (
    <div className="space-y-4">
      {/* H1 Projects + New project 下拉（仅自己仓库 admin 可见；他人仓库只读无按钮） */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("projects.title")}</h1>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-1">
                <Plus className="size-3.5" />
                {t("projects.new")}
                <ChevronDown className="size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={() => setNewOpen(true)}>
                <Plus className="size-4" />
                {t("projects.new")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLinkOpen(true)}>
                <Link2 className="size-4" />
                {t("projects.link")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {error ? (
        <InlineError message={error} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : projects === null || projects.length === 0 ? (
        /* 空态（按权限区分：管理态引导站内创建；只读态仅提示无 projects） */
        <div className="rounded-lg border border-dashed p-10 text-center">
          <SquareKanban className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">{t("projects.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {canManage ? t("projects.empty.desc") : t("projects.empty.descReadonly")}
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
              <SquareKanban className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/${owner}/${repo}/projects/${p.number}`}
                  className="block truncate text-sm font-medium hover:text-primary hover:underline"
                >
                  {p.title}
                </Link>
                {p.shortDescription && (
                  <p className="truncate text-xs text-muted-foreground">{p.shortDescription}</p>
                )}
              </div>
              {/* items 总数（进度信息；done 计数另查，本轮仅展示总数） */}
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                {t("projects.items", { count: p.items?.totalCount ?? 0 })}
              </span>
              <Badge
                variant={p.closed ? "secondary" : "default"}
                className={cn("shrink-0 text-xs", !p.closed && "bg-emerald-600")}
              >
                {p.closed ? t("projects.closed") : t("projects.open")}
              </Badge>
              <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex">
                {p.public ? <Globe className="size-3.5" /> : <Lock className="size-3.5" />}#
                {p.number}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:block">
                {t("projects.updated")} {fmt(p.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 新建 project dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createProject} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("projects.titleLabel")}</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("projects.titlePlaceholder")}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !title.trim()}>
                {busy ? t("common.creating") : t("projects.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 链接已有 project dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.link")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={linkProject} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("projects.urlLabel")}</label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={t("projects.urlPlaceholder")}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !linkUrl.trim()}>
                {busy ? t("common.saving") : t("projects.link")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
