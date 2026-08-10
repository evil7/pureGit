/**
 * 代码高亮主题（编辑器常用方案，明暗配对）
 *
 * 设计：
 * - 每项 = 一个「代码主题方案」，含 shiki light/dark 主题 id 配对；
 *   页面明暗模式（light/dark）分别取对应配色（shiki dual-theme 机制，
 *   dark 色经 --shiki-dark-bg/--shiki-dark 变量由 .dark .shiki CSS 覆盖）
 * - 选择存 localStorage `pg-code-theme`（本地 UI 偏好，非 GitHub 账户属性，
 *   与外观主题同安全模型——仅约束 access token 不落 localStorage）
 * - 模块级状态 + 订阅：shiki.ts 与 useCodeTheme hook 同源，切换即时生效
 */
export type CodeThemeId =
  | "github"
  | "vscode"
  | "oneDark"
  | "solarized"
  | "material"
  | "catppuccin"
  | "gruvbox"
  | "dracula"
  | "tokyoNight";

/** 语法高亮 token 调色板（完整语义色：函数/变量/数字等各自一色 修复「仅两色」） */
export interface HighlightTokens {
  /** 关键字/控制流/运算符 */
  keyword: string;
  /** 字符串/模板 */
  string: string;
  /** 数字/布尔/null */
  number: string;
  /** 函数/方法名 */
  function: string;
  /** 类型/类名 */
  type: string;
  /** 注释 */
  comment: string;
  /** 属性名/变量 */
  property: string;
}

export interface CodeThemeDef {
  id: CodeThemeId;
  /** i18n label key（settings 页展示） */
  labelKey: string;
  /** shiki light theme id */
  light: string;
  /** shiki dark theme id */
  dark: string;
  /** 预览色块（5 块：明/暗背景 + 明/暗前景字体色 + 高亮 accent，供设置页缩略展示） */
  preview: {
    /** 亮色背景 */
    bgLight: string;
    /** 暗色背景 */
    bgDark: string;
    /** 亮色前景（主要字体色） */
    fgLight: string;
    /** 暗色前景（主要字体色） */
    fgDark: string;
    /** 高亮/关键字色（次要强调色） */
    accent: string;
    /** 语法高亮 token 调色板（明/暗各一套，与各主题实际 token 色一致） */
    tokens: { light: HighlightTokens; dark: HighlightTokens };
  };
}

export const CODE_THEMES: CodeThemeDef[] = [
  {
    id: "github",
    labelKey: "codeTheme.github",
    light: "github-light",
    dark: "github-dark",
    preview: {
      bgLight: "#ffffff",
      bgDark: "#24292e",
      fgLight: "#24292e",
      fgDark: "#e6edf3",
      accent: "#0969da",
      tokens: {
        light: {
          keyword: "#cf222e",
          string: "#0a3069",
          number: "#0550ae",
          function: "#8250df",
          type: "#953800",
          comment: "#6e7781",
          property: "#0550ae",
        },
        dark: {
          keyword: "#ff7b72",
          string: "#a5d6ff",
          number: "#79c0ff",
          function: "#d2a8ff",
          type: "#ffa657",
          comment: "#8b949e",
          property: "#79c0ff",
        },
      },
    },
  },
  {
    id: "vscode",
    labelKey: "codeTheme.vscode",
    light: "light-plus",
    dark: "dark-plus",
    preview: {
      bgLight: "#ffffff",
      bgDark: "#1e1e1e",
      fgLight: "#000000",
      fgDark: "#d4d4d4",
      accent: "#569cd6",
      tokens: {
        light: {
          keyword: "#0000ff",
          string: "#a31515",
          number: "#098658",
          function: "#795e26",
          type: "#267f99",
          comment: "#008000",
          property: "#001080",
        },
        dark: {
          keyword: "#569cd6",
          string: "#ce9178",
          number: "#b5cea8",
          function: "#dcdcaa",
          type: "#4ec9b0",
          comment: "#6a9955",
          property: "#9cdcfe",
        },
      },
    },
  },
  {
    id: "oneDark",
    labelKey: "codeTheme.oneDark",
    light: "one-light",
    dark: "one-dark-pro",
    preview: {
      bgLight: "#fafafa",
      bgDark: "#282c34",
      fgLight: "#383a42",
      fgDark: "#abb2bf",
      accent: "#e06c75",
      tokens: {
        light: {
          keyword: "#a626a4",
          string: "#50a14f",
          number: "#986801",
          function: "#4078f2",
          type: "#c18401",
          comment: "#a0a1a7",
          property: "#383a42",
        },
        dark: {
          keyword: "#c678dd",
          string: "#98c379",
          number: "#d19a66",
          function: "#61afef",
          type: "#e5c07b",
          comment: "#7f848e",
          property: "#abb2bf",
        },
      },
    },
  },
  {
    id: "solarized",
    labelKey: "codeTheme.solarized",
    light: "solarized-light",
    dark: "solarized-dark",
    preview: {
      bgLight: "#fdf6e3",
      bgDark: "#002b36",
      fgLight: "#657b83",
      fgDark: "#839496",
      accent: "#268bd2",
      tokens: {
        light: {
          keyword: "#859900",
          string: "#2aa198",
          number: "#d33682",
          function: "#268bd2",
          type: "#b58900",
          comment: "#93a1a1",
          property: "#586e75",
        },
        dark: {
          keyword: "#859900",
          string: "#2aa198",
          number: "#d33682",
          function: "#268bd2",
          type: "#b58900",
          comment: "#586e75",
          property: "#839496",
        },
      },
    },
  },
  {
    id: "material",
    labelKey: "codeTheme.material",
    light: "material-theme-lighter",
    dark: "material-theme-darker",
    preview: {
      bgLight: "#fafafa",
      bgDark: "#212121",
      fgLight: "#90a4ae",
      fgDark: "#eeffff",
      accent: "#82aaff",
      tokens: {
        light: {
          keyword: "#aa00ff",
          string: "#008000",
          number: "#ff1744",
          function: "#2962ff",
          type: "#00b0ff",
          comment: "#90a4ae",
          property: "#00838f",
        },
        dark: {
          keyword: "#c792ea",
          string: "#c3e88d",
          number: "#f78c6c",
          function: "#82aaff",
          type: "#ffcb6b",
          comment: "#546e7a",
          property: "#89ddff",
        },
      },
    },
  },
  {
    id: "catppuccin",
    labelKey: "codeTheme.catppuccin",
    light: "catppuccin-latte",
    dark: "catppuccin-mocha",
    preview: {
      bgLight: "#eff1f5",
      bgDark: "#1e1e2e",
      fgLight: "#4c4f69",
      fgDark: "#cdd6f4",
      accent: "#89b4fa",
      tokens: {
        light: {
          keyword: "#8839ef",
          string: "#40a02b",
          number: "#fe640b",
          function: "#1e66f5",
          type: "#df8e1d",
          comment: "#8c8fa1",
          property: "#179299",
        },
        dark: {
          keyword: "#cba6f7",
          string: "#a6e3a1",
          number: "#fab387",
          function: "#89b4fa",
          type: "#f9e2af",
          comment: "#6c7086",
          property: "#94e2d5",
        },
      },
    },
  },
  {
    id: "gruvbox",
    labelKey: "codeTheme.gruvbox",
    light: "gruvbox-light-medium",
    dark: "gruvbox-dark-medium",
    preview: {
      bgLight: "#fbf1c7",
      bgDark: "#282828",
      fgLight: "#3c3836",
      fgDark: "#ebdbb2",
      accent: "#d65d0e",
      tokens: {
        light: {
          keyword: "#9d0006",
          string: "#79740e",
          number: "#b57614",
          function: "#076678",
          type: "#b57614",
          comment: "#928374",
          property: "#427b58",
        },
        dark: {
          keyword: "#fb4934",
          string: "#b8bb26",
          number: "#d3869b",
          function: "#fabd2f",
          type: "#83a598",
          comment: "#928374",
          property: "#8ec07c",
        },
      },
    },
  },
  {
    id: "dracula",
    labelKey: "codeTheme.dracula",
    light: "min-light",
    dark: "dracula",
    preview: {
      bgLight: "#ffffff",
      bgDark: "#282a36",
      fgLight: "#24292e",
      fgDark: "#f8f8f2",
      accent: "#bd93f9",
      tokens: {
        light: {
          keyword: "#ff79c6",
          string: "#6a9c4f",
          number: "#bd93f9",
          function: "#4f9c7a",
          type: "#00b0a0",
          comment: "#8a8a96",
          property: "#24292e",
        },
        dark: {
          keyword: "#ff79c6",
          string: "#f1fa8c",
          number: "#bd93f9",
          function: "#50fa7b",
          type: "#8be9fd",
          comment: "#6272a4",
          property: "#f8f8f2",
        },
      },
    },
  },
  {
    id: "tokyoNight",
    labelKey: "codeTheme.tokyoNight",
    light: "tokyo-night-light",
    dark: "tokyo-night",
    preview: {
      bgLight: "#e9edf7",
      bgDark: "#1a1b26",
      fgLight: "#343b58",
      fgDark: "#a9b1d6",
      accent: "#7aa2f7",
      tokens: {
        light: {
          keyword: "#8c4351",
          string: "#485e30",
          number: "#965027",
          function: "#34548d",
          type: "#166775",
          comment: "#8a9a7b",
          property: "#166775",
        },
        dark: {
          keyword: "#f7768e",
          string: "#9ece6a",
          number: "#ff9e64",
          function: "#7aa2f7",
          type: "#2ac3de",
          comment: "#565f89",
          property: "#73daca",
        },
      },
    },
  },
];

export const DEFAULT_CODE_THEME: CodeThemeId = "github";

const STORAGE_KEY = "pg-code-theme";

function loadStored(): CodeThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && CODE_THEMES.some((t) => t.id === v)) return v as CodeThemeId;
  } catch {
    /* localStorage 不可用（隐私模式等）→ 默认 */
  }
  return DEFAULT_CODE_THEME;
}

let current: CodeThemeId = typeof localStorage !== "undefined" ? loadStored() : DEFAULT_CODE_THEME;

const listeners = new Set<() => void>();

// 云端偏好同步后重读（换设备自动同步代码主题）；模块级注册一次
if (typeof window !== "undefined") {
  window.addEventListener("puregit:prefs-synced", () => {
    const v = loadStored();
    if (v !== current) {
      current = v;
      listeners.forEach((l) => l());
    }
  });
}

export function getCodeThemeId(): CodeThemeId {
  return current;
}

/** 当前代码主题定义（含 light/dark shiki id） */
export function getCodeTheme(): CodeThemeDef {
  return CODE_THEMES.find((t) => t.id === current) ?? CODE_THEMES[0];
}

export function setCodeTheme(id: CodeThemeId): void {
  if (!CODE_THEMES.some((t) => t.id === id)) return;
  current = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  // 云同步（本地已生效；未登录静默跳过）
  void import("./prefs-sync").then((m) => m.requestPrefsPush());
}

/** 订阅代码主题变化（返回取消订阅函数） */
export function subscribeCodeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 全部 shiki 主题 id（去重，供 highlighter 一次性注册，切换主题零重建） */
export function allShikiThemeIds(): string[] {
  const set = new Set<string>();
  for (const t of CODE_THEMES) {
    set.add(t.light);
    set.add(t.dark);
  }
  return [...set];
}
