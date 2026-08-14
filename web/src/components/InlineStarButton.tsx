/**
 * 列表内 Star 按钮
 *
 * 官方 feed / 搜索 / trending 列表的「Star/Starred 双态」行内按钮：
 * - Star/Starred 切换（GraphQL mutation 首选 + REST 降级，setStarredSmart）
 * - 计数即时更新（新计数由 mutation 返回，否则本地 ±1）
 * - 未登录点击弹登录引导（LoginPrompt 统一模板）
 * - 受控初始态：仓库元数据就绪后经 initialStarred / initialCount 注入
 */
import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoginPrompt } from "@/components/LoginPrompt";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { setStarredSmart } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";

export function InlineStarButton({
  fullName,
  initialStarred,
  initialCount,
}: {
  fullName: string;
  /** 仓库元数据就绪后的初始 star 态（undefined 表示未就绪，保持默认） */
  initialStarred?: boolean;
  /** 仓库元数据就绪后的初始 star 数 */
  initialCount?: number;
}) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [starred, setStarred] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // 仓库元数据就绪（undefined → 有值）时同步初始态
  useEffect(() => {
    if (initialStarred !== undefined) setStarred(initialStarred);
    if (initialCount !== undefined) setCount(initialCount);
  }, [initialStarred, initialCount]);

  const toggle = async () => {
    if (!token) {
      setShowLogin(true);
      return;
    }
    const target = !starred;
    setBusy(true);
    try {
      const [owner, repo] = fullName.split("/");
      const newCount = await setStarredSmart(token, owner, repo, target);
      setStarred(target);
      if (newCount !== null) setCount(newCount);
      else setCount((c) => Math.max(c + (target ? 1 : -1), 0));
    } catch {
      /* 静默失败，保持原状态 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" className="gap-1 px-2" onClick={() => void toggle()} disabled={busy}>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Star
            className={cn("size-3.5", starred && "fill-amber-400 text-amber-400")}
            fill={starred ? "currentColor" : "none"}
          />
        )}
        {/* 用户要求：标签只要 icon，去掉 Star/Starred 文字 */}
        <span className="text-muted-foreground">{formatCount(count)}</span>
      </Button>

      {/* 登录引导（未登录点击） */}
      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-center">{t("login.requiredTitle")}</DialogTitle>
          </DialogHeader>
          <LoginPrompt title={t("login.requiredTitle")} desc={t("login.starDesc")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogin(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
