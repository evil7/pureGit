/**
 * 可管理组织 hook
 *
 * 返回当前用户「管理的组织」（admin 角色）列表，供账号切换器（AccountSwitcher）使用。
 * - fetchUserOrgsSmart：全部所属组织
 * - fetchOrgMemberships：角色（admin → Owner），仅保留 admin 组织
 * 个人账户 + admin 组织构成切换实体列表。
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchUserOrgsSmart, fetchViewerSmart } from "@/lib/api";
import { fetchOrgMemberships } from "@/lib/restapi";
import type { SwitcherEntity } from "@/components/AccountSwitcher";

/** 个人账户 + admin 组织 → 切换实体列表（个人在前，组织按序） */
export function useManageableEntities(
  userLogin?: string,
  userAvatarUrl?: string | null,
): { entities: SwitcherEntity[]; loaded: boolean } {
  const { token } = useAuth();
  const [orgs, setOrgs] = useState<SwitcherEntity[]>([]);
  /** 个人账户显示名（取所设置的姓名，而非 login） */
  const [userName, setUserName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      // 未登录：无实体可切换，直接标记加载完成
      setLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchUserOrgsSmart(token),
      fetchOrgMemberships(token),
      // 个人姓名（切换下拉左侧显示设置的姓名；失败回退 login）
      fetchViewerSmart(token).catch(() => null),
    ])
      .then(([list, mships, viewer]) => {
        if (cancelled) return;
        if (viewer) setUserName(viewer.name || userLogin || null);
        const adminSet = new Set(
          mships
            .filter((m) => m.state === "active" && m.role === "admin")
            .map((m) => m.organization.login),
        );
        setOrgs(
          list
            .filter((o) => adminSet.has(o.login))
            .map((o) => ({
              kind: "org" as const,
              login: o.login,
              name: o.name ?? o.login,
              avatarUrl: o.avatarUrl ?? null,
            })),
        );
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [token, userLogin]);

  return useMemo(() => {
    const entities: SwitcherEntity[] = [];
    if (userLogin) {
      entities.push({
        kind: "user",
        login: userLogin,
        // 左侧显示设置的姓名（fetchViewerSmart 结果），回退 login
        name: userName ?? userLogin,
        avatarUrl: userAvatarUrl ?? null,
      });
    }
    entities.push(...orgs);
    return { entities, loaded };
  }, [userLogin, userAvatarUrl, userName, orgs, loaded]);
}
