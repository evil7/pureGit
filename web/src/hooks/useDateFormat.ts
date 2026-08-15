/**
 * 日期格式偏好 hook
 *
 * 选择时间显示方式（三档）：
 * - absolute（默认）：绝对日期，样式跟随界面语言——zh-CN → `2026年8月7日 22:53`；
 *   en-US → `August 7, 2026 22:53`
 * - iso：通用标准 `2026-01-02T12:34:56`（ISO 8601）
 * - relative：仅相对时间 `2 小时前`
 *
 * 本地偏好键 `pg-date-format`（非 GitHub 账户属性，可写 localStorage）；
 * 云端同步：改动经 requestPrefsPush()，PREFS_SYNC_EVENT 后重读。
 */
import { useEffect, useMemo, useState } from "react";
import { PREFS_SYNC_EVENT, requestPrefsPush } from "@/lib/auth/prefs-sync";
import { useI18n } from "@/i18n";

export type DateFormat = "absolute" | "iso" | "relative";

const STORAGE_KEY = "pg-date-format";

export function loadDateFormat(): DateFormat {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "absolute" || saved === "iso" || saved === "relative") {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return "absolute";
}

/** 英文月份名（absolute/relative 超 30 天回退共用） */
const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** 绝对日期（zh/en 样式） */
function absoluteDate(d: Date, lang: "zh-CN" | "en-US", hm: string): string {
  if (lang === "en-US")
    return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 纯日期（无时间，分组标题/日期徽标用）：absolute 样式随 lang */
export function formatDay(iso: string, lang: "zh-CN" | "en-US" = "zh-CN"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (lang === "en-US") return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 格式化 ISO 时间为指定格式（absolute 样式随 lang；iso 走 ISO 8601；relative 依赖当前时间差值） */
export function formatDate(
  iso: string,
  format: DateFormat,
  lang: "zh-CN" | "en-US" = "zh-CN",
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (format === "relative") return relativeTime(d, lang);
  if (format === "iso") {
    // 通用标准：YYYY-MM-DDTHH:mm:ss（本地时区）
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours(),
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return absoluteDate(d, lang, `${hh}:${mm}`);
}

/** 相对时间（官方 relative-time 简化版；随界面语言输出 zh/en） */
function relativeTime(d: Date, lang: "zh-CN" | "en-US"): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (lang === "en-US") {
    if (m < 1) return "just now";
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const day = Math.floor(h / 24);
    if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return absoluteDate(d, lang, hm);
  }
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return absoluteDate(d, lang, hm);
}

export function useDateFormat() {
  const { lang } = useI18n();
  const [format, setFormat] = useState<DateFormat>(loadDateFormat);

  // 界面语言偏好可能为 system（跟随系统）→ 解析为实际生效语言供日期样式
  const effectiveLang: "zh-CN" | "en-US" =
    lang === "en-US"
      ? "en-US"
      : lang === "zh-CN"
        ? "zh-CN"
        : (() => {
            try {
              return (navigator.language ?? "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
            } catch {
              return "zh-CN";
            }
          })();

  // 云端偏好同步后重读（换设备自动同步）
  useEffect(() => {
    const onSync = () => setFormat(loadDateFormat());
    window.addEventListener(PREFS_SYNC_EVENT, onSync);
    return () => window.removeEventListener(PREFS_SYNC_EVENT, onSync);
  }, []);

  // 写入本地 + 云同步
  const setFormatAndSync = (f: DateFormat) => {
    setFormat(f);
    try {
      localStorage.setItem(STORAGE_KEY, f);
    } catch {
      /* ignore */
    }
    requestPrefsPush();
  };

  // 绑定语言与当前格式的格式化函数（absolute 样式随 lang 变化自动重渲染）
  const fmt = useMemo(
    () => (iso: string) => formatDate(iso, format, effectiveLang),
    [format, effectiveLang],
  );
  // 纯日期格式化（分组标题/日期徽标用，不随 relative/absolute 偏好变化）
  const day = useMemo(() => (iso: string) => formatDay(iso, effectiveLang), [effectiveLang]);

  return { format, setFormat: setFormatAndSync, fmt, day };
}
