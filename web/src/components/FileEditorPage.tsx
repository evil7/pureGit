/**
 * 文件编辑器页面（从 FileEditDialog 弹框整页化，复刻官方布局）
 *
 * 路由（与官方一致）：
 * - /:owner/:repo/new/:branch/*   新建文件（通配符为初始路径前缀，可选）
 * - /:owner/:repo/edit/:branch/*  编辑文件（通配符为文件路径，必填）
 *
 * 布局（官方 Create/Edit file 页 实测对齐）：
 * - 两栏：左 Files 文件树（共享 FileTreeSidebar）+ 右编辑区
 * - 编辑区顶部：面包屑（repo / 目录段 / 文件名输入）in {branch} + 右上角 Cancel changes / Commit changes… 按钮
 * - 编辑区：编辑/预览 tab + 编辑器（CodeMirror）
 * - Commit Dialog：commit message + extended description + Direct commit or PR（Radio 分组）
 *
 * 数据：PUT /repos/{o}/{r}/contents/{path}（有 sha 更新，无 sha 新增；新建分支先 POST /git/refs 两段式）。
 */
import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NeedFork } from "@/components/NeedFork";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CodeEditor } from "@/components/CodeEditor";
import { InlineError } from "@/components/InlineError";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { FileTreeSidebar } from "@/pages/RepoCode";
import { useRepoTree, type TreeNode } from "@/lib/repo/file-tree";
import {
  fetchFileTree,
  updateFileContent,
  createBranch,
  apiErrorMessage,
  type GitTree,
} from "@/lib/restapi";
// 编辑模式数据走 fetchFileEditSmart（一次 GraphQL 拿 blob 内容+sha，
// 降级链完备；不再单独 REST fetchFileMeta + smart 内容两条通道）
import { fetchFileEditSmart } from "@/lib/api";
import { PAGE_SHELL, CONTENT_FILL } from "@/lib/ui/layout";
import { cn } from "@/lib/utils";

export function FileEditorPage() {
  const { owner = "", repo = "", branch = "", "*": rest = "" } = useParams();
  const { token, user } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const navigate = useNavigate();
  const location = useLocation();
  const path = rest; // 编辑：文件路径；新建：可选前缀
  // 路由模式区分（bug 修复）：new/:branch/* 的 * 是**目录前缀**（非文件名），
  // 不能用 rest 是否为空判断新建——否则 new/main/docs（在 docs 目录新建）会被误判为编辑，
  // 把 "docs" 当文件名预填、并按目录请求内容返回 JSON 显示（用户反馈 bug）。
  const isNew = location.pathname.startsWith(`/${owner}/${repo}/new`);

  // 路径状态：dirs（已确认目录段）+ fileName（输入框，可能含未切分的 /）
  // 官方交互：输入 / 自动把 / 前内容切成目录段；输入框最前 Backspace 合并最后目录段回来
  const initDirs = useMemo(
    () =>
      isNew
        ? path.split("/").filter(Boolean) // 新建：整个 rest 都是目录前缀
        : path.split("/").slice(0, -1).filter(Boolean), // 编辑：除最后一段都是目录
    [isNew, path],
  );
  const initName = useMemo(
    () => (isNew ? "" : (path.split("/").pop() ?? "")), // 新建：文件名留空（等用户输入）
    [isNew, path],
  );
  const [dirs, setDirs] = useState<string[]>(initDirs);
  const [fileName, setFileName] = useState<string>(initName);

  const [content, setContent] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [extDesc, setExtDesc] = useState("");
  const [sha, setSha] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Commit Dialog（官方右上角 Commit changes… 弹框）
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMode, setCommitMode] = useState<"direct" | "pr">("direct");
  // 新分支默认名（官方 <login>-patch-1）
  const defaultNewBranch = useMemo(() => `${user?.login ?? owner}-patch-1`, [user, owner]);
  const [newBranch, setNewBranch] = useState(defaultNewBranch);

  // user 加载完成（登录恢复）后刷新默认新分支名
  useEffect(() => {
    setNewBranch(defaultNewBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultNewBranch]);

  // 完整目标路径（目录段 + 文件名）
  const fullPath = useMemo(() => [...dirs, fileName].filter(Boolean).join("/"), [dirs, fileName]);

  // 左栏文件树（两栏布局；共享 FileTreeSidebar，数据同 blob 页）
  const [tree, setTree] = useState<GitTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const treeRoot = useRepoTree(tree);
  useEffect(() => {
    let cancelled = false;
    setTreeError(null);
    fetchFileTree(owner, repo, branch, token)
      .then((t) => {
        if (cancelled) return;
        setTree(t);
        if (t.truncated) setTreeError("文件树过大，GitHub 已截断（仅显示部分文件）");
      })
      .catch(() => !cancelled && setTreeError("文件树加载失败"));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);
  // 当前编辑/新建路径高亮（tree 侧栏）
  const treeCurrentPath = fullPath;
  const treeNode: TreeNode | null = treeRoot;

  // 从 blob 预览页点编辑进入：blob 已加载内容经 location.state 注入（省一次内容请求）；
  // 直接访问编辑链接（无 state）→ 自己走 fetchFileContentSmart 加载（与 blob 页同通道）
  const injectedContent = useMemo(
    () => (location.state as { content?: string } | null)?.content,
    [location.state],
  );

  // 编辑模式：加载文件内容 + sha（新建时无需加载）
  // 一次 fetchFileEditSmart——注入内容（blob→编辑）时 skipContent 只取 sha；
  // 直接访问链接时一次 GraphQL 拿内容+sha（原 REST sha + smart 内容两条通道 → 单通道）
  useEffect(() => {
    if (isNew || !token) return;
    let cancelled = false;
    setError(null);
    setSha(undefined);
    setContent(injectedContent ?? "");
    const load = async () => {
      try {
        const data = await fetchFileEditSmart(
          owner,
          repo,
          path,
          token,
          branch,
          injectedContent != null, // 已注入内容 → 仅取 sha
        );
        if (cancelled) return;
        setSha(data.sha);
        setCommitMessage(`Update ${path.split("/").pop()}`);
        if (data.content != null) setContent(data.content);
      } catch {
        if (!cancelled) setError("文件加载失败（可能超过 100MB 或为二进制）");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, path, isNew, token, injectedContent]);

  // 新建：预填 commit message（官方实测预填 "Create {fileName}"）
  useEffect(() => {
    if (isNew) {
      setCommitMessage(fileName ? `Create ${fileName}` : "");
    }
  }, [isNew, fileName]);

  // 路由 path 变化时重置路径状态（编辑 A → 编辑 B）
  useEffect(() => {
    setDirs(initDirs);
    setFileName(initName);
  }, [initDirs, initName]);

  const submit = async () => {
    if (!token || busy) return;
    const target = fullPath;
    if (!target || !target.trim() || !commitMessage.trim()) return;
    // 新建分支名：pr 模式且输入非空 → 分支名；否则 null（direct 模式/空输入）
    // ⚠️ 不能是布尔 false（`false ?? branch` 会得 false——?? 只对 null/undefined 生效）
    const useNewBranch: string | null =
      commitMode === "pr" && newBranch.trim() ? newBranch.trim() : null;
    setBusy(true);
    setError(null);
    try {
      // GitHub message 约定：commit message + `\n\n` + extended description
      const fullMessage = extDesc.trim()
        ? `${commitMessage.trim()}\n\n${extDesc.trim()}`
        : commitMessage.trim();
      if (useNewBranch) {
        // 官方两段式：先建分支，再提交到新分支（contents API 无 new_branch 参数）
        await createBranch(owner, repo, useNewBranch, branch, token);
        await updateFileContent(
          owner,
          repo,
          target.trim(),
          content,
          fullMessage,
          useNewBranch,
          token,
          sha,
        );
      } else {
        await updateFileContent(
          owner,
          repo,
          target.trim(),
          content,
          fullMessage,
          branch,
          token,
          sha,
        );
      }
      setCommitOpen(false);
      // 跳转：直接提交 → 原分支 blob；新建分支 → 新分支 blob
      navigate(`/${owner}/${repo}/blob/${useNewBranch ?? branch}/${target.trim()}`);
    } catch (e) {
      setError(
        apiErrorMessage(
          e,
          useNewBranch
            ? `提交失败（分支 ${useNewBranch} 可能已存在）`
            : "提交失败（可能文件超 1MB 或为二进制）",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = token && fullPath.trim() && commitMessage.trim();

  // —— 智能文件名输入框（官方交互）——
  // 输入 /：自动把 / 前内容切成面包屑目录段，输入框只留 / 后文件名
  // 输入框最前 Backspace：把最后一个目录段合并回输入框（可再次用 / 分割）
  const handleFileNameChange = (raw: string) => {
    const slashIdx = raw.lastIndexOf("/");
    if (slashIdx === -1) {
      setFileName(raw);
      return;
    }
    // 把 / 前的段并入目录（支持粘贴完整路径一次切分）。
    // 用函数式更新 + 前缀去重：若 head 与现有 dirs 尾部重复（整体替换输入的场景），
    // 只追加新增部分，避免重复目录段。
    const headParts = raw.slice(0, slashIdx).split("/").filter(Boolean);
    const tail = raw.slice(slashIdx + 1);
    setDirs((prev) => {
      const prevStr = prev.join("/");
      const headStr = headParts.join("/");
      if (prev.length === 0) return headParts;
      // head 已完整包含现有 dirs（编辑 README.md → 粘贴 aaa/bbb/ccc/ddd.js）→ 整体替换
      if (headStr === prevStr || headStr.endsWith(`/${prevStr}`)) {
        return headParts;
      }
      // head 是现有 dirs 的超集前缀（逐步输入 / 后追加新段）→ 只追加增量
      if (headStr.startsWith(`${prevStr}/`)) {
        return [...prev, ...headParts.slice(prev.length)];
      }
      // 输入框继续延伸（prev=aaa/bbb，输入框 ccc/ddd.js → head=ccc）→ 追加 head
      return [...prev, ...headParts];
    });
    setFileName(tail);
  };

  const handleFileNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace") return;
    // 仅当光标在输入框最前（且无选区）时触发合并
    const el = e.currentTarget;
    if (el.selectionStart !== 0 || el.selectionEnd !== 0) return;
    if (dirs.length === 0) return;
    e.preventDefault();
    // 把最后一个目录段合并回输入框：last/ + 当前值
    setDirs((prev) => prev.slice(0, -1));
    setFileName((prevName) => `${dirs[dirs.length - 1]}/${prevName}`);
  };

  // 仓库归属判断：无仓库写权限（WRITE+ 以下）不能直接编辑/新建/删除文件，
  // 右栏渲染 fork 引导卡（官方语义：先 fork 到本人副本再修改，改动经 PR 提交回原仓库）
  const isOwnRepo = !token || canWriteRepo;

  return (
    <div className={PAGE_SHELL}>
      {/* 屏幕阅读器标题（官方 sr-only） */}
      <h1 className="sr-only">
        {isNew ? "新增文件" : `编辑 ${fileName}`} in {repo}
      </h1>

      {/* 两栏布局（官方 Create/Edit file：左 Files 文件树 + 右编辑区，同 blob 页断点） */}
      <div className="grid items-start gap-3 md:grid-cols-[240px_1fr] lg:grid-cols-[320px_1fr]">
        {/* 左栏：文件树（共享 FileTreeSidebar） */}
        <FileTreeSidebar branch={branch} currentPath={treeCurrentPath} treeRoot={treeNode} />

        {/* 右栏：编辑区（非本人仓库 → NeedFork 占位引导页替代：fork 目标下拉 + fork 按钮） */}
        <div className={cn("min-w-0", CONTENT_FILL)}>
          {!isOwnRepo ? (
            <NeedFork owner={owner} action={isNew ? "新建" : "编辑"} />
          ) : (
            <>
              {treeError && (
                <InlineError message={treeError} variant="warning" size="sm" className="mb-2" />
              )}

              {/* 面包屑 + 文件名输入框 + 右上角操作按钮（官方 Create/Edit file 头部：同一行，面包屑左、按钮右） */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                {/* 左：面包屑（仓库名 + 目录段 + 文件名输入框 in branch） */}
                <div className="flex flex-wrap items-center gap-1">
                  {/* 仓库名（不带 owner，官方同款） */}
                  <Link
                    to={`/${owner}/${repo}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {repo}
                  </Link>
                  {/* 目录段（可点击跳 tree 页） */}
                  {dirs.map((d, i) => (
                    <Fragment key={`${i}-${d}`}>
                      <span aria-hidden>/</span>
                      <Link
                        to={`/${owner}/${repo}/tree/${branch}/${dirs.slice(0, i + 1).join("/")}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {d}
                      </Link>
                    </Fragment>
                  ))}
                  <span aria-hidden>/</span>
                  {/* 文件名输入框（最前 Backspace 合并目录段） */}
                  <Input
                    value={fileName}
                    onChange={(e) => handleFileNameChange(e.target.value)}
                    onKeyDown={handleFileNameKeyDown}
                    placeholder="Name your file…"
                    className="w-40 rounded-md border px-2 font-mono text-sm"
                    autoFocus={isNew}
                    aria-label="File name"
                  />
                  <span className="mx-1">in</span>
                  <Link
                    to={`/${owner}/${repo}/tree/${branch}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {branch}
                  </Link>
                </div>
                {/* 右：Cancel changes + Commit changes…（官方右上角） */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => navigate(-1)}>
                    Cancel changes
                  </Button>
                  <Button
                    disabled={!token || !fullPath.trim()}
                    onClick={() => {
                      setError(null);
                      setCommitMode("direct");
                      setNewBranch(defaultNewBranch);
                      setCommitOpen(true);
                    }}
                  >
                    Commit changes…
                  </Button>
                </div>
              </div>

              {/* 编辑区：CodeEditor（行号 + 编辑/预览 + 高亮，撑满右栏高度） */}
              <div className="flex flex-col gap-2">
                <CodeEditor
                  value={content}
                  onChange={setContent}
                  path={fullPath}
                  placeholder="文件内容…"
                  minHeight="min-h-[calc(100svh-10rem)]"
                />
              </div>
            </>
          )}
        </div>
      </div>
      {/* 编辑区 / 右栏 / 两栏 grid */}

      {/* Commit Dialog（官方 Commit changes… 弹框） */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              {isNew ? `Creating a new file in ${repo}` : `Editing ${fileName} in ${repo}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="commit-message">Commit message</Label>
              <Input
                id="commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={isNew ? "Create new file" : "Update file"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ext-desc">Extended description</Label>
              <Textarea
                id="ext-desc"
                value={extDesc}
                onChange={(e) => setExtDesc(e.target.value)}
                placeholder="Add an optional extended description…"
                rows={3}
                className="text-sm"
              />
            </div>
            <RadioGroup
              value={commitMode}
              onValueChange={(v) => setCommitMode(v as "direct" | "pr")}
              className="gap-2.5"
            >
              <Label className="flex items-start gap-2 font-normal">
                <RadioGroupItem value="direct" className="mt-0.5" />
                <span className="text-sm">
                  Commit directly to the{" "}
                  <span className="font-mono text-xs font-medium">{branch}</span> branch
                </span>
              </Label>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="pr" className="mt-0.5" />
                <div className="grid gap-1.5">
                  <Label className="text-sm font-normal">
                    Create a new branch for this commit and start a pull request
                  </Label>
                  {commitMode === "pr" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Your new branch will be created:
                      </span>
                      <Input
                        value={newBranch}
                        onChange={(e) => setNewBranch(e.target.value)}
                        className="w-52 font-mono"
                        aria-label="New branch name"
                      />
                    </div>
                  )}
                </div>
              </div>
            </RadioGroup>
          </div>
          {error && <InlineError message={error} size="sm" />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCommitOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit || busy}>
              {busy ? "Committing…" : "Commit changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
