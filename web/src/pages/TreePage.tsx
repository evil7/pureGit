/**
 * 目录页（/:owner/:repo/tree/:branch/:path*，自 RepoCode.tsx 拆出）
 *
 * GitHub 风格：Sticky 单行头（展开树/分支/面包屑/Go to file/新增文件）+ 目录列表 + 子目录 README。
 * 共享组件（BranchPicker/GoToFileInput/FileList）自 RepoCode 导入；Breadcrumb 为本页私有。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, CornerDownRight, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/Tip";
import { InlineError } from "@/components/InlineError";
import { useAuth } from "@/hooks/useAuth";
import { useBranchPath } from "@/hooks/useBranchPath";
import { tStatic } from "@/i18n";
import { fetchDirWithReadmeSmart, apiErrorMessage } from "@/lib/api";
import type { ReadmeInfo, DirEntry } from "@/lib/restapi";
import { MarkdownView } from "@/components/MarkdownView";
import { WriteGate } from "@/components/WriteGate";
import { ForkGate } from "@/components/ForkGate";
import { useTreeCollapse } from "@/lib/repo/tree-collapse";
import { cn } from "@/lib/utils";
import { BranchPicker, GoToFileInput, FileList, RepoRootView, AddFileDropdown } from "./RepoCode";

export default function TreePage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  // tree 路由已改 splat：按分支列表最长前缀匹配解析 branch/path（分支名可含 `/`）
  const { branch: b, path } = useBranchPath();
  const { collapsed: treeCollapsed, setCollapsed: setTreeCollapsed } = useTreeCollapse();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  // 子目录 README（官方：进入目录若含 README 渲染在列表下方）
  const [readme, setReadme] = useState<ReadmeInfo | null>(null);
  // 加载错误态（限流/网络失败 → 明确提示，绝不再误导为「目录为空」）
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // 分支根（path 空）走 RepoRootView（等价 repo 根目录），不在此拉目录数据
    if (!path) return;
    let cancelled = false;
    setEntries(null);
    setReadme(null);
    setLoadError(null);
    // 目录条目 + 子目录 README 一次 Tree.entries 复合查询（原 fetchDirContentsSmart + fetchReadmeSmart 双查）
    fetchDirWithReadmeSmart(owner, repo, path, b, token)
      .then(({ entries: es, readme: r }) => {
        if (cancelled) return;
        setEntries(es);
        setReadme(r);
      })
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

  // 分支根（path 空）→ 等价「换了个 branch 的 repo 根目录」：操作栏（分支切换/Go to file/Code）
  // + 根文件列表 + README（对齐官方 tree/{branch} 与 /:owner/:repo 同渲染，而非目录页）
  if (!path) {
    return <RepoRootView branch={b} />;
  }

  return (
    <div>
      {/* Sticky 单行头（官方 tree 页 #StickyHeader 同款）：折叠态 = [展开树][分支][面包屑] | [Go to file][新增文件]；
          展开态 = [面包屑] | [新增文件]（Go to file 在树 pane 内）。
          折叠态专属元素（展开树按钮/分支/Go to file）**常驻挂载 + hidden 显隐**：
          不条件渲染卸载/重挂载 → 切换折叠不重跑 useEffect、不重复请求（BranchPicker 配 active 懒加载）。 */}
      <div className="sticky top-14 z-10 mb-3 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <Tip label={tStatic("blob.expandTree")}>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", !treeCollapsed && "hidden")}
              onClick={() => setTreeCollapsed(false)}
              aria-label={tStatic("blob.expandTree")}
            >
              <PanelRightOpen className="size-3.5" />
            </Button>
          </Tip>
          <div className={cn(!treeCollapsed && "hidden")}>
            <BranchPicker branch={b} currentPath={path} active={treeCollapsed} mode="tree" />
          </div>
          <div className="min-w-0">
            <Breadcrumb branch={b} path={path} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <GoToFileInput branch={b} className={cn(!treeCollapsed && "hidden")} />
            {token && (
              <WriteGate className="shrink-0">
                <ForkGate>
                  <AddFileDropdown branch={b} path={path} />
                </ForkGate>
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

/** 面包屑（官方 Breadcrumb：branch / 各级目录，最后一级为纯文本） */
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
