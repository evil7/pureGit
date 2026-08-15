/**
 * 多语言（react-i18next 双语 zh-CN/en-US）
 *
 * react-i18next 标准化实现：
 * - 语言包独立 json：src/i18n/locales/{zh-CN,en-US}.json（开发者补充新语言只加文件）
 * - 本文件只做初始化注册 + 兼容导出（useI18n/tStatic/Lang 签名与旧版一致，调用点零改动）
 * - 偏好存 localStorage（本地偏好，非 GitHub 账户属性）
 * - 占位符沿用 `{name}` 单花括号（i18next 默认插值 `{{}}` 不冲突），配合调用点 .replace() 使用
 */
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
// API 调试工具独立语言包（命名空间 debug，与主 translation 分开管理）
import zhDebug from "./locales/debug/zh-CN.json";
import enDebug from "./locales/debug/en-US.json";

export type Lang = "system" | "zh-CN" | "en-US";

/** 语言包键（以 zh-CN 为基准；en-US 编译期校验键一致） */
export type I18nKey = keyof typeof zhCN;

/** 调试工具语言包键（命名空间 debug；en-US 编译期校验键一致） */
export type I18nDebugKey = keyof typeof zhDebug;

const LANG_KEY = "pg_lang";

/** 读取本地语言偏好（含 system 跟随系统；无记录默认 system） */
function getStoredLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "system" || saved === "en-US" || saved === "zh-CN") return saved;
  } catch {
    /* ignore */
  }
  return "system";
}

/** 偏好 → 实际生效语言（system 跟随浏览器语言，zh 前缀 → zh-CN，其余 → en-US） */
function resolveLang(pref: Lang): "zh-CN" | "en-US" {
  if (pref !== "system") return pref;
  try {
    const nav = navigator.language ?? "";
    return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  } catch {
    return "zh-CN";
  }
}

// 编译期完整性校验：en-US 与 zh-CN 键必须完全一致（多/少任一键均报错）。
// 用「差值字符串」做错误类型：键对称时差值为 never → true；不对称时差值落在模板
// 字符串分支（非 true）→ _Assert 触发报错（旧版用 never 兜底，never extends true 恒真，
// 校验失效——多余的键不会报错）。
type _Assert<T extends true> = T;
export type _KeysMatch = _Assert<
  Exclude<keyof typeof enUS, I18nKey> extends never
    ? Exclude<I18nKey, keyof typeof enUS> extends never
      ? true
      : `zh-CN 多余键: ${Exclude<I18nKey, keyof typeof enUS> & string}`
    : `en-US 多余键: ${Exclude<keyof typeof enUS, I18nKey> & string}`
>;
/** 调试语言包键一致性校验（独立命名空间） */
export type _DebugKeysMatch = _Assert<
  Exclude<keyof typeof enDebug, I18nDebugKey> extends never
    ? Exclude<I18nDebugKey, keyof typeof enDebug> extends never
      ? true
      : `debug/zh-CN 多余键: ${Exclude<I18nDebugKey, keyof typeof enDebug> & string}`
    : `debug/en-US 多余键: ${Exclude<keyof typeof enDebug, I18nDebugKey> & string}`
>;

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN, debug: zhDebug },
    "en-US": { translation: enUS, debug: enDebug },
  },
  lng: resolveLang(getStoredLang()),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

/** 兼容 hook：签名与旧自研 useI18n 一致（t/lang/setLang），调用点零改动
 * lang 返回本地偏好（含 system 跟随系统），供设置页 SegmentedControl 展示
 * t 支持 i18next 变量插值（{{var}}），vars 可选向后兼容 */
export function useI18n() {
  const { t, i18n: inst } = useTranslation();
  return {
    t: (key: I18nKey, vars?: Record<string, unknown>): string => t(key, vars),
    lang: getStoredLang(),
    setLang: (l: Lang) => {
      void inst.changeLanguage(resolveLang(l));
      try {
        localStorage.setItem(LANG_KEY, l);
      } catch {
        /* ignore */
      }
      // 云同步（本地已生效；未登录静默跳过；动态 import 避免循环依赖）
      void import("@/lib/auth/prefs-sync").then((m) => m.requestPrefsPush());
    },
  };
}

// 云端偏好同步后重读语言（换设备自动同步；react-i18next 自动通知组件重渲染）
if (typeof window !== "undefined") {
  window.addEventListener("puregit:prefs-synced", () => {
    try {
      const pref = getStoredLang();
      const effective = resolveLang(pref);
      if (effective !== i18n.resolvedLanguage) {
        void i18n.changeLanguage(effective);
      }
    } catch {
      /* ignore */
    }
  });
}

/** 模块顶层取文案（HomePage PERIODS / SettingsLayout NAV_ITEMS 用；i18n 已初始化；vars 兼容插值） */
export const tStatic = (key: I18nKey, vars?: Record<string, unknown>): string => i18n.t(key, vars);

export default i18n;
