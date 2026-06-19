import { describe, expect, it } from "vitest";
import {
  SlotKeySchema,
  WebExtConfigSchema,
  WebExtensionDescriptorMetaSchema,
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
