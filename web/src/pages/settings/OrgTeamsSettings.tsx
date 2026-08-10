/**
 * 组织设置 —— 团队（拆分：原 OrgSettingsPage 板块独立成页）
 *
 * 路径：/organizations/:org/settings/teams（官方 /orgs/:org/teams 精简）
 * 复用 OrgTeamsSection（列表 + 创建/编辑/删除 + 成员增删；固定 REST）。
 */
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { OrgTeamsSection } from "@/pages/settings/OrgTeamsSection";

export default function OrgTeamsSettings() {
  const { org = "" } = useParams();
  const { token } = useAuth();

  if (!token) return null;

  // OrgTeamsSection 自带标题行（团队 + 计数 + 新建按钮），页面无需重复标题
  return (
    <div className="flex flex-col gap-6">
      <OrgTeamsSection org={org} token={token} />
    </div>
  );
}
