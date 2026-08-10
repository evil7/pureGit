/**
 * 外观主题 hook（light / dark / system）
 *
 * 说明：
 * - 主题偏好是本地 UI 偏好（非 GitHub 账户属性），可安全写入 localStorage；
 *   注意架构红线仅约束 access token 不得写 localStorage
 * - 采用 Tailwind v4 的 `.dark` class 自定义变体（见 index.css @custom-variant dark）
 * - favicon（/logo.svg 描边款）随主题自动换色：主题应用时把 <link rel="icon">
 *   替换为内联 SVG data URI（颜色取当前 --foreground 的明暗映射），
 *   light/dark/system 全部自动跟随
 */
import { useEffect, useState } from "react";
import { PREFS_SYNC_EVENT, requestPrefsPush } from "@/lib/prefs-sync";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "pg-theme";

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 读本地存储的主题（云端同步写回后重读用） */
function loadStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return "system";
}

/** favicon SVG 路径（与 Logo.tsx / public/logo.svg 同款描边 GitHub logo） */
const FAVICON_PATH =
  "M120.755 170c.03-4.669.059-20.874.059-27.29 0-9.272-3.167-15.339-6.719-18.41 22.051-2.464 45.201-10.863 45.201-49.067 0-10.855-3.824-19.735-10.175-26.683 1.017-2.516 4.413-12.63-.987-26.32 0 0-8.296-2.672-27.202 10.204-7.912-2.213-16.371-3.308-24.784-3.352-8.414.044-16.872 1.14-24.785 3.352C52.457 19.558 44.162 22.23 44.162 22.23c-5.4 13.69-2.004 23.804-.987 26.32C36.824 55.498 33 64.378 33 75.233c0 38.204 23.149 46.603 45.2 49.067-3.551 3.071-6.719 9.138-6.719 18.41 0 6.416.03 22.621.059 27.29M27 130c9.939.703 15.67 9.735 15.67 9.735 8.834 15.199 23.178 10.803 28.815 8.265";

/**
 * 更新 favicon 颜色（跟随主题 foreground 明暗）。
 * 独立 favicon 资源（/logo.svg）无法继承页面 CSS，故替换为内联 data URI。
 * 颜色映射：light → 近黑 #18181b（foreground），dark → 近白 #e6edf3（GitHub 深色前景）。
 */
function updateFavicon(dark: boolean) {
  const color = dark ? "#e6edf3" : "#18181b";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" fill="none"><path stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="${FAVICON_PATH}"/></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadStoredTheme);

  // 云端偏好同步后重读（换设备自动同步主题）
  useEffect(() => {
    const onSync = () => setTheme(loadStoredTheme());
    window.addEventListener(PREFS_SYNC_EVENT, onSync);
    return () => window.removeEventListener(PREFS_SYNC_EVENT, onSync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && getSystemDark());
      root.classList.toggle("dark", dark);
      // markdown 成品库（@uiw/react-markdown-preview）由 wrapperElement[data-color-mode] 单独跟随（见 MarkdownView）
      root.dataset.theme = dark ? "dark" : "light";
      // favicon 随主题换色（独立资源不继承页面 CSS，用内联 data URI）
      updateFavicon(dark);
    };
    apply();
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // 用户主动切换：写本地（effect 已做）+ 云同步
  const setThemeAndSync = (t: Theme) => {
    setTheme(t);
    requestPrefsPush();
  };

  return { theme, setTheme: setThemeAndSync };
}
