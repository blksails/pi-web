// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPanesHostElementVisible,
  observePanesHostPresence,
  type PanesHostPresenceBackend,
} from "../src/host-presence.js";

function stubRect(el: Element, width = 200, height = 200): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

function hostEl(attrs: Record<string, string> = {}, style = ""): HTMLElement {
  const el = document.createElement("section");
  el.setAttribute("data-panes-host", "");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.style.cssText = `width:200px;height:200px;${style}`;
  document.body.appendChild(el);
  if (!style.includes("display:none")) stubRect(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isPanesHostElementVisible", () => {
  it("connected 正常尺寸为可见", () => {
    const el = hostEl();
    expect(isPanesHostElementVisible(el)).toBe(true);
  });

  it("data-pi-panel-collapsed 为不可见", () => {
    const el = hostEl({ "data-pi-panel-collapsed": "true" });
    expect(isPanesHostElementVisible(el)).toBe(false);
  });

  it("祖先 data-pi-panel-open=false 为不可见", () => {
    const wrap = document.createElement("aside");
    wrap.setAttribute("data-pi-panel-open", "false");
    const el = document.createElement("section");
    el.setAttribute("data-panes-host", "");
    el.style.cssText = "width:200px;height:200px";
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    expect(isPanesHostElementVisible(el)).toBe(false);
  });

  it("display:none 为不可见", () => {
    const el = hostEl({}, "display:none");
    expect(isPanesHostElementVisible(el)).toBe(false);
  });

  it("未连接为不可见", () => {
    const el = document.createElement("section");
    el.setAttribute("data-panes-host", "");
    expect(isPanesHostElementVisible(el)).toBe(false);
  });
});

describe("observePanesHostPresence", () => {
  it("初始可见时 restore，卸载时 destroy", async () => {
    const el = hostEl();
    const backend: PanesHostPresenceBackend = {
      hideAll: vi.fn(),
      destroyAll: vi.fn(),
      restoreVisible: vi.fn(),
    };
    const off = observePanesHostPresence(el, { backend });
    await vi.waitFor(() => {
      expect(backend.restoreVisible).toHaveBeenCalled();
    });
    off();
    expect(backend.destroyAll).toHaveBeenCalled();
  });

  it("折叠标记变化时 hide", async () => {
    const wrap = document.createElement("aside");
    wrap.setAttribute("data-pi-panel-open", "true");
    const el = document.createElement("section");
    el.setAttribute("data-panes-host", "");
    el.style.cssText = "width:200px;height:200px";
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    stubRect(el);

    const backend: PanesHostPresenceBackend = {
      hideAll: vi.fn(),
      destroyAll: vi.fn(),
      restoreVisible: vi.fn(),
    };
    const off = observePanesHostPresence(el, { backend });
    await vi.waitFor(() => expect(backend.restoreVisible).toHaveBeenCalled());

    wrap.setAttribute("data-pi-panel-open", "false");
    // MutationObserver + rAF
    await vi.waitFor(() => expect(backend.hideAll).toHaveBeenCalled(), { timeout: 1000 });
    off();
  });
});
