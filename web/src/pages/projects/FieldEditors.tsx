/**
 * Project 字段编辑器组件（ColorSelect / OptionListEditor / SortableOptionRow / ItemDetailDialog / FieldEditor）
 * —— 自 ProjectDetailPage 拆出，负责「字段（列）」管理与「卡片 item 各字段值」的查看/编辑 UI。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleDot, GitPullRequest, GripVertical, Plus, SquarePen, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  type ProjectV2Card,
  type ProjectV2FieldDef,
  type ProjectV2FieldValue,
  type ProjectV2ItemFieldPatch,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toastError } from "@/lib/ui/toast";
import { cn } from "@/lib/utils";
import { OPTION_COLOR, OPTION_COLOR_KEYS } from "./constants";

/** 字段（列）选项编辑草稿：id 保留已有选项身份（新增为 null） */
export interface FieldOptionDraft {
  id: string | null;
  name: string;
  color: string;
  description: string;
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
export function OptionListEditor({
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
export function ItemDetailDialog({
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
