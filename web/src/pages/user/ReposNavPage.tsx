/**
 * All repos（/repositories）
 *
 * topbar「All repos」对应的「我的维度」列表页（需登录）。
 * 数据源 fetchMyReposSmart + fetchUserOrgsSmart；C4 工具条（Type/Language/Sort）前端过滤排序。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, GitFork, Plus, Settings, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThrowError } from "@/components/ErrorPages";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RepoVisibilityBadge } from "@/components/RepoVisibilityBadge";
import { Tip } from "@/components/Tip";
import { LangDot } from "@/components/LangDot";
import { PermissionGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import {
  fetchMyReposSmart,
  fetchUserOrgsSmart,
  normalizeApiError,
  ApiError,
  type Repository,
  type UserOrgItem,
} from "@/lib/api";
import { LoadingList, NavPageShell } from "./shared";

export default function ReposNavPage() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [orgs, setOrgs] = useState<UserOrgItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  // C4 工具条：Type（全部/公开/私有）/ Language / Sort（名字/最近更新）
  const [type, setType] = useState<"all" | "public" | "private">("all");
  const [lang, setLang] = useState<string>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setRepos(null);
    setError(null);
    fetchMyReposSmart(token)
      .then((r) => !cancelled && setRepos(r.repos))
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    // 组织列表（识别「自己组织的仓库」可管理）
    fetchUserOrgsSmart(token)
      .then((o) => !cancelled && setOrgs(o))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 可管理 = 自己 或 自己所属组织的仓库（均可设置；deepwn/xxx 属组织仓库）
  const canManageRepo = (r: Repository) => {
    const l = user?.login;
    return Boolean(l && (r.owner.login === l || orgs.some((o) => o.login === r.owner.login)));
  };

  // C4 过滤 + 排序（前端，免重拉 API）：Type → Language → Sort
  const langs = useMemo(() => {
    const s = new Set<string>();
    repos?.forEach((r) => r.language && s.add(r.language));
    return [...s].sort();
  }, [repos]);

  const visible = useMemo(() => {
    if (!repos) return null;
    let out = repos.filter((r) => {
      if (type === "public" && r.private) return false;
      if (type === "private" && !r.private) return false;
      if (lang !== "all" && r.language !== lang) return false;
      return true;
    });
    out = [...out].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    return out;
  }, [repos, type, lang, sort]);

  return (
    <NavPageShell
      title="All repos"
      desc={t("navpage.repos.desc")}
      icon={<BookOpen className="size-6" />}
      action={
        <Button asChild>
          <Link to="/new">
            <Plus className="size-4" />
            {t("navpage.repos.new")}
          </Link>
        </Button>
      }
    >
      {/* C4 工具条（官方：Type / Language / Sort + New） */}
      {visible !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as "all" | "public" | "private")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("navpage.repos.type.all")}</SelectItem>
              <SelectItem value="public">{t("navpage.repos.type.public")}</SelectItem>
              <SelectItem value="private">{t("navpage.repos.type.private")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("navpage.repos.lang.all")}</SelectItem>
              {langs.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">{t("navpage.repos.sort.updated")}</SelectItem>
              <SelectItem value="name">{t("navpage.repos.sort.name")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {visible.length} {t("navpage.repos.count")}
          </span>
        </div>
      )}

      {error ? (
        <ThrowError err={error} />
      ) : visible === null ? (
        <LoadingList />
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("empty.repos")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map((r) => (
            <div
              key={r.full_name}
              className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <Link to={`/${r.full_name}`} className="font-medium hover:underline">
                  {r.full_name}
                </Link>
                {/* 状态徽章（私有/归档，i18n；公开不显示） */}
                <RepoVisibilityBadge repo={r} />
                {r.description && (
                  <p className="truncate text-sm text-muted-foreground">{r.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {r.language && (
                  <span className="flex items-center gap-1">
                    <LangDot lang={r.language} />
                    {r.language}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Star className="size-3.5" />
                  {r.stargazers_count}
                </span>
                <span className="flex items-center gap-1">
                  <GitFork className="size-3.5" />
                  {r.forks_count}
                </span>
                <span>{fmt(r.updated_at)}</span>
                {/* 设置按钮全部显示：可管理（自己/自己组织）→ 有写权限可点；
                    无写权限或非本人/组织仓库 → 置灰不可点击 */}
                {canManageRepo(r) ? (
                  <PermissionGate>
                    <Button variant="ghost" className="gap-1" asChild>
                      <Link to={`/${r.owner.login}/${r.name}/settings`}>
                        <Settings className="size-3.5" />
                        设置
                      </Link>
                    </Button>
                  </PermissionGate>
                ) : (
                  <Tip label="仅仓库所有者可设置">
                    <span className="inline-flex cursor-not-allowed opacity-40">
                      <Button variant="ghost" className="gap-1" disabled>
                        <Settings className="size-3.5" />
                        设置
                      </Button>
                    </span>
                  </Tip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </NavPageShell>
  );
}
