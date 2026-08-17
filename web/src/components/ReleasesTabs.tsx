/**
 * Releases / Tags 二级 tab（官方 /releases 顶部「Releases | Tags」切换）
 *
 * 官方语义：/releases 与 /tags 是 Releases 区的两个子视图，顶部 Tabs 切换（URL 驱动）。
 * 纯导航触发，无内容切换（内容由各自页面渲染）。
 */
import { useNavigate, useParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";

export function ReleasesTabs({ active }: { active: "releases" | "tags" }) {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <Tabs
      value={active}
      onValueChange={(v) =>
        navigate(v === "tags" ? `/${owner}/${repo}/tags` : `/${owner}/${repo}/releases`)
      }
    >
      <TabsList>
        <TabsTrigger value="releases">{t("releases.tabs.releases")}</TabsTrigger>
        <TabsTrigger value="tags">{t("releases.tabs.tags")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
