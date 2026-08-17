/**
 * 仓库 Moderation 设置页（官方 github.com/:owner/:repo/settings/interaction_limits）
 *
 * 官方结构：H1「Interaction limits」→ H2「Temporary interaction restrictions」三档限制
 * （Limit to existing users / prior contributors / repository collaborators，各带 Enable/Remove）
 * → H2「Pull request limits」（2025 新功能，无公开 REST API → 预留外链官方）。
 * 数据与写操作走 interactions 系列端点（REST-only，GraphQL 无仓库级 mutation）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastSuccess } from "@/lib/ui/toast";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  fetchInteractionLimits,
  setInteractionLimits,
  removeInteractionLimits,
  apiErrorMessage,
} from "@/lib/restapi";
import type { InteractionLimit, InteractionLimitValue, InteractionExpiry } from "@/lib/restapi";

/** 三档限制级别定义（key = API limit 值；title/desc 为 i18n key） */
const LEVELS: { value: InteractionLimitValue; title: I18nKey; desc: I18nKey }[] = [
  {
    value: "existing_users",
    title: "repoModeration.existingUsers",
    desc: "repoModeration.existingUsers.desc",
  },
  {
    value: "contributors_only",
    title: "repoModeration.contributorsOnly",
    desc: "repoModeration.contributorsOnly.desc",
  },
  {
    value: "collaborators_only",
    title: "repoModeration.collaboratorsOnly",
    desc: "repoModeration.collaboratorsOnly.desc",
  },
];

/** 过期时长选项（expiry = 官方枚举；null = 永不过期） */
const EXPIRY_OPTIONS: { value: string; label: I18nKey; expiry: InteractionExpiry | null }[] = [
  { value: "noExpiry", label: "repoModeration.noExpiry", expiry: null },
  { value: "1day", label: "repoModeration.expiry1day", expiry: "one_day" },
  { value: "3days", label: "repoModeration.expiry3days", expiry: "three_days" },
  { value: "1week", label: "repoModeration.expiry1week", expiry: "one_week" },
  { value: "1month", label: "repoModeration.expiry1month", expiry: "one_month" },
  { value: "6months", label: "repoModeration.expiry6months", expiry: "six_months" },
];

export default function RepoModerationSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  // undefined = 加载中；null = 无限制
  const [current, setCurrent] = useState<InteractionLimit | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // 启用弹窗（记录目标级别 + 时长）
  const [enabling, setEnabling] = useState<InteractionLimitValue | null>(null);
  const [expiry, setExpiry] = useState("noExpiry");
  const [busy, setBusy] = useState(false);
  // 移除确认
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!token || !owner) return;
    let cancelled = false;
    fetchInteractionLimits(owner, repo, token)
      .then((r) => !cancelled && setCurrent(r))
      .catch(() => !cancelled && setError(t("repoModeration.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [token, owner, repo, t]);

  const confirmEnable = async () => {
    if (!token || !enabling || busy) return;
    setBusy(true);
    setError(null);
    try {
      const opt = EXPIRY_OPTIONS.find((o) => o.value === expiry);
      await setInteractionLimits(owner, repo, enabling, opt?.expiry ?? undefined, token);
      setCurrent(await fetchInteractionLimits(owner, repo, token));
      toastSuccess(t("repoModeration.enabled"));
      setEnabling(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoModeration.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeInteractionLimits(owner, repo, token);
      setCurrent(null);
      toastSuccess(t("repoModeration.removed"));
      setRemoving(false);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoModeration.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("repoModeration.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("repoModeration.desc")}</p>
      </div>

      {error && <InlineError message={error} />}

      {current === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {LEVELS.map((lvl) => {
            const active = current?.limit === lvl.value;
            return (
              <li key={lvl.value} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(lvl.title)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t(lvl.desc)}</p>
                  {active && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {current.expires_at
                        ? `${t("repoModeration.expiresAt")} ${fmt(current.expires_at)}`
                        : t("repoModeration.noExpiry")}
                    </p>
                  )}
                </div>
                {active ? (
                  <Button
                    variant="outline"
                    className="shrink-0 text-destructive"
                    onClick={() => setRemoving(true)}
                    disabled={busy}
                  >
                    {t("repoModeration.removeLimit")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      setExpiry("noExpiry");
                      setEnabling(lvl.value);
                    }}
                    disabled={busy}
                  >
                    {t("repoModeration.enable")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Pull request limits：无公开 REST API → 预留外链官方 */}
      <div>
        <h3 className="text-base font-semibold">{t("repoModeration.prLimits")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("repoModeration.prLimits.desc")}</p>
        <a
          href={`https://github.com/${owner}/${repo}/settings/interaction_limits`}
          target="_blank"
          rel="noreferrer"
          title={t("actions.mgmt.officialOnlyTitle")}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          {t("repoModeration.prLimits.manage")}
          <span className="text-[10px] text-muted-foreground/70">
            {t("actions.mgmt.officialOnly")}
          </span>
        </a>
      </div>

      {/* 启用弹窗（选择时长） */}
      <Dialog open={enabling !== null} onOpenChange={(v) => !v && setEnabling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("repoModeration.enableTitle")}</DialogTitle>
            <DialogDescription>{t("repoModeration.enableDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnabling(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void confirmEnable()} disabled={busy}>
              {busy ? t("common.submitting") : t("repoModeration.enable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移除确认 */}
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repoModeration.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("repoModeration.removeDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRemove()}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? t("common.loading") : t("repoModeration.removeLimit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
