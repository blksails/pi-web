/**
 * webext-trust-service — 服务端验签 → VettedManifest（webext-package-install 任务 2.2 / 5.1）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";
import { createTrustedPublisherRegistry } from "../lib/app/webext/trusted-publisher-registry.js";
import { createWebextTrustService } from "../lib/app/webext/webext-trust-service.js";

const subtle = webcrypto.subtle;
let pubPriv: CryptoKey;
let pubB64: string;
let roguePriv: CryptoKey;

beforeAll(async () => {
  const pub = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  pubPriv = pub.privateKey;
  pubB64 = Buffer.from(await subtle.exportKey("raw", pub.publicKey)).toString("base64");
  const rogue = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  roguePriv = rogue.privateKey;
});

async function sign(m: Omit<WebExtensionManifest, "signature">, priv: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(canonicalManifestBytes(m));
  return Buffer.from(await subtle.sign({ name: "Ed25519" }, priv, data)).toString("base64");
}

const codeBase: Omit<WebExtensionManifest, "signature"> = {
  id: "acme",
  targetApiVersion: "^0.1.0",
  entry: "web-extension.mjs",
  integrity: "sha384-abc",
};

function service(opts: { isProduction?: boolean; requireSignature?: boolean } = {}) {
  const registry = createTrustedPublisherRegistry({
    rootPublicKey: "",
    localAdd: [{ id: "trusted", publicKey: pubB64 }],
  });
  return createWebextTrustService({
    registry,
    requireSignature: opts.requireSignature ?? true,
    isProduction: opts.isProduction ?? false,
  });
}

describe("WebextTrustService", () => {
  it("受信签名 → 已背书 manifest（去 signature，标 signaturePreVerified，保 integrity）", async () => {
    const signed: WebExtensionManifest = { ...codeBase, signature: await sign(codeBase, pubPriv) };
    const r = await service().verifyManifest(signed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vetted.signaturePreVerified).toBe(true);
      expect((r.vetted as { signature?: string }).signature).toBeUndefined();
      expect(r.vetted.integrity).toBe("sha384-abc");
    }
  });

  it("代码扩展未签名 → 拒绝", async () => {
    const r = await service().verifyManifest(codeBase as WebExtensionManifest);
    expect(r.ok).toBe(false);
  });

  it("不受信发布者签名 → 拒绝", async () => {
    const signed: WebExtensionManifest = { ...codeBase, signature: await sign(codeBase, roguePriv) };
    const r = await service().verifyManifest(signed);
    expect(r.ok).toBe(false);
  });

  it("纯声明扩展 → 放行（无需签名）", async () => {
    const decl: WebExtensionManifest = { id: "d", targetApiVersion: "^0.1.0", config: { layout: "wide" } };
    const r = await service().verifyManifest(decl);
    expect(r.ok).toBe(true);
  });

  it("dev 免签模式 → 放行但带不安全提示", async () => {
    const r = await service({ isProduction: false, requireSignature: false }).verifyManifest(
      codeBase as WebExtensionManifest,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unsafeWarning).toBeDefined();
  });

  it("生产模式强制签名：免签开关无效，未签名代码扩展被拒", async () => {
    const r = await service({ isProduction: true, requireSignature: false }).verifyManifest(
      codeBase as WebExtensionManifest,
    );
    expect(r.ok).toBe(false);
  });
});
