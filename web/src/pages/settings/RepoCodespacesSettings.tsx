/**
 * 仓库 Codespaces 设置页（官方 /settings/codespaces）
 *
 * 无公开 API（Codespaces 公开 REST 缺 repo 级设置）→ 预留外链官方。
 */
import { OfficialOnlySettings } from "./OfficialOnlySettings";

export default function RepoCodespacesSettings() {
  return (
    <OfficialOnlySettings
      titleKey="repoCodespaces.title"
      descKey="repoCodespaces.desc"
      path="codespaces"
    />
  );
}
