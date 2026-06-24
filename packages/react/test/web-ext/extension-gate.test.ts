import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  computeSri,
  verifyIntegrity,
  verifySignature,
  isApiCompatible,
  verifyExtension,
} from "../../src/web-ext/extension-gate.js";
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/protocol";

function signWith(secret: string, m: Omit<WebExtensionManifest, "signature">): string {
  return createHmac("sha256", secret).update(canonicalManifestBytes(m)).digest("base64");
}

const entry = Buffer.from("export default {manifestId:'x'}", "utf8");

async function codeManifest(extra: Partial<WebExtensionManifest> = {}): Promise<WebExtensionManifest> {
  const integrity = await computeSri(entry);
  return { id: "acme", targetApiVersion: "^0.1.0", entry: "e.mjs", integrity, ...extra };
}

describe("isApiCompatible", () => {
  it("caret 0.x:同 minor 且 host>=spec 通过", () => {
    expect(isApiCompatible("^0.1.0", "0.1.3")).toBe(true);
    expect(isApiCompatible("^0.1.0", "0.2.0")).toBe(false); // 0.x 不同 minor 不兼容
    expect(isApiCompatible("^0.1.5", "0.1.2")).toBe(false); // host < spec
  });
  it("caret >=1:同 major 且 host>=spec", () => {
    expect(isApiCompatible("^1.2.0", "1.5.0")).toBe(true);
    expect(isApiCompatible("^1.2.0", "2.0.0")).toBe(false);
  });
  it("精确与通配", () => {
    expect(isApiCompatible("0.1.0", "0.1.0")).toBe(true);
    expect(isApiCompatible("0.1.0", "0.1.1")).toBe(false);
    expect(isApiCompatible("*", "9.9.9")).toBe(true);
  });
});

describe("verifyIntegrity / verifySignature", () => {
  it("SRI 一致通过,篡改字节失败", async () => {
    const m = await codeManifest();
    expect(await verifyIntegrity(m, entry)).toBe(true);
    expect(await verifyIntegrity(m, Buffer.from("tampered"))).toBe(false);
  });

  it("白名单密钥验签命中通过,错误密钥失败", async () => {
    const base = await codeManifest();
    const signature = signWith("trusted-secret", base);
    const signed: WebExtensionManifest = { ...base, signature };
    expect(await verifySignature(signed, ["trusted-secret"])).toBe(true);
    expect(await verifySignature(signed, ["other"])).toBe(false);
    expect(await verifySignature(base, ["trusted-secret"])).toBe(false); // 无签名
  });
});

describe("verifyExtension", () => {
  const opts = { whitelist: ["trusted-secret"], requireSignature: true, hostApiVersion: "0.1.0" };

  it("纯声明扩展(无 entry)版本通过即放行", async () => {
    const r = await verifyExtension({
      manifest: { id: "d", targetApiVersion: "^0.1.0" },
      opts,
    });
    expect(r.ok).toBe(true);
  });

  it("代码扩展:SRI+合法签名通过", async () => {
    const base = await codeManifest();
    const signed: WebExtensionManifest = { ...base, signature: signWith("trusted-secret", base) };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts });
    expect(r.ok).toBe(true);
  });

  it("requireSignature 但未签名 → 拒绝", async () => {
    const m = await codeManifest();
    const r = await verifyExtension({ manifest: m, entryBytes: entry, opts });
    expect(r.ok).toBe(false);
  });

  it("SRI 不符 → 拒绝", async () => {
    const base = await codeManifest({ integrity: "sha384-WRONG" });
    const signed: WebExtensionManifest = { ...base, signature: signWith("trusted-secret", base) };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts });
    expect(r.ok).toBe(false);
  });

  it("版本不兼容 → 拒绝", async () => {
    const r = await verifyExtension({
      manifest: { id: "d", targetApiVersion: "^9.0.0" },
      opts,
    });
    expect(r.ok).toBe(false);
  });

  it("签名不在白名单 → 拒绝", async () => {
    const base = await codeManifest();
    const signed: WebExtensionManifest = { ...base, signature: signWith("rogue", base) };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts });
    expect(r.ok).toBe(false);
  });
});
