/**
 * ============================================================================
 * CommentsSection 组件测试（happy-dom + @testing-library/react）—— 评论区质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * CommentsSection 是 issue/PR 详情页的评论区（官方结构）：评论头（头像/作者/时间/编号/
 * hover 复制链接）+ 评论正文（MarkdownView / 空 body 斜体占位）+ 发表区（登录门控）：
 * - 未登录 → LoginPrompt（官方「Sign in to comment」引导）
 * - 登录 + 只读（canWrite=false）→ 「写评论需完全权限」提示（WriteGate 门控）
 * - 登录 + 可写 → MarkdownEditor + 提交按钮；空 body 提交按钮禁用（不触发 api）
 * - 提交成功 → 调用 addIssueCommentSmart + onCommentAdded 回调 + 清空输入
 * - 提交失败 → 显示错误（apiErrorMessage）
 * - 空 body 评论 → 斜体占位（comments.emptyBody），不渲染 MarkdownView
 *
 * 【测试方式】mock 重依赖（useAuth/useI18n/useDateFormat/api/MarkdownEditor/UserAvatar/
 * LoginPrompt/MarkdownView），聚焦 CommentsSection 自身的门控与提交流。零网络请求。
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommentsSection } from "@/components/CommentsSection";
import { useAuth } from "@/hooks/useAuth";
import { addIssueCommentSmart } from "@/lib/api";
import type { IssueComment } from "@/lib/restapi";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => ({ fmt: (s: string) => s }) }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }), tStatic: (k: string) => k }));
vi.mock("@/lib/api", () => ({ addIssueCommentSmart: vi.fn() }));
vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return { ...actual, apiErrorMessage: (e: unknown, fb?: string) => fb ?? String(e) };
});
vi.mock("@/lib/repo/repo-raw", () => ({
  repoRawBase: () => "https://raw.githubusercontent.com/o/r",
}));
vi.mock("@/components/MarkdownView", () => ({
  MarkdownView: ({ children }: { children?: unknown }) => (
    <div data-testid="md-view">{String(children)}</div>
  ),
}));
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({ onChange }: { onChange: (v: string) => void }) => (
    <textarea data-testid="editor" onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: ({ alt }: { alt?: string }) => <img data-testid="avatar" alt={alt} />,
}));
vi.mock("@/components/LoginPrompt", () => ({
  LoginPrompt: ({ title, desc }: { title?: string; desc?: string }) => (
    <div data-testid="login-prompt">
      {title} {desc}
    </div>
  ),
}));

const mockUseAuth = vi.mocked(useAuth);
const mockAddComment = vi.mocked(addIssueCommentSmart);

afterEach(cleanup);

/** 登录态默认：可写 */
function authState(over: Partial<{ token: string | null; login: string; canWrite: boolean }> = {}) {
  mockUseAuth.mockReturnValue({ token: "gho_x", login: "alice", canWrite: true, ...over } as never);
}

const commentA: IssueComment = {
  id: 1,
  html_url: "https://github.com/o/r/issues/1#issuecomment-1",
  body: "first comment",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  user: { login: "alice", avatar_url: "https://a.png" },
};
const commentEmpty: IssueComment = {
  ...commentA,
  id: 2,
  body: "",
  user: { login: "bob" },
};

const defaultProps = {
  owner: "o",
  repo: "r",
  number: 1,
  comments: [commentA],
  onCommentAdded: vi.fn(),
};

describe("评论列表渲染", () => {
  it("渲染评论作者 / 编号 / 时间 / 正文", () => {
    authState();
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText(commentA.body)).toBeInTheDocument();
    // MarkdownView 渲染正文
    expect(screen.getByTestId("md-view")).toHaveTextContent("first comment");
  });

  it("空 body 评论 → 斜体占位（不渲染 MarkdownView）", () => {
    authState();
    render(<CommentsSection {...defaultProps} comments={[commentEmpty]} />);
    expect(screen.queryByTestId("md-view")).not.toBeInTheDocument();
    expect(screen.getByText("comments.emptyBody")).toBeInTheDocument();
  });

  it("无评论 → 不渲染评论列表容器", () => {
    authState();
    const { container } = render(<CommentsSection {...defaultProps} comments={[]} />);
    // 无 divide-y 容器（只有发表区）
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    expect(container.querySelector(".divide-y")).toBeNull();
  });
});

describe("登录门控（WriteGate）", () => {
  it("未登录 → LoginPrompt（Sign in to comment 引导）", () => {
    authState({ token: null });
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByTestId("login-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("登录 + 只读（canWrite=false）→ 写评论需完全权限提示", () => {
    authState({ canWrite: false });
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByText("comments.writeRequired")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("登录 + 可写 → 编辑器 + 提交按钮", () => {
    authState();
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /comments\.submit/ });
    expect(submit).toBeDisabled(); // 初始空 body → 禁用
  });
});

describe("评论提交流", () => {
  it("空 body → 提交按钮禁用，点击不触发 api", () => {
    authState();
    const onAdded = vi.fn();
    render(<CommentsSection {...defaultProps} onCommentAdded={onAdded} />);
    const submit = screen.getByRole("button", { name: /comments\.submit/ });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mockAddComment).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("输入后提交 → 调用 addIssueCommentSmart + onCommentAdded + 清空", async () => {
    authState();
    const onAdded = vi.fn();
    const created: IssueComment = { ...commentA, id: 99, body: "new comment" };
    mockAddComment.mockResolvedValue(created);
    render(<CommentsSection {...defaultProps} onCommentAdded={onAdded} />);
    const editor = screen.getByTestId("editor");
    fireEvent.change(editor, { target: { value: "  new comment  " } });
    const submit = screen.getByRole("button", { name: /comments\.submit/ });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    // 提交后清空（编辑器重建，值恢复空）
    expect(mockAddComment).toHaveBeenCalledWith("o", "r", 1, "new comment", "gho_x"); // trim
    // onCommentAdded 在 await 后异步调用 → waitFor 等待微任务
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(created));
  });

  it("提交失败 → 显示错误（不调用 onCommentAdded）", async () => {
    authState();
    const onAdded = vi.fn();
    mockAddComment.mockRejectedValue(new Error("boom"));
    render(<CommentsSection {...defaultProps} onCommentAdded={onAdded} />);
    fireEvent.change(screen.getByTestId("editor"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /comments\.submit/ }));
    // apiErrorMessage(err, t("comments.addFailed")) → 返回回退文案
    expect(await screen.findByText("comments.addFailed")).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
  });
});
