/**
 * 仓库 GitHub Pages 设置页（官方 github.com/:owner/:repo/settings/pages）
 *
 * 官方结构：未启用 → 「Pages 未启用」+ 启用表单（Source: 分支 + 目录）；
 * 已启用 → Visit site 链接 + Build and deployment（分支/目录）+ Custom domain +
 * Enforce HTTPS + Recent builds。
 * 整体 REST-only（GraphQL 无 Pages 端点，见 api-pages.ts 理由）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Globe, ExternalLink, RefreshCw, Trash2, Rocket } from "lucide-react";
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
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchBranches, apiErrorMessage } from "@/lib/restapi";
import {
  fetchPagesSmart,
  createPagesSiteSmart,
  updatePagesSiteSmart,
  deletePagesSiteSmart,
  listPagesBuildsSmart,
  requestPagesBuildSmart,
} from "@/lib/api";
import type { RepoPages, RepoPagesBuild } from "@/lib/restapi";

export default function RepoPagesSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [pages, setPages] = useState<RepoPages | null | undefined>(undefined); // undefined=加载中 null=未启用
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [builds, setBuilds] = useState<RepoPagesBuild[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单状态（未启用 + 已启用共用）
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState<"/" | "/docs">("/");
  const [cname, setCname] = useState("");
  const [httpsEnforced, setHttpsEnforced] = useState(false);

  // 删除确认
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = () => {
    if (!token) return;
    setError(null);
    setBuilds(null);
    fetchPagesSmart(owner, repo, token)
      .then((p) => {
        setPages(p);
        if (p) {
          setBranch(p.source?.branch ?? "");
          setPath(p.source?.path ?? "/");
          setCname(p.cname ?? "");
          setHttpsEnforced(p.https_enforced ?? false);
        }
      })
      .catch((e) => setError(apiErrorMessage(e, t("repoPages.loadFailed"))));
    fetchBranches(owner, repo, 100, token)
      .then((b) => {
        setBranches(b.map((x) => ({ name: x.name })));
        // 默认分支回填：优先 main/master
        const preferred = b.find((x) => x.name === "main" || x.name === "master");
        setBranch((prev) => prev || preferred?.name || b[0]?.name || "");
      })
      .catch(() => setBranches([]));
    listPagesBuildsSmart(owner, repo, token)
      .then(setBuilds)
      .catch(() => setBuilds([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const enable = async () => {
    if (!token || !branch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await createPagesSiteSmart(owner, repo, branch, path, token);
      setPages(p);
      toastSuccess(t("repoPages.enabled"));
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const saveSource = async () => {
    if (!token || !branch || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePagesSiteSmart(
        owner,
        repo,
        { source: { branch, path }, build_type: "legacy" },
        token,
      );
      toastSuccess(t("repoPages.saved"));
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const saveCname = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePagesSiteSmart(owner, repo, { cname: cname.trim() || null }, token);
      toastSuccess(t("repoPages.saved"));
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const toggleHttps = async (v: boolean) => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePagesSiteSmart(owner, repo, { https_enforced: v }, token);
      setHttpsEnforced(v);
      toastSuccess(t("repoPages.saved"));
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const requestBuild = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPagesBuildSmart(owner, repo, token);
      toastSuccess(t("repoPages.buildRequested"));
      listPagesBuildsSmart(owner, repo, token)
        .then(setBuilds)
        .catch(() => setBuilds([]));
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deletePagesSiteSmart(owner, repo, token);
      setPages(null);
      setBuilds([]);
      toastSuccess(t("repoPages.deleted"));
      setDeleteOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoPages.deleteFailed")));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (status: RepoPages["status"]) => {
    if (status === "built") return <Badge>{t("repoPages.statusBuilt")}</Badge>;
    if (status === "building")
      return <Badge variant="secondary">{t("repoPages.statusBuilding")}</Badge>;
    if (status === "errored")
      return <Badge variant="destructive">{t("repoPages.statusErrored")}</Badge>;
    return null;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("repoPages.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("repoPages.desc")}</p>
      </div>

      {error && <InlineError message={error} />}

      {pages === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : pages === null ? (
        /* 未启用态 */
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("repoPages.disabled")}</p>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="pg-branch" className="mb-1.5 block">
                {t("repoPages.sourceLabel")}
              </Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger id="pg-branch" className="w-full">
                  <SelectValue placeholder={t("repoPages.branchPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pg-path" className="mb-1.5 block">
                {t("repoPages.folderLabel")}
              </Label>
              <Select value={path} onValueChange={(v) => setPath(v as "/" | "/docs")}>
                <SelectTrigger id="pg-path" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="/">/ (root)</SelectItem>
                  <SelectItem value="/docs">/docs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void enable()} disabled={busy || !branch}>
              <Rocket className="size-4" />
              {busy ? t("common.submitting") : t("repoPages.enable")}
            </Button>
          </div>
        </div>
      ) : (
        /* 已启用态 */
        <div className="flex flex-col gap-6">
          {/* Visit site */}
          {pages.url && (
            <a
              href={pages.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Globe className="size-4" />
              {t("repoPages.visitSite")}
              <ExternalLink className="size-3.5" />
            </a>
          )}

          {/* Build and deployment */}
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t("repoPages.buildDeployment")}</h3>
              {statusBadge(pages.status)}
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <Label htmlFor="pg-branch2" className="mb-1.5 block">
                  {t("repoPages.sourceLabel")}
                </Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger id="pg-branch2" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pg-path2" className="mb-1.5 block">
                  {t("repoPages.folderLabel")}
                </Label>
                <Select value={path} onValueChange={(v) => setPath(v as "/" | "/docs")}>
                  <SelectTrigger id="pg-path2" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="/">/ (root)</SelectItem>
                    <SelectItem value="/docs">/docs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => void saveSource()} disabled={busy || !branch}>
                {t("repoPages.saveSource")}
              </Button>
            </div>
          </section>

          {/* Custom domain */}
          <section className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-medium">{t("repoPages.customDomain")}</h3>
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="pg-cname" className="mb-1.5 block">
                  {t("repoPages.cnameLabel")}
                </Label>
                <Input
                  id="pg-cname"
                  value={cname}
                  onChange={(e) => setCname(e.target.value)}
                  placeholder="example.com"
                />
              </div>
              <Button onClick={() => void saveCname()} disabled={busy}>
                {t("repoPages.save")}
              </Button>
            </div>
            {cname && (
              <p className="mt-2 text-xs text-muted-foreground">{t("repoPages.cnameHint")}</p>
            )}
          </section>

          {/* Enforce HTTPS */}
          <section className="flex items-center justify-between rounded-lg border bg-card p-4">
            <div>
              <p className="text-sm font-medium">{t("repoPages.enforceHttps")}</p>
              <p className="text-sm text-muted-foreground">{t("repoPages.enforceHttpsDesc")}</p>
            </div>
            <Switch checked={httpsEnforced} onCheckedChange={(v) => void toggleHttps(v)} />
          </section>

          {/* Recent builds */}
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t("repoPages.recentBuilds")}</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void requestBuild()}
                disabled={busy}
              >
                <RefreshCw className="size-3.5" />
                {t("repoPages.requestBuild")}
              </Button>
            </div>
            {builds === null ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : builds.length === 0 ? (
              <p className="mt-3 py-4 text-center text-sm text-muted-foreground">
                {t("repoPages.noBuilds")}
              </p>
            ) : (
              <ul className="mt-3 divide-y">
                {builds.map((b) => (
                  <li key={b.url} className="flex items-center gap-3 py-2">
                    <Badge variant={b.error.message ? "destructive" : "default"}>{b.status}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {b.commit.slice(0, 7)}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmt(b.updated_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Danger zone */}
          <section className="flex items-center justify-between rounded-lg border border-destructive/40 bg-card p-4">
            <div>
              <p className="text-sm font-medium">{t("repoPages.disableTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("repoPages.disableDesc")}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
            >
              <Trash2 className="size-3.5" />
              {t("repoPages.disable")}
            </Button>
          </section>
        </div>
      )}

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repoPages.disableTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("repoPages.disableConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? t("common.loading") : t("repoPages.disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
