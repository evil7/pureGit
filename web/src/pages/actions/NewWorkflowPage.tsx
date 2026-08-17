/**
 * 新建 workflow 模板选择页（官方 /owner/repo/actions/new）
 *
 * 官方结构：标题 "Choose a workflow" + 描述 + Skip 链接 + 搜索框 +
 * 分类区块（每分类 h2 + View all 链接 + 卡片网格）。
 * 数据源：actions/starter-workflows 官方模板仓库（分类 + 模板 + 元数据 + 图标）。
 * 图标走 raw 直连 + onError 降级 /$raw 代理（智能熔断，绕墙）。
 * Configure → /new/{默认分支}?filename=.github/workflows/{name}.yml&workflow_template={category}/{name}
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { fetchRepository } from "@/lib/restapi";
import {
  fetchWorkflowCategories,
  fetchWorkflowTemplates,
  fetchTemplateIconDataUri,
  workflowCategoryName,
  type WorkflowCategory,
  type WorkflowTemplate,
} from "@/lib/api";

/** 首页每分类展示模板数（官方首页约 6 个 + View all） */
const PREVIEW_COUNT = 6;

/** 模板卡片图标（复用 fetchFileContentSmart 读 SVG → data URI；失败隐藏） */
function TemplateIcon({ iconName, name }: { iconName: string; name: string }) {
  const { token } = useAuth();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!iconName) return;
    let cancelled = false;
    fetchTemplateIconDataUri(iconName, token)
      .then((uri) => {
        if (!cancelled && uri) setSrc(uri);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [iconName, token]);
  if (!iconName || !src) return null;
  return <img src={src} alt={`${name} logo`} className="size-12 shrink-0 object-contain" />;
}

export default function NewWorkflowPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get("category") ?? "";

  const [defaultBranch, setDefaultBranch] = useState("main");
  const [categories, setCategories] = useState<WorkflowCategory[]>([]);
  const [templates, setTemplates] = useState<Record<string, WorkflowTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  // 仓库默认分支（Configure 链接的 new/:branch）
  useEffect(() => {
    fetchRepository(owner, repo, token)
      .then((r) => setDefaultBranch(r.default_branch ?? "main"))
      .catch(() => {});
  }, [owner, repo, token]);

  // 分类 + 模板加载（首页：全部分类各取前 6；?category= 单分类全量）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const load = async () => {
      try {
        if (categoryParam) {
          const list = await fetchWorkflowTemplates(categoryParam, token);
          if (cancelled) return;
          setCategories([{ id: categoryParam, name: workflowCategoryName(categoryParam) }]);
          setTemplates({ [categoryParam]: list });
        } else {
          const cats = await fetchWorkflowCategories(token);
          if (cancelled) return;
          setCategories(cats);
          const map: Record<string, WorkflowTemplate[]> = {};
          await Promise.all(
            cats.map(async (c) => {
              const list = await fetchWorkflowTemplates(c.id, token).catch(() => []);
              map[c.id] = list.slice(0, PREVIEW_COUNT);
            }),
          );
          if (cancelled) return;
          setTemplates(map);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, categoryParam]);

  // 搜索过滤（前端：匹配标题/描述/作者/分类）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    const out: Record<string, WorkflowTemplate[]> = {};
    for (const [cat, list] of Object.entries(templates)) {
      const hit = list.filter((tmpl) =>
        [tmpl.name, tmpl.description, tmpl.creator, tmpl.category].some((s) =>
          s.toLowerCase().includes(q),
        ),
      );
      if (hit.length) out[cat] = hit;
    }
    return out;
  }, [templates, query]);

  const configureHref = (tmpl: WorkflowTemplate) =>
    `/${owner}/${repo}/new/${encodeURIComponent(defaultBranch)}?filename=${encodeURIComponent(
      `.github/workflows/${tmpl.filename}`,
    )}&workflow_template=${encodeURIComponent(tmpl.template)}`;

  return (
    <div className={PAGE_SHELL}>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold">{t("actions.newWorkflow.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("actions.newWorkflow.desc")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("actions.newWorkflow.skipPrefix")}{" "}
          <Link
            to={`/${owner}/${repo}/new/${encodeURIComponent(defaultBranch)}?filename=${encodeURIComponent(
              ".github/workflows/main.yml",
            )}&workflow_template=blank`}
            className="font-medium text-primary hover:underline"
          >
            {t("actions.newWorkflow.skipLink")}
          </Link>
        </p>

        {/* 搜索框（官方 "Search workflows"） */}
        <div className="relative mt-4">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("actions.newWorkflow.search")}
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="mt-6 rounded-lg border p-6 text-center text-sm text-muted-foreground">
            {t("actions.newWorkflow.loadFailed")}
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {categories.map((cat) => {
              const list = filtered[cat.id] ?? [];
              if (list.length === 0) return null;
              const hasMore = !categoryParam && (templates[cat.id] ?? []).length >= PREVIEW_COUNT;
              return (
                <section key={cat.id}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{cat.name}</h2>
                    {hasMore && (
                      <Link
                        to={`/${owner}/${repo}/actions/new?category=${encodeURIComponent(cat.id)}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {t("actions.newWorkflow.viewAll", { category: cat.name })}
                      </Link>
                    )}
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {list.map((tmpl) => (
                      <div key={tmpl.template} className="flex flex-col rounded-lg border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-medium">{tmpl.name}</h3>
                            {tmpl.creator && (
                              <p className="text-xs text-muted-foreground">
                                {t("actions.newWorkflow.by", { creator: tmpl.creator })}
                              </p>
                            )}
                          </div>
                          <TemplateIcon iconName={tmpl.iconName} name={tmpl.name} />
                        </div>
                        {tmpl.description && (
                          <p className="mt-2 flex-1 text-sm text-muted-foreground">
                            {tmpl.description}
                          </p>
                        )}
                        <Link
                          to={configureHref(tmpl)}
                          className="mt-3 text-sm font-medium text-primary hover:underline"
                        >
                          {t("actions.newWorkflow.configure")}
                        </Link>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
