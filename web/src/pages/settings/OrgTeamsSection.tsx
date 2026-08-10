/**
 * 组织设置 —— 团队管理板块（增补，官方 Teams 页）
 *
 * - 列表：GET /orgs/{org}/teams（read:org）
 * - 创建：POST /orgs/{org}/teams（admin:org）
 * - 编辑/删除：PATCH/DELETE /orgs/{org}/teams/{slug}（owner 或 team maintainer）
 * - 团队成员：GET .../members + PUT/DELETE .../memberships/{username}
 * 全部固定 REST（GraphQL 无团队查询/mutation 等价，见 api-compat.md）。
 */
import { useEffect, useRef, useState } from "react";
import { PencilLine, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";
import {
  fetchOrgTeams,
  createOrgTeam,
  updateOrgTeam,
  deleteOrgTeam,
  fetchTeamMembers,
  addTeamMember,
  removeTeamMember,
  apiErrorMessage,
  type OrgTeam,
} from "@/lib/api";
import type { OrgMember } from "@/lib/rest";

export function OrgTeamsSection({ org, token }: { org: string; token: string }) {
  const { t } = useI18n();
  const [teams, setTeams] = useState<OrgTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 新建表单展开
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  // 编辑目标
  const [editing, setEditing] = useState<OrgTeam | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  // 删除目标（确认框）
  const [deleteTarget, setDeleteTarget] = useState<OrgTeam | null>(null);
  // 团队展开成员
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, OrgMember[]>>({});
  const [memberBusy, setMemberBusy] = useState(false);
  const [addUser, setAddUser] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = () => {
    fetchOrgTeams(org, token)
      .then((list) => mountedRef.current && setTeams(list))
      .catch(
        (e: unknown) => mountedRef.current && setError(e instanceof Error ? e.message : String(e)),
      );
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, token]);

  const doCreate = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createOrgTeam(org, token, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("orgTeams.createFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doUpdate = async () => {
    if (busy || !editing || !editName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateOrgTeam(org, editing.slug, token, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("orgTeams.updateFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (busy || !deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrgTeam(org, deleteTarget.slug, token);
      setDeleteTarget(null);
      setExpanded((s) => (s === deleteTarget.slug ? null : s));
      load();
    } catch (e) {
      setError(apiErrorMessage(e, t("orgTeams.deleteFailed")));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = async (slug: string) => {
    if (expanded === slug) {
      setExpanded(null);
      return;
    }
    setExpanded(slug);
    setAddUser("");
    if (!members[slug]) {
      setMemberBusy(true);
      try {
        const list = await fetchTeamMembers(org, slug, token);
        if (mountedRef.current) {
          setMembers((prev) => ({ ...prev, [slug]: list }));
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(apiErrorMessage(e, t("orgTeams.membersLoadFailed")));
        }
      } finally {
        setMemberBusy(false);
      }
    }
  };

  const doAddMember = async (slug: string) => {
    if (memberBusy || !addUser.trim()) return;
    setMemberBusy(true);
    setError(null);
    try {
      await addTeamMember(org, slug, addUser.trim(), token);
      setAddUser("");
      const list = await fetchTeamMembers(org, slug, token);
      if (mountedRef.current) {
        setMembers((prev) => ({ ...prev, [slug]: list }));
      }
    } catch (e) {
      setError(apiErrorMessage(e, t("orgTeams.addMemberFailed")));
    } finally {
      setMemberBusy(false);
    }
  };

  const doRemoveMember = async (slug: string, username: string) => {
    if (memberBusy) return;
    setMemberBusy(true);
    setError(null);
    try {
      await removeTeamMember(org, slug, username, token);
      setMembers((prev) => ({
        ...prev,
        [slug]: (prev[slug] ?? []).filter((m) => m.login !== username),
      }));
    } catch (e) {
      setError(apiErrorMessage(e, t("orgTeams.removeMemberFailed")));
    } finally {
      setMemberBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {t("orgTeams.title")}
            {teams !== null && (
              <Badge variant="secondary" className="ml-2 align-middle">
                {teams.length}
              </Badge>
            )}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setShowCreate((v) => !v);
            if (showCreate) {
              setNewName("");
              setNewDesc("");
            }
          }}
        >
          <Plus className="size-4" />
          {t("common.add")}
        </Button>
      </div>

      {error && <InlineError message={error} size="sm" />}

      {/* 新建团队表单（标题行按钮展开） */}
      {showCreate && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <Label htmlFor="team-name" className="mb-1.5 block">
              {t("orgTeams.name")}
            </Label>
            <Input
              id="team-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("orgTeams.namePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="team-desc" className="mb-1.5 block">
              {t("orgTeams.desc")}
            </Label>
            <Input
              id="team-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t("orgTeams.descPlaceholder")}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void doCreate()} disabled={busy || !newName.trim()}>
              {t("orgTeams.create")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setNewDesc("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* 团队列表 */}
      <div className="flex flex-col divide-y rounded-lg border">
        {teams === null ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("orgTeams.empty")}</p>
        ) : (
          teams.map((team) => (
            <div key={team.id} className="divide-y">
              {/* 团队行 */}
              <div className="flex items-center gap-2 px-4 py-3">
                <Users className="size-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void toggleExpand(team.slug)}
                >
                  <p className="truncate text-sm font-medium">
                    {team.name}
                    {team.members_count !== undefined && (
                      <span className="text-muted-foreground"> · {team.members_count}</span>
                    )}
                  </p>
                  {team.description && (
                    <p className="truncate text-xs text-muted-foreground">{team.description}</p>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t("orgTeams.edit")}
                  onClick={() => {
                    setEditing(team);
                    setEditName(team.name);
                    setEditDesc(team.description ?? "");
                  }}
                >
                  <PencilLine className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  title={t("orgTeams.delete")}
                  onClick={() => setDeleteTarget(team)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              {/* 展开：成员管理 */}
              {expanded === team.slug && (
                <div className="flex flex-col gap-3 bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={addUser}
                      onChange={(e) => setAddUser(e.target.value)}
                      placeholder={t("orgTeams.addMemberPlaceholder")}
                      className="h-7 max-w-64 text-sm"
                      onKeyDown={(e) => e.key === "Enter" && void doAddMember(team.slug)}
                    />
                    <Button
                      size="sm"
                      className="h-7"
                      disabled={memberBusy || !addUser.trim()}
                      onClick={() => void doAddMember(team.slug)}
                    >
                      <UserPlus className="size-3.5" />
                      {t("orgTeams.addMember")}
                    </Button>
                  </div>
                  <div className="flex flex-col divide-y rounded-md border bg-background">
                    {members[team.slug] === undefined ? (
                      <div className="flex flex-col gap-2 p-3">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <Skeleton key={i} className="h-6 w-full" />
                        ))}
                      </div>
                    ) : members[team.slug].length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {t("orgTeams.membersEmpty")}
                      </p>
                    ) : (
                      members[team.slug].map((m) => (
                        <div key={m.login} className="flex items-center gap-2 px-3 py-2">
                          <Avatar className="size-6">
                            <AvatarImage src={m.avatar_url} alt={m.login} />
                            <AvatarFallback>{m.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-sm">@{m.login}</span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            title={t("orgTeams.removeMember")}
                            disabled={memberBusy}
                            onClick={() => void doRemoveMember(team.slug, m.login)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 编辑团队对话框 */}
      <AlertDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orgTeams.editTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("orgTeams.editDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="team-edit-name" className="mb-1.5 block">
                {t("orgTeams.name")}
              </Label>
              <Input
                id="team-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="team-edit-desc" className="mb-1.5 block">
                {t("orgTeams.desc")}
              </Label>
              <Input
                id="team-edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !editName.trim()}
              onClick={(e) => {
                e.preventDefault();
                void doUpdate();
              }}
            >
              {t("orgTeams.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除团队确认框 */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orgTeams.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("orgTeams.deleteDesc").replace("{name}", deleteTarget?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
            >
              {t("orgTeams.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
