/**
 * 全局错误页内容组件（引入）
 *
 * 架构（用户决策：路由级 errorElement 大重构）：
 * - 页面级整页加载失败 → render 中 throw ApiError → 路由 errorElement 捕获
 * - `AppErrorPage`（在 App.tsx 中渲染完整 chrome：Nav + main + Footer）按类型分发：
 *   404 → NotFoundPage（Logo 小猫场景 + 站内搜索框 + 链接）
 *   限流 → RateLimitPage（未登录登录引导 + 聚光灯；已登录稍后重试）
 *   其他 → ErrorPage（status 徽标 + 友好文案 + 可展开原始 JSON）
 * - 路由 `path="*"` 未知路径 → NotFoundPage（无错误对象）
 * - ⚠️ errorElement 会替换发生错误的 route 层级——故错误页需自备 chrome（Nav/Footer），
 *   否则走 errorElement 的 404/限流页会变成无导航裸页面（实测修复）
 *
 * 局部错误（表单/评论/列表子区）不进本模块——占位空态 + toast 提示。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, RefreshCw, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { NotFoundSceneLayout } from "@/components/NotFoundScene";
import { triggerLoginSpotlight } from "@/lib/login-spotlight";
import { useI18n } from "@/i18n";
import { ApiError, normalizeApiError } from "@/lib/rest";
import { getPrefsToken } from "@/lib/prefs-sync";
import { PAGE_SHELL } from "@/lib/layout";

/** 统一外壳：居中内容 + PAGE_SHELL（顶部间距；禁止 py-*）。
 * min-h 扣除 Nav/Footer chrome（约 7rem）→ 内容在可视区域内真正居中（修复：原 60svh 偏上）。 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${PAGE_SHELL} flex min-h-[calc(100svh-7rem)] flex-col items-center justify-center gap-6 text-center`}
    >
      {children}
    </div>
  );
}

/** 404 页面（仿官方：大图 + 站内搜索框 + 链接行）——路由 path="*" 与 errorElement 404 共用
 * 使用可复用 NotFoundSceneLayout（全屏动态背景 + 单栏居中内容），children 传入说明/搜索/链接 */
export function NotFoundPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  return (
    <NotFoundSceneLayout>
      {/* 标题 + 描述 */}
      <div>
        <h1 className="text-xl font-semibold">{t("error.404.heading")}</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("error.404.desc")}</p>
      </div>
      {/* 站内搜索（官方：Find code, projects, and people on GitHub） */}
      <form
        className="flex w-full max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("error.404.searchPlaceholder")}
            className="pl-8"
            aria-label={t("error.404.searchLabel")}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("error.404.searchButton")}
        </Button>
      </form>
      {/* 链接行（官方：Contact Support — GitHub Status — @githubstatus） */}
      <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary hover:underline">
          {t("error.404.backHome")}
        </Link>
        <span aria-hidden>·</span>
        <a
          href="https://support.github.com?tags=puregit-404"
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary hover:underline"
        >
          GitHub Support
        </a>
      </p>
    </NotFoundSceneLayout>
  );
}

/** 限流页（未登录：登录引导 + 聚光灯；已登录：稍后重试提示，footer 额度实时显示恢复） */
export function RateLimitPage({ err }: { err?: ApiError }) {
  const { t } = useI18n();
  const isAuthed = Boolean(getPrefsToken());
  const hint = err?.parsed?.message;

  // 未登录 → 聚光灯引导右上角登录按钮（与 LoginPrompt 同机制）
  useEffect(() => {
    if (isAuthed) return;
    const timer = setTimeout(() => triggerLoginSpotlight(), 350);
    return () => clearTimeout(timer);
  }, [isAuthed]);

  return (
    <Shell>
      <div className="flex size-16 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="size-8 text-amber-600 dark:text-amber-400" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">{t("error.rateLimit.title")}</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {t("error.rateLimit.desc")}
          {!isAuthed && ` ${t("error.rateLimit.loginDesc")}`}
        </p>
        {typeof hint === "string" && hint && (
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground/70">{hint}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!isAuthed ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Search className="size-4" />
            {t("login.prompt.toTopRight")}
          </p>
        ) : (
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw className="size-3.5" />
            {t("error.rateLimit.retry")}
          </Button>
        )}
      </div>
    </Shell>
  );
}

/** 通用错误页（status 徽标 + 友好文案 + 可展开原始 JSON） */
export function ErrorPage({ err }: { err?: ApiError }) {
  const { t } = useI18n();
  const e = err ?? new ApiError(0, "");
  const hasRaw = Boolean(e.rawBody);

  return (
    <Shell>
      <div className="flex size-16 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
        <SearchX className="size-8 text-destructive" />
      </div>
      <div>
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-xl font-semibold">{t("error.page.title")}</h1>
          {e.status > 0 && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
              {e.status}
            </span>
          )}
        </div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {t("error.page.desc")}
        </p>
        {e.message && e.message !== `GitHub API ${e.status}` && (
          <p className="mx-auto mt-2 max-w-md wrap-break-word text-xs text-muted-foreground/70">
            {e.message}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="size-3.5" />
          {t("error.page.retry")}
        </Button>
        <Link to="/">
          <Button variant="ghost" size="sm">
            {t("error.404.backHome")}
          </Button>
        </Link>
      </div>
      {/* 可展开原始 JSON（GitHub 错误响应体；无原始体时隐藏） */}
      {hasRaw && (
        <details className="w-full max-w-md rounded-lg border bg-muted/40 text-left">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("error.page.showRaw")}
            <ChevronDown className="size-3.5" />
          </summary>
          <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {e.rawBody}
          </pre>
        </details>
      )}
    </Shell>
  );
}

/**
 * 错误内容分发（供 App.tsx RouteErrorPage 调用：已归一化 err 按类型渲染）。
 * 注意：本组件只渲染错误内容，**不含 Nav/Footer**——chrome 由 App.tsx 的 RouteErrorPage 提供。
 */
export function AppErrorPage({ err }: { err: ApiError }) {
  if (err.isNotFound()) return <NotFoundPage />;
  if (err.isRateLimit) return <RateLimitPage err={err} />;
  return <ErrorPage err={err} />;
}

/**
 * 渲染期抛错组件（JSX 内联用）：整页级致命错误冒泡至路由 errorElement 全局错误页。
 * 用法：`{error ? <ThrowError err={error} /> : <正常内容/>}`
 */
export function ThrowError({ err }: { err: unknown }): React.ReactNode {
  throw normalizeApiError(err);
}

/** 站标（Shell 顶部可选；登录墙风格统一用 Logo） */
export function ErrorLogo() {
  return <Logo className="size-12 text-muted-foreground" />;
}
