/**
 * REST body 结构化列表视图（R2：结构化编辑泛化到 REST body）
 *
 * 与 GqlVariablesPanel 结构化视图同构——默认 JSON 编辑器（RequestEditor Body tab），
 * 用户可切换到此视图以「结构驱动表单」编辑请求体：
 * - **schema 驱动**：bodySchema（OpenAPI deref）→ openApiSchemaToStructured → StructuredField
 * - **双向序列化**：body JSON 文本 ↔ StructuredRow（jsonToStructuredRows 反向 /
 *   structuredRowToJson 正向）——复用 GraphQL M5.5 序列化层（完全通用，零协议耦合）
 * - **渲染**：StructuredTable 递归表格（object → 字段行、array → 数组编辑器、
 *   enum → 下拉、必填星标 + checkbox 锁定、placeholder 承载默认值）
 * - 编辑即写回 req.body（JSON 文本；发送/历史零改动复用）
 * - 未匹配端点（无 bodySchema）→ 提示不可用（结构化视图入口在切换按钮，无 schema 时禁用）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  jsonToStructuredRows,
  structuredRowToJson,
  type StructuredRow,
} from "@/lib/debug/debug-gql-structured";
import { openApiSchemaToStructured } from "@/lib/debug/debug-rest-structured";
import { StructuredTable } from "./StructuredTable";

interface BodyStructuredPanelProps {
  t: (k: string, vars?: Record<string, unknown>) => string;
  /** 当前 REST 端点 requestBody schema（OpenAPI deref；null = 未匹配无文档） */
  schema: Record<string, unknown> | null;
  /** 当前 body JSON 文本（权威源；编辑写回） */
  body: string;
  onChange: (v: string) => void;
}

export function BodyStructuredPanel({ t, schema, body, onChange }: BodyStructuredPanelProps) {
  /** 顶层结构模型（deref schema → StructuredField；无 schema → null 不可用） */
  const field = useMemo(() => (schema ? openApiSchemaToStructured(schema) : null), [schema]);
  /** 当前编辑行（StructuredTable 数据） */
  const [row, setRow] = useState<StructuredRow | null>(() =>
    field ? jsonToStructuredRows(field, {}) : null,
  );
  /** 自身写入的 JSON 文本（反向重建跳过——编辑写回 body 时不再重建打断输入） */
  const lastEmittedRef = useRef("");

  /** 反向同步：body 外部变化（历史重放/切端点/切回 JSON 编辑）→ 重建行；自身写入跳过 */
  useEffect(() => {
    if (!field) {
      setRow(null);
      return;
    }
    if (lastEmittedRef.current === body) return;
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* 无效 JSON（外部手动输入中间态）→ 空骨架兜底 */
    }
    setRow(jsonToStructuredRows(field, parsed));
  }, [field, body]);

  if (!schema) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("body.structuredNoSchema")}</p>
    );
  }
  if (!field || !row) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <StructuredTable
        t={t}
        row={row}
        onChange={(next) => {
          setRow(next);
          const res = structuredRowToJson(next);
          const text = JSON.stringify(res.ok ? res.value : undefined, null, 2);
          lastEmittedRef.current = text;
          onChange(text);
        }}
      />
    </div>
  );
}
