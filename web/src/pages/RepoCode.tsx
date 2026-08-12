/**
 * Code 系列页面（复刻 GitHub 仓库 Code 区，布局与路径对齐官方）
 *
 * 布局策略（复刻但精简）：
 *   - /:owner/:repo                     → CodeIndex：操作栏 + 根文件列表 + README（全宽）
 *   - /:owner/:repo/tree/:branch/:path* → TreePage：面包屑 + 当前目录列表（全宽）
 *   - /:owner/:repo/blob/:branch/:path* → BlobPage：左文件树 + 右代码预览（双栏）
 *
 * 操作栏（复刻 GitHub）：分支选择器 ▾ | Go to file 搜索框 | Code ▾ 克隆按钮
 * 文件列表条目（复刻 GitHub）：文件夹/文件图标 + 名称 + 更新时间
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  Search,
  Code2,
  Copy,
  Check,
  CornerDownRight,
  Clock,
  History,
  Download,
  PencilLine,
  Trash2,
  Plus,
  SquareCode,
  X,
  ArrowLeft,
  ExternalLink,
  List,
  ArrowUp,
  PanelLeftClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/Tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import {
  fetchFileTree,
  fetchReadme,
  fetchDirContents,
  fetchBranches,
  fetchLatestCommit,
  fetchFileCommit,
  fetchFileMeta,
  deleteFileContent,
  apiErrorMessage,
  type GitTree,
  type DirEntry,
  type ReadmeInfo,
} from "@/lib/rest";
import { fetchFileContentSmart } from "@/lib/api";
import { parseTreePath } from "@/lib/repo-path";
import { WORKER_BASE } from "@/lib/worker-base";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { tStatic } from "@/i18n";
import { useRepoData } from "@/lib/repo-context";
import { FileTree } from "@/components/FileTree";
import { useRepoTree, type TreeNode } from "@/lib/file-tree";
import { MarkdownView } from "@/components/MarkdownView";
import { CodeView } from "@/components/CodeView";
import { UserAvatar } from "@/components/UserAvatar";
import { WriteGate } from "@/components/WriteGate";
import { ForkInfoBar } from "@/components/ForkInfoBar";
import { ArchivedBanner } from "@/components/ArchivedBanner";
import { SegmentedControl } from "@/components/SegmentedControl";
import { cn } from "@/lib/utils";
import { SIDEBAR_STICKY_SCROLL } from "@/lib/layout";
import PageLayout from "@/components/PageLayout";
import { useTreeCollapse, TreeCollapseCtx } from "@/lib/tree-collapse";
import type { EditorView } from "@codemirror/view";
import { collectReferences, type SymbolInfo, type SymbolRef } from "@/lib/symbols";
import { extractOutline, type OutlineItem } from "@/lib/markdown-outline";

/** 分支切换器（官方 ref-selector 同款：FileTreeSidebar 展开态 + blob/tree 折叠态 sticky 头共用）
 * active：折叠态 sticky 头的实例在展开态被 hidden 隐藏但**常驻挂载**（不重挂载→不重复请求），
 * active=false 时不拉取；首次 active=true 拉取一次后 loadedRef 置位，后续折叠/展开切换不再重拉（数据保留在 state）。 */
function BranchPicker({
  branch,
  currentPath,
  compact = false,
  active = true,
}: {
  branch: string;
  currentPath: string;
  compact?: boolean;
  active?: boolean;
}) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const [branches, setBranches] = useState<string[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!active || loadedRef.current) return;
    let cancelled = false;
    loadedRef.current = true;
    fetchBranches(owner, repo, 30, token)
      .then((bs) => !cancelled && setBranches(bs.map((b) => b.name)))
      .catch(() => {
        loadedRef.current = false; // 失败允许下次重试
      });
    return () => {
      cancelled = true;
    };
  }, [active, owner, repo, token]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("font-mono text-xs", compact && "h-7")}>
          <GitBranch className="size-3.5" />
          {branch}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">分支</DropdownMenuLabel>
        {branches.map((b) => (
          <DropdownMenuItem
            key={b}
            className="font-mono text-xs"
            onClick={() => {
              if (b !== branch) {
                // 保留当前文件路径，与官方一致
                window.location.href = `/${owner}/${repo}/blob/${b}/${currentPath}`;
              }
            }}
          >
            {b}
          </DropdownMenuItem>
        ))}
        {branches.length === 0 && (
          <DropdownMenuItem disabled>{tStatic("common.noBranches")}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Go to file 搜索框（官方：输入回车直达文件；折叠态 sticky 头右侧） */
function GoToFileInput({ branch, className }: { branch: string; className?: string }) {
  const { owner = "", repo = "" } = useParams();
  const [filter, setFilter] = useState("");
  const goFile = () => {
    if (!filter.trim()) return;
    window.location.href = `/${owner}/${repo}/blob/${branch}/${filter.trim()}`;
  };
  return (
    <div className={cn("relative w-56", className)}>
      <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && goFile()}
        placeholder="Go to file"
        className="h-8 pl-8 text-sm"
      />
    </div>
  );
}

// ===== 操作栏（分支选择器 + Go to file + 新增文件 + Code 克隆按钮）=====

function RepoActionBar({ branch }: { branch: string }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [copiedType, setCopiedType] = useState<"https" | "ssh" | "mirror" | null>(null);
  // 当前站点域名：镜像 clone 命令指向用户正在访问的域名（不再硬编码生产域名，他人部署自动适配）
  const siteHost = window.location.host;

  useEffect(() => {
    let cancelled = false;
    fetchBranches(owner, repo, 30, token)
      .then((bs) => !cancelled && setBranches(bs.map((b) => b.name)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  const goSearch = () => {
    if (!filter.trim()) return;
    // GitHub 风格：输入文件路径直接跳到对应 blob
    window.location.href = `/${owner}/${repo}/blob/${branch}/${filter.trim()}`;
  };

  const copyClone = async (type: "https" | "ssh" | "mirror", url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* 分支选择器 + 分支计数（官方：main ▾ | 1 Branch） */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="font-mono text-xs">
            <GitBranch className="size-3.5" />
            {branch}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
          <DropdownMenuLabel className="text-xs">分支</DropdownMenuLabel>
          {branches.map((b) => (
            <DropdownMenuItem
              key={b}
              className="font-mono text-xs"
              onClick={() => {
                if (b !== branch) window.location.href = `/${owner}/${repo}/tree/${b}`;
              }}
            >
              {b}
            </DropdownMenuItem>
          ))}
          {branches.length === 0 && (
            <DropdownMenuItem disabled>{tStatic("common.noBranches")}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {branches.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
          <GitBranch className="size-3.5" />
          {branches.length} branch{branches.length > 1 ? "es" : ""}
        </span>
      )}

      {/* Go to file 搜索框 */}
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && goSearch()}
          placeholder="Go to file"
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/* 右侧按钮组：新增文件（跳转 /new 整页）+ Code 克隆（ml-auto 整体推到行尾） */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {token && (
          <WriteGate>
            <Tip label="新增文件">
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <Link to={`/${owner}/${repo}/new/${branch}`}>
                  <Plus className="size-4" />
                </Link>
              </Button>
            </Tip>
          </WriteGate>
        )}

        {/* Code 克隆按钮（恢复默认主色调 + 去右侧下拉图标，避免要素过多） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Code2 className="size-4" />
              Code
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="text-xs">克隆仓库</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="space-y-3 px-2 py-2">
              {/* HTTPS（官方：纯链接文本，无 git clone 前缀） */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">HTTPS</p>
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
                    https://github.com/{owner}/{repo}.git
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() =>
                      void copyClone("https", `https://github.com/${owner}/${repo}.git`)
                    }
                  >
                    {copiedType === "https" ? (
                      <Check className="size-3.5 text-chart-1" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              {/* SSH（官方格式 git@github.com:owner/repo.git，可推导无需额外请求） */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">SSH</p>
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
                    git@github.com:{owner}/{repo}.git
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => void copyClone("ssh", `git@github.com:${owner}/${repo}.git`)}
                  >
                    {copiedType === "ssh" ? (
                      <Check className="size-3.5 text-chart-1" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              {/* 镜像（本站域名，insteadOf 接入，见 cli-setup.md） */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">HTTPS（镜像）</p>
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
                    https://{siteHost}/{owner}/{repo}.git
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() =>
                      void copyClone("mirror", `https://${siteHost}/${owner}/${repo}.git`)
                    }
                  >
                    {copiedType === "mirror" ? (
                      <Check className="size-3.5 text-chart-1" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ===== 最新提交信息行（复刻 GitHub 列表顶部）=====

function LatestCommitLine({ branch }: { branch: string }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const [commit, setCommit] = useState<Awaited<ReturnType<typeof fetchLatestCommit>>>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestCommit(owner, repo, branch, token).then((c) => !cancelled && setCommit(c));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  if (!commit) return null;

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
      <GitCommitHorizontal className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{commit.commit.message.split("\n")[0]}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Clock className="size-3.5" />
        {fmt(commit.commit.committer.date)}
      </span>
      <span className="shrink-0 font-mono text-primary">{commit.sha.slice(0, 7)}</span>
    </div>
  );
}

// ===== 文件列表（复刻 GitHub 条目：图标 + 名称 + 更新时间）=====

function FileList({
  entries,
  branch,
  path,
}: {
  entries: DirEntry[];
  branch: string;
  /** 当前目录路径（空 = 仓库根） */
  path: string;
}) {
  const { owner = "", repo = "" } = useParams();
  const sorted = useMemo(
    () =>
      [...entries].sort((a, z) =>
        a.type === z.type ? a.name.localeCompare(z.name) : a.type === "dir" ? -1 : 1,
      ),
    [entries],
  );
  // 虚拟上级目录（GitHub 心智：子目录时列表首位显示 .. 返回上级）
  const parent = path ? path.split("/").slice(0, -1).join("/") : null;
  const parentTo = parent
    ? `/${owner}/${repo}/tree/${branch}/${parent}`
    : `/${owner}/${repo}/tree/${branch}`;

  return (
    // 自定义容器（不用 shadcn Card：其 py-(--card-spacing) 会让信息栏上方露出 16px 空白）
    <div className="overflow-hidden rounded-lg border bg-card">
      <LatestCommitLine branch={branch} />
      <div className="divide-y">
        {path && (
          <Link
            to={parentTo}
            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50"
          >
            <Folder className="size-4 shrink-0 text-sky-500" />
            <span className="min-w-0 flex-1 truncate">..</span>
          </Link>
        )}
        {sorted.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">目录为空</p>
        )}
        {sorted.map((e) => (
          <Link
            key={e.path}
            to={
              e.type === "dir"
                ? `/${owner}/${repo}/tree/${branch}/${e.path}`
                : `/${owner}/${repo}/blob/${branch}/${e.path}`
            }
            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50"
          >
            {e.type === "dir" ? (
              <Folder className="size-4 shrink-0 text-sky-500" />
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground/60" />
            )}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {e.type === "file" && e.size > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {(e.size / 1024).toFixed(1)} KB
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ===== blob 页/文件编辑页左侧栏（官方：Files 标题 + branch 切换 + Go to file 框 + 文件树；无 Code 按钮）=====
// 共享组件：BlobPage 与 FileEditorPage（new/edit 两栏布局）共用

export function FileTreeSidebar({
  branch,
  currentPath,
  treeRoot,
  onToggleCollapse,
}: {
  branch: string;
  currentPath: string;
  treeRoot: TreeNode | null;
  onToggleCollapse?: () => void;
}) {
  const { owner = "", repo = "" } = useParams();
  const [filter, setFilter] = useState("");

  return (
    // 布局规范：工具型限高 sticky 侧栏（SIDEBAR_STICKY_SCROLL； 曾用 SIDEBAR_FILL 通底
    // 撑满视口内剩余 简化并入限高版，树底留 32px 余量）；树区 flex-1 overflow-y-auto 内部滚动；flex 布局 + z 保留
    <div className={`flex flex-col overflow-hidden border lg:z-20 ${SIDEBAR_STICKY_SCROLL}`}>
      {/* Files 标题 + Collapse 按钮（官方：heading + collapse-file-tree 按钮） */}
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>Files</span>
        {onToggleCollapse && (
          <Tip label="折叠文件树">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              onClick={onToggleCollapse}
              aria-label="折叠文件树"
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </Tip>
        )}
      </div>
      {/* branch 切换 */}
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-2">
        <BranchPicker branch={branch} currentPath={currentPath} />
      </div>
      {/* Go to file 搜索框（输入实时过滤树，回车直达文件） */}
      <div className="relative border-b px-2 py-2">
        <Search className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && goToBlob(owner, repo, branch, filter)}
          placeholder="Go to file"
          className="h-8 pl-8 text-sm"
        />
      </div>
      {/* 文件树（独立滚动区） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {treeRoot ? (
          <FileTree root={treeRoot} currentPath={currentPath} branch={branch} filter={filter} />
        ) : (
          <p className="p-2 text-sm text-muted-foreground">文件树为空</p>
        )}
      </div>
    </div>
  );
}

/** 跳到仓库内某路径的 blob 页（Go to file 回车 / 树搜索共用） */
function goToBlob(owner: string, repo: string, branch: string, path: string) {
  if (!path.trim()) return;
  window.location.href = `/${owner}/${repo}/blob/${branch}/${path.trim()}`;
}

// ===== blob 页共享布局（官方：左文件树卡片 + 右内容，无 Code 按钮、无全宽面包屑）=====

export default function RepoCode({ children }: { children: ReactNode }) {
  const { owner = "", repo = "", branch: urlBranch = "" } = useParams();
  const { token } = useAuth();
  const repoData = useRepoData();
  const branch = urlBranch || repoData?.default_branch || "main";
  const { pathname } = useLocation();

  const [tree, setTree] = useState<GitTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 文件树折叠（官方 Collapse file tree：折叠后仅 Expand + 分支 + Go to file 一行，内容全宽）
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treeRoot = useRepoTree(tree);
  const path = parseTreePath(pathname);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFileTree(owner, repo, branch, token)
      .then((t) => {
        if (cancelled) return;
        setTree(t);
        if (t.truncated) setError("文件树过大，GitHub 已截断（仅显示部分文件）");
      })
      .catch((e) => {
        if (!cancelled)
          // 限流（匿名 60/h 耗尽）→ 明确提示登录（apiErrorMessage + 聚光灯）
          setError(apiErrorMessage(e, "文件树加载失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  return (
    <div>
      {error && <InlineError message={error} variant="warning" size="sm" className="mb-2" />}
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        /* 恒定双栏结构（修复）：折叠/展开只切换 left.hidden + PageLayout 自动收敛 grid 模板，
           children 的 DOM 位置始终不变 → 不卸载重挂载 → 不触发重复请求。
           此前 treeCollapsed 三元切换两种不同结构，children（TreePage/BlobPage）在
           DOM 树中位置/深度改变 → React 协调卸载重挂载 → 内部 useEffect 全部重跑，
           fetchDirContents/fetchBlobContent 等重复请求（用户反馈，后台日志可见）。 */
        <TreeCollapseCtx.Provider
          value={{ collapsed: treeCollapsed, setCollapsed: setTreeCollapsed }}
        >
          <PageLayout
            gap="sm"
            left={{
              node: (
                <FileTreeSidebar
                  branch={branch}
                  currentPath={path}
                  treeRoot={treeRoot}
                  onToggleCollapse={() => setTreeCollapsed(true)}
                />
              ),
              width: 240,
              lgWidth: 320,
              sticky: "tool",
              breakpoint: "md",
              /* 折叠时 hidden（保留 DOM 常驻挂载，树数据不重拉） */
              hidden: treeCollapsed,
              className: cn(treeCollapsed && "hidden"),
            }}
          >
            {children}
          </PageLayout>
        </TreeCollapseCtx.Provider>
      )}
    </div>
  );
}

// ===== Code 首页（GitHub 风格：操作栏 + 根文件列表 + README）=====

export function CodeIndex() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const repoData = useRepoData();
  const branch = repoData?.default_branch ?? "main";
  const [readme, setReadme] = useState<ReadmeInfo | null>(null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchReadme(owner, repo, token).catch(() => null),
      fetchDirContents(owner, repo, "", branch, token).catch(() => []),
    ]).then(([r, es]) => {
      if (cancelled) return;
      setReadme(r);
      setEntries(es);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  return (
    <div>
      {/* 归档仓库横幅（最顶；官方 archived 黄色条） */}
      <ArchivedBanner archivedAt={repoData?.archived_at} />
      {/* fork 对照信息条（仅 fork 仓库；官方 BranchInfoBar） */}
      <ForkInfoBar />
      <RepoActionBar branch={branch} />
      {entries === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <FileList entries={entries} branch={branch} path="" />
      )}

      {readme && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CornerDownRight className="size-4" />
            README.md
          </div>
          <Card>
            {/*：边距对齐单文件 README（p-8，官方 markdown-body padding） */}
            <CardContent className="p-8">
              <MarkdownView rawBase={readme.rawBase}>{readme.content}</MarkdownView>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ===== 目录页（GitHub 风格：面包屑 + 目录列表）=====

export function TreePage() {
  const { owner = "", repo = "", branch = "", "*": rest = "" } = useParams();
  const { token } = useAuth();
  const repoData = useRepoData();
  const b = branch || repoData?.default_branch || "main";
  const path = rest;
  const { collapsed: treeCollapsed, setCollapsed: setTreeCollapsed } = useTreeCollapse();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  // 子目录 README（官方：进入目录若含 README 渲染在列表下方）
  const [readme, setReadme] = useState<ReadmeInfo | null>(null);
  // 加载错误态（限流/网络失败 → 明确提示，绝不再误导为「目录为空」）
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setLoadError(null);
    fetchDirContents(owner, repo, path, b, token)
      .then((items) => !cancelled && setEntries(items))
      .catch((e) => {
        if (cancelled) return;
        setEntries([]);
        // 限流（403/429）→ apiErrorMessage 返回登录解锁提示；其他失败 → 通用加载失败
        setLoadError(
          apiErrorMessage(
            e,
            tStatic("common.loadFailed").replace(
              "{error}",
              e instanceof Error ? e.message : String(e),
            ),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, path, b, token]);

  // 子目录 README（官方：目录下有 README 渲染在文件列表下方；无则隐藏）
  useEffect(() => {
    let cancelled = false;
    setReadme(null);
    fetchReadme(owner, repo, token, path)
      .then((r) => !cancelled && setReadme(r))
      .catch(() => !cancelled && setReadme(null));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, path, token]);

  return (
    <div>
      {/* Sticky 单行头（官方 tree 页 #StickyHeader 同款）：折叠态 = [展开树][分支][面包屑] | [Go to file][新增文件]；
          展开态 = [面包屑] | [新增文件]（Go to file 在树 pane 内）。
          折叠态专属元素（展开树按钮/分支/Go to file）**常驻挂载 + hidden 显隐**：
          不条件渲染卸载/重挂载 → 切换折叠不重跑 useEffect、不重复请求（BranchPicker 配 active 懒加载）。 */}
      <div className="sticky top-14 z-10 mb-3 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <Tip label="展开文件树">
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", !treeCollapsed && "hidden")}
              onClick={() => setTreeCollapsed(false)}
              aria-label="展开文件树"
            >
              <PanelRightOpen className="size-3.5" />
            </Button>
          </Tip>
          <div className={cn(!treeCollapsed && "hidden")}>
            <BranchPicker branch={b} currentPath={path} compact active={treeCollapsed} />
          </div>
          <div className="min-w-0">
            <Breadcrumb branch={b} path={path} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <GoToFileInput branch={b} className={cn(!treeCollapsed && "hidden")} />
            {token && (
              <WriteGate className="shrink-0">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                  <Link to={`/${owner}/${repo}/new/${b}${path ? `/${path}` : ""}`}>
                    <Plus className="size-3.5" />
                    新增文件
                  </Link>
                </Button>
              </WriteGate>
            )}
          </div>
        </div>
      </div>
      {loadError ? (
        <InlineError message={loadError} />
      ) : entries === null ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <FileList entries={entries} branch={b} path={path} />
      )}

      {/* 子目录 README（官方：目录含 README 渲染在列表下方） */}
      {readme && !loadError && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CornerDownRight className="size-4" />
            {readme.path}
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            {/*：补边距对齐单文件 README（p-8，原无 padding 贴边） */}
            <div className="p-8">
              <MarkdownView rawBase={readme.rawBase}>{readme.content}</MarkdownView>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 文件页（左树右内容，代码高亮 + 行号 + 官方 blob 头部：sticky 面包屑 + 提交行 + 大小/Raw）=====

export function BlobPage() {
  const { owner = "", repo = "", branch = "", "*": rest = "" } = useParams();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const navigate = useNavigate();
  const { collapsed: treeCollapsed, setCollapsed: setTreeCollapsed } = useTreeCollapse();
  const repoData = useRepoData();
  const b = branch || repoData?.default_branch || "main";
  const path = rest;
  const [rawContent, setRawContent] = useState("");
  const [commit, setCommit] = useState<Awaited<ReturnType<typeof fetchFileCommit>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 文件头 Raw/Copy/下载：本地 raw 内容代理（不跳转 raw.githubusercontent.com）
  const [copiedRaw, setCopiedRaw] = useState(false);
  // 文件删除确认（需 sha + commit message）
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  // Symbols 面板（官方 blob 右侧大纲——左树 | 代码 | symbols 300px；lezer 语法树提取）
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [symFilter, setSymFilter] = useState("");
  // 选中符号详情（官方：点击 symbol → 高亮定义行 + 面板切 Definition/References 视图）
  const [selectedSym, setSelectedSym] = useState<{
    symbol: SymbolInfo;
    defText: string;
    refs: SymbolRef[];
  } | null>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const filteredSymbols = useMemo(() => {
    const q = symFilter.trim().toLowerCase();
    return q ? symbols.filter((s) => s.label.toLowerCase().includes(q)) : symbols;
  }, [symbols, symFilter]);
  // Markdown Outline 面板（官方 blob 页对 .md 渲染视图 + 右侧目录索引）
  const isMarkdown = /\.(md|markdown|mdown|mkd|mdx)$/i.test(path);
  // 视图切换（官方 blob 头 SegmentedControl）：markdown 文件 Preview（渲染）/ Code（代码）
  const [view, setView] = useState<"preview" | "code">("preview");
  // 滚动后显示 Top 按钮（官方 sticky 面包屑同款）
  const [showTop, setShowTop] = useState(false);
  // 面包屑粘住状态（官方 outerWrapperStickied：粘住后**实色背景** bgColor-muted，消除半透明影印）
  const [crumbStickied, setCrumbStickied] = useState(false);
  // 操作头 sticky 粘住状态（官方 BlobViewHeader stickied：粘住后圆角 0、紧贴面包屑底 100px）
  const [headerStickied, setHeaderStickied] = useState(false);
  const actionBarRef = useRef<HTMLDivElement>(null);
  const crumbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      setShowTop(window.scrollY > 120);
      const el = actionBarRef.current;
      if (el) setHeaderStickied(el.getBoundingClientRect().top <= 102);
      const crumb = crumbRef.current;
      if (crumb) setCrumbStickied(crumb.getBoundingClientRect().top <= 57);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // 内容加载完成后补测一次（scroll 未触发时操作头可能已粘住，如 URL 带锚点直达）
  useEffect(() => {
    const el = actionBarRef.current;
    if (el) setHeaderStickied(el.getBoundingClientRect().top <= 102);
    const crumb = crumbRef.current;
    if (crumb) setCrumbStickied(crumb.getBoundingClientRect().top <= 57);
  }, [rawContent, isMarkdown, view]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineFilter, setOutlineFilter] = useState("");
  const outline = useMemo(
    () => (isMarkdown ? extractOutline(rawContent) : []),
    [isMarkdown, rawContent],
  );
  const filteredOutline = useMemo(() => {
    const q = outlineFilter.trim().toLowerCase();
    return q ? outline.filter((o) => o.text.toLowerCase().includes(q)) : outline;
  }, [outline, outlineFilter]);
  /** Outline 点击：滚动到对应标题 + URL hash（官方锚点同款：立即跳转，scroll-mt-24 补偿 sticky 头） */
  const jumpToOutline = (item: OutlineItem) => {
    const el = document.getElementById(item.id);
    el?.scrollIntoView({ block: "start" });
    const next = `#${item.id}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  };
  /** symbols 点击（官方：跳定义行高亮 + 面板切详情视图显示 Definition/References） */
  const jumpToSymbol = (s: SymbolInfo) => {
    const cmView = cmViewRef.current;
    let defText = "";
    let refs: SymbolRef[] = [];
    if (cmView) {
      const doc = cmView.state.doc;
      const line = Math.min(Math.max(s.line, 1), doc.lines);
      defText = doc.line(line).text.trim();
      // 高亮定义行（整行选中，官方同款）
      cmView.dispatch({
        selection: { anchor: doc.line(line).from, head: doc.line(line).to },
        scrollIntoView: true,
      });
      // 写 URL hash（刷新可恢复）
      const next = `#L${s.line}`;
      if (window.location.hash !== next) {
        window.history.replaceState(null, "", next);
      }
      // 提取文件内引用（官方 References in this file）
      refs = collectReferences(cmView, s);
    }
    setSelectedSym({ symbol: s, defText, refs });
  };
  /** 关闭详情返回全部符号 */
  const backToAll = () => setSelectedSym(null);
  /** 详情视图内跳转（Definitions/References 行） */
  const jumpToLine = (line: number) => {
    const cmView = cmViewRef.current;
    if (!cmView) return;
    const doc = cmView.state.doc;
    const l = Math.min(Math.max(line, 1), doc.lines);
    cmView.dispatch({
      selection: { anchor: doc.line(l).from, head: doc.line(l).to },
      scrollIntoView: true,
    });
    const next = `#L${line}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  };

  // 加载原始内容（仅依赖路径；代码主题切换不重新 fetch）
  useEffect(() => {
    let cancelled = false;
    setRawContent("");
    setError(null);
    //：改 smart 层（登录 GraphQL blob 首选，绕开 contents API 无 CORS 头问题；
    // 匿名走 REST——限流 403 错误响应无 CORS 头会被浏览器拦截，catch 里 apiErrorMessage 区分提示）
    fetchFileContentSmart(owner, repo, path, token, b)
      .then((content) => {
        if (cancelled) return;
        setRawContent(content);
      })
      .catch((e) => {
        if (cancelled) return;
        // 限流（匿名 60/h 耗尽）→ apiErrorMessage 明确提示「登录后可获得更高配额」+ 聚光灯引导；
        // 其余（>1MB/二进制等）→ 原提示
        setError(apiErrorMessage(e, "文件加载失败（可能超过 100MB 或为二进制）"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, path, token, b]);

  // 文件头：该文件最近一次提交（作者 + branch + commit message + hash）
  //：匿名时跳过（省 REST 配额——匿名 60/h 极紧张，commit 头非关键信息）
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchFileCommit(owner, repo, path, b, token).then((c) => !cancelled && setCommit(c));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, path, b, token]);

  const fileName = path.split("/").pop() ?? path;
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // ===== 文件头操作：Raw 内容走 Worker /$raw 内部代理（不再用 blob URL）
  // openRaw 新标签页直链 /$raw/{o}/{r}/{branch}/{path}——经代理展示上游原始内容（Content-Type
  // 透传，图片/文本/二进制按实际类型）；copy/download 基于已加载 rawContent（无需再请求）。
  const rawProxyUrl = () =>
    `${WORKER_BASE}/$raw/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/${encodeURIComponent(b)}/${path
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
  /** Raw：新标签页打开 Worker /$raw 代理（内部功能性路由，展示上游原始内容） */
  const openRaw = () => {
    window.open(rawProxyUrl(), "_blank", "noopener");
  };
  /** Copy raw file：复制原始内容到剪贴板 */
  const copyRaw = async () => {
    if (!rawContent) return;
    try {
      await navigator.clipboard.writeText(rawContent);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 1500);
    } catch {
      /* ignore */
    }
  };
  /** Download raw file：blob URL 触发下载 */
  const downloadRaw = () => {
    if (!rawContent) return;
    const url = URL.createObjectURL(new Blob([rawContent], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // 行数 / 字节（官方：`24 lines (22 loc) · 253 Bytes`；结尾换行不计入行数）
  const trimmed = rawContent ? rawContent.replace(/\n$/, "") : "";
  const lines = trimmed ? trimmed.split("\n").length : 0;
  const loc = trimmed ? trimmed.split("\n").filter((l) => l.trim() !== "").length : 0;
  const bytes = rawContent ? new Blob([rawContent]).size : 0;
  // 移除 raw.githubusercontent.com 直链，Raw/复制/下载全部走本地代理

  // 删除文件：需 sha + commit message + 确认
  const doDelete = async () => {
    if (!token || delBusy) return;
    setDelBusy(true);
    setDelError(null);
    try {
      const meta = await fetchFileMeta(owner, repo, path, token);
      await deleteFileContent(owner, repo, path, `Delete ${fileName}`, b, meta.sha, token);
      setDelOpen(false);
      navigate(`/${owner}/${repo}/tree/${b}`);
    } catch (e) {
      setDelError(apiErrorMessage(e, "删除失败"));
      setDelBusy(false);
    }
  };

  /* 操作栏内容（官方 BlobViewHeader：位于内容容器内部顶部，随容器一体 sticky；
     行数 + Raw 组 + Edit 组 + 面板切换按钮） */
  const renderActionBar = () => (
    <>
      {/* 视图切换（官方 segmented control）：markdown → Preview / Code（Blame 未实现舍弃） */}
      {isMarkdown && (
        <SegmentedControl
          options={[
            { value: "preview", label: "Preview" },
            { value: "code", label: "Code" },
          ]}
          value={view}
          onValueChange={setView}
          variant="box"
          size="xs"
        />
      )}
      <span className="font-mono">
        {lines} lines ({loc} loc) · {bytes} Bytes
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* Raw 按钮组（官方 ButtonGroup：Raw 文字 + Copy + 下载 图标，圆角合并） */}
        <div className="flex items-stretch overflow-hidden rounded-md border">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-none px-2.5 text-xs"
            onClick={() => void openRaw()}
          >
            Raw
          </Button>
          <Tip label={copiedRaw ? "已复制" : "复制原始内容"}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 rounded-none"
              onClick={() => void copyRaw()}
            >
              {copiedRaw ? (
                <Check className="size-3.5 text-chart-1" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </Tip>
          <Tip label="下载原始文件">
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 rounded-none"
              onClick={() => void downloadRaw()}
            >
              <Download className="size-3.5" />
            </Button>
          </Tip>
        </div>
        {/* Edit + More-edit（官方 ButtonGroup：pencil 图标 + 三角下拉；仅写权限显示） */}
        {token && (
          <WriteGate className="flex items-center gap-1.5">
            <div className="flex items-stretch overflow-hidden rounded-md border">
              <Tip label="编辑此文件">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 rounded-none"
                  asChild
                  aria-label="编辑此文件"
                >
                  {/*：blob 已加载内容随导航 state 传给编辑页（省一次内容请求）；直接访问编辑链接则自加载 */}
                  <Link to={`/${owner}/${repo}/edit/${b}/${path}`} state={{ content: rawContent }}>
                    <PencilLine className="size-3.5" />
                  </Link>
                </Button>
              </Tip>
              <Tip label="删除文件">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDelOpen(true)}
                  aria-label="删除文件"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tip>
            </div>
          </WriteGate>
        )}
        {/* 面板切换按钮（官方 blob 头最右）：markdown 预览 → Outline；代码 → Symbols；markdown Code 视图无 */}
        {isMarkdown && view === "preview" && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7"
            onClick={() => setOutlineOpen((v) => !v)}
            title={outlineOpen ? "关闭目录面板" : "打开目录面板"}
            aria-pressed={outlineOpen}
            aria-expanded={outlineOpen}
          >
            <List className="size-3.5" />
          </Button>
        )}
        {!isMarkdown && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7"
            onClick={() => setSymbolsOpen((v) => !v)}
            title={symbolsOpen ? "关闭符号面板" : "打开符号面板"}
            aria-pressed={symbolsOpen}
            aria-expanded={symbolsOpen}
          >
            <SquareCode className="size-3.5" />
          </Button>
        )}
      </div>
    </>
  );

  return (
    <div>
      {/* Sticky 面包屑行（官方 CodeViewHeader #StickyHeader 同款）：折叠态 = [展开树][分支][面包屑][Copy path][Go to file]；
          展开态 = [面包屑][Copy path]（树 pane 自带 Files 标题+折叠按钮；Go to file 在树 pane 内）
          操作头粘住时隐藏 border-b（避免与操作头 border-top 双线，官方 outerWrapperStickied 无底边框） */}
      <div
        ref={crumbRef}
        className={cn(
          "sticky top-14 z-10 mb-3",
          // 粘住时实色背景（官方 outerWrapperStickied 同款）——半透明 bg-background/95 + backdrop-blur
          // 会让滚过的内容从下方透出（半透明影印），粘住后必须切实色
          crumbStickied ? "bg-background" : "bg-background/95 backdrop-blur",
          headerStickied ? "border-b-transparent" : "border-b",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
          {/* 折叠态元素：展开树按钮 + 分支常驻挂载 + hidden 显隐，避免切换重挂载重复请求 */}
          <Tip label="展开文件树">
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", !treeCollapsed && "hidden")}
              onClick={() => setTreeCollapsed(false)}
              aria-label="展开文件树"
            >
              <PanelRightOpen className="size-3.5" />
            </Button>
          </Tip>
          <div className={cn(!treeCollapsed && "hidden")}>
            <BranchPicker branch={b} currentPath={path} compact active={treeCollapsed} />
          </div>
          {/* 面包屑（官方 Breadcrumb：repo 链接 / 文件名） */}
          <Link
            to={`/${owner}/${repo}/tree/${b}`}
            className="truncate font-medium text-primary hover:underline"
          >
            {repo}
          </Link>
          <span className="shrink-0 text-muted-foreground">/</span>
          <h1 className="min-w-0 truncate font-medium">{fileName}</h1>
          {/* Copy path（官方 Breadcrumb 尾部） */}
          <Tip label="Copy path">
            <Button size="icon" variant="ghost" className="size-7" onClick={() => void copyPath()}>
              {copied ? <Check className="size-3.5 text-chart-1" /> : <Copy className="size-3.5" />}
            </Button>
          </Tip>
          {/* 右侧组（官方 Breadcrumb 尾部）：折叠态 [Go to file][Top]，展开态 [Top]——ml-auto 推最右 */}
          <div className="ml-auto flex items-center gap-2">
            {!error && rawContent !== "" && (
              <GoToFileInput branch={b} className={cn(!treeCollapsed && "hidden")} />
            )}
            {showTop && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                <ArrowUp className="size-3.5" />
                Top
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Latest commit 行（官方 LatestCommit：透明无边框，位于面包屑与操作头之间——中间） */}
      {commit && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          {commit.author?.avatar_url && (
            <UserAvatar src={commit.author.avatar_url} alt={commit.author.login ?? ""} />
          )}
          <span className="shrink-0 font-medium text-foreground">
            {commit.author?.login ?? "unknown"}
          </span>
          <span className="min-w-0 flex-1 truncate">{commit.commit.message.split("\n")[0]}</span>
          <span className="shrink-0 font-mono text-primary">{commit.sha.slice(0, 7)}</span>
          <span className="shrink-0">{fmt(commit.commit.committer.date)}</span>
          <a
            href={`https://github.com/${owner}/${repo}/commits/${b}/${path}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex shrink-0 items-center gap-1 text-primary hover:underline"
          >
            <History className="size-3.5" />
            History
          </a>
        </div>
      )}

      {/* 操作头已并入内容容器内部顶部（renderActionBar，官方 BlobViewHeader 一体结构） */}
      {/* (commit 行已移至操作头上方，官方 LatestCommit 位置——中间) */}

      {error ? (
        <InlineError message={error} size="sm" />
      ) : rawContent === "" ? (
        <Skeleton className="h-64 w-full" />
      ) : isMarkdown && view === "preview" ? (
        /* Markdown 渲染视图（官方 blob Preview tab：渲染后文档 + 右侧 Outline 目录；可折叠） */
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* 操作头（官方 BlobViewHeader：sticky 于面包屑底 100px；未粘住圆角顶 + 全边框，粘住后圆角 0（stickied）；与内容容器无缝拼接成一体） */}
            <div
              ref={actionBarRef}
              className={cn(
                "sticky top-25 z-10 flex flex-wrap items-center gap-2 border bg-muted px-4 py-2 text-xs text-muted-foreground",
                headerStickied ? "" : "rounded-t-md",
              )}
            >
              {renderActionBar()}
            </div>
            <div className="rounded-b-md border border-t-0 bg-card">
              <div className="p-8">
                <MarkdownView
                  headings={outline}
                  rawBase={`https://raw.githubusercontent.com/${owner}/${repo}/${b}${
                    path.includes("/") ? "/" + path.slice(0, path.lastIndexOf("/")) : ""
                  }`}
                >
                  {rawContent}
                </MarkdownView>
              </div>
            </div>
          </div>
          {outlineOpen && outline.length > 0 && (
            <div className="w-75 shrink-0">
              <OutlinePanel
                outline={filteredOutline}
                filter={outlineFilter}
                onFilterChange={setOutlineFilter}
                onSelect={jumpToOutline}
                onClose={() => setOutlineOpen(false)}
              />
            </div>
          )}
        </div>
      ) : (
        /* 代码只读展示（官方 blob：markdown Code tab / 代码文件；操作头与内容无缝拼接一体；symbols 面板在**代码右侧**——官方 325px；可折叠） */
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* 操作头（官方 BlobViewHeader：sticky；未粘住圆角顶 + 全边框，粘住后圆角 0（stickied）；与内容容器无缝拼接成一体） */}
            <div
              ref={actionBarRef}
              className={cn(
                "sticky top-25 z-10 flex flex-wrap items-center gap-2 border bg-muted px-4 py-2 text-xs text-muted-foreground",
                headerStickied ? "" : "rounded-t-md",
              )}
            >
              {renderActionBar()}
            </div>
            <div className="rounded-b-md border border-t-0 bg-card">
              <CodeView
                code={rawContent}
                path={path}
                minHeight="min-h-96"
                onSymbolsChange={setSymbols}
                onViewReady={(v) => {
                  cmViewRef.current = v;
                }}
              />
            </div>
          </div>
          {!isMarkdown && symbolsOpen && symbols.length > 0 && (
            <div className="w-75 shrink-0">
              <SymbolsPanel
                symbols={filteredSymbols}
                filter={symFilter}
                onFilterChange={setSymFilter}
                onSelect={jumpToSymbol}
                onClose={() => setSymbolsOpen(false)}
                selectedSym={selectedSym}
                onBack={backToAll}
                onJumpLine={jumpToLine}
              />
            </div>
          )}
        </div>
      )}

      {/* 文件删除确认（danger 操作必须 AlertDialog 红线） */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tStatic("common.deleteFile").replace("{name}", fileName)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              将在分支 {b} 上提交删除此文件。此操作会写入 git 历史，请确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {delError && <InlineError message={delError} size="sm" />}
          <AlertDialogFooter>
            <AlertDialogCancel>{tStatic("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void doDelete()}
              disabled={delBusy}
            >
              {delBusy ? "删除中…" : "提交删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Symbols 面板（官方 blob **右侧**大纲——代码右侧列 300px，kind 标签 + 符号名 + 行号，点击跳转）=====

const SYMBOL_KIND_STYLE: Record<string, string> = {
  function: "text-purple-500",
  method: "text-purple-500",
  class: "text-orange-500",
  interface: "text-orange-500",
  type: "text-amber-500",
  enum: "text-amber-500",
  impl: "text-cyan-500",
  variable: "text-blue-500",
  property: "text-blue-500",
  field: "text-blue-500",
  const: "text-emerald-500",
};

function SymbolsPanel({
  symbols,
  filter,
  onFilterChange,
  onSelect,
  onClose,
  selectedSym,
  onBack,
  onJumpLine,
}: {
  symbols: SymbolInfo[];
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (s: SymbolInfo) => void;
  onClose: () => void;
  /** 选中符号详情（官方：点击 symbol → Definition/References 视图） */
  selectedSym: { symbol: SymbolInfo; defText: string; refs: SymbolRef[] } | null;
  onBack: () => void;
  onJumpLine: (line: number) => void;
}) {
  const { owner = "", repo = "" } = useParams();
  // 详情视图（官方：Back to all symbols + kind/名称 + Definitions + References + Search）
  if (selectedSym) {
    const { symbol, defText, refs } = selectedSym;
    return (
      <div className="overflow-hidden rounded-md border">
        {/* 详情头：返回全部符号 + 关闭 */}
        <div className="flex items-center justify-between border-b bg-muted/50 px-2 py-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            All symbols
          </Button>
          <Tip label="关闭符号面板">
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-6"
              onClick={onClose}
              aria-label="关闭符号面板"
            >
              <X className="size-3.5" />
            </Button>
          </Tip>
        </div>
        {/* 符号标题（官方 heading：kind 标签 + 名称） */}
        <div className="border-b px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] uppercase",
                SYMBOL_KIND_STYLE[symbol.kind] ?? "text-muted-foreground",
              )}
            >
              {symbol.kind}
            </span>
            <span className="min-w-0 truncate font-mono text-sm font-semibold">{symbol.label}</span>
          </div>
        </div>
        {/* Definitions in this file（官方：定义所在行） */}
        <div className="border-b px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Definitions in this file
        </div>
        <button
          onClick={() => onJumpLine(symbol.line)}
          className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-xs hover:bg-accent"
        >
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {symbol.line}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{defText}</span>
        </button>
        {/* References in this file（官方：引用行列表） */}
        <div className="border-b px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          References in this file
          {refs.length > 0 && (
            <span className="ml-1 font-normal normal-case text-muted-foreground/80">
              ({refs.length})
            </span>
          )}
        </div>
        {refs.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">未找到文件内引用</p>
        ) : (
          <div className="max-h-[38vh] overflow-y-auto pb-1">
            {refs.map((r) => (
              <button
                key={r.line}
                onClick={() => onJumpLine(r.line)}
                className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-xs hover:bg-accent"
              >
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {r.line}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{r.text}</span>
              </button>
            ))}
          </div>
        )}
        {/* Search for this symbol（官方：全仓库搜索该符号） */}
        <a
          href={`/search?q=${encodeURIComponent(
            `repo:${owner}/${repo} ${symbol.label}`,
          )}&type=code`}
          className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-primary hover:underline"
        >
          Search for this symbol
          <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      {/* 标题行（官方：Symbols + 关闭按钮） */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <h2 className="text-sm font-semibold">Symbols</h2>
        <Tip label="关闭符号面板">
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6"
            onClick={onClose}
            aria-label="关闭符号面板"
          >
            <X className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {/* 过滤框（官方：Filter symbols） */}
      <div className="border-b px-2 py-2">
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter symbols"
          className="h-7 text-xs"
          aria-label="Filter symbols"
        />
      </div>
      {/* 符号树列表（官方：kind 标签 + 名称 + 行号；点击跳 #L{n}） */}
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {symbols.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">无匹配符号</p>
        ) : (
          symbols.map((s) => (
            <button
              key={s.from}
              onClick={() => onSelect(s)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
            >
              <span
                className={cn(
                  "w-14 shrink-0 font-mono text-[10px] uppercase",
                  SYMBOL_KIND_STYLE[s.kind] ?? "text-muted-foreground",
                )}
              >
                {s.kind}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{s.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ===== Outline 面板（官方 blob 页 markdown 目录——Outline + Filter headings + 层级缩进列表）=====

function OutlinePanel({
  outline,
  filter,
  onFilterChange,
  onSelect,
  onClose,
}: {
  outline: OutlineItem[];
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (o: OutlineItem) => void;
  onClose: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      {/* 标题行（官方：Outline + 关闭按钮） */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <h2 className="text-sm font-semibold">Outline</h2>
        <Tip label="关闭目录面板">
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6"
            onClick={onClose}
            aria-label="关闭目录面板"
          >
            <X className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {/* 过滤框（官方：Filter headings） */}
      <div className="border-b px-2 py-2">
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter headings"
          className="h-7 text-xs"
          aria-label="Filter headings"
        />
      </div>
      {/* 标题树列表（官方：层级缩进；点击滚动到标题） */}
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {outline.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">无匹配标题</p>
        ) : (
          outline.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect(o)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
              style={{ paddingLeft: `${Math.min(o.level - 1, 4) * 12 + 8}px` }}
            >
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {"#".repeat(o.level)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{o.text}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ===== 面包屑与返回上级 =====

function Breadcrumb({ branch, path }: { branch: string; path: string }) {
  const { owner = "", repo = "" } = useParams();
  const parts = path ? path.split("/") : [];
  const items = [
    { label: branch, to: `/${owner}/${repo}/tree/${branch}` },
    ...parts.map((p, i) => {
      const acc = parts.slice(0, i + 1).join("/");
      return {
        label: p,
        to: i === parts.length - 1 ? null : `/${owner}/${repo}/tree/${branch}/${acc}`,
      };
    }),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/50" />}
          {item.to ? (
            <Link to={item.to} className="text-primary hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
