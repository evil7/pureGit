/**
 * 新建 Pull Request 整页（复刻官方 /owner/repo/pulls/new + compare 单页合并）
 *
 * 官方路径：/{owner}/{repo}/pulls/new（替换域名即可访问官方同页）
 * - 未登录/只读：登录引导
 * - 已登录：base/compare 分支选择 → **compare 统计条 + diff 预览（DiffView）**
 *   → 标题 + 正文（MarkdownEditor）；成功后跳 PR 详情
 *
 * 对比官方「/compare 预览页 → /pulls/new 两页」，简版合并为单页——
 * 分支选择下方自动加载 diff 预览，操作由繁化简。
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, GitCompare, GitCommitHorizontal, Plus, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { createPullRequestSmart, fetchBranchesSmart } from "@/lib/api";
import { fetchCompare, type CompareResult } from "@/lib/rest";
import { PAGE_SHELL } from "@/lib/layout";
import { LoginPrompt } from "@/components/LoginPrompt";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DiffView } from "@/components/DiffView";

export default function NewPullRequestPage() {
  const { owner = "", repo = "" } = useParams();
  const { token, canWrite } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [base, setBase] = useState("main");
  // compare 预填（官方 compare/<branch>?expand=1 → pulls/new?compare=<branch>；如 RecentPushesBanner 入口）
  const [head, setHead] = useState(searchParams.get("compare") ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 分支列表（REST /branches；加载失败降级为手动输入）
  const [branches, setBranches] = useState<string[] | null>(null);
  // 分支 sha 映射（DiffView Expand 用）
  const [branchShas, setBranchShas] = useState<Record<string, string>>({});
  // compare 预览（base/head 变化自动加载）
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchBranchesSmart(owner, repo, token)
      .then((list) => {
        if (cancelled) return;
        const names = list.map((b) => b.name);
        setBranches(names);
        setBranchShas(Object.fromEntries(list.map((b) => [b.name, b.commit.sha])));
        if (names.length && !names.includes(base)) {
          // 默认分支非 main 时自动对齐首个分支（按名称排序近似默认分支）
          setBase(names[0] ?? "main");
        }
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  // base/head 确定后加载 compare 预览
  useEffect(() => {
    if (!base.trim() || !head.trim() || base === head) {
      setCompare(null);
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    setCompareError(false);
    setCompare(null);
    fetchCompare(owner, repo, base, head, token)
      .then((d) => !cancelled && setCompare(d))
      .catch(() => !cancelled && setCompareError(true))
      .finally(() => !cancelled && setCompareLoading(false));
    return () => {
      cancelled = true;
    };
  }, [base, head, owner, repo, token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !title.trim() || !head.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const number = await createPullRequestSmart(token, owner, repo, {
        title: title.trim(),
        body: body.trim() || undefined,
        base: base.trim(),
        head: head.trim(),
      });
      navigate(`/${owner}/${repo}/pulls/${number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt
          title="新建 Pull Request"
          desc="登录后可提交 PR，请求由你的 GitHub 账号发出。"
        />
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className={`${PAGE_SHELL} mx-auto max-w-md`}>
        <LoginPrompt title="新建 Pull Request" desc="只读模式无法创建，请切换完全控制后重试。" />
      </div>
    );
  }

  const branchSelect = (
    id: string,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
  ) =>
    branches === null ? (
      <Input
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder="加载分支中…"
        disabled
      />
    ) : branches.length > 0 ? (
      <Select value={value || undefined} onValueChange={setter}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Input
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
        required
      />
    );

  return (
    <div className={PAGE_SHELL}>
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link to={`/${owner}/${repo}/pulls`}>
            <ArrowLeft className="size-4" />
            返回 Pull Requests
          </Link>
        </Button>
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-semibold">
          <GitCompare className="size-6 text-muted-foreground" />
          新建 Pull Request
        </h1>
        <form onSubmit={submit} className="space-y-4">
          {/* 分支选择（官方 base ↔ compare） */}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="space-y-1.5">
              <Label htmlFor="pr-base">base（目标分支）</Label>
              {branchSelect("pr-base", base, setBase, "选择分支")}
            </div>
            <div className="hidden text-center text-xs font-medium text-muted-foreground sm:block">
              …
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-head">compare（来源分支）</Label>
              {branchSelect("pr-head", head, setHead, "feature/xxx")}
            </div>
          </div>
          {branches !== null && branches.length === 0 && (
            <p className="text-xs text-muted-foreground">分支列表加载失败，请手动输入分支名。</p>
          )}

          {/* compare 统计条 + diff 预览（官方 compare 页内容） */}
          {compareLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : compareError ? (
            <InlineError message="compare 加载失败" size="sm" />
          ) : compare && compare.files.length === 0 ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {head} 与 {base} 没有可比较的差异。
            </p>
          ) : compare ? (
            <div className="space-y-3">
              {/* 统计条（官方：N commits ahead + +A −D） */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Badge variant="outline" className="gap-1">
                  <GitCommitHorizontal className="size-3.5" />
                  {compare.total_commits} commits ahead of {base}
                </Badge>
                <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-add-fg)" }}>
                  <Plus className="size-3.5" />
                  {compare.files.reduce((s, f) => s + f.additions, 0)}
                </Badge>
                <Badge variant="outline" className="gap-1" style={{ color: "var(--diff-del-fg)" }}>
                  <Minus className="size-3.5" />
                  {compare.files.reduce((s, f) => s + f.deletions, 0)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {compare.files.length} 个文件变更
                </span>
              </div>
              {/* diff 预览（复用 DiffView） */}
              <DiffView
                files={compare.files}
                owner={owner}
                repo={repo}
                baseSha={branchShas[base]}
                headSha={branchShas[head]}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="pr-title">标题</Label>
            <Input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR 标题"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-body">内容（Markdown 支持）</Label>
            <MarkdownEditor
              id="pr-body"
              owner={owner}
              repo={repo}
              defaultValue=""
              placeholder="变更说明…"
              rows={6}
              onChange={setBody}
            />
          </div>
          {error && <InlineError message={error} size="sm" />}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting || !title.trim() || !head.trim()}>
              {submitting ? "提交中…" : "创建 Pull Request"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {owner}/{repo}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
