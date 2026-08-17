/**
 * 仓库 Copilot 设置页（官方 /settings/copilot）
 *
 * 无公开 API（repo 级 Copilot 设置 GraphQL/REST 均无适配）→ 预留外链官方。
 */
import { OfficialOnlySettings } from "./OfficialOnlySettings";

export default function RepoCopilotSettings() {
  return (
    <OfficialOnlySettings titleKey="repoCopilot.title" descKey="repoCopilot.desc" path="copilot" />
  );
}
