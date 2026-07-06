/**
 * Task 2.1 — WebExtension.canvasPlugins key + CanvasPluginBundle structural mirror
 * (Req 4.1 / 4.4 / 5.1; design「web-kit · canvasPlugins 键(结构镜像)」).
 *
 * RED→GREEN: written before the type change. The compile-time coverage lives in
 * the typed literals below (a missing key / missing export fails `tsc --noEmit`);
 * the runtime asserts keep vitest exercising the same seam.
 */
import { describe, expect, it } from "vitest";
import { defineWebExtension } from "../src/define-web-extension.js";
import type {
  WebExtension,
  CanvasPluginBundle,
} from "../src/define-web-extension.js";

describe("CanvasPluginBundle structural mirror (task 2.1)", () => {
  it("accepts a minimal bundle (id only)", () => {
    const bundle: CanvasPluginBundle = { id: "stickers" };
    expect(bundle.id).toBe("stickers");
  });

  it("accepts the full bundle shape (requires + component slots as unknown)", () => {
    // Component-position fields are width `unknown` in the mirror — any value is
    // assignable; canonical shapes live in canvas-kit and are consumed there.
    const bundle: CanvasPluginBundle = {
      id: "stickers",
      requires: ["stickers:sticker"],
      tools: [{ id: "sticker" }],
      layers: [{ type: "sticker" }],
      actions: [{ id: "style_transfer" }],
    };
    expect(bundle.requires).toEqual(["stickers:sticker"]);
    expect(bundle.tools).toHaveLength(1);
    expect(bundle.layers).toHaveLength(1);
    expect(bundle.actions).toHaveLength(1);
  });
});

describe("WebExtension.canvasPlugins key (task 2.1)", () => {
  it("WebExtension accepts a canvasPlugins array of bundles", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      canvasPlugins: [{ id: "stickers", requires: ["stickers:sticker"] }],
    };
    expect(ext.canvasPlugins).toHaveLength(1);
    expect(ext.canvasPlugins?.[0]?.id).toBe("stickers");
  });

  it("canvasPlugins coexists with existing keys (slots/renderers) — Req 4.4", () => {
    const ext = defineWebExtension({
      manifestId: "acme",
      slots: { panelRight: null },
      renderers: { tools: {} },
      canvasPlugins: [{ id: "stickers" }],
    });
    // Identity helper returns the same reference; all keys survive side by side.
    expect(ext.slots).toBeDefined();
    expect(ext.renderers).toBeDefined();
    expect(ext.canvasPlugins).toHaveLength(1);
  });

  it("canvasPlugins is optional (omitting it is a valid WebExtension) — Req 4.3", () => {
    const ext: WebExtension = { manifestId: "acme" };
    expect(ext.canvasPlugins).toBeUndefined();
  });
});
