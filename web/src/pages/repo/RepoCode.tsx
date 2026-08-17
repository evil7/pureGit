/**
 * Code 区共享组件与布局（复刻 GitHub 仓库 Code 区，布局与路径对齐官方）
 *
 * 拆分后职责：共享组件（BranchPicker/GoToFileInput/RepoActionBar/FileList/FileTreeSidebar）
 * + RepoCode 布局包裹（左文件树 + 右内容，BlobPage 与 FileEditorPage 挂载）。
 * 三个页面（CodeIndex/TreePage/BlobPage）已拆到 pages/ 根目录独立文件，从本文件导入共享组件。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  CornerDownRight,
  Download,
  File,
  FilePlus,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  fetchFileTree,
  apiErrorMessage,
  type GitTree,
  type DirEntry,
  type ReadmeInfo,
} from "@/lib/restapi";
import {
  fetchBranchesSmart,
  fetchLatestCommitSmart,
  fetchDirWithReadmeSmart,
  fetchRepoHeaderSmart,
  type RepoHeaderData,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useBranchPath } from "@/hooks/useBranchPath";
import { useDateFormat } from "@/hooks/useDateFormat";
import { tStatic } from "@/i18n";
import { FileTree } from "@/components/FileTree";
import { MarkdownView } from "@/components/MarkdownView";
import { useRepoTree, type TreeNode } from "@/lib/repo/file-tree";
import { WriteGate } from "@/components/WriteGate";
import { ForkGate } from "@/components/ForkGate";
import { cn } from "@/lib/utils";
import { SIDEBAR_STICKY_SCROLL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { TreeCollapseCtx } from "@/lib/repo/tree-collapse";

/** 分支切换器（官方 ref-selector 同款：FileTreeSidebar 展开态 + blob/tree 折叠态 sticky 头共用）
 * active：折叠态 sticky 头的实例在展开态被 hidden 隐藏但**常驻挂载**（不重挂载→不重复请求），
 * active=false 时不拉取；首次 active=true 拉取一次后 loadedRef 置位，后续折叠/展开切换不再重拉（数据保留在 state）。
 * mode：tree 页切分支跳 tree/、blob 页跳 blob/（保留当前文件/目录路径与官方一致）。 */
export function BranchPicker({
  branch,
  currentPath,
  active = true,
  mode = "blob",
}: {
  branch: string;
  currentPath: string;
  active?: boolean;
  /** 切换分支后跳转的浏览类型：tree（目录页）/ blob（文件页） */
  mode?: "tree" | "blob";
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
        <Button variant="outline" className="font-mono">
          <GitBranch className="size-3.5" />
          {branch}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">{tStatic("repoCode.branches")}</DropdownMenuLabel>
        {branches.map((b) => (
          <DropdownMenuItem
            key={b}
            className="font-mono text-xs"
            onClick={() => {
              if (b !== branch) {
                // 保留当前文件/目录路径，与官方一致（tree 页跳 tree、blob 页跳 blob）
                window.location.href = `/${owner}/${repo}/${mode}/${b}/${currentPath}`;
              }
            }}
          >
            {b}
          </DropdownMenuItem>
        ))}
        {branches.length === 0 && (
          <DropdownMenuItem disabled>{tStatic("common.noBranches")}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* 查看全部分支（官方分支选择器底部入口 → /branches 管理页） */}
        <DropdownMenuItem asChild>
          <Link to={`/${owner}/${repo}/branches`} className="text-xs">
            {tStatic("branches.viewAll")}
          </Link>
        </DropdownMenuItem>
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

export function RepoActionBar({
  branch,
  branches: externalBranches,
}: {
  branch: string;
  /** 外部提供的分支列表（CodeIndex 首页合并查询下发；undefined = 内部自行 fetch） */
  branches?: string[];
}) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [copiedType, setCopiedType] = useState<"https" | "ssh" | "mirror" | null>(null);
  // 当前站点域名：镜像 clone 命令指向用户正在访问的域名（不再硬编码生产域名，他人部署自动适配）
  const siteHost = window.location.host;

  useEffect(() => {
    // 外部已提供分支列表（合并查询下发）→ 直接采用，不再单独 fetch
    if (externalBranches !== undefined) {
      setBranches(externalBranches);
      return;
    }
    let cancelled = false;
    fetchBranchesSmart(owner, repo, token)
      .then((bs) => !cancelled && setBranches(bs.map((b) => b.name)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, externalBranches]);

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
          <Button variant="outline" className="font-mono">
            <GitBranch className="size-3.5" />
            {branch}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
          <DropdownMenuLabel className="text-xs">{tStatic("repoCode.branches")}</DropdownMenuLabel>
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
          <DropdownMenuSeparator />
          {/* 查看全部分支（官方分支选择器底部入口 → /branches 管理页） */}
          <DropdownMenuItem asChild>
            <Link to={`/${owner}/${repo}/branches`} className="text-xs">
              {tStatic("branches.viewAll")}
            </Link>
          </DropdownMenuItem>
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

      {/* 右侧按钮组：Add file 下拉（新建文件/上传文件）+ Code 克隆（ml-auto 整体推到行尾） */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {token && (
          <WriteGate>
            {/* ForkGate：无写权限仓库点击新增文件 → fork 引导（官方语义：编辑他人仓库前必须 fork） */}
            <ForkGate>
              <AddFileDropdown branch={branch} />
            </ForkGate>
          </WriteGate>
        )}

        {/* Code 克隆按钮（恢复默认主色调 + 去右侧下拉图标，避免要素过多） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Code2 className="size-4" />
              Code
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="text-xs">{tStatic("repoCode.clone")}</DropdownMenuLabel>
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
                <p className="mb-1 text-xs text-muted-foreground">
                  {tStatic("repoCode.httpsMirror")}
                </p>
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
            <DropdownMenuSeparator />
            {/* 下载源码归档（官方 Code 下拉：Download ZIP；zip 直链 github.com 会 302 到 codeload） */}
            <DropdownMenuItem asChild>
              <a
                href={`https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`}
                className="flex items-center gap-2"
              >
                <Download className="size-4" />
                {tStatic("repoCode.downloadZip")}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Add file 下拉（官方 Code 区操作栏：Create new file / Upload files；分支根与目录页共用） */
export function AddFileDropdown({ branch, path = "" }: { branch: string; path?: string }) {
  const { owner = "", repo = "" } = useParams();
  const dirPrefix = path ? `/${path}` : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={tStatic("addFile.label")}>
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      {/* shadcn 默认宽度（跟随 trigger + min-w-32 兑底）；内容短，无需固定 w-56 */}
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/${owner}/${repo}/new/${branch}${dirPrefix}`}>
            <FilePlus className="size-4" />
            {tStatic("addFile.create")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/${owner}/${repo}/upload/${branch}${dirPrefix}`}>
            <Upload className="size-4" />
            {tStatic("addFile.upload")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ===== 最新提交信息行（复刻 GitHub 列表顶部）=====

function LatestCommitLine({
  branch,
  latestCommit: externalCommit,
}: {
  branch: string;
  /** 外部提供的最新提交（CodeIndex 首页合并查询下发；undefined = 内部自行 fetch） */
  latestCommit?: Awaited<ReturnType<typeof fetchLatestCommitSmart>>;
}) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const [commit, setCommit] = useState<Awaited<ReturnType<typeof fetchLatestCommitSmart>>>(null);

  useEffect(() => {
    // 外部已提供最新提交（合并查询下发）→ 直接采用，不再单独 fetch
    if (externalCommit !== undefined) {
      setCommit(externalCommit);
      return;
    }
    let cancelled = false;
    fetchLatestCommitSmart(owner, repo, branch, token).then((c) => !cancelled && setCommit(c));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token, externalCommit]);

  if (!commit) return null;

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
      <GitCommitHorizontal className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{commit.commit.message.split("\n")[0]}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Clock className="size-3.5" />
        {fmt(commit.commit.committer.date)}
      </span>
      <Badge variant="secondary" asChild className="shrink-0 font-mono hover:bg-secondary/80">
        <Link to={`/${owner}/${repo}/commit/${commit.sha}`} title={commit.sha}>
          {commit.sha.slice(0, 7)}
        </Link>
      </Badge>
    </div>
  );
}

// ===== 文件列表（复刻 GitHub 条目：图标 + 名称 + 更新时间）=====

export function FileList({
  entries,
  branch,
  path,
  latestCommit,
}: {
  entries: DirEntry[];
  branch: string;
  /** 当前目录路径（空 = 仓库根） */
  path: string;
  /** 外部提供的最新提交（CodeIndex 首页合并查询下发；undefined = LatestCommitLine 内部自行 fetch） */
  latestCommit?: Awaited<ReturnType<typeof fetchLatestCommitSmart>>;
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
      <LatestCommitLine branch={branch} latestCommit={latestCommit} />
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
          <p className="p-6 text-center text-sm text-muted-foreground">
            {tStatic("repoCode.dirEmpty")}
          </p>
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

/** 命令块（标题 + 复制按钮 + 代码行），EmptyRepoSetup 复用 */
function CmdBlock({
  title,
  cmds,
  copyKey,
  copied,
  onCopy,
}: {
  title: string;
  cmds: string[];
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="text-sm font-medium">{title}</p>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => onCopy(copyKey, cmds.join("\n"))}
          aria-label={tStatic("repoCode.copyTitle", { title })}
        >
          {copied === copyKey ? (
            <Check className="size-3.5 text-chart-1" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
      <pre className="m-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
        {cmds.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </pre>
    </div>
  );
}

/**
 * 空仓库本地初始化提示（官方 Quick setup 卡片：无 commit 的空仓库展示本地 git 命令）。
 * 命令随仓库/默认分支动态生成，逐块可一键复制；clone URL 与 RepoActionBar 的 HTTPS 一致。
 */
function EmptyRepoSetup({ branch }: { branch: string }) {
  const { owner = "", repo = "" } = useParams();
  const [copied, setCopied] = useState<string | null>(null);

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const createCmds = [
    `echo "# ${repo}" >> README.md`,
    "git init",
    "git add README.md",
    'git commit -m "first commit"',
    `git branch -M ${branch}`,
    `git remote add origin ${cloneUrl}`,
    `git push -u origin ${branch}`,
  ];
  const pushCmds = [
    `git remote add origin ${cloneUrl}`,
    `git branch -M ${branch}`,
    `git push -u origin ${branch}`,
  ];

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/50 px-4 py-2 text-sm font-medium">
        {tStatic("emptyRepo.quickSetup")}
      </div>
      <CmdBlock
        title={tStatic("emptyRepo.createOnCmd")}
        cmds={createCmds}
        copyKey="create"
        copied={copied}
        onCopy={copy}
      />
      <div className="border-t" />
      <CmdBlock
        title={tStatic("emptyRepo.pushExisting")}
        cmds={pushCmds}
        copyKey="push"
        copied={copied}
        onCopy={copy}
      />
    </div>
  );
}

/**
 * 仓库「根目录」视图（分支根 = repo 根目录，等价 /:owner/:repo 但指定 branch）。
 * 操作栏（分支切换/Go to file/新增文件/Code 克隆）+ 根文件列表 + 根 README。
 * CodeIndex（默认分支根）与 TreePage（tree/{branch} 分支根，path 为空）共用——
 * 切换分支后应回到「换了个 branch 的 repo 根目录」体验，而非目录页（sticky 头 + 面包屑）。
 */
export function RepoRootView({ branch }: { branch: string }) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const [readme, setReadme] = useState<ReadmeInfo | null>(null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  // 分支列表 + 最新提交（一次复合查询，下发 RepoActionBar / FileList）
  const [repoHeader, setRepoHeader] = useState<RepoHeaderData | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 目录条目 + README 一次 Tree.entries 复合查询（原 fetchDirContentsSmart + fetchReadmeSmart 双查）
    fetchDirWithReadmeSmart(owner, repo, "", branch, token)
      .then(({ entries: es, readme: r }) => {
        if (cancelled) return;
        setReadme(r);
        setEntries(es);
      })
      .catch(() => {
        if (cancelled) return;
        setReadme(null);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  useEffect(() => {
    let cancelled = false;
    // 分支列表 + 最新提交一次复合查询（原 RepoActionBar fetchBranchesSmart + LatestCommitLine fetchLatestCommitSmart 双查）
    fetchRepoHeaderSmart(owner, repo, branch, token)
      .then((h) => !cancelled && setRepoHeader(h))
      .catch(() => !cancelled && setRepoHeader({ branches: [], latestCommit: null }));
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, token]);

  return (
    <div>
      <RepoActionBar branch={branch} branches={repoHeader?.branches ?? []} />
      {entries === null ? (
        <Skeleton className="h-64 w-full" />
      ) : entries.length === 0 && !readme ? (
        // 空仓库（无提交 + 无 README）→ 本地初始化命令提醒（官方 Quick setup）
        <EmptyRepoSetup branch={branch} />
      ) : (
        <FileList
          entries={entries}
          branch={branch}
          path=""
          latestCommit={repoHeader?.latestCommit ?? null}
        />
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
          <Tip label={tStatic("blob.collapseTree")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              aria-label={tStatic("blob.collapseTree")}
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
          <p className="p-2 text-sm text-muted-foreground">{tStatic("repoCode.treeEmpty")}</p>
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
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  // blob 路由已改 splat：按分支列表最长前缀匹配解析 branch/path（分支名可含 `/`）
  const { branch, path } = useBranchPath();

  const [tree, setTree] = useState<GitTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 文件树折叠（官方 Collapse file tree：折叠后仅 Expand + 分支 + Go to file 一行，内容全宽）
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treeRoot = useRepoTree(tree);

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
