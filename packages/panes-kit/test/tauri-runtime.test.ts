import { describe, expect, it, vi } from "vitest";
import {
  createGlobalTauriPaneViewAdapter,
  isTauriNativePaneLayout,
  publishTauriContentWellMetrics,
  resolveTauriPaneInstanceId,
  setTauriPaneLayoutMetrics,
  setTauriPaneLayoutMode,
} from "../src/adapters/tauri-runtime.js";

describe("Tauri Pane runtime", () => {
  it("uses the query instance id instead of the epoch-suffixed native label", () => {
    expect(resolveTauriPaneInstanceId(
      "http://127.0.0.1/pane.html?pi-pane-instance=materials-4#pi-pane-instance=materials-4",
      "pane-materials-4-2",
    )).toBe("materials-4");
  });

  it("removes the epoch when only the native label survives", () => {
    expect(resolveTauriPaneInstanceId(
      "http://127.0.0.1/pane.html",
      "pane-materials-4-2",
    )).toBe("materials-4");
  });

  it("creates one host adapter per document so StrictMode cannot repeat cleanup", () => {
    const invoke = vi.fn(() => Promise.resolve());
    const target = {
      __TAURI__: {
        core: { invoke },
        event: { listen: vi.fn(() => Promise.resolve(() => undefined)) },
        window: {
          getCurrentWindow: () => ({
            innerPosition: () => Promise.resolve({ x: 0, y: 0 }),
            scaleFactor: () => Promise.resolve(1),
          }),
        },
      },
    } as unknown as Window;

    const first = createGlobalTauriPaneViewAdapter(target);
    const second = createGlobalTauriPaneViewAdapter(target);

    expect(second).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("pane_webview_cleanup");
    expect(invoke).toHaveBeenCalledWith("pane_layout_is_native");
  });

  it("sends semantic layout state instead of raw webview bounds", async () => {
    const invoke = vi.fn(() => Promise.resolve());
    const target = {
      __TAURI__: {
        core: { invoke },
        window: { getCurrentWindow: () => ({}) },
      },
    } as unknown as Window;

    await setTauriPaneLayoutMetrics({ paneWidth: 360, minWidth: 240 }, target);
    await setTauriPaneLayoutMode("workspace", target);

    expect(invoke).toHaveBeenNthCalledWith(1, "pane_layout_set_metrics", {
      metrics: { paneWidth: 360, minWidth: 240 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "pane_layout_set_mode", {
      mode: "workspace",
    });
  });

  it("publishes content-well geometry for native child overlay", async () => {
    const invoke = vi.fn(() => Promise.resolve());
    const target = {
      innerHeight: 800,
      __TAURI__: {
        core: { invoke },
        window: { getCurrentWindow: () => ({}) },
      },
    } as unknown as Window;
    const well = {
      getBoundingClientRect: () => ({
        left: 520,
        top: 40,
        width: 400,
        height: 700,
        right: 920,
        bottom: 740,
        x: 520,
        y: 40,
        toJSON: () => ({}),
      }),
    } as unknown as Element;

    await publishTauriContentWellMetrics(well, { minWidth: 240, target });

    expect(invoke).toHaveBeenCalledWith("pane_layout_set_metrics", {
      metrics: {
        leftWidth: 520,
        topHeight: 40,
        paneWidth: 400,
        bottomHeight: 60,
        minWidth: 240,
      },
    });
  });

  it("detects native layout flag via pane_layout_is_native", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "pane_layout_is_native") return true;
      return undefined;
    });
    const target = {
      __TAURI__: {
        core: { invoke },
        window: { getCurrentWindow: () => ({}) },
      },
    } as unknown as Window;

    await expect(isTauriNativePaneLayout(target)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("pane_layout_is_native");
  });
});
