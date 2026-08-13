/**
 * 偏好设置（本项目的设置页，非 GitHub 对照）
 *
 * 内容（重排）：
 * 1. 接口状态：REST/GraphQL 双额度卡（smart 按需自动消耗，独立配额同时消耗，
 *    无主备之分，仅耗尽告警）
 * 2. 授权方式：只读/完全控制切换（重新授权）
 * 3. 日期格式：绝对日期（样式跟随语言）/ 相对时间
 * 4. 显示语言：跟随系统 / zh-CN / en-US
 * 5. 明暗主题：light / dark / system
 * 6. 代码配色：编辑器常用方案（明暗配对）+ 示例代码卡片
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Monitor, Moon, Sun, Plug, Zap, AlertTriangle, Lock, PencilLine } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useDateFormat, type DateFormat } from "@/hooks/useDateFormat";
import { CODE_THEMES } from "@/lib/code/code-theme";
import { useI18n, type Lang, type I18nKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getApiUsage,
  hasApiUsageData,
  setApiUsage,
  subscribeUsageChange,
  type ApiUsage,
} from "@/lib/api/octokit";
import { fetchRateLimit } from "@/lib/restapi";
import { useAuth } from "@/hooks/useAuth";
import { CodeView } from "@/components/CodeView";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";
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

/** 示例代码（代码配色预览用） */
const SAMPLE_CODE = `import { graphql } from "@octokit/graphql";

// GraphQL 唯一主通道：登录态全部经 GraphQL，匿名走 REST 数据层
export async function fetchRepo(owner: string, name: string, token?: string | null) {
  if (!token) return restFetch(owner, name); // 匿名强制 REST（GraphQL 匿名恒 403）
  const resp = await graphql(REPO_QUERY, { owner, name }, { headers: { authorization: \`bearer \${token}\` } });
  return resp.repository;
}`;

/** 接口状态按钮：接口名 + 内嵌额度进度条（REST/GraphQL 独立配额；GraphQL 为主通道，REST 匿名/降级用） */
function ApiStatusCard({
  title,
  icon: Icon,
  limit,
  remaining,
  exhaustedLabel,
  remainingLabel,
  lowQuotaLabel,
}: {
  title: string;
  icon: typeof Plug;
  limit: number;
  remaining: number;
  exhaustedLabel: string;
  remainingLabel: string;
  lowQuotaLabel?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round(((limit - remaining) / limit) * 100)) : 0;
  const exhausted = limit > 0 && remaining <= 0;
  // 低额度告警：剩余不足 100（且未耗尽）时提示影响范围
  const lowQuota = limit > 0 && remaining > 0 && remaining < 100;
  return (
    <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-muted/30 p-4">
      {/* 顶部：接口名 + 耗尽徽章 */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
        {exhausted && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            {exhaustedLabel}
          </span>
        )}
      </div>
      {/* 进度条 */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            exhausted ? "bg-destructive" : "bg-muted-foreground/40",
          )}
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">
        {limit > 0 ? `${remainingLabel} ${remaining}/${limit}` : "—"}
      </div>
      {/* 低额度告警（剩余 <100） */}
      {lowQuota && lowQuotaLabel && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{lowQuotaLabel}</span>
        </div>
      )}
    </div>
  );
}

/** 权限 tabs-switch（只读访问 / 完全控制）；点击切换 → 确认框 → 重新授权并回原页 */
function ModeSwitch() {
  const { scopes, login } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const isWrite = scopes?.mode === "write";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [target, setTarget] = useState<"read" | "write" | null>(null);

  const requestSwitch = (mode: "read" | "write") => {
    if (mode === (isWrite ? "write" : "read")) return;
    setTarget(mode);
    setConfirmOpen(true);
  };

  const confirm = () => {
    if (!target) return;
    setConfirmOpen(false);
    login({ mode: target, redirect: pathname });
  };

  return (
    <>
      <SegmentedControl
        variant="box"
        options={[
          { value: "read", label: t("settings.mode.read"), icon: Lock },
          { value: "write", label: t("settings.mode.write"), icon: PencilLine },
        ]}
        value={isWrite ? "write" : "read"}
        onValueChange={(m) => requestSwitch(m)}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.modeSwitchTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {target === "write" ? t("settings.modeSwitchWrite") : t("settings.modeSwitchRead")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>
              {t("settings.modeSwitchConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function PreferencesSettings() {
  const { theme, setTheme } = useTheme();
  const { codeThemeId, setCodeTheme } = useCodeTheme();
  const { t, lang, setLang } = useI18n();
  const { format: dateFormat, setFormat: setDateFormat } = useDateFormat();
  const { token } = useAuth();
  const [usage, setUsage] = useState<ApiUsage | null>(null);

  // 选项（依赖 t，组件内定义）
  const themeOptions: SegmentedOption<Theme>[] = [
    { value: "system", label: t("settings.system"), icon: Monitor },
    { value: "light", label: t("settings.light"), icon: Sun },
    { value: "dark", label: t("settings.dark"), icon: Moon },
  ];
  const langOptions: SegmentedOption<Lang>[] = [
    { value: "system", label: t("settings.system"), icon: Monitor },
    { value: "zh-CN", label: t("settings.lang.zh") },
    { value: "en-US", label: t("settings.lang.en") },
  ];
  const dateFormatOptions: SegmentedOption<DateFormat>[] = [
    { value: "absolute", label: t("settings.dateFormat.absolute") },
    { value: "iso", label: t("settings.dateFormat.iso") },
    { value: "relative", label: t("settings.dateFormat.relative") },
  ];

  // 双额度（footer 同源统一缓存 octokit.ts）：订阅每次接口响应头实时更新——
  // 页面任意 REST/GraphQL 活动即刷新，替代原 60s 轮询 /rate_limit（每分钟消耗 1 次 REST 配额）。
  useEffect(() => {
    const apply = () => {
      const u = getApiUsage();
      if (u.rest.limit > 0 || u.graphql.limit > 0) setUsage(u);
    };
    const unsub = subscribeUsageChange(apply);
    apply(); // 初始同步（挂载前可能已有请求写入缓存）
    return unsub;
  }, []);

  // 兜底：缓存为空（全站尚无任何接口请求）时一次 /rate_limit 回填统一缓存（经 setApiUsage → emit → apply）
  useEffect(() => {
    let cancelled = false;
    if (hasApiUsageData()) return;
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
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex flex-col gap-8">
      {/* 1. 接口状态（smart 按需自动消耗，REST/GraphQL 独立配额同时消耗，无主备之分，仅耗尽告警） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.api.title")}</h2>
        </div>
        {/* 双额度卡（GraphQL Zap / REST Plug 统一图标，独立配额，实时剩余） */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <ApiStatusCard
            title={t("settings.api.graphql")}
            icon={Zap}
            limit={usage?.graphql.limit ?? 0}
            remaining={usage?.graphql.remaining ?? 0}
            exhaustedLabel={t("settings.api.exhausted")}
            remainingLabel={t("settings.api.remaining")}
            lowQuotaLabel={t("settings.api.lowQuota").replace(
              "{impact}",
              t("settings.api.impact.graphql"),
            )}
          />
          <ApiStatusCard
            title={t("settings.api.rest")}
            icon={Plug}
            limit={usage?.rest.limit ?? 0}
            remaining={usage?.rest.remaining ?? 0}
            exhaustedLabel={t("settings.api.exhausted")}
            remainingLabel={t("settings.api.remaining")}
            lowQuotaLabel={t("settings.api.lowQuota").replace(
              "{impact}",
              t("settings.api.impact.rest"),
            )}
          />
        </div>
      </section>

      {/* 2. 授权方式（只读访问 / 完全控制；切换需重新授权） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.auth.title")}</h2>
        </div>
        <ModeSwitch />
      </section>

      {/* 3. 日期格式 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.dateFormat")}</h2>
        </div>
        <SegmentedControl
          options={dateFormatOptions}
          value={dateFormat}
          onValueChange={(v) => setDateFormat(v)}
          className="flex-col sm:flex-row"
        />
      </section>

      {/* 4. 显示语言 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.language")}</h2>
        </div>
        <SegmentedControl options={langOptions} value={lang} onValueChange={(v) => setLang(v)} />
      </section>

      {/* 5. 明暗主题 */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.theme")}</h2>
        </div>
        <SegmentedControl options={themeOptions} value={theme} onValueChange={(v) => setTheme(v)} />
      </section>

      {/* 6. 代码配色（选项卡 + 示例代码卡 1:2 同行） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.codeTheme")}</h2>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {/* 左 1/3：配色选项（名称居左，色标胶囊居右） */}
          <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-1 lg:w-1/3">
            {CODE_THEMES.map((ct) => {
              const active = codeThemeId === ct.id;
              const p = ct.preview;
              return (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => setCodeTheme(ct.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                  )}
                >
                  {/* 名称居左 */}
                  <span className="min-w-0 truncate text-left">{t(ct.labelKey as I18nKey)}</span>
                  {/* 色标胶囊 5 块居右（明/暗背景 + 明/暗前景 + accent） */}
                  <span className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                    <span className="size-4" style={{ backgroundColor: p.bgLight }} />
                    <span className="size-4" style={{ backgroundColor: p.bgDark }} />
                    <span className="size-4" style={{ backgroundColor: p.fgLight }} />
                    <span className="size-4" style={{ backgroundColor: p.fgDark }} />
                    <span className="size-4" style={{ backgroundColor: p.accent }} />
                  </span>
                </button>
              );
            })}
          </div>
          {/* 右 2/3：示例代码卡片（直观感知配色） */}
          <div className="flex min-w-0 flex-1 flex-col lg:w-2/3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
              <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="font-mono">sample.ts</span>
                <span className="ml-auto">{t("settings.codeTheme.sample")}</span>
              </div>
              <div className="overflow-hidden">
                <CodeView code={SAMPLE_CODE} path="sample.ts" minHeight="min-h-72" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
