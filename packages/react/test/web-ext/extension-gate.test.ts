import { describe, expect, it, beforeAll } from "vitest";
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
} from "@blksails/pi-web-protocol";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

// 受信发布者 Ed25519 keypair(测试期生成);公钥进白名单,私钥签名。
let trustedPriv: CryptoKey;
let trustedPubB64: string;
let roguePriv: CryptoKey;

beforeAll(async () => {
  const trusted = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  trustedPriv = trusted.privateKey;
  trustedPubB64 = bytesToBase64(
    new Uint8Array(await crypto.subtle.exportKey("raw", trusted.publicKey)),
  );
  const rogue = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  roguePriv = rogue.privateKey;
});

async function signWith(
  priv: CryptoKey,
  m: Omit<WebExtensionManifest, "signature">,
): Promise<string> {
  const data = new TextEncoder().encode(canonicalManifestBytes(m));
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, data);
  return bytesToBase64(new Uint8Array(sig));
}

const entry = Buffer.from("export default {manifestId:'x'}", "utf8");

async function codeManifest(
  extra: Partial<WebExtensionManifest> = {},
): Promise<WebExtensionManifest> {
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

  it("白名单 Ed25519 公钥验签命中通过,错误公钥/伪造签名失败", async () => {
    const base = await codeManifest();
    const signed: WebExtensionManifest = {
      ...base,
      signature: await signWith(trustedPriv, base),
    };
    expect(await verifySignature(signed, [trustedPubB64])).toBe(true);
    // 流氓私钥签名,受信公钥验不过
    const forged: WebExtensionManifest = {
      ...base,
      signature: await signWith(roguePriv, base),
    };
    expect(await verifySignature(forged, [trustedPubB64])).toBe(false);
    expect(await verifySignature(base, [trustedPubB64])).toBe(false); // 无签名
  });
});

describe("verifyExtension", () => {
  function opts(extra: Record<string, unknown> = {}) {
    return {
      whitelist: [trustedPubB64],
      requireSignature: true,
      hostApiVersion: "0.1.0",
      ...extra,
    };
  }

  it("纯声明扩展(无 entry)版本通过即放行", async () => {
    const r = await verifyExtension({
      manifest: { id: "d", targetApiVersion: "^0.1.0" },
      opts: opts(),
    });
    expect(r.ok).toBe(true);
  });

  it("代码扩展:SRI+合法签名通过", async () => {
    const base = await codeManifest();
    const signed: WebExtensionManifest = {
      ...base,
      signature: await signWith(trustedPriv, base),
    };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts: opts() });
    expect(r.ok).toBe(true);
  });

  it("requireSignature 但未签名 → 拒绝", async () => {
    const m = await codeManifest();
    const r = await verifyExtension({ manifest: m, entryBytes: entry, opts: opts() });
    expect(r.ok).toBe(false);
  });

  it("SRI 不符 → 拒绝", async () => {
    const base = await codeManifest({ integrity: "sha384-WRONG" });
    const signed: WebExtensionManifest = {
      ...base,
      signature: await signWith(trustedPriv, base),
    };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts: opts() });
    expect(r.ok).toBe(false);
  });

  it("版本不兼容 → 拒绝", async () => {
    const r = await verifyExtension({
      manifest: { id: "d", targetApiVersion: "^9.0.0" },
      opts: opts(),
    });
    expect(r.ok).toBe(false);
  });

  it("签名不在白名单 → 拒绝", async () => {
    const base = await codeManifest();
    const signed: WebExtensionManifest = {
      ...base,
      signature: await signWith(roguePriv, base),
    };
    const r = await verifyExtension({ manifest: signed, entryBytes: entry, opts: opts() });
    expect(r.ok).toBe(false);
  });

  it("signaturePreVerified:跳过签名分支但仍执行 SRI", async () => {
    // 无签名、空白名单,但 signaturePreVerified=true:SRI 正确 → 通过
    const base = await codeManifest();
    const okR = await verifyExtension({
      manifest: base,
      entryBytes: entry,
      opts: { whitelist: [], requireSignature: false, hostApiVersion: "0.1.0", signaturePreVerified: true },
    });
    expect(okR.ok).toBe(true);
    // SRI 仍生效:篡改字节 → 拒绝
    const badR = await verifyExtension({
      manifest: base,
      entryBytes: Buffer.from("tampered"),
      opts: { whitelist: [], requireSignature: false, hostApiVersion: "0.1.0", signaturePreVerified: true },
    });
    expect(badR.ok).toBe(false);
  });
});
