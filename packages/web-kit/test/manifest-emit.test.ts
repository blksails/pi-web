import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import {
  computeIntegrity,
  emitManifest,
  signManifest,
  generateSigningKeyPair,
} from "../build/manifest-emit.js";
import {
  WebExtensionManifestSchema,
  canonicalManifestBytes,
} from "@blksails/pi-web-protocol";

describe("manifest-emit", () => {
  it("computeIntegrity 产出 sha384- 前缀且确定", () => {
    const a = computeIntegrity(Buffer.from("hello", "utf8"));
    const b = computeIntegrity(Buffer.from("hello", "utf8"));
    expect(a).toMatch(/^sha384-/);
    expect(a).toBe(b);
    expect(computeIntegrity(Buffer.from("world"))).not.toBe(a);
  });

  it("emitManifest(code 扩展) 产出合法 manifest 且 entry⇒integrity", async () => {
    const m = await emitManifest({
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      entryBytes: Buffer.from("export default {}", "utf8"),
      capabilities: ["slots"],
    });
    expect(WebExtensionManifestSchema.safeParse(m).success).toBe(true);
    expect(m.integrity).toMatch(/^sha384-/);
  });

  it("emitManifest(声明式) 可省略 entry/integrity", async () => {
    const m = await emitManifest({ id: "acme", targetApiVersion: "^0.1.0" });
    expect(WebExtensionManifestSchema.safeParse(m).success).toBe(true);
    expect(m.entry).toBeUndefined();
  });

  it("Ed25519 签名确定可复算,异密钥不同,且可被对应公钥验证", async () => {
    const { publicKey, privateKey } = await generateSigningKeyPair();
    const base = { id: "acme", targetApiVersion: "^0.1.0", entry: "e.mjs", integrity: "sha384-x" };
    const s1 = await signManifest(base, privateKey);
    const s2 = await signManifest(base, privateKey);
    expect(s1).toBe(s2); // Ed25519 确定性
    const { privateKey: other } = await generateSigningKeyPair();
    expect(await signManifest(base, other)).not.toBe(s1);

    // 与宿主验签互通:用导出的 raw 公钥验证签名通过
    const pubKey = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(publicKey, "base64"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await webcrypto.subtle.verify(
      { name: "Ed25519" },
      pubKey,
      Buffer.from(s1, "base64"),
      new TextEncoder().encode(canonicalManifestBytes(base)),
    );
    expect(ok).toBe(true);
  });

  it("emitManifest 带 signKey 产出可校验签名", async () => {
    const { privateKey } = await generateSigningKeyPair();
    const m = await emitManifest({
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      entryBytes: Buffer.from("export default {}", "utf8"),
      signKey: privateKey,
    });
    expect(m.signature).toBeDefined();
    expect(WebExtensionManifestSchema.safeParse(m).success).toBe(true);
  });
});
