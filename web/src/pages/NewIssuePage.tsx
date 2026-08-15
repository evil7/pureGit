/**
 * 新建 Issue 整页（复刻官方 /owner/repo/issues/new）
 *
 * 官方路径：
 * - /{owner}/{repo}/issues/new/choose → 模板选择页（有 issue 模板时列出卡片）
 * - /{owner}/{repo}/issues/new?template={filename} → 表单页（模板预填正文）
 * - /{owner}/{repo}/issues/new → 表单页（空白）
 *
 * 模板来源（官方语义）：.github/ISSUE_TEMPLATE/ISSUE_TEMPLATE/docs 目录 + 单文件，
 * 解析 front matter（name/about/description）。无模板直接进表单。
 *
 * 表单：标题必填 + Write/Preview 正文 + 右栏 Assignees/Labels 预选
 * + Create more（提交后继续）+ Ctrl+Enter 快捷键。
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bug, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { createIssueSmart, fetchRepoFilterDataSmart } from "@/lib/api";
import {
  apiErrorMessage,
  fetchIssueTemplates,
  type IssueTemplate,
  type RepoLabel,
} from "@/lib/restapi";
import type { GitHubUser } from "@/lib/restapi";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import PageLayout from "@/components/PageLayout";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { LoginPrompt } from "@/components/LoginPrompt";

export default function NewIssuePage() {
  const { owner = "", repo = "" } = useParams();
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // 模板选择视图：/issues/new/choose
  const isChoose = location.pathname.endsWith("/choose");
  // 当前选中模板（?template=filename）
  const templateName = searchParams.get("template") ?? "";

  // ---- 表单状态 ----
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // 模板预填正文（defaultValue 数据源）+ 编辑器重建键（模板加载/创建后继续时 ++）
  const [templateBody, setTemplateBody] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [createMore, setCreateMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 数据 ----
  const [templates, setTemplates] = useState<IssueTemplate[] | null>(null);
  const [labels, setLabels] = useState<RepoLabel[]>([]);
  const [assignees, setAssignees] = useState<GitHubUser[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState("");

  // 当前选中模板对象（用于显示 "Bug report · Choose a different template"）
  const activeTemplate = useMemo(
    () => templates?.find((tmpl) => tmpl.filename === templateName) ?? null,
    [templates, templateName],
  );

  // 首次加载：choose 视图拉模板列表；表单视图拉 labels/assignees + 模板预填
  useEffect(() => {
    if (isChoose) {
      let cancelled = false;
      fetchIssueTemplates(owner, repo, token)
        .then((list) => !cancelled && setTemplates(list))
        .catch(() => !cancelled && setTemplates([]));
      return () => {
        cancelled = true;
      };
    }
    // 表单视图：labels/assignees 预选数据（复合查询一次 GraphQL）+ 模板预填
    let cancelled = false;
    if (token) {
      fetchRepoFilterDataSmart(owner, repo, token)
        .then((fd) => {
          if (cancelled) return;
          setLabels(fd.labels);
          setAssignees(fd.assignees);
        })
        .catch(() => {});
    }
    if (templateName) {
      fetchIssueTemplates(owner, repo, token)
        .then((list) => {
          if (cancelled) return;
          setTemplates(list);
          const tmpl = list.find((x) => x.filename === templateName);
          if (tmpl) {
            // 模板预填：正文（.md）+ 标题/labels（form 模板 front matter）
            setBody(tmpl.content);
            setTemplateBody(tmpl.content);
            setEditorKey((k) => k + 1);
            if (tmpl.prefillTitle) setTitle(tmpl.prefillTitle);
            if (tmpl.prefillLabels?.length) setSelectedLabels(tmpl.prefillLabels);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isChoose, owner, repo, token, templateName]);

  // Ctrl+Enter 提交（官方 ⌃⏎）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void doSubmit();
    }
  };

  const doSubmit = async () => {
    if (!token || !title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const number = await createIssueSmart(token, owner, repo, {
        title: title.trim(),
        body: body.trim() || undefined,
        labels: selectedLabels,
        assignees: selectedAssignee ? [selectedAssignee] : undefined,
      });
      if (createMore) {
        // 继续创建：清空表单（官方 Create more 语义）
        setTitle("");
        setBody("");
        setTemplateBody("");
        setEditorKey((k) => k + 1);
        setSelectedLabels([]);
        setSelectedAssignee("");
      } else {
        navigate(`/${owner}/${repo}/issues/${number}`);
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Issue 创建失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void doSubmit();
  };

  if (!token || !canWrite) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt
          title={t("create.issue")}
          desc={!token ? t("newIssue.loginDesc") : t("newIssue.readonlyDesc")}
        />
      </div>
    );
  }

  // ===== 模板选择视图 =====
  if (isChoose) {
    return (
      <div className={PAGE_SHELL}>
        <div className="mx-auto max-w-3xl">
          <Button variant="ghost" asChild className="mb-3">
            <Link to={`/${owner}/${repo}/issues`}>
              <ArrowLeft className="size-4" />
              {t("newIssue.back")}
            </Link>
          </Button>
          <h1 className="mb-1 text-2xl font-semibold">{t("create.issue")}</h1>
          {templates === null ? (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : templates.length === 0 ? (
            // 无模板：官方直接进空白表单
            <div className="mt-6 rounded-lg border p-6 text-center">
              <p className="text-sm text-muted-foreground">{t("newIssue.noTemplates")}</p>
              <Button className="mt-4" asChild>
                <Link to={`/${owner}/${repo}/issues/new`}>{t("newIssue.createBlank")}</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-6 space-y-2">
              {templates.map((tmpl) => (
                <Link
                  key={tmpl.filename}
                  to={`/${owner}/${repo}/issues/new?template=${encodeURIComponent(tmpl.filename)}`}
                  className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50"
                >
                  <Bug className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium">{tmpl.name}</p>
                    {tmpl.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{tmpl.description}</p>
                    )}
                  </div>
                </Link>
              ))}
              <div className="pt-3">
                <Button variant="ghost" asChild>
                  <Link to={`/${owner}/${repo}/issues/new`}>{t("newIssue.skipTemplate")}</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== 表单视图 =====
  return (
    /* 官方新建页：主列 + 右 metadata（PageLayout 收编 GRID_2COL_ASIDE_280） */
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="sm"
        right={{
          node: (
            <aside className="space-y-5 text-sm">
              {/* Labels（checkbox 多选） */}
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {t("newIssue.labels")}
                </h3>
                {labels.length === 0 ? (
                  <p className="text-muted-foreground">{t("newIssue.noLabels")}</p>
                ) : (
                  <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                    {labels.map((l) => (
                      <label
                        key={l.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
                          selectedLabels.includes(l.name)
                            ? "border-foreground bg-accent"
                            : "border-border hover:bg-accent/50",
                        )}
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: `#${l.color}` }}
                        />
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedLabels.includes(l.name)}
                          onChange={() =>
                            setSelectedLabels((prev) =>
                              prev.includes(l.name)
                                ? prev.filter((n) => n !== l.name)
                                : [...prev, l.name],
                            )
                          }
                        />
                        {l.name}
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* Assignees（下拉单选，官方支持多选 → 简化核心 @me/成员） */}
              <section>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {t("newIssue.assignees")}
                </h3>
                <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("newIssue.assignPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {assignees.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        {t("newIssue.noAssignees")}
                      </SelectItem>
                    ) : (
                      assignees.slice(0, 20).map((a) => (
                        <SelectItem key={a.login} value={a.login}>
                          {a.login}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </section>
            </aside>
          ),
          width: 280,
          sticky: "nav",
        }}
      >
        {/* 主列：标题 + 正文 + 操作按钮 */}
        <div className="space-y-3">
          <Button variant="ghost" asChild className="mb-3">
            <Link to={`/${owner}/${repo}/issues`}>
              <ArrowLeft className="size-4" />
              {t("newIssue.back")}
            </Link>
          </Button>
          <h1 className="mb-2 text-2xl font-semibold">{t("create.issue")}</h1>

          {/* 模板提示（官方：Bug report · Choose a different template） */}
          {activeTemplate && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{activeTemplate.name}</span>
              <span>·</span>
              <Link
                to={`/${owner}/${repo}/issues/new/choose`}
                className="text-primary hover:underline"
              >
                {t("newIssue.chooseTemplate")}
              </Link>
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* 标题（官方 Add a title *） */}
            <div className="space-y-1.5">
              <Label htmlFor="issue-title" className="text-sm font-medium">
                {t("newIssue.titleLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="issue-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("newIssue.titlePlaceholder")}
                required
              />
            </div>

            {/* 正文（官方 Write/Preview；MarkdownEditor） */}
            <div className="space-y-1.5">
              <Label htmlFor="issue-body" className="text-sm font-medium">
                {t("newIssue.bodyLabel")}
              </Label>
              <MarkdownEditor
                id="issue-body"
                key={`issue-${templateName}-${editorKey}`}
                owner={owner}
                repo={repo}
                defaultValue={templateBody}
                placeholder={t("newIssue.bodyPlaceholder")}
                rows={12}
                onChange={setBody}
                onSubmit={() => void doSubmit()}
              />
            </div>

            {error && <InlineError message={error} size="sm" />}

            {/* 底部操作：Create more + Cancel + Create（⌃⏎） */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={createMore} onCheckedChange={(v) => setCreateMore(Boolean(v))} />
                {t("newIssue.createMore")}
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" asChild>
                  <Link to={`/${owner}/${repo}/issues`}>{t("common.cancel")}</Link>
                </Button>
                <Button type="submit" disabled={submitting || !title.trim()}>
                  <Send className="size-3.5" />
                  {submitting ? t("common.submitting") : t("newIssue.create")}
                  <kbd className="ml-1.5 hidden rounded bg-primary-foreground/20 px-1 text-[10px] font-normal sm:inline">
                    ⌃⏎
                  </kbd>
                </Button>
              </div>
            </div>
          </form>
        </div>
      </PageLayout>
    </div>
  );
}
