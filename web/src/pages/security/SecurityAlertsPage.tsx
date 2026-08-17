/**
 * 仓库安全告警页（官方 /security/dependabot / code-scanning / secret-scanning）
 *
 * 三个 tab 共用 AlertsList（按 kind 差异数据源 + 归一化渲染）：
 * - 列表（默认 open，可切 Closed 过滤）
 * - severity 徽标 + state 徽标 + 标题 + 元信息 + 时间
 * - dismiss（选 reason/resolution 的 AlertDialog）+ reopen（open 状态）
 * - 点击行 → 官方告警详情（外链 html_url）
 * 整体 REST-only（GraphQL 无 alerts 适配，见 api-code-security.ts）。
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { Badge } from "@/components/ui/badge";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SecurityNav } from "@/components/SecurityNav";
import { toastSuccess } from "@/lib/ui/toast";
import { apiErrorMessage, normalizeApiError } from "@/lib/restapi";
import {
  fetchDependabotAlertsSmart,
  updateDependabotAlertSmart,
  fetchCodeScanningAlertsSmart,
  updateCodeScanningAlertSmart,
  fetchSecretScanningAlertsSmart,
  updateSecretScanningAlertSmart,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type AlertKind = "dependabot" | "code-scanning" | "secret-scanning";

/** 归一化行（三类 alert 统一渲染） */
interface AlertRow {
  number: number;
  state: string;
  severity: string | null;
  title: string;
  meta: string | null;
  html_url: string;
  created_at: string;
}

const KIND_META: Record<AlertKind, { nav: "dependabot" | "code-scanning" | "secret-scanning" }> = {
  dependabot: { nav: "dependabot" },
  "code-scanning": { nav: "code-scanning" },
  "secret-scanning": { nav: "secret-scanning" },
};

/** severity → 徽标配色 */
function severityClass(sev: string | null): string {
  switch (sev) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-red-500 text-white";
    case "medium":
      return "bg-amber-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** state → 徽标配色（open/resolved 绿，其余灰） */
function stateClass(state: string): string {
  return state === "open" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground";
}

/** 加载 + 归一化（按 kind） */
async function loadRows(
  kind: AlertKind,
  owner: string,
  repo: string,
  token: string | null,
  stateFilter: "open" | "closed",
): Promise<AlertRow[]> {
  const state = stateFilter === "open" ? "open" : undefined;
  if (kind === "dependabot") {
    const list = await fetchDependabotAlertsSmart(owner, repo, token, state);
    return list.map((a) => ({
      number: a.number,
      state: a.state,
      severity: a.severity,
      title: a.summary || a.ghsa_id,
      meta: a.package_name
        ? `${a.package_name}${a.vulnerable_version_range ? ` · ${a.vulnerable_version_range}` : ""}`
        : null,
      html_url: a.html_url,
      created_at: a.created_at,
    }));
  }
  if (kind === "code-scanning") {
    const list = await fetchCodeScanningAlertsSmart(owner, repo, token, state);
    return list.map((a) => ({
      number: a.number,
      state: a.state,
      severity: a.severity === "error" || a.severity === "warning" ? "high" : a.severity,
      title: a.description || `Alert #${a.number}`,
      meta: a.tool ? `${a.tool}${a.message ? ` · ${a.message}` : ""}` : a.message,
      html_url: a.html_url,
      created_at: a.created_at,
    }));
  }
  const list = await fetchSecretScanningAlertsSmart(owner, repo, token, state);
  return list.map((a) => ({
    number: a.number,
    state: a.state,
    severity: null,
    title: a.secret_type_display_name || a.secret_type,
    meta: a.secret_type_display_name ? a.secret_type : a.secret_type,
    html_url: a.html_url,
    created_at: a.created_at,
  }));
}

function AlertsList({ kind }: { kind: AlertKind }) {
  const { owner = "", repo = "" } = useParams();
  const { token, canWrite: canWriteToken } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const { canWrite: canWriteRepo } = useRepoPermission();
  // 写操作门控：令牌级写 scope 且 仓库级写权限
  const canWrite = canWriteToken && canWriteRepo;
  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 列表加载错误分类：forbidden=权限不足 / notFound=未启用 / generic=其他
  const [errorKind, setErrorKind] = useState<"forbidden" | "notFound" | "generic" | null>(null);
  // dismiss 弹窗
  const [dismissing, setDismissing] = useState<AlertRow | null>(null);
  const [reason, setReason] = useState("tolerable_risk");
  const [busy, setBusy] = useState(false);
  const [busyNumber, setBusyNumber] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    setErrorKind(null);
    loadRows(kind, owner, repo, token, stateFilter)
      .then((list) => !cancelled && setRows(list))
      .catch((e) => {
        if (cancelled) return;
        const err = normalizeApiError(e);
        if (err.isNotFound()) {
          setErrorKind("notFound");
        } else if (err.isForbidden()) {
          setErrorKind("forbidden");
        } else {
          setErrorKind("generic");
          setError(apiErrorMessage(e, t("security.alerts.loadFailed")));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, owner, repo, token, stateFilter]);

  /** dismiss 选项（dependabot/code-scanning 用 reason；secret-scanning 用 resolution） */
  const dismissOptions: { value: string; label: string }[] = useMemo(() => {
    if (kind === "secret-scanning") {
      return [
        "false_positive",
        "pattern_deleted",
        "pattern_edited",
        "revoked_secret",
        "used_in_tests",
        "won't_fix",
      ].map((v) => ({ value: v, label: t(`security.alerts.resolution.${v}` as I18nKey) }));
    }
    return ["fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"].map((v) => ({
      value: v,
      label: t(`security.alerts.reason.${v}` as I18nKey),
    }));
  }, [kind, t]);

  const confirmDismiss = async () => {
    if (!token || !dismissing) return;
    setBusy(true);
    try {
      if (kind === "dependabot") {
        await updateDependabotAlertSmart(
          owner,
          repo,
          dismissing.number,
          { state: "dismissed", dismissed_reason: reason },
          token,
        );
      } else if (kind === "code-scanning") {
        await updateCodeScanningAlertSmart(
          owner,
          repo,
          dismissing.number,
          { state: "dismissed", dismissed_reason: reason },
          token,
        );
      } else {
        await updateSecretScanningAlertSmart(
          owner,
          repo,
          dismissing.number,
          { state: "resolved", resolution: reason },
          token,
        );
      }
      toastSuccess(t("security.alerts.dismissed"));
      setDismissing(null);
      // 刷新当前列表
      loadRows(kind, owner, repo, token, stateFilter)
        .then(setRows)
        .catch(() => undefined);
    } catch (e) {
      setErrorKind("generic");
      setError(apiErrorMessage(e, t("security.alerts.dismissFailed")));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (row: AlertRow) => {
    if (!token || busyNumber !== null) return;
    setBusyNumber(row.number);
    setError(null);
    try {
      if (kind === "dependabot") {
        await updateDependabotAlertSmart(owner, repo, row.number, { state: "open" }, token);
      } else if (kind === "code-scanning") {
        await updateCodeScanningAlertSmart(owner, repo, row.number, { state: "open" }, token);
      } else {
        await updateSecretScanningAlertSmart(owner, repo, row.number, { state: "open" }, token);
      }
      toastSuccess(t("security.alerts.reopened"));
      loadRows(kind, owner, repo, token, stateFilter)
        .then(setRows)
        .catch(() => undefined);
    } catch (e) {
      setErrorKind("generic");
      setError(apiErrorMessage(e, t("security.alerts.dismissFailed")));
    } finally {
      setBusyNumber(null);
    }
  };

  const isOpen = (state: string) => state === "open";
  const nav = KIND_META[kind].nav;

  return (
    <div className="flex flex-col gap-4">
      <SecurityNav active={nav} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(`security.alerts.title.${kind}` as I18nKey)}</h1>
        {/* Open / Closed 过滤 */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-[3px] text-sm text-muted-foreground">
          {(["open", "closed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStateFilter(f)}
              className={cn(
                "rounded-md px-3 py-0.5 transition-colors",
                stateFilter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "hover:text-foreground",
              )}
            >
              {t(f === "open" ? "security.alerts.open" : "security.alerts.closed")}
            </button>
          ))}
        </div>
      </div>

      {errorKind === "forbidden" && <InlineError message={t("security.alerts.forbidden")} />}
      {errorKind === "generic" && error && <InlineError message={error} />}

      {errorKind === "notFound" ? (
        <p className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {t("security.alerts.notEnabled")}
        </p>
      ) : rows === null ? (
        <div className="flex flex-col divide-y rounded-lg border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="size-4 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {t("security.alerts.empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.number} className="flex items-center gap-3 px-4 py-3">
              <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={r.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  <span className="truncate">{r.title}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </a>
                {r.meta && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.meta}</p>
                )}
              </div>
              {r.severity && (
                <Badge className={cn("shrink-0 text-xs", severityClass(r.severity))}>
                  {r.severity}
                </Badge>
              )}
              <Badge variant="secondary" className={cn("shrink-0 text-xs", stateClass(r.state))}>
                {r.state}
              </Badge>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {fmt(r.created_at)}
              </span>
              {canWrite && isOpen(r.state) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setDismissing(r);
                    setReason(kind === "secret-scanning" ? "false_positive" : "tolerable_risk");
                  }}
                >
                  {t("security.alerts.dismiss")}
                </Button>
              )}
              {canWrite && !isOpen(r.state) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={busyNumber !== null}
                  onClick={() => void reopen(r)}
                >
                  {t("security.alerts.reopen")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* dismiss 确认 */}
      <AlertDialog open={dismissing !== null} onOpenChange={(v) => !v && setDismissing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("security.alerts.dismissTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("security.alerts.dismissDesc", { title: dismissing?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dismissOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDismiss()}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? t("common.loading") : t("security.alerts.dismiss")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function DependabotAlertsPage() {
  return <AlertsList kind="dependabot" />;
}

export function CodeScanningAlertsPage() {
  return <AlertsList kind="code-scanning" />;
}

export function SecretScanningAlertsPage() {
  return <AlertsList kind="secret-scanning" />;
}
