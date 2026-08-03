// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observePaneResizeFrame } from "../src/resize-frame.js";

afterEach(() => vi.unstubAllGlobals());

describe("observePaneResizeFrame", () => {
  it("coalesces resize notifications to the latest value in one frame", () => {
    let notify: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe(): void {}
      disconnect(): void {
        disconnect();
      }
    });
    let flush: FrameRequestCallback = () => undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      flush = callback;
      return 1;
    });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const seen: Array<{ width: number; height: number }> = [];
    const element = document.createElement("div");
    const dispose = observePaneResizeFrame(element, (frame) => seen.push(frame));
    const entry = (width: number, height: number): ResizeObserverEntry =>
      ({ contentRect: { width, height } }) as ResizeObserverEntry;

    notify([entry(320, 180)], {} as ResizeObserver);
    notify([entry(480, 270)], {} as ResizeObserver);
    expect(seen).toEqual([]);
    flush(0);
    expect(seen).toEqual([{ width: 480, height: 270 }]);

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
