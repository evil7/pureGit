/**
 * 账户设置 —— 组织管理（独立板块 用户要求单列）
 *
 * 官方 /settings/organizations 语义：展示当前用户所属组织列表（可能不止 1 个），
 * 每个组织：头像/名称 + 角色（Owner/Member）+ 设置入口；New organization 官方外链。
 * 原并入个人资料页（阶段 4 分区堆叠）→ 用户要求独立成页（左导航单列板块）。
 */
import { OrganizationsSection } from "./OrganizationsSection";

export default function OrganizationsSettings() {
  return <OrganizationsSection />;
}
