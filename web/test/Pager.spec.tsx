/**
 * ============================================================================
 * Pager 组件测试（happy-dom + @testing-library/react）—— 通用翻页器质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * Pager 是核心页（HomePage/Issues/Pulls 等）统一复用的通用翻页器（shadcn Pagination）：
 * - totalPages <= 1 → 返回 null（不渲染，避免孤立的翻页条）
 * - 页码窗口 = 当前页 ±2 + 首尾页；中间折叠为省略号（"…"）
 * - 上一页/下一页：边界禁用（page<=1 前禁用 / page>=totalPages 后禁用，pointer-events-none + opacity-50）
 * - 点击非当前页码 → onChange(p)；点击当前页 → 不触发（无 onChange 调用）
 * - 语义：当前页 PaginationLink isActive（aria-current="page"）
 *
 * 【UI/UX 一致性】本测试同时作为 UI 一致性基线：
 * - 禁用态 class 必须是 `pointer-events-none opacity-50`（shadcn 约定）
 * - 翻页器容器 Pagination 有 mt-4（与内容留白，对齐设计规范）
 *
 * 【测试方式】happy-dom 组件测试，零网络请求。
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Pager } from "@/components/Pager";

afterEach(cleanup);

describe("Pager 渲染", () => {
  it("totalPages<=1 → 不渲染（返回 null）", () => {
    const { container } = render(<Pager page={1} totalPages={1} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("totalPages=0 → 不渲染", () => {
    const { container } = render(<Pager page={1} totalPages={0} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("5 页内全部显示（无省略号），页码 1..5 且当前页高亮", () => {
    const { container } = render(<Pager page={3} totalPages={5} onChange={vi.fn()} />);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("link", { name: String(n) })).toBeInTheDocument();
    }
    // 当前页 aria-current（isActive 语义）
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "2" })).not.toHaveAttribute("aria-current", "page");
    // 无省略号（aria-hidden 图标，用 data-slot 查询）
    expect(container.querySelector('[data-slot="pagination-ellipsis"]')).toBeNull();
  });

  it("页码窗口 = 当前页 ±2 + 首尾，中间折叠省略号", () => {
    const { container } = render(<Pager page={10} totalPages={20} onChange={vi.fn()} />);
    // 首尾 + 窗口（8..12）出现
    for (const n of [1, 20, 8, 9, 10, 11, 12]) {
      expect(screen.getByRole("link", { name: String(n) })).toBeInTheDocument();
    }
    // 窗口外（如 5、15）不出现
    expect(screen.queryByRole("link", { name: "5" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "15" })).not.toBeInTheDocument();
    // 两个省略号（1..8 之间、12..20 之间）
    expect(container.querySelectorAll('[data-slot="pagination-ellipsis"]')).toHaveLength(2);
  });

  it("首页附近（page=2）窗口与省略号正确（1 2 3 4 … 20）", () => {
    const { container } = render(<Pager page={2} totalPages={20} onChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: "4" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "5" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="pagination-ellipsis"]')).toHaveLength(1);
  });
});

describe("Pager 交互", () => {
  it("点击非当前页码 → onChange(p)；点击当前页 → 不触发", () => {
    const onChange = vi.fn();
    render(<Pager page={3} totalPages={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole("link", { name: "5" }));
    expect(onChange).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("link", { name: "3" })); // 当前页
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("上一页：page>1 可点 → onChange(page-1)", () => {
    const onChange = vi.fn();
    render(<Pager page={3} totalPages={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole("link", { name: "Go to previous page" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("下一页：page<totalPages 可点 → onChange(page+1)", () => {
    const onChange = vi.fn();
    render(<Pager page={3} totalPages={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole("link", { name: "Go to next page" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("首尾禁用态：page=1 上一页禁用（pointer-events-none + opacity-50），点击不触发", () => {
    const onChange = vi.fn();
    render(<Pager page={1} totalPages={5} onChange={onChange} />);
    const prev = screen.getByRole("link", { name: "Go to previous page" });
    expect(prev).toHaveClass("pointer-events-none");
    expect(prev).toHaveClass("opacity-50");
    fireEvent.click(prev);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("末页下一页禁用（pointer-events-none + opacity-50）", () => {
    const onChange = vi.fn();
    render(<Pager page={5} totalPages={5} onChange={onChange} />);
    const next = screen.getByRole("link", { name: "Go to next page" });
    expect(next).toHaveClass("pointer-events-none");
    expect(next).toHaveClass("opacity-50");
    fireEvent.click(next);
    expect(onChange).not.toHaveBeenCalled();
  });
});
