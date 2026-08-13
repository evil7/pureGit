/**
 * 详情侧栏参与者分区（issue / PR 详情右栏共享）
 *
 * 官方「{n} participants」计数 + 重叠头像栈（最多 max 个头像，超出 +n）。
 * 统一 issue / PR 两处参与者展示（此前 issue 用 gap 平铺、PR 用重叠，风格不一）——
 * 现统一为官方重叠头像 + 计数。头像数据源 = 作者 + 指派人 + 评论者/评审作者聚合（调用方负责去重）。
 */
import { UserAvatar } from "@/components/UserAvatar";
import { SidebarSection } from "@/components/SidebarSection";

export function ParticipantsSection({
  title,
  participants,
  max = 5,
}: {
  title: string;
  participants: { login: string; avatar_url?: string | null }[];
  max?: number;
}) {
  return (
    <SidebarSection title={title}>
      {participants.length > 0 ? (
        <div className="flex items-center">
          <div className="flex -space-x-2">
            {participants.slice(0, max).map((u) => (
              <UserAvatar
                key={u.login}
                src={u.avatar_url}
                alt={u.login}
                title={u.login}
                className="size-6 ring-2 ring-background"
              />
            ))}
          </div>
          {participants.length > max && (
            <span className="ml-2 text-xs text-muted-foreground">+{participants.length - max}</span>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </SidebarSection>
  );
}
