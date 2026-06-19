import { describe, expect, it } from "vitest";
import {
  WebExtensionManifestSchema,
  isDeclarativeOnly,
} from "../../src/web-ext/manifest.js";

describe("WebExtensionManifest", () => {
  it("accepts a code extension with entry + integrity", () => {
    const r = WebExtensionManifestSchema.safeParse({
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      css: "ext.css",
      integrity: "sha384-abc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a declarative-only manifest (no entry/integrity)", () => {
    const r = WebExtensionManifestSchema.safeParse({
      id: "acme",
      targetApiVersion: "^0.1.0",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(isDeclarativeOnly(r.data)).toBe(true);
  });

  it("rejects entry without integrity", () => {
    const r = WebExtensionManifestSchema.safeParse({
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing id / targetApiVersion", () => {
    expect(WebExtensionManifestSchema.safeParse({ id: "x" }).success).toBe(
      false,
    );
    expect(
      WebExtensionManifestSchema.safeParse({ targetApiVersion: "^0.1.0" })
        .success,
    ).toBe(false);
  });

  it("validates capability enum", () => {
    const r = WebExtensionManifestSchema.safeParse({
      id: "acme",
      targetApiVersion: "^0.1.0",
      capabilities: ["slots", "bogus"],
    });
    expect(r.success).toBe(false);
  });
});
