/**
 * 新建讨论两段式整页（/discussions/new/choose → /discussions/new）—— 自 DiscussionsPage 拆出。
 * 第一段选分类（grid 卡片跳转带 category query），第二段填标题 + 正文。
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchDiscussionsSmart,
  createDiscussionSmart,
  fetchRepositoryIdSmart,
  categorySlug,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/restapi";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { LoginPrompt } from "@/components/LoginPrompt";
import { emoji } from "./constants";

/** 第一段：选择分类（官方 grid 卡片，点击跳转 /discussions/new?category={slug}） */
export function NewDiscussionChoosePage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const [categories, setCategories] = useState<
    { id: string; name: string; emoji: string; description?: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchDiscussionsSmart(owner!, repo!, token, null, null, null, null)
      .then((d) => !cancelled && setCategories(d.categories))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("discussions.new")}</h1>
        <p className="text-sm text-muted-foreground">{t("discussions.chooseCategory")}</p>
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              to={`/${owner}/${repo}/discussions/new?category=${categorySlug(c.name)}`}
              className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/50"
            >
              <span className="text-2xl">{emoji(c.emoji)}</span>
              <h3 className="mt-2 font-medium group-hover:text-primary">{c.name}</h3>
              {c.description && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {c.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** 第二段：填写标题 + 正文（官方 /discussions/new?category={slug}） */
export function NewDiscussionPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const categorySlugUrl = searchParams.get("category") ?? "";

  const [categories, setCategories] = useState<
    { id: string; name: string; emoji: string; description?: string | null }[]
  >([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchDiscussionsSmart(owner!, repo!, token, null, null, null, null)
      .then((d) => !cancelled && setCategories(d.categories))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  const categoryId = categories.find((c) => categorySlug(c.name) === categorySlugUrl)?.id ?? "";
  const canSubmit = categoryId && title.trim() && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const tk = token!;
    setSubmitting(true);
    setError(null);
    try {
      const repositoryId = await fetchRepositoryIdSmart(tk, owner!, repo!);
      if (!repositoryId) throw new Error(t("discussions.createFailed"));
      const number = await createDiscussionSmart(
        repositoryId,
        categoryId,
        title.trim(),
        body.trim(),
        tk,
      );
      setBody("");
      setTitle("");
      setResetKey((k) => k + 1);
      navigate(`/${owner}/${repo}/discussions/${number}`);
    } catch (err) {
      setError(apiErrorMessage(err, t("discussions.createFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return <LoginPrompt title={t("discussions.loginRequired")} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* 面包屑（官方：repo / Category name） */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Link
          to={`/${owner!}/${repo!}/discussions`}
          className="font-medium text-foreground hover:underline"
        >
          {repo}
        </Link>
        <span aria-hidden>/</span>
        <Link
          to={`/${owner!}/${repo!}/discussions/new/choose`}
          className="text-muted-foreground hover:text-foreground"
        >
          {t("discussions.new")}
        </Link>
        {categoryId && (
          <>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">
              {categories.find((c) => c.id === categoryId)?.name}
            </span>
          </>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {/* 分类徽标 */}
        <div className="flex items-center gap-2">
          {categories
            .filter((c) => c.id === categoryId)
            .map((c) => (
              <Badge key={c.id} variant="secondary">
                {emoji(c.emoji)} {c.name}
              </Badge>
            ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("discussions.titleLabel")}</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("discussions.titlePlaceholder")}
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("discussions.bodyLabel")}</label>
          <MarkdownEditor
            key={resetKey}
            owner={owner}
            repo={repo}
            defaultValue=""
            rows={10}
            placeholder={t("discussions.bodyPlaceholder")}
            onChange={setBody}
          />
        </div>

        {error && <InlineError message={error} size="sm" />}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? t("common.creating") : t("discussions.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
