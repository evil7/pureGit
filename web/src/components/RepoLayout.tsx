/**
 * 仓库嵌套布局：RepoHeader（全 tab）+ 内容区（Outlet）
 * 所有仓库子页面共用该布局，保持 tab 导航持久
 * 未登录策略（设计方案）：仅 Code 浏览（根/tree/blob/new/edit）匿名可访问，
 * 其余 tab（Issues/Pulls/Actions/Security/Insights/Wiki/Releases/Projects/Settings）
 * 切换时内容区显示登录墙（LoginPrompt + 聚光灯指引右上角登录按钮）——URL 驱动，登录后回落。
 */
import { useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import RepoHeader from "@/components/RepoHeader";
import RepoAbout from "@/components/RepoAbout";
import { LoginPrompt } from "@/components/LoginPrompt";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchContributorsCount,
  fetchSecurityAdvisoriesCount,
  normalizeApiError,
  type ApiError,
} from "@/lib/restapi";
import { fetchRepoHomeSmart, fetchRootFilesSmart, type Repository } from "@/lib/api";
import type { Release } from "@/lib/restapi";
import { RepoDataContext } from "@/lib/repo/repo-context";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { Skeleton } from "@/components/ui/skeleton";

/** 未登录可匿名浏览的 Code 相关路径段（根/tree/blob/new/edit/upload/branches；其余 tab 需登录） */
const CODE_PATH_SEGMENTS = ["", "tree", "blob", "new", "edit", "upload", "branches"];

/** 仓库内容区：key 随路径变化触发动画；未登录且非 Code 段 → 登录墙（URL 驱动，登录后回落） */
function RepoContent() {
  const { pathname } = useLocation();
  const { token } = useAuth();
  const { t } = useI18n();
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const base = `/${owner}/${repo}`;
  const rest = pathname.slice(base.length).replace(/^\/+/, "");
  const segment = rest.split("/")[0].toLowerCase();
  const isCodePath = CODE_PATH_SEGMENTS.includes(segment);

  // 未登录 + 非 Code 段 → 登录墙（官方 URL 语义：tab 可点，内容区提示登录；含 settings）
  if (!token && !isCodePath) {
    return (
      <LoginPrompt
        title={t("repoLoginWall.title")}
        desc={t("repoLoginWall.desc").replace("{tab}", segment)}
        className="py-16"
      />
    );
  }
  return (
    <div key={pathname} className="page-enter">
      <Outlet />
    </div>
  );
}

export default function RepoLayout() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useAuth();
  const { pathname } = useLocation();
  // blob 页（左树 + 代码）md 以下隐去 About：内容区已含文件树 + sticky 面包屑 + commit 行，
  // 单列时 About 会掉到代码底部造成割裂（大屏仍保留右栏 sticky）；设置页官方全宽无 About；
  // issues 列表/详情页官方为 filters 左栏 + 内容，无 About 右栏；pulls 列表/详情页官方全宽单列；
  // new/edit 文件编辑页官方为左文件树两栏（同 blob），无 About 右栏
  const isBlobPage = /\/blob\//.test(pathname);
  // 文件编辑页：/:owner/:repo/new|edit/:branch/*（第 3 段为 new/edit；避免误伤 issues/new、pulls/new）
  const isFileEditPage = /^\/[^/]+\/[^/]+\/(?:new|edit)\//.test(pathname);
  const isSettingsPage = /\/settings$/.test(pathname);
  const isIssuesPage = /\/issues(\/|$)/.test(pathname);
  const isPullsPage = /\/pulls(\/|$)/.test(pathname);
  // PR 详情页单数路径 pull/:number（官方 /:owner/:repo/pull/:id）——自身已是 F 型右 metadata
  // 布局，外层不得叠加 About 右栏（此前漏覆盖：仅 isPullsPage 复数列表，详情页 About 误显）
  const isPullDetailPage = /\/pull(\/|$)/.test(pathname);
  // 官方 Discussions 页：左分类栏 + 右内容两栏（无 About 右栏 对齐官方实测）
  const isDiscussionsPage = /\/discussions(\/|$)/.test(pathname);
  // 全站审计：官方仅 Code 首页 + tree 根 保留 About；
  // actions/projects/wiki/security/pulse/releases 均无 About（此前多显，一次补齐 6 项）
  const isActionsPage = /\/actions(\/|$)/.test(pathname);
  const isProjectsPage = /\/projects(\/|$)/.test(pathname);
  const isWikiPage = /\/wiki(\/|$)/.test(pathname);
  const isSecurityPage = /\/security(\/|$)/.test(pathname);
  const isPulsePage = /\/pulse(\/|$)/.test(pathname);
  const isReleasesPage = /\/releases(\/|$)/.test(pathname);
  // 分支管理页（官方全宽单列，无 About 右栏）
  const isBranchesPage = /\/branches(\/|$)/.test(pathname);
  // 文件上传页（官方全宽单列，无 About 右栏，同 blob/new/edit）
  const isUploadPage = /\/upload(\/|$)/.test(pathname);
  // Fork 页（官方全宽单列卡片，无 About 右栏）
  const isForkPage = /\/fork(\/|$)/.test(pathname);
  // 未登录 + 非 Code 段（登录墙页）→ About 侧栏隐藏，避免白发匿名请求
  const isCodePath = (() => {
    const base = `/${owner}/${repo}`;
    const rest = pathname.slice(base.length).replace(/^\/+/, "");
    return CODE_PATH_SEGMENTS.includes(rest.split("/")[0].toLowerCase());
  })();
  const hideAbout =
    isBlobPage ||
    isFileEditPage ||
    isSettingsPage ||
    isIssuesPage ||
    isPullsPage ||
    isPullDetailPage ||
    isDiscussionsPage ||
    isActionsPage ||
    isProjectsPage ||
    isWikiPage ||
    isSecurityPage ||
    isPulsePage ||
    isReleasesPage ||
    isBranchesPage ||
    isUploadPage ||
    isForkPage ||
    (!token && !isCodePath);
  const [data, setData] = useState<Repository | null>(null);
  const [languages, setLanguages] = useState<Record<string, number>>({});
  const [releasesCount, setReleasesCount] = useState(0);
  const [latestRelease, setLatestRelease] = useState<Release | null>(null);
  const [rootFiles, setRootFiles] = useState<string[] | null>(null);
  const [contributorsCount, setContributorsCount] = useState(0);
  // RepoHeader Security tab 计数（GHSA 总数；公开仓库匿名可读；null = 未加载/失败 → 隐藏计数）
  const [securityCount, setSecurityCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    // About 侧栏 Contributors 计数（REST per_page=1 读 Link header；失败/限流静默保持 0）。
    // 侧栏隐藏页（blob/设置/issues/pulls/未登录登录墙）→ 跳过，避免白发请求
    if (hideAbout) return;
    let cancelled = false;
    fetchContributorsCount(owner!, repo!, token)
      .then((c) => !cancelled && setContributorsCount(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, hideAbout]);

  useEffect(() => {
    // RepoHeader Security tab 计数：独立于 About 侧栏（tab 恒显示），与 hideAbout 无关；
    // 失败/限流 → null → RepoHeader 隐藏计数（不显示错误）
    let cancelled = false;
    fetchSecurityAdvisoriesCount(owner!, repo!, token)
      .then((c) => !cancelled && setSecurityCount(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  useEffect(() => {
    // 根目录文件探测（依赖 data 默认分支；Resources 中 CoC/Contributing/Security/license 显隐；
    // 失败 null → 非必须项隐藏，不影响页面）
    if (hideAbout || !data) return;
    let cancelled = false;
    fetchRootFilesSmart(owner!, repo!, data.default_branch, token)
      .then((files) => !cancelled && setRootFiles(files))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token, hideAbout, data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // 仓库主页复合查询：GraphQL 一次取仓库元数据 + languages + tab 计数 + releases 总数/最新（匿名 REST 分步）
    fetchRepoHomeSmart(owner!, repo!, token)
      .then(({ data: repoData, langs, releasesCount: rc, latestRelease: lr }) => {
        if (cancelled) return;
        setData(repoData);
        setLanguages(langs);
        setReleasesCount(rc);
        setLatestRelease(lr);
      })
      .catch((e: unknown) => {
        // 整页级致命错误（404/限流/5xx）保存原始错误，render 中 throw → 路由 errorElement
        if (!cancelled) setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  // 仓库加载失败（404 不存在 / 限流 / 5xx 等整页不可用）→ throw 至路由 errorElement 全局错误页
  if (error) throw error;
  // 加载中 → 尺寸匹配骨架（模拟 RepoHeader + 内容区布局，防加载完成切换时大小抖动）
  if (!data || loading) {
    return (
      <div className="min-h-svh">
        {/* RepoHeader 骨架（头像 + owner/repo + 操作按钮 + tabs 行） */}
        <div className="border-b">
          <div className="mx-auto max-w-7xl px-4">
            <div className="flex min-w-0 items-center gap-2 py-3">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <div className="flex min-w-0 items-center gap-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-4 shrink-0" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
            {/* Tabs 行骨架（与 RepoHeader TABS 数量一致） */}
            <nav className="flex gap-1 overflow-x-auto">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 shrink-0" />
              ))}
            </nav>
          </div>
        </div>
        {/* 内容区骨架（右栏 About 与 hideAbout 语义一致） */}
        <div className={PAGE_SHELL}>
          <PageLayout
            gap="md"
            right={
              hideAbout
                ? undefined
                : {
                    node: (
                      <div className="space-y-3">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <div className="flex flex-wrap gap-1.5 pt-2">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-5 w-16 rounded-full" />
                          ))}
                        </div>
                        <Skeleton className="mt-3 h-6 w-32" />
                        <div className="space-y-2 pt-1">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-4 w-full" />
                          ))}
                        </div>
                      </div>
                    ),
                    width: 320,
                    sticky: "nav",
                    breakpoint: "lg",
                  }
            }
          >
            {/* 内容区骨架（文件列表卡片模拟，匹配 Code 首页行高） */}
            <div className="rounded-lg border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                >
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="ml-auto h-4 w-1/4" />
                </div>
              ))}
            </div>
          </PageLayout>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh">
      {/* Provider 提升：RepoHeader（Star/Fork 按钮）与内容区共用仓库元数据 + viewer 状态，
          避免 StarForkButtons 重复发 REST（/user/starred、/subscription）；
          update 供设置页 Features 开关等 PATCH 成功后局部同步（tabs 即时反映） */}
      <RepoDataContext.Provider
        value={{
          data,
          update: (patch) => setData((prev) => (prev ? { ...prev, ...patch } : prev)),
        }}
      >
        {/* 仓库头（含 tabs 行右侧 Star/Fork，官方位置）；data 加载后传递 */}
        <RepoHeader
          data={data}
          securityCount={securityCount}
          onRepoUpdated={(stars, forks) =>
            setData((prev) =>
              prev ? { ...prev, stargazers_count: stars, forks_count: forks } : prev,
            )
          }
        />
        <div className={PAGE_SHELL}>
          {/* 布局规范 G 型（内容 + 右 About）：PageLayout right 侧栏；
             hideAbout 页不传 right → 全宽单列（官方行为 全站审计） */}
          <PageLayout
            gap="md"
            right={
              hideAbout
                ? undefined
                : {
                    node: (
                      <RepoAbout
                        data={data}
                        languages={languages}
                        releasesCount={releasesCount}
                        latestRelease={latestRelease}
                        contributorsCount={contributorsCount}
                        rootFiles={rootFiles}
                      />
                    ),
                    width: 320,
                    sticky: "nav",
                    breakpoint: "lg",
                  }
            }
          >
            <RepoContent />
          </PageLayout>
        </div>
      </RepoDataContext.Provider>
    </div>
  );
}
