// Radix UI(Select/Popover)在 jsdom 下需要以下未实现的 DOM API 的 polyfill
// (照 packages/ui/test/setup.ts 先例,去掉 jest-dom——本包用原生断言)。
if (typeof window !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = (): boolean => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = (): void => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = (): void => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (): void => undefined;
  }
  if (typeof window.ResizeObserver === "undefined") {
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
  if (typeof DOMRect === "undefined") {
    // 一些 Radix 测量路径依赖 DOMRect。
    (globalThis as unknown as { DOMRect: unknown }).DOMRect = class {
      x = 0;
      y = 0;
      width = 0;
      height = 0;
      top = 0;
      right = 0;
      bottom = 0;
      left = 0;
    };
  }
}
