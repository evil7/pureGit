/** Project 看板列颜色枚举 → CSS 色值（看板列头圆点 / 卡片状态标） */
export const OPTION_COLOR: Record<string, string> = {
  GRAY: "#6b7280",
  BLUE: "#3b82f6",
  GREEN: "#22c55e",
  YELLOW: "#eab308",
  ORANGE: "#f97316",
  RED: "#ef4444",
  PINK: "#ec4899",
  PURPLE: "#a855f7",
};

/** 颜色枚举名列表（官方固定 8 色，顺序即显示顺序） */
export const OPTION_COLOR_KEYS = Object.keys(OPTION_COLOR);
