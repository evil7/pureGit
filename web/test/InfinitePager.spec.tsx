/**
 * ============================================================================
 * InfinitePager 无限翻页器组件测试（happy-dom + @testing-library/react）—— 质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * InfinitePager 与 Pager（有 totalPages 页码窗口）互补，服务**总数未知**（至多 999 页）的
 * 分页式搜索（首页动态/热点）：翻页器不显示假总页数，只有上/下翻 + 输入跳页。
 * - 布局：左侧 [<上一页] [下一页>]（文字按钮）+ 右侧 [数字输入] / 页（justify-between）
 * - 上一页 disabled = page<=1；下一页 disabled = endReached（父组件探测到末页）
 * - 输入框：Enter/失焦提交（1~999 整数）；非法输入回退当前页不触发 onChange
 * - 页码变化（外部 page prop）→ 输入框同步显示
 *
 * 【测试方式】happy-dom 组件测试，i18n mock（t/tStatic 返回 key），零网络请求。
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InfinitePager } from "@/components/InfinitePager";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }), tStatic: (k: string) => k }));

afterEach(cleanup);

const getPrev = () => screen.getByRole("button", { name: /actions\.previous/ });
const getNext = () => screen.getByRole("button", { name: /actions\.next/ });
const getInput = () => screen.getByRole("spinbutton");

describe("InfinitePager 布局（第 [输入] 页 + 对齐 Pager 按钮样式）", () => {
  it("渲染 [上一页] [下一页] + 第 [输入] 页 前缀/后缀", () => {
    render(<InfinitePager page={2} onChange={vi.fn()} />);
    expect(getPrev()).toBeInTheDocument();
    expect(getNext()).toBeInTheDocument();
    // 前缀/后缀（mock t 返回 key：pager.pagePrefix / pager.pageSuffix）
    expect(screen.getByText("pager.pagePrefix")).toBeInTheDocument();
    expect(screen.getByText("pager.pageSuffix")).toBeInTheDocument();
  });

  it("按钮样式对齐 Pager（ghost 变体 + 默认尺寸，无 outline 边框色）", () => {
    render(<InfinitePager page={2} onChange={vi.fn()} />);
    // shadcn Button ghost 变体：hover:bg-muted 且无 outline 的 border-border/dark:border-input 边框色
    expect(getPrev().className).toContain("hover:bg-muted");
    expect(getPrev().className).not.toContain("border-border");
  });
});

describe("InfinitePager 翻页按钮", () => {
  it("page=1 上一页禁用；点击下一页 → onChange(page+1)", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={1} onChange={onChange} />);
    expect(getPrev()).toBeDisabled();
    fireEvent.click(getNext());
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("endReached 下一页禁用；上一页仍可点", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={3} endReached onChange={onChange} />);
    expect(getNext()).toBeDisabled();
    expect(getPrev()).toBeEnabled();
    fireEvent.click(getPrev());
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("上一页不越过 1（page=1 禁用；不触发 onChange）", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={1} onChange={onChange} />);
    fireEvent.click(getPrev());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("InfinitePager 输入跳页", () => {
  it("Enter 提交有效页码 → onChange(p)", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={1} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "5" } });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("失焦提交有效页码 → onChange(p)", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={1} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "7" } });
    fireEvent.blur(getInput());
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("输入当前页 → 不触发 onChange", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={3} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "3" } });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("非法输入（非数字）→ 回退当前页，不触发 onChange", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={2} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "abc" } });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(getInput()).toHaveValue(2);
  });

  it("输入超过 999 → 回退当前页，不触发 onChange", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={2} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "1500" } });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(getInput()).toHaveValue(2);
  });

  it("输入 0 / 负数 → 回退当前页", () => {
    const onChange = vi.fn();
    render(<InfinitePager page={2} onChange={onChange} />);
    fireEvent.change(getInput(), { target: { value: "0" } });
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(getInput()).toHaveValue(2);
  });

  it("外部 page 变化 → 输入框同步显示", () => {
    const onChange = vi.fn();
    const { rerender } = render(<InfinitePager page={1} onChange={onChange} />);
    fireEvent.click(getNext());
    rerender(<InfinitePager page={2} onChange={onChange} />);
    expect(getInput()).toHaveValue(2);
  });
});
