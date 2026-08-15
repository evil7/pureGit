/**
 * Project 详情页（/:owner/:repo/projects/:number，官方 /orgs/{org}/projects/{n} 站内化）
 *
 * 看板视图（Board layout）：按 Status 单选框字段分列，卡片 = issue/PR/draft 标题 + 编号。
 * 现代化操作：@dnd-kit 拖拽——
 *   - 跨列拖拽 = 更新 Status 字段值（updateProjectV2ItemFieldValue）
 *   - 同列排序 = 更新 item 位置（updateProjectV2ItemPosition）
 * 乐观更新 + mutation 失败回滚（重新拉取）。
 * 权限：viewerCanUpdate（project 写权限）控制是否可拖拽；只读访客仅浏览。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  CircleDot,
  GitPullRequest,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Archive,
  ArchiveRestore,
  Lock,
  Unlock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchProjectV2DetailSmart,
  fetchProjectV2ItemsSmart,
  updateProjectV2ItemFieldValueSmart,
  updateProjectV2ItemPositionSmart,
  updateProjectV2Smart,
  deleteProjectV2Smart,
  addProjectV2DraftIssueSmart,
  addProjectV2ItemByIdSmart,
  deleteProjectV2ItemSmart,
  resolveIssuePrNodeId,
  updateProjectV2FieldSmart,
  createProjectV2FieldSmart,
  deleteProjectV2FieldSmart,
  updateProjectV2ItemFieldValueGenericSmart,
  type ProjectV2Column,
  type ProjectV2Card,
  type ProjectV2Detail,
  type ProjectV2OptionPatch,
  type ProjectV2FieldDef,
  type ProjectV2FieldValue,
  type ProjectV2ItemFieldPatch,
} from "@/lib/api";
import { LoginPrompt } from "@/components/LoginPrompt";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { MarkdownView } from "@/components/MarkdownView";
import { toastSuccess, toastError } from "@/lib/ui/toast";
import { cn } from "@/lib/utils";

/** 列颜色枚举 → CSS 色值（看板列头圆点 / 卡片状态标） */
const OPTION_COLOR: Record<string, string> = {
  GRAY: "#6b7280",
  BLUE: "#3b82f6",
  GREEN: "#22c55e",
  YELLOW: "#eab308",
  ORANGE: "#f97316",
  RED: "#ef4444",
  PINK: "#ec4899",
  PURPLE: "#a855f7",
};

/** 颜色枚举名列表（官方固定 8 色，顺序即显示顺序） */
const OPTION_COLOR_KEYS = Object.keys(OPTION_COLOR);

/** 字段（列）选项编辑草稿：id 保留已有选项身份（新增为 null） */
interface FieldOptionDraft {
  id: string | null;
  name: string;
  color: string;
  description: string;
}

/** 应用字段值补丁到卡片（本地乐观更新；fieldId 为 status 时同步 statusOptionId） */
function applyFieldPatch(
  card: ProjectV2Card,
  fieldId: string,
  patch: ProjectV2ItemFieldPatch,
  statusFieldId: string | null,
): ProjectV2Card {
  const existing = card.fieldValues.find((fv) => fv.fieldId === fieldId);
  const base: ProjectV2FieldValue = existing ?? {
    fieldId,
    text: null,
    number: null,
    date: null,
    optionId: null,
    optionIds: [],
    iterationId: null,
    iterationTitle: null,
  };
  const updated: ProjectV2FieldValue = {
    ...base,
    text: patch.text !== undefined ? patch.text : base.text,
    number: patch.number !== undefined ? patch.number : base.number,
    date: patch.date !== undefined ? patch.date : base.date,
    optionId: patch.singleSelectOptionId !== undefined ? patch.singleSelectOptionId : base.optionId,
    optionIds:
      patch.multiSelectOptionIds !== undefined
        ? (patch.multiSelectOptionIds ?? [])
        : base.optionIds,
    iterationId: patch.iterationId !== undefined ? patch.iterationId : base.iterationId,
  };
  const fieldValues = existing
    ? card.fieldValues.map((fv) => (fv.fieldId === fieldId ? updated : fv))
    : [...card.fieldValues, updated];
  return {
    ...card,
    fieldValues,
    statusOptionId: fieldId === statusFieldId ? updated.optionId : card.statusOptionId,
  };
}

/** 解析「添加 issue/PR」输入：`#123` / `123`（当前仓库）或完整 URL；未识别返回 null */
function parseIssueRef(input: string, fallbackOwner: string, fallbackRepo: string) {
  const s = input.trim();
  if (!s) return null;
  // 完整 URL：https://github.com/{owner}/{repo}/issues|pull/{number}
  const url = s.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  // #number 或纯数字 → 当前仓库
  const num = s.match(/^#?(\d+)$/);
  if (num) return { owner: fallbackOwner, repo: fallbackRepo, number: Number(num[1]) };
  return null;
}

export default function ProjectDetailPage() {
  const { owner = "", repo = "", number = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProjectV2Detail | null>(null);
  const [columns, setColumns] = useState<ProjectV2Column[]>([]);
  const [orphans, setOrphans] = useState<ProjectV2Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<ProjectV2Card | null>(null);
  // 分页
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 管理 dialog 状态
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editReadme, setEditReadme] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Add item dialog 状态
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"draft" | "item">("draft");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [itemRef, setItemRef] = useState("");
  // 待删除 item（卡片删除确认）
  const [deleteItem, setDeleteItem] = useState<ProjectV2Card | null>(null);
  // 卡片详情抽屉（点击卡片打开）
  const [detailItem, setDetailItem] = useState<ProjectV2Card | null>(null);
  // 字段（列）管理 dialog 状态
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldOptions, setFieldOptions] = useState<FieldOptionDraft[]>([]);
  // 新建字段（列）dialog 状态
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldOptions, setNewFieldOptions] = useState<FieldOptionDraft[]>([
    { id: null, name: "", color: "GRAY", description: "" },
  ]);
  // 删除字段（列）确认
  const [deleteFieldOpen, setDeleteFieldOpen] = useState(false);

  // 最新列快照（拖拽事件处理器内同步读，避免 React 异步 state 滞后）
  const columnsRef = useRef<ProjectV2Column[]>([]);
  columnsRef.current = columns;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchProjectV2DetailSmart(owner, Number(number), token);
      setDetail(d);
      setColumns(d.columns);
      setOrphans(d.orphans);
      setEndCursor(d.endCursor);
      setHasMore(d.hasNextItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, number, token]);

  const canEdit = Boolean(detail?.viewerCanUpdate) && Boolean(token);

  /** 分页续接更多 items */
  const loadMore = async () => {
    if (!token || !endCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchProjectV2ItemsSmart(
        owner,
        Number(number),
        endCursor,
        detail?.statusFieldId ?? null,
        token,
      );
      // 分列合并到现有 columns / orphans
      const colIndex = new Map(columnsRef.current.map((c, i) => [c.optionId, i]));
      const nextColumns = columnsRef.current.map((c) => ({ ...c, items: [...c.items] }));
      const nextOrphans = [...orphans];
      for (const card of r.cards) {
        const idx = card.statusOptionId ? colIndex.get(card.statusOptionId) : undefined;
        if (idx !== undefined) nextColumns[idx].items.push(card);
        else nextOrphans.push(card);
      }
      setColumns(nextColumns);
      setOrphans(nextOrphans);
      setEndCursor(r.endCursor);
      setHasMore(r.hasNextPage);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t("projects.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  /** 编辑 project（标题 + 描述 + readme） */
  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !detail || busy) return;
    setBusy(true);
    try {
      await updateProjectV2Smart(
        detail.projectId,
        {
          title: editTitle.trim(),
          shortDescription: editDesc.trim() || null,
          readme: editReadme.trim() || null,
        },
        token,
      );
      toastSuccess(t("projects.saved"));
      setEditOpen(false);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 关闭/重开 project */
  const toggleClosed = async () => {
    if (!token || !detail || busy) return;
    setBusy(true);
    try {
      await updateProjectV2Smart(detail.projectId, { closed: !detail.closed }, token);
      toastSuccess(detail.closed ? t("projects.reopened") : t("projects.closed2"));
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 切换 public/private（设为私有/公开） */
  const togglePublic = async () => {
    if (!token || !detail || busy) return;
    setBusy(true);
    try {
      await updateProjectV2Smart(detail.projectId, { public: !detail.public }, token);
      toastSuccess(detail.public ? t("projects.madePrivate") : t("projects.madePublic"));
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 删除 project */
  const confirmDelete = async () => {
    if (!token || !detail || busy) return;
    setBusy(true);
    try {
      await deleteProjectV2Smart(detail.projectId, token);
      toastSuccess(t("projects.deleted"));
      navigate(`/${owner}/${repo}/projects`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.deleteFailed"));
      setBusy(false);
    }
  };

  /** 添加 item（draft 或现有 issue/PR） */
  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !detail || busy) return;
    setBusy(true);
    try {
      if (addMode === "draft") {
        await addProjectV2DraftIssueSmart(
          detail.projectId,
          draftTitle.trim(),
          draftBody.trim(),
          token,
        );
      } else {
        const ref = parseIssueRef(itemRef, owner, repo);
        if (!ref) {
          toastError(t("projects.itemInvalid"));
          return;
        }
        const nodeId = await resolveIssuePrNodeId(ref.owner, ref.repo, ref.number, token);
        if (!nodeId) {
          toastError(t("projects.itemNotFound"));
          return;
        }
        await addProjectV2ItemByIdSmart(detail.projectId, nodeId, token);
      }
      toastSuccess(t("projects.itemAdded"));
      setAddOpen(false);
      setDraftTitle("");
      setDraftBody("");
      setItemRef("");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.itemAddFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 删除单个 item（卡片） */
  const confirmDeleteItem = async () => {
    if (!token || !detail || !deleteItem || busy) return;
    setBusy(true);
    try {
      await deleteProjectV2ItemSmart(detail.projectId, deleteItem.itemId, token);
      toastSuccess(t("projects.itemDeleted"));
      setDeleteItem(null);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.itemDeleteFailed"));
      setDeleteItem(null);
    } finally {
      setBusy(false);
    }
  };

  /** 保存抽屉内单个字段值（成功本地乐观更新；status 字段触发重新分列） */
  const saveFieldValue = async (fieldId: string, patch: ProjectV2ItemFieldPatch) => {
    if (!token || !detail || !detailItem) return;
    await updateProjectV2ItemFieldValueGenericSmart(
      detail.projectId,
      detailItem.itemId,
      fieldId,
      patch,
      token,
    );
    const statusId = detail.statusFieldId;
    if (fieldId === statusId && patch.singleSelectOptionId !== undefined) {
      // status 变化：从所有列移除该卡片，再插入新列/未分组
      const updated = applyFieldPatch(detailItem, fieldId, patch, statusId);
      const nextColumns = columns.map((c) => ({
        ...c,
        items: c.items.filter((it) => it.itemId !== detailItem.itemId),
      }));
      const targetId = patch.singleSelectOptionId ?? null;
      const idx = targetId ? nextColumns.findIndex((c) => c.optionId === targetId) : -1;
      if (idx >= 0) nextColumns[idx].items.push(updated);
      else setOrphans((prev) => [...prev.filter((it) => it.itemId !== detailItem.itemId), updated]);
      setColumns(nextColumns);
      setDetailItem(updated);
    } else {
      const apply = (c: ProjectV2Card) => applyFieldPatch(c, fieldId, patch, statusId);
      setDetailItem((prev) => (prev ? apply(prev) : prev));
      setColumns((prev) => prev.map((c) => ({ ...c, items: c.items.map(apply) })));
      setOrphans((prev) => prev.map(apply));
    }
  };

  /** 打开字段（列）管理 dialog：用当前列初始化草稿 */
  const openFieldEditor = () => {
    if (!detail) return;
    setFieldName(detail.statusFieldName ?? "");
    setFieldOptions(
      detail.columns.map((c) => ({
        id: c.optionId,
        name: c.name,
        color: c.color,
        description: c.description,
      })),
    );
    setFieldOpen(true);
  };

  /** 提交字段（列）更新：改名 + 覆盖选项列表（增删/改名/改颜色/改描述） */
  const submitField = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !detail?.statusFieldId || busy) return;
    setBusy(true);
    try {
      const options: ProjectV2OptionPatch[] = fieldOptions.map((o) => ({
        id: o.id,
        name: o.name.trim(),
        color: o.color,
        description: o.description,
      }));
      await updateProjectV2FieldSmart(
        detail.statusFieldId,
        { name: fieldName.trim() || undefined, options },
        token,
      );
      toastSuccess(t("projects.fieldSaved"));
      setFieldOpen(false);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.fieldSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 打开新建字段（列）dialog：重置为单个空选项 */
  const openNewField = () => {
    setNewFieldName("");
    setNewFieldOptions([{ id: null, name: "", color: "GRAY", description: "" }]);
    setNewFieldOpen(true);
  };

  /** 提交新建字段（列）：单选框类型 + 至少一个非空选项 */
  const submitNewField = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !detail || busy) return;
    const options = newFieldOptions.filter((o) => o.name.trim());
    if (!newFieldName.trim() || options.length === 0) return;
    setBusy(true);
    try {
      await createProjectV2FieldSmart(
        detail.projectId,
        newFieldName.trim(),
        options.map((o) => ({
          name: o.name.trim(),
          color: o.color,
          description: o.description,
        })),
        token,
      );
      toastSuccess(t("projects.fieldCreated"));
      setNewFieldOpen(false);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.fieldSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 删除当前分组字段（列；不可恢复） */
  const confirmDeleteField = async () => {
    if (!token || !detail?.statusFieldId || busy) return;
    setBusy(true);
    try {
      await deleteProjectV2FieldSmart(detail.statusFieldId, token);
      toastSuccess(t("projects.fieldDeleted"));
      setDeleteFieldOpen(false);
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("projects.fieldDeleteFailed"));
      setDeleteFieldOpen(false);
    } finally {
      setBusy(false);
    }
  };

  /** 卡片定位：返回 [列索引, 卡片在列内索引] */
  const locate = (itemId: string, cols: ProjectV2Column[]): [number, number] | null => {
    for (let ci = 0; ci < cols.length; ci++) {
      const ii = cols[ci].items.findIndex((it) => it.itemId === itemId);
      if (ii !== -1) return [ci, ii];
    }
    return null;
  };

  /** 跨列拖拽（onDragOver 实时乐观移动，视觉即时反馈） */
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activePos = locate(String(active.id), columnsRef.current);
    if (!activePos) return;
    const [fromCol, fromIdx] = activePos;

    // over 可能是卡片（同/跨列排序）或列容器（拖到空列）
    const overCardPos = locate(String(over.id), columnsRef.current);
    const overCol = overCardPos
      ? overCardPos[0]
      : columnsRef.current.findIndex((c) => c.optionId === over.id);

    if (overCol === -1 || overCol === fromCol) return;

    // 跨列：从源列移除，插入目标列（over 卡片前 / 空列末尾）
    setColumns((prev) => {
      const next = prev.map((c) => ({ ...c, items: [...c.items] }));
      const card = next[fromCol].items.splice(fromIdx, 1)[0];
      if (!card) return prev;
      const insertIdx = overCardPos ? overCardPos[1] : next[overCol].items.length;
      next[overCol].items.splice(insertIdx, 0, card);
      return next;
    });
  };

  /** 提交字段值更新（跨列换列） */
  const commitFieldValue = async (card: ProjectV2Card, optionId: string | null) => {
    if (!token || !detail?.statusFieldId) return;
    try {
      await updateProjectV2ItemFieldValueSmart(
        detail.projectId,
        card.itemId,
        detail.statusFieldId,
        optionId,
        token,
      );
    } catch (e) {
      toastError(e instanceof Error ? e.message : t("projects.moveFailed"));
      await load(); // 回滚
    }
  };

  /** 提交位置更新（同列排序） */
  const commitPosition = async (card: ProjectV2Card, afterId: string | null) => {
    if (!token || !detail) return;
    try {
      await updateProjectV2ItemPositionSmart(detail.projectId, card.itemId, afterId, token);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t("projects.moveFailed"));
      await load(); // 回滚
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const card = columnsRef.current
      .flatMap((c) => c.items)
      .find((it) => it.itemId === String(e.active.id));
    setActiveCard(card ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveCard(null);
    if (!over) return;
    const card =
      activeCard ??
      columnsRef.current.flatMap((c) => c.items).find((it) => it.itemId === String(active.id));
    if (!card) return;

    const activePos = locate(String(active.id), columnsRef.current);
    if (!activePos) return;
    const [fromCol] = activePos;

    const overCardPos = locate(String(over.id), columnsRef.current);
    const overCol = overCardPos
      ? overCardPos[0]
      : columnsRef.current.findIndex((c) => c.optionId === over.id);
    if (overCol === -1) return;

    if (overCol !== fromCol) {
      // 跨列 → 更新字段值
      void commitFieldValue(card, columnsRef.current[overCol].optionId);
    } else {
      // 同列排序 → 更新位置（afterId = 当前前一项）
      const finalIdx = overCardPos ? overCardPos[1] : 0;
      const afterId = finalIdx > 0 ? columnsRef.current[fromCol].items[finalIdx - 1].itemId : null;
      void commitPosition(card, afterId);
    }
  };

  if (!token) {
    return <LoginPrompt title={t("projects.loginTitle")} />;
  }

  return (
    <div className="space-y-4">
      {/* 头部：返回 + 标题 + 描述 + 管理操作 */}
      <header className="space-y-2">
        <div>
          <ButtonBack owner={owner} repo={repo} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold wrap-break-word">{detail?.title ?? ""}</h1>
          {detail && (
            <Badge
              variant={detail.closed ? "secondary" : "default"}
              className={cn("text-xs", !detail.closed && "bg-emerald-600")}
            >
              {detail.closed ? t("projects.closed") : t("projects.open")}
            </Badge>
          )}
          {canEdit && (
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                {t("projects.addItem")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("projects.more")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditTitle(detail?.title ?? "");
                      setEditDesc(detail?.shortDescription ?? "");
                      setEditReadme(detail?.readme ?? "");
                      setEditOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                    {t("projects.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openFieldEditor}>
                    <SlidersHorizontal className="size-4" />
                    {t("projects.manageStatus")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openNewField}>
                    <Plus className="size-4" />
                    {t("projects.newField")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void togglePublic()}>
                    {detail?.public ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                    {detail?.public ? t("projects.makePrivate") : t("projects.makePublic")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void toggleClosed()}>
                    {detail?.closed ? (
                      <ArchiveRestore className="size-4" />
                    ) : (
                      <Archive className="size-4" />
                    )}
                    {detail?.closed ? t("projects.reopen") : t("projects.close")}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 className="size-4" />
                    {t("projects.deleteProject")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {detail?.shortDescription && (
          <p className="text-sm text-muted-foreground">{detail.shortDescription}</p>
        )}
        {detail?.readme && (
          <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-3 text-sm">
            <MarkdownView>{detail.readme}</MarkdownView>
          </div>
        )}
        {!canEdit && detail && (
          <p className="text-xs text-muted-foreground">{t("projects.detail.readonly")}</p>
        )}
      </header>

      {error ? (
        <InlineError message={error} />
      ) : loading ? (
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-72" />
          ))}
        </div>
      ) : columns.length === 0 && orphans.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("projects.detail.noColumns")}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex items-start gap-3 overflow-x-auto pb-4">
            {columns.map((col) => (
              <BoardColumn
                key={col.optionId}
                column={col}
                canEdit={canEdit}
                onDelete={setDeleteItem}
                onOpen={setDetailItem}
              />
            ))}
            {orphans.length > 0 && (
              <OrphansColumn
                orphans={orphans}
                canEdit={canEdit}
                onDelete={setDeleteItem}
                onOpen={setDetailItem}
              />
            )}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="rotate-2 rounded-lg border bg-card p-3 shadow-lg">
                <CardBody card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!loading && !error && hasMore && (
        <LoadMoreButton loading={loadingMore} endReached={false} onClick={() => void loadMore()} />
      )}

      {/* 编辑 project dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.edit")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("projects.titleLabel")}</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={t("projects.titlePlaceholder")}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("projects.descLabel")}</label>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={t("projects.descPlaceholder")}
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("projects.readmeLabel")}</label>
              <Textarea
                value={editReadme}
                onChange={(e) => setEditReadme(e.target.value)}
                placeholder={t("projects.readmePlaceholder")}
                rows={5}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 字段（列）管理 dialog：字段名 + 选项改名/改颜色/增删 */}
      <Dialog open={fieldOpen} onOpenChange={setFieldOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.manageStatus")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitField} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("projects.fieldNameLabel")}</label>
              <Input
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                placeholder={t("projects.fieldNamePlaceholder")}
              />
            </div>
            <OptionListEditor options={fieldOptions} onChange={setFieldOptions} />
            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteFieldOpen(true)}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                {t("projects.deleteField")}
              </Button>
              <div className="flex-1" />
              <Button type="button" variant="outline" onClick={() => setFieldOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 新建字段（列）dialog */}
      <Dialog open={newFieldOpen} onOpenChange={setNewFieldOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.newField")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitNewField} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("projects.fieldNameLabel")}</label>
              <Input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder={t("projects.fieldNamePlaceholder")}
                required
              />
            </div>
            <OptionListEditor options={newFieldOptions} onChange={setNewFieldOptions} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFieldOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("projects.newField")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 添加 item dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.addItem")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAdd} className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={addMode === "draft" ? "default" : "outline"}
                onClick={() => setAddMode("draft")}
              >
                {t("projects.addDraft")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={addMode === "item" ? "default" : "outline"}
                onClick={() => setAddMode("item")}
              >
                {t("projects.addExisting")}
              </Button>
            </div>
            {addMode === "draft" ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("projects.titleLabel")}</label>
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder={t("projects.titlePlaceholder")}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("projects.bodyLabel")}</label>
                  <Textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder={t("projects.bodyPlaceholder")}
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("projects.itemRefLabel")}</label>
                <Input
                  value={itemRef}
                  onChange={(e) => setItemRef(e.target.value)}
                  placeholder={t("projects.itemRefPlaceholder")}
                  required
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("projects.addItem")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除 project 确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projects.deleteProject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("projects.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除字段（列）确认 */}
      <AlertDialog open={deleteFieldOpen} onOpenChange={setDeleteFieldOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projects.deleteField")}</AlertDialogTitle>
            <AlertDialogDescription>{t("projects.deleteFieldConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDeleteField()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除 item 确认 */}
      <AlertDialog open={deleteItem !== null} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projects.deleteItem")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteItemConfirm").replace("{title}", deleteItem?.title ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDeleteItem()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 卡片详情抽屉：查看/编辑 item 各字段值 */}
      <ItemDetailDialog
        card={detailItem}
        fields={detail?.fields ?? []}
        canEdit={canEdit}
        onClose={() => setDetailItem(null)}
        onSave={saveFieldValue}
      />
    </div>
  );
}

/** 返回列表按钮（与 Pull/Issue 详情页一致的 ghost 按钮样式） */
function ButtonBack({ owner, repo }: { owner: string; repo: string }) {
  const { t } = useI18n();
  return (
    <Button variant="ghost" asChild className="-ml-2">
      <Link to={`/${owner}/${repo}/projects`}>
        <ArrowLeft className="size-4" />
        {t("projects.backToList")}
      </Link>
    </Button>
  );
}

/** 单个看板列（droppable 容器 + 卡片 SortableContext） */
function BoardColumn({
  column,
  canEdit,
  onDelete,
  onOpen,
}: {
  column: ProjectV2Column;
  canEdit: boolean;
  onDelete: (card: ProjectV2Card) => void;
  onOpen: (card: ProjectV2Card) => void;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: column.optionId, disabled: !canEdit });
  const color = OPTION_COLOR[column.color] ?? OPTION_COLOR.GRAY;

  return (
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30">
      {/* 列头：色点 + 名称 + 计数 */}
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-sm font-medium">{column.name}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {column.items.length}
        </span>
      </div>
      {/* 卡片区 */}
      <SortableContext
        items={column.items.map((it) => it.itemId)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 p-2 transition-colors",
            isOver && "bg-accent/40",
          )}
        >
          {column.items.map((card) => (
            <BoardCard
              key={card.itemId}
              card={card}
              canEdit={canEdit}
              onDelete={onDelete}
              onOpen={onOpen}
            />
          ))}
          {column.items.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {canEdit ? t("projects.dropHere") : "—"}
            </p>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/** 未分组项列（未设置 status 的项；仅展示 + 删除，不参与拖拽排序） */
function OrphansColumn({
  orphans,
  canEdit,
  onDelete,
  onOpen,
}: {
  orphans: ProjectV2Card[];
  canEdit: boolean;
  onDelete: (card: ProjectV2Card) => void;
  onOpen: (card: ProjectV2Card) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <span className="truncate text-sm font-medium">{t("projects.noStatus")}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{orphans.length}</span>
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {orphans.map((card) => (
          <BoardCard
            key={card.itemId}
            card={card}
            canEdit={canEdit}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

/** 单个看板卡片（sortable） */
function BoardCard({
  card,
  canEdit,
  onDelete,
  onOpen,
}: {
  card: ProjectV2Card;
  canEdit: boolean;
  onDelete: (card: ProjectV2Card) => void;
  onOpen: (card: ProjectV2Card) => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.itemId,
    disabled: !canEdit,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onOpen(card)}
      className={cn(
        "group relative rounded-lg border bg-card p-3 pr-7 text-sm shadow-sm",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        {canEdit && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t("projects.dragToSort")}
            className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <CardBody card={card} />
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(card);
          }}
          aria-label={t("projects.deleteItem")}
          className="absolute top-2 right-1.5 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 卡片正文：类型图标 + 标题 + 编号 */
function CardBody({ card }: { card: ProjectV2Card }) {
  const icon =
    card.type === "PULL_REQUEST" ? (
      <GitPullRequest className="size-3.5 shrink-0 text-primary" />
    ) : card.type === "DRAFT_ISSUE" ? (
      <SquarePen className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <CircleDot className="size-3.5 shrink-0 text-chart-1" />
    );
  return (
    <div className="flex items-start gap-1.5">
      {icon}
      <span className="min-w-0 flex-1 wrap-break-word">{card.title}</span>
      {card.number !== null && (
        <span className="shrink-0 text-xs text-muted-foreground">#{card.number}</span>
      )}
    </div>
  );
}

/** 选项颜色下拉（官方固定 8 色枚举；色点 + 名称） */
function ColorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTION_COLOR_KEYS.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: OPTION_COLOR[c] }}
              />
              {c}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 选项列表编辑器（色点下拉 + 名称 + 拖拽排序 + 删除 + 添加），字段管理/新建字段共用 */
function OptionListEditor({
  options,
  onChange,
}: {
  options: FieldOptionDraft[];
  onChange: (options: FieldOptionDraft[]) => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const itemIds = options.map((_, i) => String(i));

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{t("projects.optionsLabel")}</label>
      <DndContext
        sensors={sensors}
        onDragEnd={(e) => {
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const oldIndex = itemIds.indexOf(String(active.id));
          const newIndex = itemIds.indexOf(String(over.id));
          if (oldIndex < 0 || newIndex < 0) return;
          onChange(arrayMove(options, oldIndex, newIndex));
        }}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {options.map((opt, i) => (
              <SortableOptionRow
                key={i}
                id={String(i)}
                opt={opt}
                index={i}
                options={options}
                onChange={onChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={() =>
          onChange([...options, { id: null, name: "", color: "GRAY", description: "" }])
        }
      >
        <Plus className="size-4" />
        {t("projects.addOption")}
      </Button>
    </div>
  );
}

/** 单个选项排序行（sortable；GripVertical 手柄拖拽排序） */
function SortableOptionRow({
  id,
  opt,
  index,
  options,
  onChange,
}: {
  id: string;
  opt: FieldOptionDraft;
  index: number;
  options: FieldOptionDraft[];
  onChange: (options: FieldOptionDraft[]) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("projects.dragToSort")}
        className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <ColorSelect
        value={opt.color}
        onChange={(v) => onChange(options.map((o, j) => (j === index ? { ...o, color: v } : o)))}
      />
      <Input
        value={opt.name}
        onChange={(e) =>
          onChange(options.map((o, j) => (j === index ? { ...o, name: e.target.value } : o)))
        }
        placeholder={t("projects.optionNamePlaceholder")}
        className="flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("projects.deleteOption")}
        onClick={() => onChange(options.filter((_, j) => j !== index))}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/** 卡片详情抽屉：查看/编辑 item 各字段值（text/number/date/single/multi 可编辑） */
function ItemDetailDialog({
  card,
  fields,
  canEdit,
  onClose,
  onSave,
}: {
  card: ProjectV2Card | null;
  fields: ProjectV2FieldDef[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (fieldId: string, patch: ProjectV2ItemFieldPatch) => Promise<void>;
}) {
  const { t } = useI18n();
  // 每字段草稿值（打开时从 card.fieldValues 初始化）
  const [drafts, setDrafts] = useState<Record<string, ProjectV2FieldValue>>({});
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    if (card) {
      const map: Record<string, ProjectV2FieldValue> = {};
      for (const fv of card.fieldValues) map[fv.fieldId] = fv;
      setDrafts(map);
    }
  }, [card]);

  const emptyValue = (fieldId: string): ProjectV2FieldValue => ({
    fieldId,
    text: null,
    number: null,
    date: null,
    optionId: null,
    optionIds: [],
    iterationId: null,
    iterationTitle: null,
  });
  const getValue = (fieldId: string): ProjectV2FieldValue => drafts[fieldId] ?? emptyValue(fieldId);

  const commit = async (fieldId: string, patch: ProjectV2ItemFieldPatch) => {
    if (!canEdit || savingField) return;
    setSavingField(fieldId);
    try {
      await onSave(fieldId, patch);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t("projects.itemFieldSaveFailed"));
    } finally {
      setSavingField(null);
    }
  };

  // 可编辑字段类型（其余内置只读字段如 TITLE/ASSIGNEES/LABELS 不在抽屉展示）
  const EDITABLE = new Set([
    "TEXT",
    "NUMBER",
    "DATE",
    "SINGLE_SELECT",
    "MULTI_SELECT",
    "ITERATION",
  ]);
  const fieldList = fields.filter((f) => EDITABLE.has(f.dataType));

  const icon =
    card?.type === "PULL_REQUEST" ? (
      <GitPullRequest className="size-4 shrink-0 text-primary" />
    ) : card?.type === "DRAFT_ISSUE" ? (
      <SquarePen className="size-4 shrink-0 text-muted-foreground" />
    ) : (
      <CircleDot className="size-4 shrink-0 text-chart-1" />
    );

  return (
    <Dialog open={card !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {icon}
            {card?.url ? (
              <Link
                to={card.url}
                onClick={onClose}
                className="min-w-0 flex-1 wrap-break-word text-base font-semibold text-primary hover:underline"
              >
                {card?.title ?? ""}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 wrap-break-word text-base font-semibold">
                {card?.title ?? ""}
              </span>
            )}
            {card?.number !== null && (
              <span className="shrink-0 text-sm text-muted-foreground">#{card?.number}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {fieldList.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("projects.noFields")}
            </p>
          ) : (
            fieldList.map((f) => (
              <FieldEditor
                key={f.id}
                field={f}
                value={getValue(f.id)}
                canEdit={canEdit}
                saving={savingField === f.id}
                onCommit={(patch) => void commit(f.id, patch)}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 单个字段编辑器（按 dataType 渲染控件） */
function FieldEditor({
  field,
  value,
  canEdit,
  saving,
  onCommit,
}: {
  field: ProjectV2FieldDef;
  value: ProjectV2FieldValue;
  canEdit: boolean;
  saving: boolean;
  onCommit: (patch: ProjectV2ItemFieldPatch) => void;
}) {
  const { t } = useI18n();

  if (field.dataType === "SINGLE_SELECT") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium">{field.name}</label>
        <Select
          value={value.optionId ?? ""}
          onValueChange={(v) => onCommit({ singleSelectOptionId: v || null })}
          disabled={!canEdit || saving}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder={t("projects.noStatus")} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: OPTION_COLOR[o.color] ?? OPTION_COLOR.GRAY }}
                  />
                  {o.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.dataType === "MULTI_SELECT") {
    const selected = new Set(value.optionIds);
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{field.name}</label>
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const checked = selected.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={!canEdit || saving}
                onClick={() => {
                  const next = checked
                    ? value.optionIds.filter((id) => id !== o.id)
                    : [...value.optionIds, o.id];
                  onCommit({ multiSelectOptionIds: next });
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                  checked
                    ? "border-transparent bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: OPTION_COLOR[o.color] ?? OPTION_COLOR.GRAY }}
                />
                {o.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.dataType === "NUMBER") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium">{field.name}</label>
        <Input
          type="number"
          defaultValue={value.number ?? ""}
          key={`${field.id}-${value.number}`}
          disabled={!canEdit || saving}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            onCommit({ number: raw === "" ? null : Number(raw) });
          }}
        />
      </div>
    );
  }

  if (field.dataType === "DATE") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium">{field.name}</label>
        <Input
          type="date"
          defaultValue={value.date ?? ""}
          key={`${field.id}-${value.date}`}
          disabled={!canEdit || saving}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            onCommit({ date: raw === "" ? null : raw });
          }}
        />
      </div>
    );
  }

  if (field.dataType === "ITERATION") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium">{field.name}</label>
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {value.iterationTitle ?? t("projects.noStatus")}
        </p>
      </div>
    );
  }

  // TEXT（默认）
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{field.name}</label>
      <Input
        defaultValue={value.text ?? ""}
        key={`${field.id}-${value.text}`}
        disabled={!canEdit || saving}
        placeholder={t("projects.noStatus")}
        onBlur={(e) => onCommit({ text: e.target.value })}
      />
    </div>
  );
}
