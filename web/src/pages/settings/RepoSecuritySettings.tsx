/**
 * 仓库安全分析设置（github.com/:owner/:repo/settings/security 的 Code security and analysis 子页）
 *
 * 官方语义：安全分析各功能的启用开关（GitHub Advanced Security / Code security /
 * Secret scanning / Push protection / AI detection / Non-provider patterns）。
 * 数据与写操作均走 PATCH /repos/{owner}/{repo} 的 security_and_analysis 字段
 * （status: enabled/disabled；无 GraphQL mutation 适配 → REST 唯一通道）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import {
  fetchRepository,
  apiErrorMessage,
  type SecurityAnalysis,
  type SecurityToggleKind,
  type SecurityToggles,
} from "@/lib/restapi";
import {
  updateRepositorySmart,
  fetchSecurityTogglesSmart,
  setSecurityToggleSmart,
} from "@/lib/api";
import { toastSuccess } from "@/lib/ui/toast";

/** 安全分析功能项定义（key = security_and_analysis 字段；title/desc 为 i18n key） */
const FEATURES: { key: keyof SecurityAnalysis; title: I18nKey; desc: I18nKey }[] = [
  {
    key: "advanced_security",
    title: "repoSecurity.advancedSecurity",
    desc: "repoSecurity.advancedSecurity.desc",
  },
  {
    key: "code_security",
    title: "repoSecurity.codeSecurity",
    desc: "repoSecurity.codeSecurity.desc",
  },
  {
    key: "secret_scanning",
    title: "repoSecurity.secretScanning",
    desc: "repoSecurity.secretScanning.desc",
  },
  {
    key: "secret_scanning_push_protection",
    title: "repoSecurity.pushProtection",
    desc: "repoSecurity.pushProtection.desc",
  },
  {
    key: "secret_scanning_ai_detection",
    title: "repoSecurity.aiDetection",
    desc: "repoSecurity.aiDetection.desc",
  },
  {
    key: "secret_scanning_non_provider_patterns",
    title: "repoSecurity.nonProviderPatterns",
    desc: "repoSecurity.nonProviderPatterns.desc",
  },
];

/** Dependabot 区块开关定义（key = 独立三件套开关；title/desc 为 i18n key） */
const DEPENDABOT_FEATURES: { key: SecurityToggleKind; title: I18nKey; desc: I18nKey }[] = [
  {
    key: "vulnerabilityAlerts",
    title: "repoSecurity.dependabotAlerts",
    desc: "repoSecurity.dependabotAlerts.desc",
  },
  {
    key: "automatedSecurityFixes",
    title: "repoSecurity.dependabotUpdates",
    desc: "repoSecurity.dependabotUpdates.desc",
  },
  {
    key: "privateVulnerabilityReporting",
    title: "repoSecurity.privateVulnerability",
    desc: "repoSecurity.privateVulnerability.desc",
  },
];

export default function RepoSecuritySettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [analysis, setAnalysis] = useState<SecurityAnalysis | null>(null);
  const [toggles, setToggles] = useState<SecurityToggles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<keyof SecurityAnalysis | null>(null);
  const [busyToggle, setBusyToggle] = useState<SecurityToggleKind | null>(null);

  useEffect(() => {
    if (!token || !owner) return;
    let cancelled = false;
    fetchRepository(owner, repo, token)
      .then((r) => !cancelled && setAnalysis(r.security_and_analysis ?? {}))
      .catch(() => !cancelled && setError(t("repoSecurity.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [token, owner, repo, t]);

  // Dependabot 三态开关独立加载（check 端点 204/404 语义）
  useEffect(() => {
    if (!token || !owner) return;
    let cancelled = false;
    fetchSecurityTogglesSmart(owner, repo, token)
      .then((res) => !cancelled && setToggles(res))
      .catch(() => !cancelled && setError(t("repoSecurity.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [token, owner, repo, t]);

  const toggle = async (key: keyof SecurityAnalysis) => {
    if (busyKey || !analysis) return;
    const enabled = analysis[key]?.status === "enabled";
    const next = enabled ? "disabled" : "enabled";
    setBusyKey(key);
    setError(null);
    // 乐观更新
    setAnalysis((a) => (a ? { ...a, [key]: { status: next } } : a));
    try {
      await updateRepositorySmart(owner, repo, token!, {
        security_and_analysis: { [key]: { status: next } },
      });
      toastSuccess(t("repoSecurity.updated"));
    } catch (e) {
      // 失败回滚
      setAnalysis((a) => (a ? { ...a, [key]: { status: enabled ? "enabled" : "disabled" } } : a));
      setError(apiErrorMessage(e, t("repoSecurity.updateFailed")));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleDependabot = async (key: SecurityToggleKind) => {
    if (!toggles || busyToggle) return;
    const enabled = toggles[key];
    const next = !enabled;
    setBusyToggle(key);
    setError(null);
    // 乐观更新
    setToggles((prev) => (prev ? { ...prev, [key]: next } : prev));
    try {
      await setSecurityToggleSmart(owner, repo, key, next, token!);
      toastSuccess(t("repoSecurity.updated"));
    } catch (e) {
      // 失败回滚
      setToggles((prev) => (prev ? { ...prev, [key]: enabled } : prev));
      setError(apiErrorMessage(e, t("repoSecurity.updateFailed")));
    } finally {
      setBusyToggle(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("repoSecurity.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("repoSecurity.desc")}</p>
      </div>

      {error && <InlineError message={error} />}

      {analysis === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          {FEATURES.map((f) => (
            <div
              key={f.key}
              className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(f.title)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t(f.desc)}</p>
              </div>
              <Switch
                checked={analysis[f.key]?.status === "enabled"}
                onCheckedChange={() => void toggle(f.key)}
                disabled={busyKey === f.key || !token}
              />
            </div>
          ))}
        </div>
      )}

      {/* Dependabot 区块（三个独立开关） */}
      <h3 className="text-sm font-semibold">{t("repoSecurity.dependabot")}</h3>
      {toggles === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          {DEPENDABOT_FEATURES.map((f) => (
            <div
              key={f.key}
              className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(f.title)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t(f.desc)}</p>
              </div>
              <Switch
                checked={toggles[f.key]}
                onCheckedChange={() => void toggleDependabot(f.key)}
                disabled={busyToggle === f.key || !token}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
