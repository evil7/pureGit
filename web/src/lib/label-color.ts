/**
 * GitHub label 颜色适配（官方语义）
 *
 * GitHub 官方 label 徽标：背景 = label 色值，前景 = 根据背景亮度自动黑白
 * （primer `contrast-color` 语义，HSL lightness > 0.6 → 深色文字，否则白色）。
 * 暗色主题下背景会降饱和、提亮（避免刺眼 + 保证可读），前景再按新亮度选黑白。
 */

export interface LabelColorStyle {
  backgroundColor: string;
  color: string;
}

/** hex(#rrggbb 或 rrggbb) → {r,g,b}（0-255）；非法值回退灰色 */
function hexToRgb(hex: string | undefined | null): { r: number; g: number; b: number } {
  let h = (hex ?? "").replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const num = parseInt(h, 16);
  if (Number.isNaN(num) || h.length !== 6) return { r: 128, g: 128, b: 128 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** RGB → HSL（h 0-360，s/l 0-100） */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

/**
 * 计算 label 徽标样式（背景 + 前景），跟随亮/暗主题。
 * @param color label 色值（如 "1d76db"，无 #）
 * @param dark  是否暗色主题
 */
export function getLabelStyle(color: string | undefined | null, dark: boolean): LabelColorStyle {
  const { r, g, b } = hexToRgb(color);
  const { h, s, l } = rgbToHsl(r, g, b);

  if (dark) {
    // 暗色主题：降饱和（≤50%）、提亮（60-75%），官方暗色 label 观感
    const ns = Math.min(50, s * 0.5);
    const nl = Math.min(75, Math.max(60, l * 1.3));
    return {
      backgroundColor: `hsl(${h} ${ns}% ${nl}%)`,
      color: nl > 60 ? "#1f2328" : "#ffffff",
    };
  }

  // 亮色主题：原色背景，前景按亮度黑白
  return {
    backgroundColor: color ? `#${color.replace("#", "")}` : "#e5e7eb",
    color: l > 60 ? "#1f2328" : "#ffffff",
  };
}
