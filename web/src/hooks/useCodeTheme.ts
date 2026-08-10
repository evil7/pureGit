/**
 * 代码主题 React hook
 *
 * - 状态与 localStorage 同源（lib/code-theme.ts 模块级 + 订阅）
 * - 返回 { codeThemeId, codeTheme, setCodeTheme }
 * - 高亮页面以 codeThemeId 作为 effect 依赖 → 切换主题后重新高亮
 */
import { useEffect, useState } from "react";
import {
  getCodeTheme,
  getCodeThemeId,
  setCodeTheme,
  subscribeCodeTheme,
  type CodeThemeDef,
  type CodeThemeId,
} from "@/lib/code-theme";

export function useCodeTheme() {
  const [id, setId] = useState<CodeThemeId>(getCodeThemeId);

  useEffect(() => subscribeCodeTheme(() => setId(getCodeThemeId())), []);

  const codeTheme: CodeThemeDef = getCodeTheme();

  return { codeThemeId: id, codeTheme, setCodeTheme };
}
