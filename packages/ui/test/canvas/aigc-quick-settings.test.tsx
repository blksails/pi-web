/**
 * AigcQuickSettings 单元测试(aigc-prompt-toolbar tasks 3.2)。
 *
 * 覆盖:无接入返回 null(7.2)/ 清单来自共享状态与常量回退(2.2/3.1)/ 选择写偏好 +
 * 本地记忆(2.3/3.2/6.1)/ 订阅推送回显更新(5.2)/ 挂载 seed 回填(6.1/6.3)/ 默认态
 * 占位(2.4/3.3)。fake WebExtStateAccess 全程注入。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { AigcQuickSettings } from "../../src/canvas/aigc-quick-settings.js";
import type { WebExtStateAccess } from "@blksails/pi-web-kit";

/** fake 状态接入:内存 Map + 订阅分发 + set 记录。 */
function makeFakeState(init: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(init));
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const sets: Array<[string, unknown]> = [];
  const state: WebExtStateAccess = {
    get: <T = unknown,>(k: string) => store.get(k) as T | undefined,
    subscribe: (k, l) => {
      const set = listeners.get(k) ?? new Set();
      set.add(l);
      listeners.set(k, set);
      return () => set.delete(l);
    },
    set: async (k, v) => {
      store.set(k, v);
      sets.push([k, v]);
      listeners.get(k)?.forEach((l) => l(v));
    },
    delete: async (k) => {
      store.delete(k);
      listeners.get(k)?.forEach((l) => l(undefined));
    },
  };
  /** 模拟外部写回(如工具追问经下行帧):直接落 store 并通知订阅者。 */
  const push = (k: string, v: unknown): void => {
    store.set(k, v);
    listeners.get(k)?.forEach((l) => l(v));
  };
  return { state, sets, push, store };
}

describe("AigcQuickSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("state 缺失 → 返回 null,不呈现不报错(7.2)", () => {
    render(<AigcQuickSettings />);
    expect(document.querySelector("[data-aigc-quick-settings]")).toBeNull();
  });

  it("默认态:无选择且无记忆 → 两个选择器显示占位(2.4/3.3)", () => {
    const { state } = makeFakeState();
    render(<AigcQuickSettings state={state} />);
    const root = document.querySelector("[data-aigc-quick-settings]");
    expect(root).not.toBeNull();
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain("图像模型");
    expect(document.querySelector("[data-aigc-size-select]")?.textContent).toContain("尺寸");
  });

  it("清单来自共享状态;未就绪回退内置常量(2.2/3.1)", () => {
    const { state } = makeFakeState({ "aigc.models": ["only-model-a"] });
    render(<AigcQuickSettings state={state} />);
    fireEvent.click(document.querySelector("[data-aigc-model-select]")!);
    const options = Array.from(document.querySelectorAll("[role=option]")).map(
      (o) => o.textContent,
    );
    expect(options).toContain("only-model-a"); // KV 清单生效
    expect(options).not.toContain("gpt-image-2"); // 不再混入 fallback
  });

  it("有 label 映射 → 选项可见文本用 label,hover title 用模型 id", () => {
    const { state } = makeFakeState({
      "aigc.models": ["gpt-image-2", "wan2.7-image-pro"],
      "aigc.modelLabels": {
        "gpt-image-2": "GPT Image 2 · NewAPI",
        "wan2.7-image-pro": "Wan 2.7 Image Pro",
      },
    });
    render(<AigcQuickSettings state={state} />);
    fireEvent.click(document.querySelector("[data-aigc-model-select]")!);
    const opts = Array.from(document.querySelectorAll("[role=option]"));
    const labelOpt = opts.find((o) => o.getAttribute("title") === "gpt-image-2");
    expect(labelOpt).toBeDefined();
    expect(labelOpt?.textContent).toContain("GPT Image 2 · NewAPI"); // 可见=label
    expect(labelOpt?.textContent).not.toContain("gpt-image-2"); // id 不作可见文本
  });

  it("有 provider 映射 → 字母徽章 + 去掉冗余 provider 名后缀(保留非 provider 后缀)", () => {
    const { state } = makeFakeState({
      "aigc.models": ["gpt-image-2", "wan2.7-image-pro-bailian"],
      "aigc.modelLabels": {
        "gpt-image-2": "GPT Image 2 · NewAPI",
        "wan2.7-image-pro-bailian": "Wan 2.7 Image Pro · token plan",
      },
      "aigc.modelProviders": {
        "gpt-image-2": "newapi",
        "wan2.7-image-pro-bailian": "dashscope",
      },
    });
    render(<AigcQuickSettings state={state} />);
    fireEvent.click(document.querySelector("[data-aigc-model-select]")!);
    const opts = Array.from(document.querySelectorAll("[role=option]"));
    const newapiOpt = opts.find((o) => o.getAttribute("title") === "gpt-image-2");
    expect(newapiOpt?.textContent).toContain("N"); // 字母徽章
    expect(newapiOpt?.textContent).toContain("GPT Image 2"); // 干净名
    expect(newapiOpt?.textContent).not.toContain("NewAPI"); // provider 名后缀由徽章取代
    const dashOpt = opts.find(
      (o) => o.getAttribute("title") === "wan2.7-image-pro-bailian",
    );
    expect(dashOpt?.textContent).toContain("D"); // 字母徽章
    expect(dashOpt?.textContent).toContain("token plan"); // 非 provider 后缀保留
  });

  it("缺 label 映射的模型 → 选项回退显示 id(title 仍为 id)", () => {
    const { state } = makeFakeState({
      "aigc.models": ["no-label-model"],
      "aigc.modelLabels": {},
    });
    render(<AigcQuickSettings state={state} />);
    fireEvent.click(document.querySelector("[data-aigc-model-select]")!);
    const opt = Array.from(document.querySelectorAll("[role=option]")).find(
      (o) => o.getAttribute("title") === "no-label-model",
    );
    expect(opt?.textContent).toContain("no-label-model");
  });

  it("选择模型 → 写会话偏好 + 本地记忆(2.3/6.1 前半)", () => {
    const { state, sets } = makeFakeState({ "aigc.models": ["model-x", "model-y"] });
    render(<AigcQuickSettings state={state} />);
    fireEvent.click(document.querySelector("[data-aigc-model-select]")!);
    const opt = Array.from(document.querySelectorAll("[role=option]")).find(
      (o) => o.textContent === "model-x",
    );
    fireEvent.click(opt!);
    expect(sets).toContainEqual(["aigc.model", "model-x"]);
    expect(window.localStorage.getItem("pi-web.aigc.model")).toBe("model-x");
  });

  it("外部写回(工具追问)推送 → 回显自动更新(5.2)", () => {
    const { state, push } = makeFakeState();
    render(<AigcQuickSettings state={state} />);
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain("图像模型");
    act(() => push("aigc.model", "wan2.7-image-pro"));
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain(
      "wan2.7-image-pro",
    );
  });

  it("挂载 seed(延迟后):会话偏好为空且本地记忆存在 → 回填会话 KV(6.1/6.3)", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("pi-web.aigc.model", "remembered-model");
    window.localStorage.setItem("pi-web.aigc.size", "1536x1024");
    const { state, sets } = makeFakeState();
    render(<AigcQuickSettings state={state} />);
    // 延迟窗口内不 seed(竞态防护)。
    expect(sets.some(([k]) => k === "aigc.model")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(sets).toContainEqual(["aigc.model", "remembered-model"]);
    expect(sets).toContainEqual(["aigc.size", "1536x1024"]);
    // 回显 seed 后的值。
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain(
      "remembered-model",
    );
    vi.useRealTimers();
  });

  it("会话已有偏好时 seed 不覆盖(会话态优先于本地记忆)", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("pi-web.aigc.model", "old-remembered");
    const { state, sets } = makeFakeState({ "aigc.model": "session-current" });
    render(<AigcQuickSettings state={state} />);
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(sets.some(([k, v]) => k === "aigc.model" && v === "old-remembered")).toBe(false);
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain(
      "session-current",
    );
    vi.useRealTimers();
  });

  it("seed 竞态防护:延迟窗口内粘性回放出会话真值 → 不被本地旧值覆盖", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("pi-web.aigc.model", "stale-local");
    const { state, sets, push } = makeFakeState(); // mount 时 KV 尚空(回放未到)
    render(<AigcQuickSettings state={state} />);
    // 300ms:粘性帧回放出会话真值。
    await act(async () => {
      vi.advanceTimersByTime(300);
      push("aigc.model", "session-truth");
    });
    // 越过 seed 延迟:判空发现已有真值 → 不写 stale-local。
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(sets.some(([, v]) => v === "stale-local")).toBe(false);
    expect(document.querySelector("[data-aigc-model-select]")?.textContent).toContain(
      "session-truth",
    );
    vi.useRealTimers();
  });
});
