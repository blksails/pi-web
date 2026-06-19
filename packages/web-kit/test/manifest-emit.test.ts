import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  computeIntegrity,
  emitManifest,
  signManifest,
} from "../build/manifest-emit.js";
import { WebExtensionManifestSchema } from "@pi-web/protocol";

describe("manifest-emit", () => {
  it("computeIntegrity 产出 sha384- 前缀且确定", () => {
    const a = computeIntegrity(Buffer.from("hello", "utf8"));
    const b = computeIntegrity(Buffer.from("hello", "utf8"));
    expect(a).toMatch(/^sha384-/);
    expect(a).toBe(b);
    expect(computeIntegrity(Buffer.from("world"))).not.toBe(a);
  });

  it("emitManifest(code 扩展) 产出合法 manifest 且 entry⇒integrity", () => {
    const m = emitManifest({
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      entryBytes: Buffer.from("export default {}", "utf8"),
      capabilities: ["slots"],
    });
    expect(WebExtensionManifestSchema.safeParse(m).success).toBe(true);
    expect(m.integrity).toMatch(/^sha384-/);
  });

  it("emitManifest(声明式) 可省略 entry/integrity", () => {
    const m = emitManifest({ id: "acme", targetApiVersion: "^0.1.0" });
    expect(WebExtensionManifestSchema.safeParse(m).success).toBe(true);
    expect(m.entry).toBeUndefined();
  });

  it("签名可复算(同密钥确定)", () => {
    const base = { id: "acme", targetApiVersion: "^0.1.0", entry: "e.mjs", integrity: "sha384-x" };
    const s1 = signManifest(base, "secret");
    const s2 = signManifest(base, "secret");
    expect(s1).toBe(s2);
    expect(signManifest(base, "other")).not.toBe(s1);
  });
});
