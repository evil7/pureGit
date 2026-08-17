/**
 * issue 详情侧栏底部管理操作组（锁定 / 置顶 / 转移 / 删除）
 *
 * 官方 issue 侧栏底部（github.com）：分割线下方依次为锁定对话、置顶、转移、删除，
 * 均按权限门控（锁定需 TRIAGE+ 或作者；置顶需 ADMIN+公开仓库；转移/删除需 ADMIN）。
 * 删除为危险操作（AlertDialog 二次确认）；转移需输入目标仓库（Dialog + owner/repo 校验）。
 * 数据走 smart 层（GraphQL 唯一主通道 + REST 熔断降级；置顶/转移为 GraphQL-only）。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightLeft, Lock, LockOpen, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import {
  setIssueLockedSmart,
  deleteIssueSmart,
  setIssuePinnedSmart,
  transferIssueSmart,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/restapi";
import { toastSuccess, toastError } from "@/lib/ui/toast";

/** 目标仓库 owner/repo 校验（GitHub 仓库名允许字母数字与 . _ -） */
const TARGET_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function IssueSidebarActions({
  owner,
  repo,
  number,
  authorLogin,
  locked,
  isPinned,
  isPublicRepo,
  onLockedChange,
  onPinnedChange,
}: {
  owner: string;
  repo: string;
  number: number;
  authorLogin: string;
  locked: boolean;
  isPinned: boolean;
  /** 置顶仅公开仓库可用（GitHub pinIssue 限制） */
  isPublicRepo: boolean;
  onLockedChange: (locked: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
}) {
  const { token, user, canWrite } = useAuth();
  const { canCollaborate, canAdmin } = useRepoPermission();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [lockBusy, setLockBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  // 未登录不渲染管理操作组
  if (!token) return null;

  // 权限门槛（令牌级写 scope 与仓库级权限双门槛）
  const canLock = canWrite && (canCollaborate || user?.login === authorLogin);
  const canPin = canWrite && canAdmin && isPublicRepo;
  const canAdminAction = canWrite && canAdmin;

  const toggleLock = async () => {
    setLockBusy(true);
    try {
      await setIssueLockedSmart(owner, repo, number, !locked, token);
      onLockedChange(!locked);
      toastSuccess(locked ? t("issueDetail.unlocked") : t("issueDetail.locked"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.lockFailed")));
    } finally {
      setLockBusy(false);
    }
  };

  const togglePin = async () => {
    setPinBusy(true);
    try {
      await setIssuePinnedSmart(owner, repo, number, !isPinned, token);
      onPinnedChange(!isPinned);
      toastSuccess(isPinned ? t("issueDetail.unpinned") : t("issueDetail.pinned"));
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.pinFailed")));
    } finally {
      setPinBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleteBusy(true);
    try {
      await deleteIssueSmart(owner, repo, number, token);
      toastSuccess(t("issueDetail.deleted"));
      navigate(`/${owner}/${repo}/issues`);
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.deleteFailed")));
      setConfirmDelete(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const doTransfer = async () => {
    const target = transferTarget.trim();
    if (!TARGET_REPO_RE.test(target)) {
      toastError(t("issueDetail.transferInvalid"));
      return;
    }
    const [targetOwner, targetName] = target.split("/");
    setTransferBusy(true);
    try {
      await transferIssueSmart(owner, repo, number, targetOwner, targetName, token);
      toastSuccess(t("issueDetail.transferred"));
      setTransferOpen(false);
      navigate(`/${owner}/${repo}/issues`);
    } catch (e) {
      toastError(apiErrorMessage(e, t("issueDetail.transferFailed")));
    } finally {
      setTransferBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      {/* 锁定对话：TRIAGE+ 或作者 */}
      {canLock && (
        <Button
          variant="ghost"
          className="w-full justify-start px-2 text-muted-foreground"
          onClick={toggleLock}
          disabled={lockBusy}
        >
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          {locked ? t("issueDetail.unlockConversation") : t("issueDetail.lockConversation")}
        </Button>
      )}

      {/* 置顶：ADMIN + 公开仓库 */}
      {canPin && (
        <Button
          variant="ghost"
          className="w-full justify-start px-2 text-muted-foreground"
          onClick={togglePin}
          disabled={pinBusy}
        >
          {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {isPinned ? t("issueDetail.unpin") : t("issueDetail.pin")}
        </Button>
      )}

      {/* 转移：ADMIN（Dialog 输入目标仓库） */}
      {canAdminAction && (
        <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" className="w-full justify-start px-2 text-muted-foreground">
              <ArrowRightLeft className="size-3.5" />
              {t("issueDetail.transfer")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("issueDetail.transferTitle")}</DialogTitle>
              <DialogDescription>{t("issueDetail.transferDesc")}</DialogDescription>
            </DialogHeader>
            <Input
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              placeholder={t("issueDetail.transferPlaceholder")}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransferOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={doTransfer} disabled={transferBusy}>
                {t("issueDetail.transferConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 删除：ADMIN（AlertDialog 二次确认，danger） */}
      {canAdminAction && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start px-2 text-destructive hover:text-destructive"
              disabled={deleteBusy}
            >
              <Trash2 className="size-3.5" />
              {t("issueDetail.delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("issueDetail.deleteConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("issueDetail.deleteConfirmDesc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={doDelete}
                disabled={deleteBusy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("issueDetail.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
