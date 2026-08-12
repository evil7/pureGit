/**
 * 仓库级跨页头部：仓库名 + 六 tab 导航（Code/Issues/PR/Discussions/Releases/Projects）
 * 仿 GitHub 仓库页头部，持久显示于所有仓库子页面
 * tab 高亮依据当前路径精确匹配（与 GitHub 路由一致）
 * 官方布局（2026 新版）：仓库名行 = 头像 + 名称 + Public/Private 标签 + Star/Fork（行最右侧）；
 * tabs 独立一行，不含操作按钮。
 */
import { Link, useLocation, useParams } from "react-router-dom";
import {
  BookOpen,
  MessageSquare,
  GitPullRequest,
  Package,
  Boxes,
  Settings,
  BookMarked,
  Zap,
  ShieldAlert,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StarForkButtons } from "@/components/StarForkButtons";
import { WriteGate } from "@/components/WriteGate";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import type { Repository } from "@/lib/rest";

const TABS: {
  to: string;
  label: string;
  icon: typeof BookOpen;
  /** 依据仓库 Features 开关显隐（undefined = 始终显示） */
  feature?: "issues" | "discussions" | "projects" | "wiki";
}[] = [
  // 官方顺序（实测 github.com/microsoft/vscode DOM）：
  // Code → Issues → Pull requests → Discussions → Actions → Projects → Wiki → Security → Insights → Releases → Settings
  { to: "", label: "Code", icon: BookOpen },
  { to: "/issues", label: "Issues", icon: MessageSquare, feature: "issues" },
  { to: "/pulls", label: "Pull requests", icon: GitPullRequest },
  { to: "/discussions", label: "Discussions", icon: MessageSquare, feature: "discussions" },
  { to: "/actions", label: "Actions", icon: Zap },
  { to: "/projects", label: "Projects", icon: Boxes, feature: "projects" },
  { to: "/wiki", label: "Wiki", icon: BookMarked, feature: "wiki" },
  { to: "/security", label: "Security", icon: ShieldAlert },
  { to: "/pulse", label: "Insights", icon: BarChart3 },
  { to: "/releases", label: "Releases", icon: Package },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Features 开关 → tab 显隐（官方语义：Issues/Projects/Wiki 关则隐藏，Discussions 开才显示） */
function showTabByFeature(
  feature: "issues" | "discussions" | "projects" | "wiki" | undefined,
  data?: Repository | null,
): boolean {
  if (!feature || !data) return true;
  switch (feature) {
    case "issues":
      return data.has_issues !== false;
    case "discussions":
      return data.has_discussions === true;
    case "projects":
      return data.has_projects !== false;
    case "wiki":
      return data.has_wiki !== false;
  }
}

export default function RepoHeader({
  data,
  securityCount,
  onRepoUpdated,
}: {
  /** 仓库数据（存在时渲染头像/可见性标签/Star/Fork，官方位置） */
  data?: Repository | null;
  /** Security tab 计数（GHSA 总数，独立于 Repository 数据获取；null = 未加载/失败 → 隐藏） */
  securityCount?: number | null;
  /** star/fork 数变化后的回调（同步回 RepoLayout 状态） */
  onRepoUpdated?: (stars: number, forks: number) => void;
}) {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { t } = useI18n();
  // 当前仓库根路径（pathname 前缀），用于计算当前 tab
  const basePath = `/${owner}/${repo}`;

  // 当前所在 tab：Code 涵盖根路径 /tree/... /blob/...
  const rest = pathname.slice(basePath.length).replace(/^\/+/, "");
  const current = rest === "" ? "code" : rest.split("/")[0].toLowerCase();
  const isCodeActive = current === "code" || current === "tree" || current === "blob";
  // Settings tab 仅仓库所有者可见（官方：非 owner/admin 完全无设置入口）。
  // 组织仓库需组织 admin 权限（用 login 精确匹配；组织 admin 场景走 OrgSettingsPage）
  const isOwner = Boolean(data && user && data.owner.login === user.login);

  return (
    <div className="border-b">
      <div className="mx-auto max-w-7xl px-4">
        {/* 仓库名行（官方：头像 + 名称 + 可见性 + Star/Fork 最右侧） */}
        <div className="flex min-w-0 items-center gap-2 py-3">
          {data && (
            <Avatar className="size-5 shrink-0 rounded-full">
              <AvatarImage src={data.owner.avatar_url} alt={data.owner.login} />
              <AvatarFallback>{data.owner.login.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          {/* 仓库名行（官方：头像 + 名称 + 可见性 + Star/Fork 最右侧）。
              用户名 / 项目名分开可点击（对齐 GitHub）：点用户名 → 用户主页，点项目名 → 项目主页 */}
          <span className="flex min-w-0 items-center gap-0.5">
            <Link
              to={`/${owner}`}
              className="truncate font-semibold text-muted-foreground hover:text-foreground hover:underline"
            >
              {owner}
            </Link>
            <span className="shrink-0 text-muted-foreground">/</span>
            <Link to={basePath} className="truncate font-semibold hover:underline">
              <span className="text-foreground">{repo}</span>
            </Link>
          </span>
          {data && (
            <Badge variant="secondary" className="text-xs">
              {data.private ? t("common.repoPrivate") : t("common.repoPublic")}
            </Badge>
          )}
          {/* 归档徽章（归档仓库详情头标识，对齐官方黄色横幅语义的轻量版） */}
          {data?.archived && (
            <Badge variant="outline" className="text-xs">
              {t("common.repoArchived")}
            </Badge>
          )}
          {data && (
            <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
              {/* Star/Fork 属写操作：仅限访问模式下置灰 */}
              <WriteGate>
                <StarForkButtons
                  stars={data.stargazers_count}
                  forks={data.forks_count}
                  subscribers={data.subscribers_count ?? 0}
                  onUpdated={onRepoUpdated}
                />
              </WriteGate>
            </div>
          )}
        </div>

        {/* Tabs 导航（独立一行，不含操作按钮）；Features 关的板块 tab 隐藏（官方语义） */}
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            if (!showTabByFeature(tab.feature, data)) return null;
            const Icon = tab.icon;
            const isActive = tab.to ? current === tab.to.slice(1) : isCodeActive;
            const full = tab.to ? basePath + tab.to : basePath;
            // tab 计数（官方语义：Issues/PRs 显示 open 数、Security 显示 GHSA 总数；
            // 有数据即显示含 0，undefined/null（未加载/失败/降级缺失）隐藏）
            const tabCount =
              tab.to === "/issues"
                ? data?.open_issues_count
                : tab.to === "/pulls"
                  ? data?.open_pulls_count
                  : tab.to === "/security"
                    ? securityCount
                    : undefined;
            const link = (
              <Link
                key={tab.to}
                to={full}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {tab.label}
                {tabCount !== undefined && tabCount !== null && (
                  <Badge variant="secondary" className="rounded-full px-1.5 font-normal">
                    {formatCount(tabCount)}
                  </Badge>
                )}
              </Link>
            );
            // Settings tab 仅仓库所有者可见（官方：非 owner/admin 完全无设置入口）
            return tab.to === "/settings" ? (isOwner ? link : null) : link;
          })}
        </nav>
      </div>
    </div>
  );
}
