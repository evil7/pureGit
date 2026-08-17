/**
 * 全局顶部导航（从 App.tsx 提取，App 只保留路由表）
 *
 * 官方 GitHub 头部：左 Logo + 中搜索 pill + 右图标按钮组
 * （Create new / Issues / PRs / Repos / Gist / 通知 / 用户菜单）。
 * 从 App.tsx 分离：App 职责单一化为路由编排，公共布局组件独立维护。
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, CircleDot, GitPullRequest, BookOpen, FileCode2, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { LoginScopeDialog } from "@/components/LoginScopeDialog";
import { Logo } from "@/components/Logo";
import { CreateNewMenu } from "@/components/NewRepoDialog";

export default function Nav() {
  const { user, loading, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        {/* 左：Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2 font-bold">
          <Logo className="size-6" />
          PureGit
        </Link>

        {/* 中：搜索栏（官方 pill，居中） */}
        <form onSubmit={submitSearch} className="relative mx-auto w-full max-w-md flex-1">
          {/* 最左侧搜索 icon 按钮：点击进入搜索页（不提交查询）；占 pl-9 区域，悬停高亮 */}
          <button
            type="button"
            aria-label={t("nav.searchGo")}
            onClick={() => navigate("/search")}
            className="absolute left-0 top-0 flex h-full w-9 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <Search className="size-4" />
          </button>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("nav.search")}
            className="h-9 rounded-full bg-muted/60 pl-9 text-sm"
          />
        </form>

        {/* 右：官方图标按钮组（Create new 下拉 / issues / PR / repos / Gist / 通知 / 用户）
           ：未登录（含会话恢复中）不展示任何操作按钮，右侧仅登录按钮 */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {user && (
            <>
              {/* Create new 下拉（P7，复刻官方）：仓库/Gist/Issue/PR */}
              <CreateNewMenu />
              {/* 用户级导航图标按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={t("nav.issues")}
                asChild
              >
                <Link to="/issues">
                  <CircleDot className="size-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" title={t("nav.pulls")} asChild>
                <Link to="/pulls">
                  <GitPullRequest className="size-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" title={t("nav.repos")} asChild>
                <Link to="/repositories">
                  <BookOpen className="size-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" title={t("nav.gist")} asChild>
                <Link to="/gist">
                  <FileCode2 className="size-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={t("nav.notifications")}
                asChild
              >
                <Link to="/notifications">
                  <Bell className="size-4" />
                </Link>
              </Button>
            </>
          )}
          {loading ? (
            // 首次加载（会话恢复中）：仅显示登录按钮（未登录不展示操作按钮，避免空白跳动）
            <LoginScopeDialog />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="cursor-pointer rounded-full outline-none">
                <Avatar className="size-7">
                  <AvatarImage src={user.avatarUrl} alt={user.login} />
                  <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="cursor-default font-medium text-foreground">
                  @{user.login}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  {t("nav.settings")}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
                  {t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <LoginScopeDialog />
          )}
        </div>
      </div>
    </nav>
  );
}
