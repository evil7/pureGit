/**
 * ============================================================================
 * ReactionPicker 组件测试（happy-dom + @testing-library/react）—— 表情反应门
 * ============================================================================
 *
 * 【验收基线（第一性原理，勿降断言）】
 * ReactionPicker 是 issue/评论/评审通用的表情反应选择器（官方 reaction picker）：
 * - 笑脸按钮（aria-label reactions.add）+ reaction pills（emoji + count）
 * - 点击已反应的 pill → removeReactionSmart（撤销）
 * - 点击未反应的 pill → addReactionSmart（添加）
 * - 成功 → onUpdated 回写最新 reactionGroups
 * - 未登录点击 → login({ mode: "write" })
 *
 * 【测试方式】mock 重依赖（useAuth/useI18n/api/toast），聚焦 ReactionPicker 自身交互。零网络。
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReactionPicker } from "@/components/ReactionPicker";
import { useAuth } from "@/hooks/useAuth";
import { addReactionSmart, removeReactionSmart } from "@/lib/api";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/api", () => ({
  addReactionSmart: vi.fn(),
  removeReactionSmart: vi.fn(),
}));
vi.mock("@/lib/ui/toast", () => ({ toastError: vi.fn() }));

const mockUseAuth = vi.mocked(useAuth);
const mockAdd = vi.mocked(addReactionSmart);
const mockRemove = vi.mocked(removeReactionSmart);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function authState(token: string | null = "gho_x") {
  mockUseAuth.mockReturnValue({ token, login: vi.fn() } as never);
}

const reactions = [
  { content: "THUMBS_UP", count: 3 },
  { content: "HEART", count: 1, viewerHasReacted: true },
];

describe("ReactionPicker 渲染", () => {
  it("渲染笑脸按钮与 reaction pills", () => {
    authState();
    render(<ReactionPicker subjectId="node123" reactions={reactions} onUpdated={vi.fn()} />);
    // 笑脸按钮（title = reactions.add）
    expect(screen.getByTitle("reactions.add")).toBeInTheDocument();
    // pills：emoji + count
    expect(screen.getByTitle("👍 3")).toBeInTheDocument();
    expect(screen.getByTitle("❤️ 1")).toBeInTheDocument();
  });
});

describe("ReactionPicker 写入", () => {
  it("点击已反应的 pill → removeReactionSmart + onUpdated 回写", async () => {
    authState();
    mockRemove.mockResolvedValue({
      reactions: [{ content: "THUMBS_UP", count: 3 }],
      viewerHasReacted: false,
    });
    const onUpdated = vi.fn();
    render(<ReactionPicker subjectId="node123" reactions={reactions} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByTitle("❤️ 1"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("node123", "HEART", "gho_x"));
    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith([{ content: "THUMBS_UP", count: 3 }], false),
    );
  });

  it("点击未反应的 pill → addReactionSmart", async () => {
    authState();
    mockAdd.mockResolvedValue({
      reactions: [
        { content: "THUMBS_UP", count: 4, viewerHasReacted: true },
        { content: "HEART", count: 1, viewerHasReacted: true },
      ],
      viewerHasReacted: true,
    });
    render(<ReactionPicker subjectId="node123" reactions={reactions} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByTitle("👍 3"));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("node123", "THUMBS_UP", "gho_x"));
  });

  it("未登录点击 → 触发 login({ mode: 'write' })", () => {
    const login = vi.fn();
    mockUseAuth.mockReturnValue({ token: null, login } as never);
    render(<ReactionPicker subjectId="node123" reactions={reactions} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByTitle("reactions.add"));
    expect(login).toHaveBeenCalledWith({ mode: "write" });
  });
});
