import { lazy, Suspense, useEffect, useRef } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
  useRouteError,
} from "react-router-dom";
// 路由级懒加载（堵点修复 3：首屏只加载首页与导航，页面按需加载）
const HomePage = lazy(() => import("@/pages/HomePage"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));
const UserIssuesPage = lazy(() => import("@/pages/user/UserIssuesPage"));
const UserPullsPage = lazy(() => import("@/pages/user/UserPullsPage"));
const ReposNavPage = lazy(() => import("@/pages/user/ReposNavPage"));
const GistsPage = lazy(() => import("@/pages/user/GistsPage"));
const NotificationsPage = lazy(() => import("@/pages/user/NotificationsPage"));
const GistDetailPage = lazy(() =>
  import("@/pages/GistPages").then((m) => ({ default: m.GistDetailPage })),
);
const GistEditPage = lazy(() =>
  import("@/pages/GistPages").then((m) => ({ default: m.GistEditPage })),
);
const NewGistPage = lazy(() =>
  import("@/pages/GistPages").then((m) => ({ default: m.NewGistPage })),
);
const RepoLayout = lazy(() => import("@/components/RepoLayout"));
const RepoCode = lazy(() => import("@/pages/RepoCode"));
const CodeIndex = lazy(() => import("@/pages/CodeIndex"));
const TreePage = lazy(() => import("@/pages/TreePage"));
const BlobPage = lazy(() => import("@/pages/BlobPage"));
const BranchesPage = lazy(() => import("@/pages/BranchesPage"));
const CommitPage = lazy(() => import("@/pages/CommitPage"));
const CommitsPage = lazy(() => import("@/pages/CommitsPage"));
const UploadPage = lazy(() => import("@/pages/UploadPage"));
const ForkPage = lazy(() => import("@/pages/ForkPage"));
const FileEditorPage = lazy(() =>
  import("@/components/FileEditorPage").then((m) => ({ default: m.FileEditorPage })),
);
const IssuesPage = lazy(() => import("@/pages/IssuesPages"));
const IssueDetailPage = lazy(() =>
  import("@/pages/IssueDetailPage").then((m) => ({ default: m.IssueDetailPage })),
);
const PullsPage = lazy(() => import("@/pages/PullsPages"));
const PullDetailPage = lazy(() => import("@/pages/PullDetailPage"));
const NewIssuePage = lazy(() => import("@/pages/NewIssuePage"));
const NewPullRequestPage = lazy(() => import("@/pages/NewPullRequestPage"));
const NewRepositoryPage = lazy(() => import("@/pages/NewRepositoryPage"));
const ReleasesPage = lazy(() => import("@/pages/ReleasesPages"));
const ReleaseDetailPage = lazy(() => import("@/pages/ReleaseDetailPage"));
const SecurityPage = lazy(() => import("@/pages/SecurityPages"));
const SecurityAdvisoryDetailPage = lazy(() =>
  import("@/pages/SecurityPages").then((m) => ({
    default: m.SecurityAdvisoryDetailPage,
  })),
);
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const WikiPage = lazy(() => import("@/pages/WikiPage"));
const ActionsPage = lazy(() => import("@/pages/actions/ActionsPage"));
const WorkflowsPage = lazy(() => import("@/pages/actions/WorkflowsPage"));
const CachesPage = lazy(() => import("@/pages/actions/CachesPage"));
const RunDetailPage = lazy(() => import("@/pages/actions/RunDetailPage"));
const JobDetailPage = lazy(() => import("@/pages/actions/JobDetailPage"));
const DiscussionsPage = lazy(() => import("@/pages/DiscussionsPage"));
const DiscussionDetailPage = lazy(() =>
  import("@/pages/DiscussionsPage").then((m) => ({ default: m.DiscussionDetailPage })),
);
const NewDiscussionChoosePage = lazy(() =>
  import("@/pages/DiscussionsPage").then((m) => ({ default: m.NewDiscussionChoosePage })),
);
const NewDiscussionPage = lazy(() =>
  import("@/pages/DiscussionsPage").then((m) => ({ default: m.NewDiscussionPage })),
);
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetailPage"));
const SettingsLayout = lazy(() => import("@/pages/settings/SettingsLayout"));
const SettingsIndexRedirect = lazy(() =>
  import("@/pages/settings/SettingsLayout").then((m) => ({
    default: m.SettingsIndexRedirect,
  })),
);
const ProfileSettings = lazy(() => import("@/pages/settings/ProfileSettings"));
const AccountSettings = lazy(() => import("@/pages/settings/AccountSettings"));
const OrgSettingsLayout = lazy(() => import("@/pages/settings/OrgSettingsLayout"));
const OrgGeneralSettings = lazy(() => import("@/pages/settings/OrgGeneralSettings"));
const OrgMembersSettings = lazy(() => import("@/pages/settings/OrgMembersSettings"));
const OrgTeamsSettings = lazy(() => import("@/pages/settings/OrgTeamsSettings"));
const OrgReposSettings = lazy(() => import("@/pages/settings/OrgReposSettings"));
const RepositoriesSettings = lazy(() => import("@/pages/settings/RepositoriesSettings"));
const OrganizationsSettings = lazy(() => import("@/pages/settings/OrganizationsSettings"));
const RepoSettingsPage = lazy(() => import("@/pages/settings/RepoSettingsPage"));
const PreferencesSettings = lazy(() => import("@/pages/settings/PreferencesSettings"));
const BlockedUsersSettings = lazy(() => import("@/pages/settings/BlockedUsersSettings"));
/* API 调试工具（/$debug 纯前端路由）：统一 GraphQL/REST 调试面板；
   系统级页面，放 /:login 动态路由之前（静态段评分更高，双保险） */
const DebugPage = lazy(() => import("@/pages/debug"));
const UserProfilePage = lazy(() =>
  import("@/pages/ProfilePages").then((m) => ({ default: m.UserProfilePage })),
);
/* 组织主页：官方统一路径 /{login}（/orgs/:org 302 → /{org}）；组织设置走 /organizations/:org/settings */
const OrgProfileRedirect = lazy(() =>
  import("@/pages/ProfilePages").then((m) => ({
    default: m.OrgProfileRedirect,
  })),
);
import { useTheme } from "@/hooks/useTheme";
import { Toaster } from "@/components/ui/sonner";
import { RippleSpotlight } from "@/components/RippleSpotlight";
import Nav from "@/components/Nav";
import AppFooter from "@/components/AppFooter";
import ScopeWarningBanner from "@/components/ScopeWarningBanner";
import { AppErrorPage, NotFoundPage } from "@/components/ErrorPages";
import { normalizeApiError } from "@/lib/restapi";

/**
 * 全局布局（data router 重构）：Nav + main(Suspense+Outlet) + Footer。
 * 子路由渲染于 Outlet；路由级 errorElement（RouteErrorPage）捕获页面级 throw 的致命错误。
 */
function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <Nav />
      {/* 查漏补缺：已授 scope 少于所需时全局提示 */}
      <ScopeWarningBanner />
      <main className="flex-1">
        {/* 路由级懒加载 fallback：页面 chunk 加载期间显示轻量骨架 */}
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <AppFooter />
    </div>
  );
}

/** 分类 URL（官方 /discussions/categories/{slug}）→ 列表页 ?category={slug} 重定向 */
function DiscussionCategoryRedirect() {
  const { owner, repo, slug } = useParams();
  return (
    <Navigate
      to={`/${owner}/${repo}/discussions?category=${encodeURIComponent(slug ?? "")}`}
      replace
    />
  );
}

/** PR 作者路径（官方 /:owner/:repo/pulls/{author}）→ 列表页 ?author={author} 重定向
 * 官方语义：/pulls/{author} 等价作者搜索 author:{author}（搜索框整体显示 is:open is:pr author:{author}）。 */
function PullsAuthorRedirect() {
  const { owner, repo, author } = useParams();
  return (
    <Navigate to={`/${owner}/${repo}/pulls?author=${encodeURIComponent(author ?? "")}`} replace />
  );
}

/**
 * 路由 errorElement：errorElement 会替换发生错误的 route 层级——根 route 的
 * errorElement 替换整个 AppLayout，故此处自备完整 chrome（Nav + main + Footer），
 * 避免 404/限流页变成无导航裸页面（实测修复）。
 *
 * ⚠️ 错误页导航修复（实测）：React Router 的 errorElement 渲染后，
 * 编程式导航（navigate()）URL 会更新但内容仍卡在错误页（Link 导航正常）。
 * 故监听 location.key：离开错误页的任何导航 → 整页刷新重置路由状态。
 */
function RouteErrorPage() {
  const routeError = useRouteError();
  const err = normalizeApiError(routeError);
  const location = useLocation();
  const enterKey = useRef(location.key);
  useEffect(() => {
    if (location.key !== enterKey.current) {
      window.location.reload();
    }
  }, [location.key]);
  return (
    <div className="flex min-h-svh flex-col">
      <Nav />
      <main className="flex-1">
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
            </div>
          }
        >
          <AppErrorPage err={err} />
        </Suspense>
      </main>
      <AppFooter />
    </div>
  );
}

/**
 * 路由树（declarative → data router）。
 * - 根 errorElement：页面级致命错误（404/限流/5xx）render throw → RouteErrorPage 分类渲染
 * - path="*"：未知路径 → 全局 404 页（仿官方）
 * - /:owner/:repo 的 blob 子路由保留 RepoCode 包裹组件
 */
const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/search", element: <SearchPage /> },
      /* 用户级 Issues（官方 /issues/{tab}：assigned/created/mentioned/recent，URL 驱动）
        注意：不用 /issues/*（splat）——React Router v7 评分中 splat 低于 /:owner/:repo，会被仓库路由抢占 */
      { path: "/issues", element: <UserIssuesPage /> },
      { path: "/issues/:tab", element: <UserIssuesPage /> },
      { path: "/pulls", element: <UserPullsPage /> },
      { path: "/pulls/:tab", element: <UserPullsPage /> },
      { path: "/repositories", element: <ReposNavPage /> },
      /* 新建仓库（官方 /new 同路径） */
      { path: "/new", element: <NewRepositoryPage /> },
      { path: "/gist", element: <GistsPage /> },
      { path: "/gist/new", element: <NewGistPage /> },
      { path: "/gist/:id/edit", element: <GistEditPage /> },
      { path: "/gist/:id", element: <GistDetailPage /> },
      { path: "/notifications", element: <NotificationsPage /> },
      /* API 调试工具（系统级，worker 白名单闸门；放 /:login 之前防抢占）
         子路径 /rest 与 /graph 驱动协议切换（URL 与左栏/方法下拉双向绑定） */
      { path: "/$debug", element: <DebugPage /> },
      { path: "/$debug/:proto", element: <DebugPage /> },
      /* 用户主页（官方 github.com/username；自动检测用户/组织） */
      { path: "/:login", element: <UserProfilePage /> },
      /* 组织主页：/orgs/:org 302 → /:org（官方行为） */
      { path: "/orgs/:org", element: <OrgProfileRedirect /> },
      /* 组织设置（向个人设置靠拢：左卡 + 左导航 + 子路由；
         对齐官方：/settings 302 → /settings/profile，主路由在 profile） */
      {
        path: "/organizations/:org/settings",
        element: <OrgSettingsLayout />,
        children: [
          { index: true, element: <Navigate to="profile" replace /> },
          { path: "profile", element: <OrgGeneralSettings /> },
          { path: "people", element: <OrgMembersSettings /> },
          { path: "teams", element: <OrgTeamsSettings /> },
          { path: "repositories", element: <OrgReposSettings /> },
          /* 系统级偏好：组织设置内直访，不跳回个人 /settings/preferences */
          { path: "preferences", element: <PreferencesSettings /> },
        ],
      },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsIndexRedirect /> },
          { path: "preferences", element: <PreferencesSettings /> },
          { path: "profile", element: <ProfileSettings /> },
          { path: "account", element: <AccountSettings /> },
          /* 组织管理独立板块（用户要求单列：其他用户可能不止 1 个组织） */
          { path: "organizations", element: <OrganizationsSettings /> },
          /* 邮箱已并入个人资料（阶段 4 合并） */
          { path: "emails", element: <Navigate to="/settings/profile" replace /> },
          { path: "repositories", element: <RepositoriesSettings /> },
          /* 兼容旧路径 appearance → profile（/settings 默认 profile，不再默认偏好） */
          { path: "appearance", element: <Navigate to="/settings/profile" replace /> },
          /* 官方路径为下划线 blocked_users（实测：连字符 404）
             已存回复：GitHub 已移除 Saved replies REST API（2024-07 公告，docs 页/端点均 404，
             对齐 fetchRepoProjects 先例删除） */
          { path: "blocked_users", element: <BlockedUsersSettings /> },
          /* 兼容旧连字符路径 */
          { path: "blocked-users", element: <Navigate to="/settings/blocked_users" replace /> },
        ],
      },
      {
        path: "/:owner/:repo",
        element: <RepoLayout />,
        children: [
          { index: true, element: <CodeIndex /> },
          { path: "tree/*", element: <TreePage /> },
          {
            path: "blob/*",
            element: (
              <RepoCode>
                <BlobPage />
              </RepoCode>
            ),
          },
          { path: "new/:branch/*", element: <FileEditorPage /> },
          { path: "edit/:branch/*", element: <FileEditorPage /> },
          { path: "upload/:branch/*", element: <UploadPage /> },
          { path: "fork", element: <ForkPage /> },
          { path: "branches", element: <BranchesPage /> },
          { path: "branches/:filter", element: <BranchesPage /> },
          { path: "commit/:sha", element: <CommitPage /> },
          { path: "commits/*", element: <CommitsPage /> },
          { path: "issues", element: <IssuesPage /> },
          { path: "issues/new/choose", element: <NewIssuePage /> },
          { path: "issues/new", element: <NewIssuePage /> },
          { path: "issues/:number", element: <IssueDetailPage /> },
          { path: "pulls", element: <PullsPage /> },
          { path: "pulls/new", element: <NewPullRequestPage /> },
          /* 官方 /:owner/:repo/pulls/{author} 路径 = 作者搜索（author:{author}）→ 列表 ?author= */
          { path: "pulls/:author", element: <PullsAuthorRedirect /> },
          /* 官方单数路径 github.com/:owner/:repo/pull/:id（/pull 无 id 容错跳转列表） */
          { path: "pull", element: <Navigate to="../pulls" replace /> },
          { path: "pull/:number", element: <PullDetailPage /> },
          { path: "discussions", element: <DiscussionsPage /> },
          { path: "discussions/new/choose", element: <NewDiscussionChoosePage /> },
          { path: "discussions/new", element: <NewDiscussionPage /> },
          { path: "discussions/categories", element: <Navigate to="." relative="path" replace /> },
          { path: "discussions/categories/:slug", element: <DiscussionCategoryRedirect /> },
          { path: "discussions/:number", element: <DiscussionDetailPage /> },
          { path: "wiki/*", element: <WikiPage /> },
          { path: "actions", element: <ActionsPage /> },
          { path: "actions/workflows", element: <WorkflowsPage /> },
          { path: "actions/caches", element: <CachesPage /> },
          { path: "actions/runs/:runId", element: <RunDetailPage /> },
          { path: "actions/runs/:runId/job/:jobId", element: <JobDetailPage /> },
          { path: "releases", element: <ReleasesPage /> },
          { path: "releases/tag/:tag", element: <ReleaseDetailPage /> },
          { path: "security", element: <SecurityPage /> },
          { path: "security/advisories/:ghsaId", element: <SecurityAdvisoryDetailPage /> },
          { path: "pulse", element: <InsightsPage /> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "projects/:number", element: <ProjectDetailPage /> },
          /* 仓库设置（官方 github.com/:owner/:repo/settings 同路径） */
          { path: "settings", element: <RepoSettingsPage /> },
        ],
      },
      /* 未知路径 → 全局 404（仿官方） */
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

function App() {
  // 全局主题应用：dark class + favicon 换色在任意页面首帧即生效，
  // 不依赖访问偏好设置页（原先主题仅偏好页 useTheme 才应用）。
  // 偏好页通过同一 useTheme（同一 localStorage 源）切换主题，此处 effect 同步生效。
  useTheme();

  return (
    <>
      {/* 全局统一操作提醒（右下角；success/error/warning/info 按类型着色） */}
      <Toaster richColors position="bottom-right" closeButton />
      {/* 涟漪聚光灯动画（监听全局事件；需聚焦场景指引视线到目标元素） */}
      <RippleSpotlight />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
