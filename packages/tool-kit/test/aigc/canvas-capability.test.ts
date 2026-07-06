/**
 * buildCanvasCapability 单测(canvas-actions-m2 task 2.1 / Req 4.1/4.7)。
 *
 * capability 同源生成:models 来自 deriveActiveModels(与 publishAigcCatalog 同一推导),provider
 * 决定尺寸族;全局 sizes 三档守恒(= workbench RATIO_OPTIONS);actions 为 A 档六命令白名单。
 * 读设置异常时兜底为「全量 catalog(空 disabled)」确定性输出,不抛。
 */
import { describe, it, expect, vi } from "vitest";

// 可切换的读设置抛错开关(测「读设置异常兜底」路径);filterRoutes 等其余导出保持真实实现。
const h = vi.hoisted(() => ({ throwOnResolve: false }));
vi.mock("../../src/aigc/model-config.js", async (orig) => {
  const actual = await orig<typeof import("../../src/aigc/model-config.js")>();
  return {
    ...actual,
    resolveAigcToolSettings: (dir?: string) => {
      if (h.throwOnResolve) throw new Error("read failed");
      return actual.resolveAigcToolSettings(dir);
    },
  };
});

import { buildCanvasCapability } from "../../src/aigc/canvas/capability.js";

const DASHSCOPE_SIZES = ["1024x1024", "1280x720", "720x1280"];
const DEFAULT_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

describe("buildCanvasCapability", () => {
  it("被禁模型不出现在 models(同源过滤)", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set(["gpt-image-2"]) });
    const ids = cap.models.map((m) => m.id);
    expect(ids).not.toContain("gpt-image-2");
    // 其余模型仍在
    expect(ids).toContain("wan2.7-image-pro");
  });

  it("dashscope 模型用 dashscope 尺寸族,其余模型用默认尺寸族", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set() });
    const wan = cap.models.find((m) => m.id === "wan2.7-image-pro");
    const gpt = cap.models.find((m) => m.id === "gpt-image-2");
    expect(wan).toBeDefined();
    expect(gpt).toBeDefined();
    expect(wan?.sizes).toEqual(DASHSCOPE_SIZES);
    expect(gpt?.sizes).toEqual(DEFAULT_SIZES);
  });

  it("models[].label 取自路由标签", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set() });
    const gpt = cap.models.find((m) => m.id === "gpt-image-2");
    expect(gpt?.label).toBe("GPT Image 2 · NewAPI");
  });

  it("全局 sizes 三档守恒(与 workbench RATIO_OPTIONS 一致)", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set() });
    expect(cap.sizes).toEqual([
      { label: "1:1", size: "1024x1024" },
      { label: "16:9", size: "1280x720" },
      { label: "9:16", size: "720x1280" },
    ]);
  });

  it("actions 恰为 A 档六命令且顺序固定", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set() });
    expect(cap.actions).toEqual([
      "edit",
      "inpaint",
      "reference",
      "variants",
      "outpaint",
      "reframe",
    ]);
    expect(cap.actions).toHaveLength(6);
  });

  it("确定性:同输入两次调用深相等", () => {
    const a = buildCanvasCapability({ disabledModels: new Set(["gpt-image-2"]) });
    const b = buildCanvasCapability({ disabledModels: new Set(["gpt-image-2"]) });
    expect(a).toEqual(b);
  });

  it("读设置抛错时兜底为全量 catalog(空 disabled)且不抛", () => {
    h.throwOnResolve = true;
    try {
      let cap!: ReturnType<typeof buildCanvasCapability>;
      expect(() => {
        cap = buildCanvasCapability();
      }).not.toThrow();
      const ids = cap.models.map((m) => m.id);
      // 兜底=空 disabled → 全量,被禁前提不生效,gpt-image-2 仍在
      expect(ids).toContain("gpt-image-2");
      expect(ids).toContain("wan2.7-image-pro");
    } finally {
      h.throwOnResolve = false;
    }
  });
});
