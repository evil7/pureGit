/**
 * 文件页（/:owner/:repo/blob/:branch/:path*，自 RepoCode.tsx 拆出）
 *
 * 左树右内容：sticky 面包屑 + Latest commit 行 + 操作头（Raw/Copy/下载/编辑/删除 + 面板切换）
 * + 代码/预览区 + 右侧 Symbols/Outline 面板。SymbolsPanel/OutlinePanel 为本页私有面板；
 * BranchPicker/GoToFileInput 自 RepoCode 导入。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  ExternalLink,
  History,
  List,
  PanelRightOpen,
  PencilLine,
  SquareCode,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/Tip";
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
import { useAuth } from "@/hooks/useAuth";
import { useBranchPath } from "@/hooks/useBranchPath";
import { useDateFormat } from "@/hooks/useDateFormat";
import { tStatic, useI18n } from "@/i18n";
import {
  fetchFileWithCommitSmart,
  fetchFileCommitSmart,
  BLOB_INLINE_MAX_BYTES,
  apiErrorMessage,
  type FileCommitInfo,
} from "@/lib/api";
import { fetchFileMeta, deleteFileContent, ApiError } from "@/lib/restapi";
import { buildRawProxyUrl, buildRawDirectUrl } from "@/lib/repo/raw-proxy";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { getRawProxyMode } from "@/lib/net/proxy-mode";
import { getMediaKind } from "@/lib/repo/media-type";
import { triggerNativeDownload } from "@/lib/net/download";
import { CodeView } from "@/components/CodeView";
import { MarkdownView } from "@/components/MarkdownView";
import { UserAvatar } from "@/components/UserAvatar";
import { WriteGate } from "@/components/WriteGate";
import { ForkGate } from "@/components/ForkGate";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useTreeCollapse } from "@/lib/repo/tree-collapse";
import { cn } from "@/lib/utils";
import type { EditorView } from "@codemirror/view";
import { collectReferences, type SymbolInfo, type SymbolRef } from "@/lib/code/symbols";
import { extractOutline, type OutlineItem } from "@/lib/markdown/markdown-outline";
import { SIDEBAR_STICKY_SCROLL_HEAD } from "@/lib/ui/layout";
import { BranchPicker, GoToFileInput } from "./RepoCode";
import { MediaPreview } from "./MediaPreview";
import { SymbolsPanel, OutlinePanel } from "./BlobPanels";

export default function BlobPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { fmt } = useDateFormat();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { collapsed: treeCollapsed, setCollapsed: setTreeCollapsed } = useTreeCollapse();
  // blob 路由已改 splat：按分支列表最长前缀匹配解析 branch/path（分支名可含 `/`）
  const { branch: b, path } = useBranchPath();
  const [rawContent, setRawContent] = useState("");
  const [commit, setCommit] = useState<FileCommitInfo>(null);
  const [error, setError] = useState<string | null>(null);
  // 文件过大（>100MB，REST 拒绝）→ 专门的「无法预览」提示（同官方），不渲染内容
  const [tooLarge, setTooLarge] = useState(false);
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
  // 媒体类型（图片/音频/视频；svg 除外——svg 走代码渲染确保安全）
  const mediaKind = useMemo(() => getMediaKind(path), [path]);
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

  // 加载内容 + 文件头提交（一次 GraphQL 复合查询；匿名时 commit 为 null 自然跳过）
  useEffect(() => {
    let cancelled = false;
    setRawContent("");
    setCommit(null);
    setError(null);
    setTooLarge(false);
    // 媒体文件：不读文本内容（二进制 .text() 只会出乱码/进内存），仅加载文件头 commit 信息行
    if (mediaKind) {
      if (token) {
        fetchFileCommitSmart(owner, repo, path, b, token)
          .then((c) => {
            if (!cancelled) setCommit(c);
          })
          .catch(() => {
            /* commit 失败静默（媒体渲染不依赖 commit） */
          });
      }
      return () => {
        cancelled = true;
      };
    }
    fetchFileWithCommitSmart(owner, repo, path, token, b, BLOB_INLINE_MAX_BYTES)
      .then(({ content, commit: c }) => {
        if (cancelled) return;
        setRawContent(content);
        setCommit(c);
      })
      .catch((e) => {
        if (cancelled) return;
        // 文件过大（>100MB，REST 拒绝）→ 专门的「无法预览」提示 + 下载/View raw
        if (e instanceof ApiError && e.status === 413) {
          setTooLarge(true);
          return;
        }
        // 限流（匿名 60/h 耗尽）→ apiErrorMessage 明确提示「登录后可获得更高配额」+ 聚光灯引导；
        // 其余（>1MB/二进制等）→ 原提示
        setError(apiErrorMessage(e, "文件加载失败（可能超过 100MB 或为二进制）"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, path, token, b, mediaKind]);

  const fileName = path.split("/").pop() ?? path;
  // 媒体 src / Raw / 下载复用 URL：按 proxy 模式分流（on / login+登录 → $raw；否则 raw 直连）
  const [rawUrl, setRawUrl] = useState(() => buildRawDirectUrl(owner, repo, b, path));
  useEffect(() => {
    let cancelled = false;
    getRawProxyMode().then((mode) => {
      if (cancelled) return;
      const canProxy = token ? mode === "on" || mode === "login" : mode === "on";
      setRawUrl(
        canProxy ? buildRawProxyUrl(owner, repo, b, path) : buildRawDirectUrl(owner, repo, b, path),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, b, path, token]);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // ===== 文件头操作：Raw/下载走已解析的 rawUrl（$raw 透传或 raw 直连） =====
  // openRaw 新标签页直链 rawUrl；copy/download 基于已加载 rawContent。
  const openRaw = () => {
    window.open(rawUrl, "_blank", "noopener");
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
  /** 大文件下载：直接走 rawUrl（$raw 透传或 raw 直连）→ 原生流式下载 */
  const downloadLarge = () => {
    triggerNativeDownload(rawUrl, fileName);
  };

  // 行数 / 字节（官方：`24 lines (22 loc) · 253 Bytes`；结尾换行不计入行数）
  const trimmed = rawContent ? rawContent.replace(/\n$/, "") : "";
  const lines = trimmed ? trimmed.split("\n").length : 0;
  const loc = trimmed ? trimmed.split("\n").filter((l) => l.trim() !== "").length : 0;
  const bytes = rawContent ? new Blob([rawContent]).size : 0;
  // 媒体文件类型标签（操作头「行数」位置改显类型：图片/音频/视频）
  const mediaLabel =
    mediaKind === "image"
      ? t("blob.mediaImage")
      : mediaKind === "audio"
        ? t("blob.mediaAudio")
        : mediaKind === "video"
          ? t("blob.mediaVideo")
          : null;
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
            { value: "preview", label: t("code.preview") },
            { value: "code", label: t("blob.viewCode") },
          ]}
          value={view}
          onValueChange={setView}
          variant="box"
        />
      )}
      <span className="font-mono">
        {mediaLabel ?? `${lines} lines (${loc} loc) · ${bytes} Bytes`}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* Raw 按钮组（官方 ButtonGroup：Raw 文字 + Copy + 下载 图标，圆角合并） */}
        <div className="flex items-stretch overflow-hidden rounded-md border">
          <Button variant="ghost" className="rounded-none px-2.5" onClick={openRaw}>
            Raw
          </Button>
          {!mediaKind && (
            <Tip label={copiedRaw ? t("common.copied") : t("blob.copyRaw")}>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-none"
                onClick={() => void copyRaw()}
              >
                {copiedRaw ? (
                  <Check className="size-3.5 text-chart-1" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </Tip>
          )}
          <Tip label={t("blob.downloadRaw")}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-none"
              onClick={mediaKind ? downloadLarge : () => void downloadRaw()}
            >
              <Download className="size-3.5" />
            </Button>
          </Tip>
        </div>
        {/* Edit + More-edit（官方 ButtonGroup：pencil 图标 + 三角下拉；仅写权限显示）
            ForkGate：非本人仓库点击编辑/删除 → fork 引导（官方语义：他人仓库先 fork 再改） */}
        {token && (
          <WriteGate className="flex items-center gap-1.5">
            <ForkGate className="flex items-center gap-1.5">
              <div className="flex items-stretch overflow-hidden rounded-md border">
                {!mediaKind && (
                  <Tip label={t("blob.editFile")}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-none"
                      asChild
                      aria-label={t("blob.editFile")}
                    >
                      {/*：blob 已加载内容随导航 state 传给编辑页（省一次内容请求）；直接访问编辑链接则自加载 */}
                      <Link
                        to={`/${owner}/${repo}/edit/${b}/${path}`}
                        state={{ content: rawContent }}
                      >
                        <PencilLine className="size-3.5" />
                      </Link>
                    </Button>
                  </Tip>
                )}
                <Tip label={t("blob.deleteFile")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDelOpen(true)}
                    aria-label={t("blob.deleteFile")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </Tip>
              </div>
            </ForkGate>
          </WriteGate>
        )}
        {/* 面板切换按钮（官方 blob 头最右）：markdown 预览 → Outline；代码 → Symbols；markdown Code 视图无 */}
        {isMarkdown && view === "preview" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOutlineOpen((v) => !v)}
            title={outlineOpen ? t("blob.closeOutline") : t("blob.openOutline")}
            aria-pressed={outlineOpen}
            aria-expanded={outlineOpen}
          >
            <List className="size-3.5" />
          </Button>
        )}
        {!isMarkdown && !mediaKind && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSymbolsOpen((v) => !v)}
            title={symbolsOpen ? t("blob.closeSymbols") : t("blob.openSymbols")}
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
          <Tip label={t("blob.expandTree")}>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", !treeCollapsed && "hidden")}
              onClick={() => setTreeCollapsed(false)}
              aria-label={t("blob.expandTree")}
            >
              <PanelRightOpen className="size-3.5" />
            </Button>
          </Tip>
          <div className={cn(!treeCollapsed && "hidden")}>
            <BranchPicker branch={b} currentPath={path} active={treeCollapsed} mode="blob" />
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
            <Button size="icon" variant="ghost" onClick={() => void copyPath()}>
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
                className="gap-1"
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
          <Badge variant="secondary" asChild className="shrink-0 font-mono hover:bg-secondary/80">
            <Link to={`/${owner}/${repo}/commit/${commit.sha}`} title={commit.sha}>
              {commit.sha.slice(0, 7)}
            </Link>
          </Badge>
          <span className="shrink-0">{fmt(commit.commit.committer.date)}</span>
          <Link
            to={`/${owner}/${repo}/commits/${b}/${path}`}
            className="ml-auto flex shrink-0 items-center gap-1 text-primary hover:underline"
          >
            <History className="size-3.5" />
            History
          </Link>
        </div>
      )}

      {/* 操作头已并入内容容器内部顶部（renderActionBar，官方 BlobViewHeader 一体结构） */}
      {/* (commit 行已移至操作头上方，官方 LatestCommit 位置——中间) */}

      {tooLarge ? (
        /* 文件过大（>100MB）：无法在线预览（同官方）——提示下载或 clone 项目后查看 */
        <div className="flex flex-col items-center gap-3 rounded-lg border py-12">
          <p className="text-sm font-medium">{t("blob.tooLarge")}</p>
          <p className="text-xs text-muted-foreground">{t("blob.tooLargeHint")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={downloadLarge}>
              <Download className="size-3.5" />
              {t("blob.downloadRaw")}
            </Button>
            <Button size="sm" variant="outline" onClick={openRaw}>
              <ExternalLink className="size-3.5" />
              Raw
            </Button>
          </div>
        </div>
      ) : error ? (
        <InlineError message={error} size="sm" />
      ) : mediaKind ? (
        /* 媒体文件（图片/音频/视频）：src 走 /$raw 直接渲染（svg 除外——svg 走代码渲染确保安全） */
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div
              ref={actionBarRef}
              className={cn(
                "sticky top-25 z-10 flex flex-wrap items-center gap-2 border bg-muted px-4 py-2 text-xs text-muted-foreground",
                headerStickied ? "" : "rounded-t-md",
              )}
            >
              {renderActionBar()}
            </div>
            <div className="flex items-center justify-center rounded-b-md border border-t-0 bg-card p-4">
              <MediaPreview key={rawUrl} kind={mediaKind} src={rawUrl} alt={fileName} />
            </div>
          </div>
        </div>
      ) : rawContent === "" ? (
        <Skeleton className="h-96 w-full rounded-lg border" />
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
                  rawBase={
                    repoRawBase(owner, repo, b) +
                    (path.includes("/") ? "/" + path.slice(0, path.lastIndexOf("/")) : "")
                  }
                >
                  {rawContent}
                </MarkdownView>
              </div>
            </div>
          </div>
          {outlineOpen && outline.length > 0 && (
            /* Outline 面板：sticky 对齐操作头（top-25），页面滚动自然锁定（同 Symbols） */
            <div className={cn("w-75 shrink-0", SIDEBAR_STICKY_SCROLL_HEAD)}>
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
            /* Symbols 面板：sticky 对齐操作头（top-25），页面滚动自然锁定——
               面板自身 max-h 限高内滚（SIDEBAR_STICKY_SCROLL_HEAD） */
            <div className={cn("w-75 shrink-0", SIDEBAR_STICKY_SCROLL_HEAD)}>
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
              {t("blob.deleteConfirm").replace("{branch}", b)}
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
              {delBusy ? t("common.deleting") : t("blob.deleteSubmit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
