/**
 * 用户/组织主页（官方统一路径 /{login}）—— 方案 A 复刻重构
 *
 * 复刻 GitHub 官方个人/组织主页（用户确认方案 A）：
 * - 左侧资料卡（260px sticky）：大头像 + 状态徽章 + 名字/@login/代词 + Edit/Follow 按钮
 *   + bio + 对齐信息（公司/位置/网站）+ 统计区（关注/成员 + 公开/私有仓库，权限感知）
 *   + 加入的组织（仅用户页）
 * - 右侧 tabs 多内容：用户页 Overview / Repositories / Stars；组织页 Overview / Repositories / People
 *
 * 二轮：① 自动检测 user/org（官方统一路径 /{login}，/orgs/{org} 302 → /{org}）；
 * ② 编辑按钮（本人 → 编辑个人资料 /settings/profile；组织可管理 → 编辑组织资料）；
 * ③ 修复 isFollowing 字段（user.viewerIsFollowing）与 pinned 降级丢失（fetchProfileSmart）。
 * 三轮（用户）：去概览 tab——只留 仓库/Star（用户）、仓库/成员（组织）；
 * Star 数量随主页查询一次拿到（starredRepositories.totalCount / REST Link 头）。
 *
 * API：GraphQL 首选 + REST 降级（见 api-org.ts）。
 * 权限差异（用户 4 问核实）：API 自动处置——user(login:)/organization(login:) 对他人只返回公开仓库，
 * 自查看含私有；repositories(visibility:PUBLIC) 恒为公开数，repositories.totalCount 为权限内总数。
 * 成员收敛：org 成员数据（membersWithRole）需 read:org 权限，受限第三方组织会 403 拖垮主查询——
 * 故主查询不取成员数，People tab 仅在 viewerCanAdminister（自己可管理）时显示并独立请求成员列表。
 * Achievements/Highlights 无公开 API（官方仅 SSR HTML），按用户确认省略。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import {
  Building2,
  Globe,
  MapPin,
  Users,
  FolderGit2,
  Lock,
  UserPlus,
  UserCheck,
  Star,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RepositoryCard } from "@/components/RepositoryCard";
import { Pager } from "@/components/Pager";
import { type SegmentedOption } from "@/components/SegmentedControl";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchProfileSmart,
  fetchProfileReposSmart,
  fetchUserStarsSmart,
  fetchOrgMembersSmart,
  isFollowingSmart,
  setFollowingSmart,
  type ProfileData,
  type OrgMembersResult,
} from "@/lib/api";
import { PAGE_SHELL } from "@/lib/ui/layout";
import PageLayout from "@/components/PageLayout";
import { normalizeApiError, type ApiError } from "@/lib/restapi";
import { cn } from "@/lib/utils";

/** 用户/组织主页（官方统一路径 /{login}，自动检测 user/org） */
export function UserProfilePage() {
  const { login = "" } = useParams();
  const { token } = useAuth();
  return <ProfileView key={login} login={login} token={token} />;
}

/** 组织主页重定向：官方 /orgs/{org} 302 → /{org}（统一路径） */
export function OrgProfileRedirect() {
  const { org = "" } = useParams();
  return <Navigate to={`/${org}`} replace />;
}

type ProfileTab = "repositories" | "stars" | "people";

/** 用户 Star 的仓库（Stars tab 懒加载数据） */
interface StarsData {
  totalCount: number;
  repos: import("@/lib/api").Repository[];
}

function ProfileView({ login, token }: { login: string; token: string | null }) {
  const { t } = useI18n();
  const { user: me, canWrite } = useAuth();
  const [kind, setKind] = useState<"user" | "org" | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<ProfileTab>("repositories");
  // Stars/People 懒加载（切换 tab 时拉取）
  const [stars, setStars] = useState<StarsData | null>(null);
  const [people, setPeople] = useState<OrgMembersResult | null>(null);
  // 页码分页：Repositories 用 GraphQL 游标链（page 1 = data.repos，page>1 = fetchProfileReposSmart 游标续接）
  const [repoPage, setRepoPage] = useState(1);
  const [pageRepos, setPageRepos] = useState<import("@/lib/api").Repository[] | null>(null);
  // 游标链（cursors[p-1] = 第 p 页的 after 游标；[0]=null，[1]=data.reposEndCursor，链式补全）
  const repoCursorsRef = useRef<(string | null)[]>([null]);
  const [starPage, setStarPage] = useState(1);
  const [pageStars, setPageStars] = useState<import("@/lib/api").Repository[] | null>(null);
  // 关注状态（用户页；GraphQL viewerIsFollowing 直取，REST 降级 isFollowingSmart 兜底）
  const [following, setFollowingState] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  // 是否显示关注按钮：用户页 + 非本人 + 已登录 + 可写（user:follow）
  const canFollow = kind === "user" && Boolean(token && canWrite && me && me.login !== login);

  // 编辑按钮：本人查看（用户页）/ 可管理（组织页 viewerCanAdminister）
  const canEdit =
    kind === "user"
      ? Boolean(token && me && me.login === login)
      : Boolean(data?.viewerCanAdminister);

  // 私有仓库数 = 权限内总数 - 公开数（API 自动过滤；他人/匿名时 totalCount=公开数 → 0 不显示）
  const privateRepos = data ? Math.max(0, data.totalRepos - data.publicRepos) : 0;

  // tabs（用户：Repositories/Stars；组织：Repositories/People； 用户去概览）
  const tabOptions = useMemo<SegmentedOption<ProfileTab>[]>(() => {
    if (!data) return [];
    const common: SegmentedOption<ProfileTab>[] = [
      {
        value: "repositories",
        icon: FolderGit2,
        label: (
          <>
            {t("profile.tabRepositories")}{" "}
            <span className="text-muted-foreground">{data.totalRepos}</span>
          </>
        ),
      },
    ];
    if (kind === "user") {
      common.push({
        value: "stars",
        icon: Star,
        label: (
          <>
            {t("profile.tabStars")}{" "}
            {(data.starCount ?? stars?.totalCount) != null && (
              <span className="text-muted-foreground">{data.starCount ?? stars?.totalCount}</span>
            )}
          </>
        ),
      });
    } else if (data.viewerCanAdminister) {
      // 收敛：仅自己可管理的组织才显示 People tab（成员数据需 read:org 权限，第三方组织不请求）
      common.push({
        value: "people",
        icon: Users,
        label: (
          <>
            {t("profile.tabPeople")}{" "}
            {people && <span className="text-muted-foreground">{people.totalCount}</span>}
          </>
        ),
      });
    }
    return common;
  }, [data, kind, stars, people, t]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setKind(null);
    setFollowingState(null);
    setTab("repositories");
    setStars(null);
    setPeople(null);
    setRepoPage(1);
    setPageRepos(null);
    repoCursorsRef.current = [null];
    setStarPage(1);
    setPageStars(null);
    fetchProfileSmart(login, token)
      .then((res) => {
        if (cancelled) return;
        setKind(res.kind);
        setData(res.data);
        // 初始化游标链（第 1 页 after=null，第 2 页 after=第一页 endCursor）
        repoCursorsRef.current = [null, res.data.reposEndCursor];
        // 进入页面即并行拉取全部 tab 数据（用户要求：tabs 数量同步展示）
        // 用户页：Star 列表；组织页：成员列表
        if (res.kind === "user") {
          fetchUserStarsSmart(login, token)
            .then((s) => !cancelled && setStars(s))
            .catch(() => !cancelled && setStars({ totalCount: 0, repos: [] }));
          // 关注状态优先 GraphQL viewerIsFollowing；REST 降级（null）时单独查询
          if (res.data.viewerIsFollowing !== null) {
            setFollowingState(res.data.viewerIsFollowing);
          } else if (token && canWrite && me && me.login !== login) {
            isFollowingSmart(token, login)
              .then((f) => !cancelled && setFollowingState(f))
              .catch(() => !cancelled && setFollowingState(false));
          }
        } else if (res.data.viewerCanAdminister) {
          // 收敛：仅自己可管理的组织才请求成员列表（第三方组织成员数据需 read:org，不发无谓请求）
          fetchOrgMembersSmart(login, token)
            .then((m) => !cancelled && setPeople(m))
            .catch(() => !cancelled && setPeople({ members: [], totalCount: 0 }));
        } else {
          // 非自己管理组织：不请求成员数据，People tab 亦不显示
          setPeople({ members: [], totalCount: 0 });
        }
      })
      .catch((e: unknown) => !cancelled && setError(normalizeApiError(e)));
    return () => {
      cancelled = true;
    };
  }, [login, token, canWrite, me]);

  // Repositories 页码 >1 时 GraphQL 游标续接（匿名走 REST 降级）
  useEffect(() => {
    if (repoPage <= 1 || !kind || !data) return;
    let cancelled = false;
    setPageRepos(null);
    (async () => {
      try {
        // 链式补全游标到第 repoPage 页（游标分页跳页需顺序续接中间页）
        const cursors = repoCursorsRef.current;
        while (cursors.length <= repoPage - 1) {
          const after = cursors[cursors.length - 1];
          if (after == null) break; // 无更多页
          const res = await fetchProfileReposSmart(login, kind, after, token);
          cursors.push(res.endCursor);
          if (!res.hasNextPage) break;
        }
        const after = cursors[repoPage - 1];
        if (after == null) {
          if (!cancelled) setPageRepos([]);
          return;
        }
        const res = await fetchProfileReposSmart(login, kind, after, token);
        if (!cancelled) {
          setPageRepos(res.repos);
          if (cursors.length <= repoPage) cursors[repoPage] = res.endCursor;
        }
      } catch {
        if (!cancelled) setPageRepos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPage, kind, login, token, data]);

  // Stars 页码 >1 时独立拉取（走 REST）
  useEffect(() => {
    if (starPage <= 1) return;
    let cancelled = false;
    setPageStars(null);
    fetchUserStarsSmart(login, token, starPage)
      .then((s) => !cancelled && setPageStars(s.repos))
      .catch(() => !cancelled && setPageStars([]));
    return () => {
      cancelled = true;
    };
  }, [starPage, login, token]);

  const goRepoPage = (p: number) => {
    setRepoPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goStarPage = (p: number) => {
    setStarPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Repositories/Stars 分页总页数（org 仓库数 = totalRepos；用户公开数 = publicRepos；全站翻页上限 999 页）
  const repoTotalPages =
    data && kind
      ? Math.min(
          999,
          Math.max(1, Math.ceil((kind === "org" ? data.totalRepos : data.publicRepos) / 20)),
        )
      : 1;
  const starTotalPages =
    data && kind
      ? Math.min(999, Math.max(1, Math.ceil((data.starCount ?? stars?.totalCount ?? 0) / 20)))
      : 1;

  const toggleFollow = async () => {
    if (!token || followBusy || following === null) return;
    setFollowBusy(true);
    try {
      await setFollowingSmart(token, login, !following);
      setFollowingState(!following);
      setData((d) =>
        d ? { ...d, followers: Math.max(0, d.followers + (!following ? 1 : -1)) } : d,
      );
    } catch {
      /* 失败保持原状态 */
    } finally {
      setFollowBusy(false);
    }
  };

  // 用户/组织不存在（404）/限流/5xx 整页不可用 → 路由 errorElement 全局错误页
  if (error) throw error;
  if (!data || !kind) return null;

  return (
    // 布局规范：PAGE_SHELL（仅顶部 padding）+ 左资料卡（PageLayout E 型）
    <div className={PAGE_SHELL}>
      <PageLayout
        gap="lg"
        left={{
          node: data ? (
            <ProfileSidebar
              login={login}
              data={data}
              kind={kind}
              canEdit={canEdit}
              privateRepos={privateRepos}
              memberCount={people?.totalCount ?? 0}
              canFollow={canFollow}
              following={following}
              followBusy={followBusy}
              onToggleFollow={() => void toggleFollow()}
            />
          ) : (
            <SidebarSkeleton />
          ),
          width: 260,
          sticky: "nav",
        }}
      >
        {/* 右侧 tabs（官方 UnderlineNav 下划线高亮；text-lg 与内容标题同字号 用户要求） */}
        {tabOptions.length > 1 && (
          <div className="mb-4 flex items-end justify-between border-b">
            <div className="flex gap-1">
              {tabOptions.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-lg transition-colors",
                    tab === value
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Repositories：完整仓库列表（用户/组织默认 tab；页码分页） */}
        {tab === "repositories" && (
          <>
            {(() => {
              const repoList = repoPage === 1 ? data.repos : (pageRepos ?? []);
              const loadingPage = repoPage > 1 && pageRepos === null;
              if (loadingPage) {
                return (
                  <div className="flex flex-col gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-24 w-full" />
                    ))}
                  </div>
                );
              }
              return repoList.length > 0 ? (
                <>
                  <div className="flex flex-col gap-3">
                    {repoList.map((r) => (
                      <RepositoryCard key={r.full_name} repo={r} />
                    ))}
                  </div>
                  {repoTotalPages > 1 && (
                    <Pager page={repoPage} totalPages={repoTotalPages} onChange={goRepoPage} />
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    {t("profile.noRepos").replace(
                      "{kind}",
                      t(kind === "org" ? "profile.kindOrg" : "profile.kindUser"),
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </>
        )}

        {/* Stars（用户页）：Star 的仓库列表（数量已随主页查询，列表懒加载；页码分页） */}
        {tab === "stars" && (
          <>
            {stars ? (
              (() => {
                const starList = starPage === 1 ? stars.repos : (pageStars ?? []);
                const loadingPage = starPage > 1 && pageStars === null;
                if (loadingPage) {
                  return (
                    <div className="flex flex-col gap-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full" />
                      ))}
                    </div>
                  );
                }
                return starList.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-3">
                      {starList.map((r) => (
                        <RepositoryCard key={r.full_name} repo={r} />
                      ))}
                    </div>
                    {starTotalPages > 1 && (
                      <Pager page={starPage} totalPages={starTotalPages} onChange={goStarPage} />
                    )}
                  </>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      {t("profile.noStars")}
                    </CardContent>
                  </Card>
                );
              })()
            ) : (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            )}
          </>
        )}

        {/* People（组织页）：成员列表（仅自己可管理组织显示，见 tabOptions 收敛） */}
        {tab === "people" && (
          <>
            {people ? (
              people.members.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {people.members.map((m) => (
                    <Link
                      key={m.login}
                      to={`/${m.login}`}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={m.avatar_url} alt={m.login} />
                        <AvatarFallback>{m.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{m.login}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    {t("profile.noMembers")}
                  </CardContent>
                </Card>
              )
            ) : (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            )}
          </>
        )}
      </PageLayout>
    </div>
  );
}

/** 左侧资料卡（官方对齐：大头像 + 状态 + 名字/代词 + Edit/Follow + bio + 对齐信息 + 统计 + 组织） */
function ProfileSidebar({
  login,
  data,
  kind,
  canEdit,
  privateRepos,
  memberCount,
  canFollow,
  following,
  followBusy,
  onToggleFollow,
}: {
  login: string;
  data: ProfileData;
  kind: "user" | "org";
  canEdit: boolean;
  privateRepos: number;
  memberCount: number;
  canFollow: boolean;
  following: boolean | null;
  followBusy: boolean;
  onToggleFollow: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {/* 大头像（官方 profile 方形圆角；Avatar 默认圆形 → rounded-lg 覆盖） */}
      <Avatar className="size-full w-full rounded-lg">
        <AvatarImage src={data.avatarUrl ?? undefined} alt={data.login} />
        <AvatarFallback>{data.login.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      {/* 状态徽章（GraphQL status；emoji + message） */}
      {data.status && (
        <div className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-sm">
          <span className="shrink-0">{data.status.emoji}</span>
          {data.status.message && <span className="truncate">{data.status.message}</span>}
        </div>
      )}

      {/* 名字 + @login + 代词 */}
      <div>
        <h1 className="text-xl font-semibold leading-tight">{data.name || data.login}</h1>
        <p className="text-muted-foreground">
          {data.login}
          {data.pronouns ? ` · ${data.pronouns}` : ""}
        </p>
      </div>

      {/* 编辑按钮（官方 js-profile-editable-edit-button：本人/组织可管理，全宽 outline） */}
      {canEdit && (
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link
            to={kind === "user" ? "/settings/profile" : `/organizations/${login}/settings/profile`}
          >
            {t(kind === "user" ? "profile.editProfile" : "profile.editOrgProfile")}
          </Link>
        </Button>
      )}

      {/* 关注/取关按钮（用户页 + 非本人 + 可写；全宽） */}
      {canFollow && (
        <Button
          variant={following ? "default" : "outline"}
          size="sm"
          className="w-full gap-1.5"
          disabled={followBusy || following === null}
          onClick={onToggleFollow}
        >
          {following ? <UserCheck className="size-3.5" /> : <UserPlus className="size-3.5" />}
          {t(following ? "profile.following" : "profile.follow")}
        </Button>
      )}

      {data.bio && <p className="text-sm">{data.bio}</p>}

      {/* 对齐信息（公司/位置/网站） */}
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {data.company && kind === "user" && (
          <span className="flex items-center gap-1.5">
            <Building2 className="size-3.5 shrink-0" /> {data.company}
          </span>
        )}
        {data.location && (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" /> {data.location}
          </span>
        )}
        {data.websiteUrl && (
          <span className="flex items-center gap-1.5 truncate">
            <Globe className="size-3.5 shrink-0" />
            <a
              href={data.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-primary hover:underline"
            >
              {data.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          </span>
        )}
      </div>

      {/* 统计区（border-top 官方风格；权限感知） */}
      <div className="flex flex-col gap-1.5 border-t pt-3 text-sm text-muted-foreground">
        {/* 用户：followers · following；组织：成员数 */}
        {kind === "user" ? (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              <span className="font-medium text-foreground">{data.followers}</span>
              {t("profile.followers")}
            </span>
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground">{data.following}</span>
              {t("profile.followingCount")}
            </span>
          </span>
        ) : memberCount > 0 ? (
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            <span className="font-medium text-foreground">{memberCount}</span>
            {t("profile.membersCount")}
          </span>
        ) : null}
        {/* 仓库数：公开（恒显）+ 私有（仅权限内有私有时显示——API 自动处置差异） */}
        <span className="flex items-center gap-1.5">
          <FolderGit2 className="size-3.5 shrink-0" />
          {t("profile.publicRepos")}
          <span className="font-medium text-foreground">{data.publicRepos}</span>
          {t("profile.reposCount")}
        </span>
        {privateRepos > 0 && (
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0" />
            {t("profile.privateRepos")}
            <span className="font-medium text-foreground">{privateRepos}</span>
            {t("profile.reposCount")}
          </span>
        )}
      </div>

      {/* 加入的组织（仅用户页；GraphQL organizations） */}
      {kind === "user" && data.organizations.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h2 className="text-sm font-semibold">{t("profile.orgs")}</h2>
          <div className="flex flex-wrap gap-2">
            {data.organizations.map((o) => (
              <Link
                key={o.login}
                to={`/${o.login}`}
                title={o.login}
                className="transition-opacity hover:opacity-75"
              >
                <Avatar className="size-8 rounded-md">
                  <AvatarImage src={o.avatarUrl ?? undefined} alt={o.login} />
                  <AvatarFallback>{o.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 左侧资料卡加载骨架 */
function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
