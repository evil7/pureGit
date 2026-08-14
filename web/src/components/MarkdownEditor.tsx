/**
 * Markdown 编辑器（方案 A：GitHub 官方 web components 路线）
 *
 * - markdown-toolbar：12 个格式按钮（粗体/斜体/删除线/引用/代码/链接/图片/
 *   无序/有序/任务/mention/issue-ref），与 GitHub 官方同款 web component
 * - text-expander：`: emoji` / `@ 协作者` / `# issue` 补全菜单
 * - Write / Preview 切换（SegmentedControl）
 *
 * ⚠️ 关键约束（方案 A 验证 3 坑）：
 * 1. **textarea 必须非受控**（defaultValue）：text-expander 直接改写 textarea.value，
 *    受控（value+onChange）会被 React 重置导致选择不插入。父组件通过 onChange 回调
 *    获取当前值；需要清空时用 key 重建（见 CommentsSection 用法）。
 * 2. **text-expander-value 事件必须监听并重赋值** `event.detail.value`（从 item.dataset.value 取）。
 * 3. text-expander-committed 在 DOM value 更新后触发（含 input）→ 用它同步 state，
 *    覆盖「补全插入」这类不经过 onInput 的值变化。
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import "@github/markdown-toolbar-element";
import "@github/text-expander-element";
import { search as emojiSearch } from "node-emoji";
import {
  AtSign,
  Bold,
  Code2,
  Hash,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { fetchContributors, type Contributor, type Issue } from "@/lib/restapi";
import { fetchIssuesSmart } from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { repoRawBase } from "@/lib/repo/repo-raw";
import { SegmentedControl } from "@/components/SegmentedControl";

/* ===== text-expander 事件类型（包 d.ts 只给 TextExpanderMatch/Result） ===== */
interface ExpanderChangeDetail {
  key: string;
  text: string;
  provide: (result: Promise<{ matched: boolean; fragment?: HTMLElement }>) => void;
}
interface ExpanderValueDetail {
  key: string;
  item: HTMLElement;
  value: string | null;
}
interface ExpanderCommittedDetail {
  input: HTMLTextAreaElement;
}

/** 补全建议项 */
interface Suggestion {
  value: string;
  label: string;
}

/** 工具栏按钮（官方 markdown-toolbar 同款） */
const TOOLBAR_BUTTONS: {
  tag:
    | "md-bold"
    | "md-italic"
    | "md-strikethrough"
    | "md-quote"
    | "md-code"
    | "md-link"
    | "md-image"
    | "md-unordered-list"
    | "md-ordered-list"
    | "md-task-list"
    | "md-mention"
    | "md-ref";
  icon: typeof Bold;
  titleKey: string;
}[] = [
  { tag: "md-bold", icon: Bold, titleKey: "markdown.toolbar.bold" },
  { tag: "md-italic", icon: Italic, titleKey: "markdown.toolbar.italic" },
  { tag: "md-strikethrough", icon: Strikethrough, titleKey: "markdown.toolbar.strike" },
  { tag: "md-quote", icon: Quote, titleKey: "markdown.toolbar.quote" },
  { tag: "md-code", icon: Code2, titleKey: "markdown.toolbar.code" },
  { tag: "md-link", icon: Link, titleKey: "markdown.toolbar.link" },
  { tag: "md-image", icon: Image, titleKey: "markdown.toolbar.image" },
  { tag: "md-unordered-list", icon: List, titleKey: "markdown.toolbar.list" },
  { tag: "md-ordered-list", icon: ListOrdered, titleKey: "markdown.toolbar.orderedList" },
  { tag: "md-task-list", icon: ListTodo, titleKey: "markdown.toolbar.taskList" },
  { tag: "md-mention", icon: AtSign, titleKey: "markdown.toolbar.mention" },
  { tag: "md-ref", icon: Hash, titleKey: "markdown.toolbar.issueRef" },
];

export function MarkdownEditor({
  id,
  defaultValue = "",
  placeholder,
  rows = 8,
  owner,
  repo,
  onChange,
  onSubmit,
  className,
  autoFocus,
  titleSlot,
}: {
  /** textarea id（markdown-toolbar for 关联） */
  id?: string;
  /** 初始内容（非受控；清空用 key 重建） */
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  /** 所属仓库（@/# 补全数据源；缺省禁用 @/# 补全） */
  owner?: string;
  repo?: string;
  /** 内容变化回调（输入/补全插入/粘贴后触发） */
  onChange?: (value: string) => void;
  /** Ctrl+Enter 提交回调 */
  onSubmit?: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** 工具栏行最左侧插槽（如「发表评论」标题——官方编辑器标题行与 Write/Preview 同排） */
  titleSlot?: ReactNode;
}) {
  const { t } = useI18n();
  const { token } = useAuth();
  // 编辑器背景跟随偏好设置代码配色（与 CodeView/CodeEditor 同源 codeTheme 明暗背景——
  // 2026-08-14 用户要求；textarea 透明底透出容器色，预览/空态同底色切换零闪动）
  const { codeTheme } = useCodeTheme();
  const { theme } = useTheme();
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorBg = dark ? codeTheme.preview.bgDark : codeTheme.preview.bgLight;
  const fallbackId = useId();
  const textareaId = id ?? fallbackId;
  const [tab, setTab] = useState<"write" | "preview">("write");
  // 当前值（非受控 textarea 的镜像，供预览与 onChange 同步）
  const [value, setValue] = useState(defaultValue);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expanderRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* @/# 补全数据懒加载（贡献者公开 API + issue/PR 列表，一次性缓存） */
  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    // contributors 公开可见（collaborators 需 push 权限，公开仓库 403）
    fetchContributors(owner, repo, token)
      .then((d) => !cancelled && setContributors(d))
      .catch(() => undefined);
    fetchIssuesSmart(owner, repo, "all", token, undefined, 100)
      .then((d) => !cancelled && setIssues(d.items))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  /** 按触发键生成补全建议（: emoji / @ 协作者 / # issue） */
  const matchSuggestions = useCallback(
    (key: string, text: string): Suggestion[] => {
      const q = text.toLowerCase();
      if (key === ":") {
        return emojiSearch(q)
          .slice(0, 10)
          .map((e) => ({ value: `:${e.name}:`, label: `${e.emoji} :${e.name}:` }));
      }
      if (key === "@") {
        return contributors
          .filter((c) => c.login.toLowerCase().includes(q))
          .slice(0, 10)
          .map((c) => ({ value: `@${c.login}`, label: c.login }));
      }
      if (key === "#") {
        return issues
          .filter((i) => String(i.number).startsWith(q) || i.title?.toLowerCase().includes(q))
          .slice(0, 10)
          .map((i) => ({ value: `#${i.number}`, label: `#${i.number} ${i.title ?? ""}` }));
      }
      return [];
    },
    [contributors, issues],
  );

  /* text-expander 事件绑定（change 提供菜单 / value 重赋值 / committed 同步 state） */
  useEffect(() => {
    const expander = expanderRef.current;
    if (!expander) return;

    const onChangeEvt = (event: Event) => {
      const detail = (event as CustomEvent<ExpanderChangeDetail>).detail;
      if (!detail) return;
      const items = matchSuggestions(detail.key, detail.text);
      const menu = menuRef.current;
      if (items.length === 0 || !menu) {
        detail.provide(Promise.resolve({ matched: false }));
        return;
      }
      menu.innerHTML = items
        .map(
          (it) =>
            `<div role="option" data-value="${it.value.replace(/"/g, "&quot;")}" class="cursor-pointer rounded-md px-2.5 py-1.5 text-sm hover:bg-accent">${it.label}</div>`,
        )
        .join("");
      // 官方要求：显示前移除 hidden（text-expander 只负责定位，不自动显示）
      menu.hidden = false;
      detail.provide(Promise.resolve({ matched: true, fragment: menu }));
    };

    const onValueEvt = (event: Event) => {
      const detail = (event as CustomEvent<ExpanderValueDetail>).detail;
      if (!detail?.item) return;
      // 官方要求：重赋值 detail.value（取 data-value）
      detail.value = detail.item.getAttribute("data-value");
    };

    const onCommittedEvt = (event: Event) => {
      const detail = (event as CustomEvent<ExpanderCommittedDetail>).detail;
      if (detail?.input) {
        const v = detail.input.value;
        setValue(v);
        onChange?.(v);
      }
    };

    expander.addEventListener("text-expander-change", onChangeEvt);
    expander.addEventListener("text-expander-value", onValueEvt);
    expander.addEventListener("text-expander-committed", onCommittedEvt);
    return () => {
      expander.removeEventListener("text-expander-change", onChangeEvt);
      expander.removeEventListener("text-expander-value", onValueEvt);
      expander.removeEventListener("text-expander-committed", onCommittedEvt);
    };
    // tab 依赖：预览切回写模式时 text-expander 重挂载（卸载→新 DOM），
    // 必须重绑事件，否则 @/#/: 补全失效（切回后输入 @ 无菜单——2026-08-14 实测）
  }, [matchSuggestions, onChange, tab]);

  const handleInput = (v: string) => {
    setValue(v);
    onChange?.(v);
  };

  // 编辑/预览统一最小高度（px）：rows×行高(text-sm leading-relaxed≈23px) + p-3 上下 padding(24px)，
  // 下限 96px（官方评论编辑器空态高度）。写/预览/空态三处引用同一值 → 切换零闪动（2026-08-14）
  const editorMinHeight = Math.max(rows * 23 + 24, 96);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.(value);
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      {/* 顶部：标题插槽（左）+ Write/Preview + 工具栏（GitHub 官方布局）——保持主题色（bg-card 继承），
          仅正文输入区跟随偏好设置代码配色（下） */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {titleSlot}
          <SegmentedControl
            variant="tab"
            options={[
              { value: "write", label: t("comments.write") },
              { value: "preview", label: t("comments.preview") },
            ]}
            value={tab}
            onValueChange={(v) => setTab(v)}
          />
        </div>
        {/* 格式化工具栏（仅写模式显示） */}
        {tab === "write" && (
          <markdown-toolbar for={textareaId} className="flex items-center gap-0.5">
            {TOOLBAR_BUTTONS.map(({ tag: Tag, icon: Icon, titleKey }) => (
              <Tag
                key={titleKey}
                title={t(titleKey as "markdown.toolbar.bold")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Icon className="size-4" />
              </Tag>
            ))}
          </markdown-toolbar>
        )}
      </div>

      {/* 正文：写模式 textarea / 预览模式 MarkdownView（三态最小高度统一 = editorMinHeight） */}
      {tab === "write" ? (
        <text-expander ref={expanderRef} keys=": @ #" className="relative block">
          <textarea
            id={textareaId}
            ref={textareaRef}
            // 非受控 textarea 的挂载初始值 = 当前编辑值（value state 是唯一事实源）：
            // 切预览再切回 write 会卸载重挂，若用 props 初始值 defaultValue 则编辑内容丢失
            // （2026-08-14 实测修复）；提交后清空走父组件 key 重建（重置为 defaultValue prop）
            defaultValue={value}
            placeholder={placeholder}
            rows={rows}
            autoFocus={autoFocus}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ minHeight: editorMinHeight, backgroundColor: editorBg }}
            // block：textarea 默认 inline-block，在 text-expander 行盒中残留基线行高
            // （line-height 24px 与自身高度差 ~6px）→ 编辑态底部多出空白，与预览态/圆角容器
            // 底部不一致（2026-08-14 实测修复）；block 后高度 = 精确 minHeight
            className="block w-full resize-y bg-transparent p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          {/* 补全菜单容器（text-expander 注入 fragment 并定位） */}
          <div
            ref={menuRef}
            slot="expander"
            hidden
            className="z-50 min-w-44 max-w-xs overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
          />
        </text-expander>
      ) : value.trim() ? (
        <div
          className="max-h-80 overflow-y-auto p-3"
          style={{ minHeight: editorMinHeight, backgroundColor: editorBg }}
        >
          <MarkdownView rawBase={owner && repo ? repoRawBase(owner, repo) : undefined}>
            {value}
          </MarkdownView>
        </div>
      ) : (
        <div
          className="flex items-center justify-center text-sm text-muted-foreground"
          style={{ minHeight: editorMinHeight, backgroundColor: editorBg }}
        >
          {t("comments.previewEmpty")}
        </div>
      )}
    </div>
  );
}
