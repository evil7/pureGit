/**
 * Projects 页（恢复真实功能）：官方 Projects v2 仅 GraphQL 可用
 * （legacy REST GET /repos/{owner}/{repo}/projects 已随官方公告下线，2026-08 实测全 404）。
 * 数据源：fetchRepoProjectsV2Smart（固定 GraphQL；repo scope 已涵盖 project 访问——官方文档）。
 * 结构对齐官方：H1 Projects + New project（外链官方新建）+ 列表/空态。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { fetchRepoProjectsV2Smart, type RepoProjectV2 } from "@/lib/api";
import { LoginPrompt } from "@/components/LoginPrompt";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, SquareKanban, Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProjectsPage() {
  const { owner = "", repo = "" } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [projects, setProjects] = useState<RepoProjectV2[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .then((list) => {
        if (!cancelled) setProjects(list);
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

  if (!token) {
    return <LoginPrompt title={t("projects.loginTitle")} />;
  }

  return (
    <div className="space-y-4">
      {/* H1 Projects + New project（官方右上，外链官方新建页） */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Button size="sm" className="gap-1" asChild>
          <a
            href={`https://github.com/${owner}/${repo}/projects/new`}
            target="_blank"
            rel="noreferrer"
          >
            <Plus className="size-3.5" />
            {t("projects.new")}
          </a>
        </Button>
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
        /* 空态（官方无 projects 时的引导卡片） */
        <div className="rounded-lg border border-dashed p-10 text-center">
          <SquareKanban className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">{t("projects.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("projects.empty.desc")}
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
              <SquareKanban className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:text-primary hover:underline"
                >
                  {p.title}
                </a>
                {p.shortDescription && (
                  <p className="truncate text-xs text-muted-foreground">{p.shortDescription}</p>
                )}
              </div>
              <Badge
                variant={p.closed ? "secondary" : "default"}
                className={cn("shrink-0 text-xs", !p.closed && "bg-emerald-600")}
              >
                {p.closed ? t("projects.closed") : t("projects.open")}
              </Badge>
              <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                {p.public ? <Globe className="size-3.5" /> : <Lock className="size-3.5" />}#
                {p.number}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                {t("projects.updated")} {fmt(p.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
