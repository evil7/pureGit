/**
 * Watch / Star / Fork 操作按钮（仓库页 About 侧栏 / Code 页，官方三按钮结构）
 *
 * - 未登录：点击弹出登录引导（Dialog 内「使用 GitHub 登录」）
 * - 已登录：watch/unwatch/ignore（REST PUT /subscription）+ star/unstar 即时切换
 *   （GraphQL mutation 首选 + REST 降级），fork 调用 REST POST /forks 后跳转到新仓库
 * - 数字显示官方简写（123.4k），由 formatCount 统一格式化
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Star, GitFork, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { LoginPrompt } from "@/components/LoginPrompt";
import {
  isStarredSmart,
  setStarredSmart,
  forkRepositorySmart,
  fetchRepoSubscriptionSmart,
  setRepoSubscriptionSmart,
} from "@/lib/api";
import { type RepoSubscription } from "@/lib/rest";
import { useRepoData } from "@/lib/repo-context";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { useI18n } from "@/i18n";

export function StarForkButtons({
  stars,
  forks,
  subscribers,
  onUpdated,
}: {
  stars: number;
  forks: number;
  /** watch 订阅人数（subscribers_count） */
  subscribers?: number;
  /** star 数变化后的回调（更新 About 侧栏显示） */
  onUpdated?: (stars: number, forks: number) => void;
}) {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  // 仓库查询（GraphQL REPOSITORY_QUERY）已带出 viewer 状态 → 直接使用，不再发 REST
  const repoData = useRepoData();
  const viewerHasStarred = repoData?.viewer_has_starred;
  const viewerSub = repoData?.viewer_subscription;

  const [starred, setStarred] = useState<boolean | null>(null);
  const [sub, setSub] = useState<RepoSubscription | null>(null);
  const [busy, setBusy] = useState<
    "star" | "unstar" | "fork" | "watch" | "unwatch" | "ignore" | null
  >(null);
  const [forkedUrl, setForkedUrl] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // 登录后检测 star + watch 状态（context 有 viewer 字段则直接用，省 2 个 REST 请求）
  useEffect(() => {
    if (!token) {
      setStarred(null);
      setSub(null);
      return;
    }
    let cancelled = false;
    if (viewerHasStarred !== undefined) {
      setStarred(viewerHasStarred);
    } else {
      // context 无 viewer 字段（REST 降级路径）→ 保持原 REST 判定
      isStarredSmart(token, owner, repo)
        .then((s) => !cancelled && setStarred(s))
        .catch(() => !cancelled && setStarred(false));
    }
    if (viewerSub) {
      setSub({
        subscribed: viewerSub === "SUBSCRIBED",
        ignored: viewerSub === "IGNORED",
      });
    } else {
      fetchRepoSubscriptionSmart(owner, repo, token)
        .then((s) => !cancelled && setSub(s))
        .catch(() => !cancelled && setSub({ subscribed: false, ignored: false }));
    }
    return () => {
      cancelled = true;
    };
  }, [token, owner, repo, viewerHasStarred, viewerSub]);

  const setWatch = async (action: "watch" | "unwatch" | "ignore") => {
    if (!token) {
      setShowLogin(true);
      return;
    }
    setBusy(action);
    try {
      const body = action === "ignore" ? { ignored: true } : { subscribed: action === "watch" };
      const s = await setRepoSubscriptionSmart(owner, repo, token, body);
      setSub(s);
    } catch {
      /* 静默失败，保持原状态 */
    } finally {
      setBusy(null);
    }
  };

  const toggleStar = async () => {
    if (!token) {
      setShowLogin(true);
      return;
    }
    const target = !starred;
    setBusy(target ? "star" : "unstar");
    try {
      const newCount = await setStarredSmart(token, owner, repo, target);
      setStarred(target);
      if (newCount !== null) onUpdated?.(newCount, forks);
      else onUpdated?.(target ? stars + 1 : Math.max(stars - 1, 0), forks);
    } catch {
      /* 静默失败，保持原状态 */
    } finally {
      setBusy(null);
    }
  };

  const doFork = async () => {
    if (!token) {
      setShowLogin(true);
      return;
    }
    setBusy("fork");
    try {
      const fullName = await forkRepositorySmart(token, owner, repo);
      setForkedUrl(fullName);
      onUpdated?.(stars, forks + 1);
    } catch {
      /* 静默失败 */
    } finally {
      setBusy(null);
    }
  };

  // Watch 按钮文案（官方：Watch / Watching / Ignoring）
  const watchLabel = sub?.ignored ? "Ignoring" : sub?.subscribed ? "Watching" : "Watch";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Watch（dropdown：Unwatch / Watch / Ignore；Watching/Ignoring 图标变蓝） */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy !== null}>
            {busy === "watch" || busy === "unwatch" || busy === "ignore" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Eye className={cn("size-4", (sub?.subscribed || sub?.ignored) && "text-blue-500")} />
            )}
            {watchLabel}
            <span className="text-muted-foreground">{formatCount(subscribers ?? 0)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem
            onClick={() => void setWatch("unwatch")}
            disabled={busy !== null}
            className={!sub?.subscribed && !sub?.ignored ? "bg-accent" : undefined}
          >
            Unwatch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void setWatch("watch")}
            disabled={busy !== null}
            className={sub?.subscribed ? "bg-accent" : undefined}
          >
            Watch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void setWatch("ignore")}
            disabled={busy !== null}
            className={sub?.ignored ? "bg-accent" : undefined}
          >
            Ignore
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Fork（无状态态，保持 outline） */}
      <Button size="sm" variant="outline" onClick={() => void doFork()} disabled={busy !== null}>
        {busy === "fork" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GitFork className="size-4" />
        )}
        Fork
        <span className="text-muted-foreground">{formatCount(forks)}</span>
      </Button>

      {/* Star（已 star：星形图标变黄填充，按钮保持 outline） */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void toggleStar()}
        disabled={busy !== null}
      >
        {busy === "star" || busy === "unstar" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Star
            className={cn("size-4", starred && "fill-amber-400 text-amber-400")}
            fill={starred ? "currentColor" : "none"}
          />
        )}
        {starred ? "Starred" : "Star"}
        <span className="text-muted-foreground">{formatCount(stars)}</span>
      </Button>

      {/* 登录引导（统一模板：只提醒不做按钮；关闭后聚光灯指引右上角登录） */}
      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-center">{t("login.requiredTitle")}</DialogTitle>
          </DialogHeader>
          <LoginPrompt title={t("login.requiredTitle")} desc={t("login.starForkDesc")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogin(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* fork 成功提示 */}
      <Dialog open={!!forkedUrl} onOpenChange={(v) => !v && setForkedUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fork 成功</DialogTitle>
            <DialogDescription>已创建 {forkedUrl}。是否立即前往查看？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForkedUrl(null)}>
              关闭
            </Button>
            <Button
              onClick={() => {
                if (forkedUrl) navigate(`/${forkedUrl}`);
                setForkedUrl(null);
              }}
            >
              前往查看
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
