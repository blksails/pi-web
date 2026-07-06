import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import type { ToolDiagnostic } from "@blksails/pi-web-canvas-kit";
// resolveToolRailTitle 是 canvas 领域纯函数,canonical 家在 canvas-ui 包入口;
// CanvasWorkbench 沿用 ui 转发层深路径(与兄弟测试一致)。
import { resolveToolRailTitle } from "@blksails/pi-web-canvas-ui";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";

const PROBE = "surface:canvas";

function asset(id: string): GalleryAsset {
  return {
    attachmentId: id,
    displayUrl: `/att/${id}`,
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: "2026-07-02T10:00:00.000Z",
    origin: "tool-output",
  };
}

function fakeSurface(available: boolean): WebExtSurfaceAccess {
  return {
    run: vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true })),
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand: (name: string) => available && name === PROBE,
  };
}

/** 工具语义诊断条目(kind 缺省=工具语义;显式 "tool" 同义)。 */
const diag = (over: Partial<ToolDiagnostic> = {}): ToolDiagnostic => ({
  toolId: "builtin:draw",
  error: "笔刷回调抛错",
  at: 1,
  ...over,
});

beforeEach(() => cleanup());

describe("resolveToolRailTitle(禁用工具 tooltip 诊断,Req 6.3/6.4)", () => {
  it("6.3 工具在 disabledTools 且 diagnostics 命中(工具语义条目)→ title 拼首条 error", () => {
    const title = resolveToolRailTitle(
      "画笔(标注即指令)",
      "builtin:draw",
      ["builtin:draw"],
      [diag({ error: "笔刷回调抛错" })],
    );
    expect(title).toBe("画笔(标注即指令)(已禁用:笔刷回调抛错)");
  });

  it("6.3 同 id 多条诊断 → 取首条 error(收集器追加序稳定)", () => {
    const title = resolveToolRailTitle(
      "画笔",
      "builtin:draw",
      ["builtin:draw"],
      [diag({ error: "第一次" }), diag({ error: "第二次" })],
    );
    expect(title).toBe("画笔(已禁用:第一次)");
  });

  it('6.3 kind 缺省=工具语义 → 命中拼原因', () => {
    const toolEntry: ToolDiagnostic = { toolId: "builtin:draw", error: "e", at: 1 };
    expect(resolveToolRailTitle("画笔", "builtin:draw", ["builtin:draw"], [toolEntry])).toBe(
      "画笔(已禁用:e)",
    );
  });

  it("6.4 未禁用(不在 disabledTools)→ title 逐字节零变(即便有诊断)", () => {
    const base = "画笔(标注即指令)";
    expect(resolveToolRailTitle(base, "builtin:draw", [], [diag()])).toBe(base);
  });

  it("6.4 禁用但无该工具诊断条目 → title 零变(门控禁用不拼原因)", () => {
    const base = "画笔(标注即指令)";
    expect(resolveToolRailTitle(base, "builtin:draw", ["builtin:draw"], [])).toBe(base);
  });

  it('6.3 仅有同 id 的 kind:"action" 条目 → 属动作面非工具轨,title 零变', () => {
    const base = "画笔";
    const actionEntry = diag({ kind: "action", error: "动作构造抛错" });
    expect(resolveToolRailTitle(base, "builtin:draw", ["builtin:draw"], [actionEntry])).toBe(base);
  });

  it("6.3 诊断条目属别的工具 id → 不拼(按 toolId 精确匹配)", () => {
    const base = "画笔";
    expect(
      resolveToolRailTitle(base, "builtin:draw", ["builtin:draw"], [
        diag({ toolId: "builtin:line" }),
      ]),
    ).toBe(base);
  });
});

describe("CanvasWorkbench 工具轨 tooltip 消费(6.4 无诊断零变 · 集成)", () => {
  it("正常渲染(无 runtime 诊断)→ 工具轨按钮 title 均不含「已禁用」,基线 title 原样", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface(true)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    const btns = Array.from(document.querySelectorAll("[data-canvas-tool]"));
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns) {
      expect(b.getAttribute("title") ?? "").not.toContain("已禁用");
    }
    // 扩图工具基线 title 逐字节等于 TOOL_RAIL_TITLES 文案(无诊断路径零变)。
    const expandBtn = document.querySelector('[data-canvas-tool="expand"]');
    expect(expandBtn?.getAttribute("title")).toBe("扩图(拖动边框向外扩,生成填充新区域)");
  });
});
