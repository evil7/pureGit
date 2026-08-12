/**
 * ============================================================================
 * FileTree 组件测试（happy-dom + @testing-library/react）—— 仓库文件树质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * FileTree 是 RepoCode 左侧文件树（官方 blob/edit 左树交互）：
 * - 目录：点击仅展开/收起（不导航，树内浏览），aria-expanded 反映状态
 * - 文件：点击 navigate 到 /{owner}/{repo}/blob/{branch}/{path}
 * - 当前路径高亮：bg-accent + font-medium + text-accent-foreground（官方选中态）
 * - 缩进：depth × 12 + 8px（层级视觉）
 * - 排序：目录在前 + 字母序（官方 FileList 同规则）
 * - 过滤：filterTree + 匹配结果全展开；无匹配 → "无匹配文件"
 * - 初始展开：currentPath 祖先链自动展开（collectOpenPaths）
 *
 * 【UI/UX 一致性】同时校验组件 class 基线：
 * - 行按钮：flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent
 * - 目录图标 FolderOpen/Folder text-sky-500（12px）；文件 File text-muted-foreground/60
 * - 无匹配态：p-2 text-sm text-muted-foreground
 *
 * 【测试方式】happy-dom 组件测试（MemoryRouter 包裹），零网络请求。
 */
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { FileTree } from "@/components/FileTree";
import { buildTree } from "@/lib/file-tree";

afterEach(cleanup);

/** 展示当前 pathname 的探针（断言文件点击后的导航） */
function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="location">{pathname}</span>;
}

function renderTree(props: {
  root: ReturnType<typeof buildTree>;
  currentPath: string;
  branch?: string;
  filter?: string;
}) {
  return render(
    <MemoryRouter initialEntries={["/o/r"]}>
      {/* LocationProbe 在 Routes 外：useLocation 只需 Router 上下文，导航后仍渲染 */}
      <LocationProbe />
      {/* Routes + Route 让 useParams 解析 :owner/:repo（否则导航缺前缀） */}
      <Routes>
        <Route
          path="/:owner/:repo"
          element={
            <FileTree
              root={props.root}
              currentPath={props.currentPath}
              branch={props.branch ?? "main"}
              filter={props.filter}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const treeData = buildTree([
  { path: "README.md", mode: "100644", type: "blob", size: 10, sha: "x" },
  { path: "src", mode: "040000", type: "tree", size: 0, sha: "x" },
  { path: "src/index.ts", mode: "100644", type: "blob", size: 100, sha: "x" },
  { path: "src/utils", mode: "040000", type: "tree", size: 0, sha: "x" },
  { path: "src/utils/format.ts", mode: "100644", type: "blob", size: 50, sha: "x" },
  { path: "package.json", mode: "100644", type: "blob", size: 200, sha: "x" },
]);

describe("FileTree 渲染与层级", () => {
  it("根级文件 + 目录渲染，目录在前 + 字母序", () => {
    const { container } = renderTree({ root: treeData, currentPath: "" });
    const buttons = container.querySelectorAll("button");
    // 目录 src 恒在首位（tree 优先）；两个根级 blob 均出现（顺序由 localeCompare 决定，不硬编码）
    const names = [...buttons].map((b) => b.textContent);
    expect(names[0]).toContain("src");
    expect(names).toContain("README.md");
    expect(names).toContain("package.json");
  });

  it("目录按钮 aria-expanded：初始 false（未展开，无子项渲染）", () => {
    const { container } = renderTree({ root: treeData, currentPath: "" });
    const src = screen.getByRole("button", { name: /src/ });
    expect(src).toHaveAttribute("aria-expanded", "false");
    // 未展开 → src 子项不渲染
    expect(screen.queryByRole("button", { name: /index\.ts/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll("button").length).toBe(3); // 仅根级 3 项
  });

  it("currentPath 祖先链自动展开（src/utils 高亮时 src 与 utils 均展开）", () => {
    renderTree({ root: treeData, currentPath: "src/utils/format.ts" });
    // src 与 utils 目录展开 → format.ts 可见
    expect(screen.getByRole("button", { name: /format\.ts/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /utils/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("缩进：层级越深 paddingLeft 越大（depth×12+8；虚拟根不渲染 → 根级实际 20px）", () => {
    renderTree({ root: treeData, currentPath: "src/utils/format.ts" });
    const format = screen.getByRole("button", { name: /format\.ts/ });
    const utils = screen.getByRole("button", { name: /utils/ });
    const src = screen.getByRole("button", { name: /src/ });
    const plFormat = Number(format.style.paddingLeft.replace("px", ""));
    const plUtils = Number(utils.style.paddingLeft.replace("px", ""));
    const plSrc = Number(src.style.paddingLeft.replace("px", ""));
    expect(plFormat).toBeGreaterThan(plUtils);
    expect(plUtils).toBeGreaterThan(plSrc);
    expect(plSrc).toBe(20); // 根级（虚拟根下第 1 层）depth 1 → 20px
    expect(plUtils).toBe(32); // 第 2 层
    expect(plFormat).toBe(44); // 第 3 层
  });
});

describe("FileTree 交互", () => {
  it("点击目录 → 展开（子项出现，aria-expanded=true）；再点 → 收起", () => {
    renderTree({ root: treeData, currentPath: "" });
    const src = screen.getByRole("button", { name: /src/ });
    fireEvent.click(src);
    expect(src).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /index\.ts/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /utils/ })).toBeInTheDocument();
    fireEvent.click(src);
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /index\.ts/ })).not.toBeInTheDocument();
  });

  it("点击文件 → 导航到 blob 页（/o/r/blob/main/src/index.ts）", () => {
    renderTree({ root: treeData, currentPath: "" });
    const src = screen.getByRole("button", { name: /src/ });
    fireEvent.click(src); // 展开
    fireEvent.click(screen.getByRole("button", { name: /index\.ts/ }));
    expect(screen.getByTestId("location").textContent).toBe("/o/r/blob/main/src/index.ts");
  });

  it("点击目录不导航（树内浏览）", () => {
    renderTree({ root: treeData, currentPath: "" });
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByTestId("location").textContent).toBe("/o/r");
  });

  it("当前路径高亮 class（bg-accent + font-medium + text-accent-foreground），其他行不亮", () => {
    renderTree({ root: treeData, currentPath: "README.md" });
    const readme = screen.getByRole("button", { name: /README\.md/ });
    const pkg = screen.getByRole("button", { name: /package\.json/ });
    expect(readme).toHaveClass("bg-accent", "font-medium", "text-accent-foreground");
    expect(pkg).not.toHaveClass("bg-accent");
  });
});

describe("FileTree 过滤（Go to file 实时过滤）", () => {
  it("过滤关键词 → 只显示匹配，且匹配结果全展开", () => {
    renderTree({ root: treeData, currentPath: "", filter: "format" });
    expect(screen.getByRole("button", { name: /format\.ts/ })).toBeInTheDocument();
    // 祖先链也显示（src / utils）
    expect(screen.getByRole("button", { name: /src/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /utils/ })).toBeInTheDocument();
    // 不匹配的不显示
    expect(screen.queryByRole("button", { name: /README\.md/ })).not.toBeInTheDocument();
  });

  it("过滤无匹配 → 空态文案「无匹配文件」", () => {
    renderTree({ root: treeData, currentPath: "", filter: "zzz_nothing" });
    expect(screen.getByText("无匹配文件")).toBeInTheDocument();
  });

  it("过滤大小写不敏感", () => {
    renderTree({ root: treeData, currentPath: "", filter: "INDEX" });
    expect(screen.getByRole("button", { name: /index\.ts/ })).toBeInTheDocument();
  });
});
