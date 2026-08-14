/**
 * Gist 页面（列表/详情/编辑整页化）
 *
 * - /gist/new      新建 Gist 整页（官方 gist 编辑页排布：描述 → 可见性 → 文件区 → 保存）
 * - /gist/:id/edit 编辑 Gist 整页（与新建共用 GistEditor）
 * - /gist/:id      详情：描述 + 各文件 Shiki 高亮（编辑入口跳转 /edit）
 *
 * 数据：GET /gists/{id}（详情含 content）、POST/PATCH /gists（创建/编辑）。
 * 未登录 → 登录引导；无 gist scope → 写操作置灰。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  PencilLine,
  Lock,
  Globe,
  FileCode2,
  ArrowLeft,
  Star,
  GitFork,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeEditor } from "@/components/CodeEditor";
import { CodeView } from "@/components/CodeView";
import { LoginPrompt } from "@/components/LoginPrompt";
import { PermissionGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useI18n } from "@/i18n";
import {
  fetchGistDetail,
  createGist,
  updateGist,
  apiErrorMessage,
  normalizeApiError,
  ApiError,
  isGistStarred,
  fetchGistForks,
  starGist,
  unstarGist,
  type Gist,
} from "@/lib/api";
import { inferLang } from "@/lib/code/shiki";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { cn } from "@/lib/utils";

// ===== Gist 编辑器页面（新建 /gist/new 与编辑 /gist/:id/edit 共用） =====

interface GistFileDraft {
  name: string;
  content: string;
}

function GistEditor({ existing }: { existing?: Gist | null }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const isEdit = Boolean(existing);
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [files, setFiles] = useState<GistFileDraft[]>([{ name: "snippet.js", content: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 编辑模式：加载现有 gist 数据填充表单（仅首次）
  useEffect(() => {
    if (!existing) return;
    setDescription(existing.description ?? "");
    setIsPublic(existing.public);
    setFiles(
      Object.values(existing.files).map((f) => ({
        name: f.filename,
        content: f.content ?? "",
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validFiles = files.filter((f) => f.name.trim() && f.content.trim());
  const canSubmit = !busy && validFiles.length > 0;

  const submit = async () => {
    if (!token || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const filesObj: Record<string, { content: string }> = {};
      validFiles.forEach((f) => {
        filesObj[f.name.trim()] = { content: f.content };
      });
      const g = existing
        ? await updateGist(token, existing.id, { description, files: filesObj })
        : await createGist(token, { description, public: isPublic, files: filesObj });
      navigate(`/gist/${g.id}`);
    } catch (e) {
      setError(apiErrorMessage(e, t("gist.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${PAGE_SHELL} mx-auto max-w-4xl`}>
      {/* 返回 + 标题 */}
      <div className="mb-5 flex items-center gap-3">
        <Button variant="ghost" className="gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          {t("common.back")}
        </Button>
        <h1 className="text-2xl font-semibold">
          {isEdit ? t("gist.editTitle") : t("gist.createTitle")}
        </h1>
      </div>

      {/* 描述（官方 gist 编辑页顶部描述输入） */}
      <div className="mb-4">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("gist.descPlaceholder")}
          className="h-11 text-base"
        />
      </div>

      {/* 文件列表（官方文件编辑器排布：文件名 + 语言徽章 + 内容） */}
      <div className="space-y-4">
        {files.map((f, idx) => (
          <div key={idx} className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={f.name}
                onChange={(e) =>
                  setFiles((fs) =>
                    fs.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder={t("gist.filePlaceholder")}
                className="h-8 flex-1 font-mono text-sm"
              />
              {f.name.trim() && inferLang(f.name) !== "text" && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {inferLang(f.name)}
                </Badge>
              )}
              {files.length > 1 && (
                <Button
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  onClick={() => setFiles((fs) => fs.filter((_, i) => i !== idx))}
                >
                  {t("gist.removeFile")}
                </Button>
              )}
            </div>
            <CodeEditor
              value={f.content}
              onChange={(v) =>
                setFiles((fs) => fs.map((x, i) => (i === idx ? { ...x, content: v } : x)))
              }
              path={f.name || "snippet.txt"}
              placeholder="// …"
              minHeight="min-h-64"
            />
          </div>
        ))}

        <Button
          variant="outline"
          className="gap-1"
          onClick={() => setFiles((fs) => [...fs, { name: "", content: "" }])}
        >
          <Plus className="size-4" />
          {t("gist.addFile")}
        </Button>
      </div>

      {/* 可见性 + 保存 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          {isPublic ? (
            <Globe className="size-4 text-muted-foreground" />
          ) : (
            <Lock className="size-4 text-muted-foreground" />
          )}
          <span className="font-medium">{isPublic ? t("gist.public") : t("gist.secret")}</span>
          <Switch
            id="gist-public"
            checked={isPublic}
            onCheckedChange={setIsPublic}
            disabled={isEdit} // 编辑不可改可见性（GitHub 同限制：gist 公开性创建后固定）
          />
        </div>
        <div className="flex items-center gap-2">
          {error && <InlineError message={error} size="sm" />}
          <PermissionGate permission="gist" className="inline-flex">
            <Button onClick={() => void submit()} disabled={!canSubmit} className="gap-1">
              {busy
                ? t("gist.saving")
                : isEdit
                  ? t("gist.save")
                  : isPublic
                    ? t("gist.createPublic")
                    : t("gist.createSecret")}
            </Button>
          </PermissionGate>
        </div>
      </div>
    </div>
  );
}

// ===== 新建 Gist 页（/gist/new） =====

export function NewGistPage() {
  const { token } = useAuth();
  const { t } = useI18n();

  if (!token) {
    return (
      <div className={cn(PAGE_SHELL, "mx-auto max-w-md")}>
        {/* 统一登录引导模板：只提醒 + 聚光灯指引右上角 */}
        <LoginPrompt title={t("gist.createTitle")} desc={t("gist.loginFirst")} />
      </div>
    );
  }

  return <GistEditor />;
}

// ===== 编辑 Gist 页（/gist/:id/edit） =====

export function GistEditPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [gist, setGist] = useState<Gist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGistDetail(id, token)
      .then((g) => !cancelled && setGist(g))
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  if (!token) {
    return (
      <div className={cn(PAGE_SHELL, "mx-auto max-w-md")}>
        <LoginPrompt title={t("gist.editTitle")} desc={t("gist.loginFirst")} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${PAGE_SHELL} space-y-3`}>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // 整页级致命错误（gist 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error || !gist) throw error ?? new ApiError(404);

  return <GistEditor existing={gist} />;
}

// ===== Gist 详情页（/gist/:id）=====

export function GistDetailPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [gist, setGist] = useState<Gist | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // C7：star/fork 计数 + star 状态
  const [starred, setStarred] = useState(false);
  const [forksCount, setForksCount] = useState(0);
  const [starBusy, setStarBusy] = useState(false);
  // 竞态/卸载防护：load 由 effect 调用
  const mountedRef = useRef(true);

  const load = () => {
    if (!id) return;
    setGist(null);
    setError(null);
    fetchGistDetail(id, token)
      .then((g) => {
        if (mountedRef.current) setGist(g);
      })
      .catch((e: unknown) => {
        if (mountedRef.current) setError(normalizeApiError(e));
      });
    // C7：star 状态 + fork 数（需 gist scope，失败静默）
    if (token) {
      isGistStarred(id, token)
        .then((s) => mountedRef.current && setStarred(s))
        .catch(() => undefined);
      fetchGistForks(id, token)
        .then((fs) => mountedRef.current && setForksCount(fs.length))
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // 整页级致命错误（gist 不存在/限流/5xx）→ 路由 errorElement 全局错误页
  if (error) throw error;

  if (!gist) {
    return (
      <div className={`${PAGE_SHELL} space-y-3`}>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const firstFile = Object.values(gist.files)[0];

  return (
    <div className={PAGE_SHELL}>
      {/* 头部：描述 + 可见性 + 操作 */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">
            {gist.description || firstFile?.filename || gist.id}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={gist.public ? "outline" : "secondary"} className="text-xs">
              {gist.public ? (
                <span className="flex items-center gap-1">
                  <Globe className="size-3" /> 公开
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Lock className="size-3" /> 私有
                </span>
              )}
            </Badge>
            {gist.owner && (
              <span>
                <Link to={`/${gist.owner.login}`} className="text-primary hover:underline">
                  @{gist.owner.login}
                </Link>
              </span>
            )}
            <span>更新于 {fmt(gist.updated_at)}</span>
          </div>
        </div>
        {token && (
          <PermissionGate permission="gist" className="inline-flex">
            <Button variant="outline" className="gap-1" asChild>
              <Link to={`/gist/${gist.id}/edit`}>
                <PencilLine className="size-3.5" />
                {t("common.edit")}
              </Link>
            </Button>
          </PermissionGate>
        )}
      </div>

      {/* C7：star / fork 计数 + star 切换（官方 gist 详情头部） */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {token && (
          <PermissionGate permission="gist">
            <Button
              variant={starred ? "default" : "outline"}
              className="gap-1"
              disabled={starBusy}
              onClick={async () => {
                setStarBusy(true);
                try {
                  if (starred) {
                    await unstarGist(id, token);
                    setStarred(false);
                  } else {
                    await starGist(id, token);
                    setStarred(true);
                  }
                } catch {
                  /* 静默 */
                } finally {
                  setStarBusy(false);
                }
              }}
            >
              <Star className="size-3.5" fill={starred ? "currentColor" : "none"} />
              {starred ? t("gist.unstar") : t("gist.star")}
            </Button>
          </PermissionGate>
        )}
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Star className="size-3.5" />
          {starred ? 1 : 0}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <GitFork className="size-3.5" />
          {forksCount}
        </span>
        {typeof gist.comments === "number" && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MessageSquare className="size-3.5" />
            {gist.comments}
          </span>
        )}
      </div>

      {/* 文件列表（每文件 Shiki 高亮） */}
      <div className="space-y-4">
        {Object.values(gist.files).map((f) => (
          <div key={f.filename} className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              <FileCode2 className="size-3.5" />
              <span className="font-mono">{f.filename}</span>
              {f.language && (
                <Badge variant="secondary" className="text-xs">
                  {f.language}
                </Badge>
              )}
              <span className="ml-auto">{(f.size / 1024).toFixed(1)} KB</span>
            </div>
            <div className="overflow-hidden">
              <CodeView code={f.content ?? ""} path={f.filename} minHeight="min-h-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
