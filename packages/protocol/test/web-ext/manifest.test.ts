import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  WebExtensionCapabilitySchema,
  WebExtensionManifestSchema,
  canonicalManifestBytes,
  isDeclarativeOnly,
} from "../../src/web-ext/manifest.js";
import { WebExtConfigSchema } from "../../src/web-ext/config.js";

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

  describe("dual-entry protocol (entries)", () => {
    it("accepts a manifest with entries expressing same-origin + isolated realms", () => {
      const r = WebExtensionManifestSchema.safeParse({
        id: "acme",
        targetApiVersion: "^0.1.0",
        entry: "web-extension.mjs",
        integrity: "sha384-abc",
        entries: [
          {
            path: "web-extension.mjs",
            integrity: "sha384-abc",
            realm: "same-origin",
          },
          {
            path: "web-extension.isolated.mjs",
            integrity: "sha384-def",
            realm: "isolated",
          },
        ],
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.entries).toHaveLength(2);
    });

    it("keeps `entry` as a valid legacy manifest field when `entries` is absent (back-compat)", () => {
      // A manifest produced before this Phase — no `entries` at all — must
      // still validate unchanged under the extended schema.
      const legacy = {
        id: "acme",
        targetApiVersion: "^0.1.0",
        entry: "web-extension.mjs",
        css: "ext.css",
        integrity: "sha384-abc",
      };
      const r = WebExtensionManifestSchema.safeParse(legacy);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.entries).toBeUndefined();
    });

    it("rejects an entries member missing integrity (each member must pair path <-> integrity)", () => {
      const r = WebExtensionManifestSchema.safeParse({
        id: "acme",
        targetApiVersion: "^0.1.0",
        entries: [{ path: "web-extension.mjs", realm: "same-origin" }],
      });
      expect(r.success).toBe(false);
    });

    it("rejects an entries member missing path", () => {
      const r = WebExtensionManifestSchema.safeParse({
        id: "acme",
        targetApiVersion: "^0.1.0",
        entries: [{ integrity: "sha384-abc", realm: "same-origin" }],
      });
      expect(r.success).toBe(false);
    });

    it("rejects an entries member with an unknown realm", () => {
      const r = WebExtensionManifestSchema.safeParse({
        id: "acme",
        targetApiVersion: "^0.1.0",
        entries: [
          { path: "x.mjs", integrity: "sha384-abc", realm: "bogus" },
        ],
      });
      expect(r.success).toBe(false);
    });

    it("does not error when a new-shaped manifest is read by a pre-Phase-2 validator (forward-compat)", () => {
      // A stand-in for the *old* host's validator — the exact pre-Phase-2
      // shape of WebExtensionManifestSchema, replicated here (not imported)
      // so this test keeps checking real zod `strip` behavior even after
      // the source schema evolves further.
      const LegacyManifestSchema = z.object({
        id: z.string().min(1),
        targetApiVersion: z.string().min(1),
        entry: z.string().min(1).optional(),
        css: z.string().min(1).optional(),
        integrity: z.string().min(1).optional(),
        signature: z.string().min(1).optional(),
        capabilities: z.array(WebExtensionCapabilitySchema).optional(),
        config: WebExtConfigSchema.optional(),
      });

      const withEntries = {
        id: "acme",
        targetApiVersion: "^0.1.0",
        entry: "web-extension.mjs",
        integrity: "sha384-abc",
        entries: [
          {
            path: "web-extension.mjs",
            integrity: "sha384-abc",
            realm: "same-origin",
          },
        ],
      };
      const r = LegacyManifestSchema.safeParse(withEntries);
      expect(r.success).toBe(true);
      if (r.success) {
        // zod's default `strip` behavior drops the unknown `entries` key —
        // the old host is unaffected by the new field's presence.
        expect((r.data as Record<string, unknown>).entries).toBeUndefined();
        expect(r.data.entry).toBe("web-extension.mjs");
      }
    });

    it("keeps canonicalManifestBytes() unchanged by `entries` — existing signatures stay valid", () => {
      const base = {
        id: "acme",
        targetApiVersion: "^0.1.0",
        entry: "web-extension.mjs",
        integrity: "sha384-abc",
      };
      const withoutEntries = canonicalManifestBytes(base);
      const withEntries = canonicalManifestBytes({
        ...base,
        entries: [
          {
            path: "web-extension.mjs",
            integrity: "sha384-abc",
            realm: "same-origin" as const,
          },
        ],
      });
      expect(withEntries).toBe(withoutEntries);
    });
  });
});
