/**
 * Code 区共享组件与布局（复刻 GitHub 仓库 Code 区，布局与路径对齐官方）
 *
 * 拆分后职责：共享组件（BranchPicker/GoToFileInput/RepoActionBar/FileList/FileTreeSidebar）
 * + RepoCode 布局包裹（左文件树 + 右内容，BlobPage 与 FileEditorPage 挂载）。
 * 三个页面（CodeIndex/TreePage/BlobPage）已拆到 pages/ 根目录独立文件，从本文件导入共享组件。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  File,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  PanelLeftClose,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
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
import { fetchFileTree, apiErrorMessage, type GitTree, type DirEntry } from "@/lib/restapi";
import { fetchBranchesSmart, fetchLatestCommitSmart } from "@/lib/api";
import { parseTreePath } from "@/lib/repo/repo-path";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { tStatic } from "@/i18n";
import { useRepoData } from "@/lib/repo/repo-context";
import { FileTree } from "@/components/FileTree";
import { useRepoTree, type TreeNode } from "@/lib/repo/file-tree";
import { WriteGate } from "@/components/WriteGate";
import { cn } from "@/lib/utils";
import { SIDEBAR_STICKY_SCROLL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { TreeCollapseCtx } from "@/lib/repo/tree-collapse";

/** 分支切换器（官方 ref-selector 同款：FileTreeSidebar 展开态 + blob/tree 折叠态 sticky 头共用）
 * active：折叠态 sticky 头的实例在展开态被 hidden 隐藏但**常驻挂载**（不重挂载→不重复请求），
 * active=false 时不拉取；首次 active=true 拉取一次后 loadedRef 置位，后续折叠/展开切换不再重拉（数据保留在 state）。 */
export function BranchPicker({
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
    fetchBranchesSmart(owner, repo, token)
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
export function GoToFileInput({ branch, className }: { branch: string; className?: string }) {
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

export function RepoActionBar({ branch }: { branch: string }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [copiedType, setCopiedType] = useState<"https" | "ssh" | "mirror" | null>(null);
  // 当前站点域名：镜像 clone 命令指向用户正在访问的域名（不再硬编码生产域名，他人部署自动适配）
  const siteHost = window.location.host;

  useEffect(() => {
    let cancelled = false;
    fetchBranchesSmart(owner, repo, token)
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
  const [commit, setCommit] = useState<Awaited<ReturnType<typeof fetchLatestCommitSmart>>>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestCommitSmart(owner, repo, branch, token).then((c) => !cancelled && setCommit(c));
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

export function FileList({
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
