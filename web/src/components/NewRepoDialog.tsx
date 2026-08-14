/**
 * topbar Create new 菜单（复刻官方 Create new... 下拉）
 *
 * - CreateNewMenu：topbar「+」→ DropdownMenu（New repository / New gist / New issue / New pull request）
 *   新建仓库跳转整页 /new；新建 Issue/PR 先选目标仓库再跳转对应 /new 整页。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FileCode2, CircleDot, GitPullRequest, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { fetchMyReposSmart, type Repository } from "@/lib/api";
import { WriteGate } from "@/components/WriteGate";

/** topbar「+」Create new 下拉（复刻官方 Create new...） */
export function CreateNewMenu() {
  const { token, user, login, canWrite } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<"issue" | "pull">("issue");
  const [repos, setRepos] = useState<Repository[] | null>(null);

  // 打开仓库选择器时加载可写仓库（自己 + 组织）
  const openPicker = (kind: "issue" | "pull") => {
    setPickerKind(kind);
    setPickerOpen(true);
    if (token && repos === null) {
      fetchMyReposSmart(token)
        .then((r) =>
          setRepos(r.repos.filter((x) => x.owner.login === user?.login || !x.private || canWrite)),
        )
        .catch(() => setRepos([]));
    }
  };

  // 未登录：+ 按钮直接触发登录（写操作 → 完全控制）
  if (!token) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => login({ mode: "write" })}
        title={t("nav.new.title")}
      >
        <Plus className="size-4" />
      </Button>
    );
  }

  return (
    <>
      <WriteGate className="inline-flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={canWrite ? t("nav.new") : t("nav.new.readonly")}
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* min-w-40 兜底：默认 128px 会让「新建 Pull Request / New pull request」换行 */}
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuLabel>{t("create.label")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => navigate("/new")}>
              <Plus className="size-4" />
              {t("create.repo")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/gist/new")}>
              <FileCode2 className="size-4" />
              {t("create.gist")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openPicker("issue")}>
              <CircleDot className="size-4" />
              {t("create.issue")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPicker("pull")}>
              <GitPullRequest className="size-4" />
              {t("create.pr")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </WriteGate>

      {/* 仓库选择器：Issue/PR 需目标仓库 → 跳转 /new 整页 */}
      <RepoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        kind={pickerKind}
        repos={repos}
      />
    </>
  );
}

/** 仓库选择器（Issue/PR 发起时选目标仓库 → 跳转对应 /new 整页） */
function RepoPickerDialog({
  open,
  onOpenChange,
  kind,
  repos,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "issue" | "pull";
  repos: Repository[] | null;
}) {
  const navigate = useNavigate();
  const { token } = useAuth();

  const pick = (r: Repository) => {
    onOpenChange(false);
    const page = kind === "issue" ? "issues" : "pulls";
    navigate(`/${r.owner.login}/${r.name}/${page}/new`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建{kind === "issue" ? " Issue" : " Pull Request"}</DialogTitle>
          <DialogDescription>选择目标仓库</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-2">
          {repos === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载仓库中…</p>
          ) : repos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {token ? "暂无可写仓库" : "请先登录"}
            </p>
          ) : (
            repos.map((r) => (
              <button
                key={r.full_name}
                type="button"
                onClick={() => pick(r)}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.full_name}</span>
                {r.private && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
