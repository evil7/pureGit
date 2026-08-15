/**
 * 全局页脚（AppFooter）
 *
 * 显示（低调、小字、底部常驻，左右分栏）：
 * - 左侧：项目仓库链接（GitHub 官方 mark 图标 + PureGit，a 标签涵盖 star 计数）
 * - 右侧：GitHub API 状态点 + 双额度（GraphQL 与 REST core 各自独立计数，官方文档确认）
 *   - 状态点：绿=可用 / 红=不可达或限流
 *   - 额度：GraphQL 闪电（Zap）+ REST 插头（Plug）+ 简写数字，hover 显示完整 remaining/limit
 *
 * 布局：mt-8 border-t 分隔 + max-w-7xl 同宽；flex justify-between 左右分栏，窄屏换行。
 * 置于 <main> 之后随页面滚动，不参与 sticky 吸附。
 */
import { useEffect, useState } from "react";
import { Star, Plug, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { Tip } from "@/components/Tip";
import { fetchRateLimit, type RepoStats } from "@/lib/restapi";
import { fetchPublicRepoStatsSmart } from "@/lib/api";
import {
  getApiUsage,
  hasApiUsageData,
  setApiUsage,
  subscribeUsageChange,
  type ApiUsage,
} from "@/lib/api/octokit";
import { getChannel, subscribeChannel, type ChannelKind } from "@/lib/net/channel-status";

/** 本项目 GitHub 仓库（owner/name + URL；如地址变更在此修改） */
const PROJECT_REPO = { owner: "evil7", name: "puregit" } as const;
const PROJECT_REPO_URL = `https://github.com/${PROJECT_REPO.owner}/${PROJECT_REPO.name}`;

type ApiStatus = "loading" | "ok" | "error";

export default function AppFooter() {
  const { token, loading } = useAuth();
  const { t } = useI18n();
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [status, setStatus] = useState<ApiStatus>("loading");
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [channel, setChannel] = useState<ChannelKind | null>(null);

  // 通道状态灯：订阅最近命中通道（channel-status 全局单例），页面任意请求命中即刷新
  useEffect(() => {
    const apply = () => setChannel(getChannel());
    const unsub = subscribeChannel(apply);
    apply(); // 初始同步：挂载前可能已有请求命中
    return unsub;
  }, []);

  // API 状态 + 双额度（REST core / GraphQL）：订阅统一 limit 缓存（octokit.ts 每次响应头实时更新），
  // 页面任意接口活动都会即时刷新 footer，无需独立轮询 /rate_limit。
  useEffect(() => {
    const apply = () => {
      const u = getApiUsage();
      if (u.rest.limit > 0 || u.graphql.limit > 0) {
        setUsage(u);
        setStatus("ok");
      }
    };
    const unsub = subscribeUsageChange(apply);
    apply(); // 初始同步：挂载前可能已有请求（如本项目 stats）写入过缓存
    return unsub;
  }, []);

  // 兜底：全站尚无任何请求记录（缓存为空）时，发一次 /rate_limit 回填统一缓存。
  // 等 auth loading 结束再请求（AppFooter 在 Suspense 外首帧即挂载，token 尚未恢复 null，
  // 直接请求会先发匿名再发认证双请求）；回填经 setApiUsage → emit → 订阅 apply 置 ok。
  useEffect(() => {
    if (loading) return;
    if (hasApiUsageData()) return;
    let cancelled = false;
    fetchRateLimit(token)
      .then((d) => {
        if (cancelled) return;
        setApiUsage(
          {
            limit: d.resources.core.limit,
            remaining: d.resources.core.remaining,
            used: (d.resources.core as { used?: number }).used ?? 0,
            reset: d.resources.core.reset,
          },
          {
            limit: d.resources.graphql?.limit ?? 0,
            remaining: d.resources.graphql?.remaining ?? 0,
            used: (d.resources.graphql as { used?: number } | undefined)?.used ?? 0,
            reset: d.resources.graphql?.reset ?? 0,
          },
        );
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => (s === "ok" ? s : "error"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, loading]);

  // 本项目 star/fork 数（匿名公开统计；仓库不存在/私有则静默隐藏）
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    fetchPublicRepoStatsSmart(PROJECT_REPO.owner, PROJECT_REPO.name, token)
      .then((s) => !cancelled && setStats(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, loading]);

  return (
    <footer className="mt-8 border-t bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-muted-foreground">
        {/* 左侧：项目仓库（GitHub 图标 + PureGit，a 涵盖 star 计数） */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href={PROJECT_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:underline"
          >
            {/* GitHub 官方 mark（Octocat） */}
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {t("footer.repo")}
            {stats && (
              <span className="flex items-center gap-1">
                <Star className="size-3.5" />
                {formatCount(stats.stargazers_count)}
              </span>
            )}
          </a>
        </div>

        {/* 右侧：通道状态灯 + 双额度（REST core / GraphQL 独立计数）。
            状态灯展示最近一次请求实际命中的服务通道（替代原「GitHub API」单一指示灯）；
            组内紧凑（gap-x-4），与左侧分栏保持 gap-x-6，形成整体分组视觉 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                status === "error"
                  ? "bg-destructive"
                  : channel
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/50",
              )}
            />
            {status === "error"
              ? t("footer.apiError")
              : channel
                ? t(`footer.channel.${channel}`)
                : t("footer.apiStatus")}
          </span>
          {usage && status === "ok" && (
            <>
              {usage.graphql.limit > 0 && (
                <Tip label={`GraphQL ${usage.graphql.remaining}/${usage.graphql.limit}`}>
                  <span className="flex items-center gap-1">
                    <Zap className="size-3.5" />
                    {formatCount(usage.graphql.remaining)}
                  </span>
                </Tip>
              )}
              <Tip label={`REST ${usage.rest.remaining}/${usage.rest.limit}`}>
                <span className="flex items-center gap-1">
                  <Plug className="size-3.5" />
                  {formatCount(usage.rest.remaining)}
                </span>
              </Tip>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
