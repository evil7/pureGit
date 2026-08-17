/**
 * Project 看板组件（BoardColumn / OrphansColumn / BoardCard / CardBody）—— 自 ProjectDetailPage 拆出。
 */
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  CircleDot,
  GitPullRequest,
  GripVertical,
  SquarePen,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectV2Column, ProjectV2Card } from "@/lib/api";
import { OPTION_COLOR } from "./constants";

/** 返回列表按钮（与 Pull/Issue 详情页一致的 ghost 按钮样式） */
export function ButtonBack({ owner, repo }: { owner: string; repo: string }) {
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
export function BoardColumn({
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
export function OrphansColumn({
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
export function BoardCard({
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
export function CardBody({ card }: { card: ProjectV2Card }) {
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
