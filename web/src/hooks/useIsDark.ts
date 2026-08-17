/**
 * 当前是否暗色主题（跟随 useTheme：light/dark/system）
 * 供内联样式（无法用 Tailwind dark: 变体）判断用，如 GitHub label 颜色适配。
 */
import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useIsDark(): boolean {
  const { theme } = useTheme();
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSysDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return theme === "dark" || (theme === "system" && sysDark);
}
