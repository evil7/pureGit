/**
 * vitest 测试 setup（所有测试文件加载）
 *
 * 职责：
 * - jest-dom matchers（@testing-library/react 组件测试用 toBeInTheDocument 等）
 * - happy-dom / jsdom 环境缺失的浏览器 API polyfill：
 *   ResizeObserver（radix-ui popover/dialog 定位）、matchMedia（useIsDark/useTheme 媒体查询）、
 *   scrollIntoView（下拉滚动）。node 环境测试（纯函数）加载无副作用。
 *
 * 注意：不要在此引入 @testing-library/react 的 cleanup——vitest 组件测试文件
 * 各自使用 `@testing-library/react`（RTL 自动注册 afterEach cleanup）。
 */
import "@testing-library/jest-dom/vitest";

/** radix-ui 原语（Dialog/Popover/Tooltip）定位依赖 ResizeObserver */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

/** 暗色主题 hook（useIsDark/useTheme）依赖 matchMedia */
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}

/** 下拉/滚动容器依赖 scrollIntoView（radix Select/DropdownMenu）；node 环境无 Element 需守卫 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
