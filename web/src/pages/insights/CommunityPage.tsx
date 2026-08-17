/**
 * Insights Community standards 页（官方 github.com/:owner/:repo/community）
 *
 * 官方结构：Community profile 健康度 + 各社区文件（README/Code of conduct/
 * Contributing/License/Issue template/PR template）存在状态 + CODEOWNERS 错误。
 * 数据通道：REST-only（get-community-profile-metrics + codeowners-errors）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/InlineError";
import {
  fetchCommunityProfileMetrics,
  fetchCodeownersErrors,
  apiErrorMessage,
} from "@/lib/restapi";
import type { CommunityProfile, CodeownersError } from "@/lib/restapi";
import InsightsShell from "./InsightsShell";

/** 社区文件清单（key = files 子字段；labelKey = i18n 键） */
const FILE_ITEMS: { key: keyof CommunityProfile["files"]; labelKey: I18nKey }[] = [
  { key: "readme", labelKey: "insights.community.readme" },
  { key: "code_of_conduct", labelKey: "insights.community.codeOfConduct" },
  { key: "contributing", labelKey: "insights.community.contributing" },
  { key: "license", labelKey: "insights.community.license" },
  { key: "issue_template", labelKey: "insights.community.issueTemplate" },
  { key: "pull_request_template", labelKey: "insights.community.prTemplate" },
];

export default function CommunityPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [errors, setErrors] = useState<CodeownersError[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCommunityProfileMetrics(owner, repo, token)
      .then((d) => !cancelled && setProfile(d))
      .catch((e) => !cancelled && setError(apiErrorMessage(e, t("insights.loadFailed"))));
    fetchCodeownersErrors(owner, repo, token)
      .then((d) => !cancelled && setErrors(d))
      .catch(() => !cancelled && setErrors([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  return (
    <InsightsShell title={t("insights.community.title")} desc={t("insights.community.desc")}>
      {error ? (
        <InlineError message={error} />
      ) : profile === null ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* 健康度 */}
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{t("insights.community.health")}</h2>
              <span className="text-2xl font-semibold tabular-nums">
                {profile.health_percentage}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-2"
                style={{ width: `${profile.health_percentage}%` }}
              />
            </div>
            {profile.description && (
              <p className="mt-2 text-sm text-muted-foreground">{profile.description}</p>
            )}
          </section>

          {/* 社区文件状态 */}
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">{t("insights.community.files")}</h2>
            <ul className="divide-y">
              {FILE_ITEMS.map(({ key, labelKey }) => {
                const file = profile.files[key];
                const present = file && (file.url || file.html_url);
                return (
                  <li key={key} className="flex items-center gap-3 py-2">
                    {present ? (
                      <CheckCircle2 className="size-4 shrink-0 text-chart-2" />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className="flex-1 text-sm">{t(labelKey)}</span>
                    <span className="text-xs text-muted-foreground">
                      {present ? t("insights.community.present") : t("insights.community.missing")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* CODEOWNERS 错误 */}
          {errors !== null && errors.length > 0 && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4 text-chart-3" />
                {t("insights.community.codeownersErrors")}
              </h2>
              <ul className="divide-y">
                {errors.map((e, i) => (
                  <li key={i} className="py-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {e.path}:{e.line}:{e.column}
                    </p>
                    <p className="mt-0.5 text-sm">{e.message}</p>
                    {e.suggestion && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{e.suggestion}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </InsightsShell>
  );
}
