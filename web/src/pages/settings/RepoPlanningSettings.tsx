/**
 * 仓库 Planning 设置页（官方 /settings/planning）
 *
 * 无公开 API（Planning 开关 GraphQL/REST 均无适配）→ 预留外链官方。
 */
import { OfficialOnlySettings } from "./OfficialOnlySettings";

export default function RepoPlanningSettings() {
  return (
    <OfficialOnlySettings
      titleKey="repoPlanning.title"
      descKey="repoPlanning.desc"
      path="planning"
    />
  );
}
