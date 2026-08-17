/**
 * Security 页顶部 tab 导航（官方 /security 的 Overview / Dependabot / Code scanning / Secret scanning）
 *
 * URL 驱动：`/security` → Overview；`/security/{dependabot|code-scanning|secret-scanning}` → 各 alerts 列表。
 * 纯导航触发，内容由各页面渲染。
 */
import { useNavigate, useParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";

export type SecurityTab = "overview" | "dependabot" | "code-scanning" | "secret-scanning";

export function SecurityNav({ active }: { active: SecurityTab }) {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  const to = (v: string) =>
    v === "overview" ? `/${owner}/${repo}/security` : `/${owner}/${repo}/security/${v}`;

  return (
    <Tabs value={active} onValueChange={(v) => navigate(to(v))}>
      <TabsList>
        <TabsTrigger value="overview">{t("security.tabs.overview")}</TabsTrigger>
        <TabsTrigger value="dependabot">{t("security.tabs.dependabot")}</TabsTrigger>
        <TabsTrigger value="code-scanning">{t("security.tabs.codeScanning")}</TabsTrigger>
        <TabsTrigger value="secret-scanning">{t("security.tabs.secretScanning")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
