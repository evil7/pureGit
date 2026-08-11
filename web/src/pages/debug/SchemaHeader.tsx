/**
 * 协议标题栏（共享组件：GqlTree / RestTree 左栏集合树头部）
 *
 * 第一行 = TreeSearchInput（搜索框）；**第二行** = 本组件：协议名 + 版本徽章
 * （hover 显示数据源描述，如 `openapi.json by @octokit/openapi@22.0.0`）+ 刷新按钮。
 *
 * 刷新进度条也在此组件：RestTree 订阅 onPreloadProgress（后台预热 / 手动刷新共用），
 * 刷新进行中标题行下显示进度条 + 状态文字（N/M + label）——替代左栏底部全局进度条，
 * 进度感知归位到数据源所在组件。
 */
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** 刷新/预热进度（onPreloadProgress 事件透传） */
export interface SchemaProgress {
  done: number;
  total: number;
  /** 当前处理的 tag / 任务名 */
  label: string;
}

interface SchemaHeaderProps {
  /** 协议名（如 "Schema" / "GitHub OpenAPI"） */
  title: string;
  /** 协议图标（GraphQLLogo / GlobeIcon；可选） */
  icon?: ReactNode;
  /** 版本徽章文本（REST: "22.0.0"；GraphQL 无版本 → 省略） */
  version?: string;
  /** 版本 hover 描述（数据源说明，如 "openapi.json by @octokit/openapi@22.0.0"） */
  versionDesc?: string;
  /** 搜索命中计数徽章（搜索模式显示；null 隐藏） */
  countBadge?: string;
  /** 刷新进行中（按钮 spin + 状态文字） */
  loading?: boolean;
  onRefresh?: () => void;
  /** 刷新按钮 title（调用方传 t 结果） */
  refreshTitle: string;
  /** 刷新/预热进度（null = 无进度）——进行中显示进度条 + 状态 */
  progress?: SchemaProgress | null;
  /** 状态文字（loading 无进度时显示，如「正在加载 Schema…」） */
  loadingText?: string;
}

export function SchemaHeader({
  title,
  icon,
  version,
  versionDesc,
  countBadge,
  loading,
  onRefresh,
  refreshTitle,
  progress,
  loadingText,
}: SchemaHeaderProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 pb-1 pt-1.5">
      <div className="flex items-center gap-1">
        {icon}
        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {version && (
          <span
            title={versionDesc}
            className="rounded bg-muted px-1 py-px font-mono text-[9px] text-muted-foreground"
          >
            {version}
          </span>
        )}
        {countBadge && (
          <span className="rounded bg-primary/10 px-1 py-px text-[9px] text-primary">
            {countBadge}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onRefresh}
            disabled={loading}
            title={refreshTitle}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        )}
      </div>
      {/* 刷新进度：进行中显示进度条 + 状态（替代左栏底部全局进度条） */}
      {progress && (
        <div className="flex items-center gap-1.5">
          <Progress
            value={(progress.done / Math.max(1, progress.total)) * 100}
            className="h-1 flex-1"
          />
          <span className="shrink-0 max-w-28 truncate text-[10px] text-muted-foreground">
            {progress.label}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {progress.done}/{progress.total}
          </span>
        </div>
      )}
      {/* 无进度 loading：状态文字（GqlTree 单请求加载） */}
      {!progress && loading && loadingText && (
        <p className="truncate text-[10px] text-muted-foreground">{loadingText}</p>
      )}
    </div>
  );
}
