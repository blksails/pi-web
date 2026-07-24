import { describe, expect, it } from "vitest";
import {
  SlotKeySchema,
  WebExtConfigSchema,
  WebExtensionDescriptorMetaSchema,
  EmptyConfigSchema,
  EmptySuggestionSchema,
} from "../../src/web-ext/descriptor.js";

describe("SlotKey", () => {
  it("accepts known slot keys", () => {
    for (const k of ["background", "panelRight", "accessoryInlineLeft", "artifactSurface"]) {
      expect(SlotKeySchema.safeParse(k).success).toBe(true);
    }
  });
  it("rejects unknown slot keys", () => {
    expect(SlotKeySchema.safeParse("nav").success).toBe(false);
  });
});

describe("WebExtConfig (Tier 5 declarative)", () => {
  it("accepts theme tokens + layout", () => {
    const r = WebExtConfigSchema.safeParse({
      theme: { "--pw-acme-accent": "#09f" },
      layout: "split",
    });
    expect(r.success).toBe(true);
  });

  it("accepts controlled panelRight width and rejects unsafe bounds", () => {
    expect(WebExtConfigSchema.safeParse({
      panelWidth: 760,
      minPanelWidth: 420,
      maxPanelWidth: 1280,
    }).success).toBe(true);
    expect(WebExtConfigSchema.safeParse({ panelWidth: 120 }).success).toBe(false);
    expect(WebExtConfigSchema.safeParse({ panelWidth: 760.5 }).success).toBe(false);
    expect(WebExtConfigSchema.safeParse({ minPanelWidth: 420 }).success).toBe(false);
    expect(WebExtConfigSchema.safeParse({ panelWidth: 760, minPanelWidth: 900 }).success).toBe(false);
    expect(WebExtConfigSchema.safeParse({ panelWidth: 760, minPanelWidth: 420, maxPanelWidth: 600 }).success).toBe(false);
  });

  it("re-exports empty config schemas through the descriptor barrel", () => {
    expect(
      EmptySuggestionSchema.safeParse({
        id: "s1",
        label: "Hi",
        value: "Hi",
        mode: "fill",
      }).success,
    ).toBe(true);
    expect(
      EmptyConfigSchema.safeParse({ mergeCommands: "append" }).success,
    ).toBe(true);
    expect(
      WebExtConfigSchema.safeParse({ empty: { title: "Hi" } }).success,
    ).toBe(true);
  });
});

describe("WebExtensionDescriptorMeta", () => {
  it("accepts a meta with slots + artifact", () => {
    const r = WebExtensionDescriptorMetaSchema.safeParse({
      manifestId: "acme",
      slots: ["panelRight", "headerCenter"],
      artifact: { entry: "artifact.html", initialHeight: 240 },
    });
    expect(r.success).toBe(true);
  });
});
