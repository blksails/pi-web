/**
 * resolve-webext — 四种返回（webext-package-install 任务 2.3 / 5.2 核心逻辑）。
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
import {
  resolveWebext,
  type ResolveWebextDeps,
} from "../lib/app/webext/resolve-webext.js";

const subtle = webcrypto.subtle;
let priv: CryptoKey;
let pubB64: string;

beforeAll(async () => {
  const kp = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  priv = kp.privateKey;
  pubB64 = Buffer.from(await subtle.exportKey("raw", kp.publicKey)).toString("base64");
});

async function sign(m: Omit<WebExtensionManifest, "signature">): Promise<string> {
  const data = new TextEncoder().encode(canonicalManifestBytes(m));
  return Buffer.from(await subtle.sign({ name: "Ed25519" }, priv, data)).toString("base64");
}

function trustSvc() {
  const registry = createTrustedPublisherRegistry({
    rootPublicKey: "",
    localAdd: [{ id: "trusted", publicKey: pubB64 }],
  });
  return createWebextTrustService({
    registry,
    hostApiVersion: "0.1.0",
    requireSignature: true,
    isProduction: false,
  });
}

function deps(manifest: unknown | undefined, hasDist = true): ResolveWebextDeps {
  return {
    locateDist: async () => (hasDist ? "/installed/pkg/.pi/web/dist" : undefined),
    readManifestJson: async () => manifest,
    toBaseUrl: (d) => `/api/webext/dist/${encodeURIComponent(d)}/`,
    trust: trustSvc(),
  };
}

describe("resolveWebext", () => {
  it("无 dist 产物 → found:false", async () => {
    const r = await resolveWebext("src", deps(undefined, false));
    expect(r.found).toBe(false);
  });

  it("纯声明源 → found + 已背书 manifest + baseUrl", async () => {
    const decl: WebExtensionManifest = { id: "d", targetApiVersion: "^0.1.0", config: { layout: "wide" } };
    const r = await resolveWebext("src", deps(decl));
    expect(r.found).toBe(true);
    expect(r.manifest?.signaturePreVerified).toBe(true);
    expect(r.baseUrl).toContain("/api/webext/dist/");
    expect(r.rejectedReason).toBeUndefined();
  });

  it("受信代码源 → found + 已背书 manifest（去签名）+ baseUrl", async () => {
    const base = { id: "acme", targetApiVersion: "^0.1.0", entry: "e.mjs", integrity: "sha384-x" };
    const signed = { ...base, signature: await sign(base) };
    const r = await resolveWebext("src", deps(signed));
    expect(r.found).toBe(true);
    expect((r.manifest as { signature?: string } | undefined)?.signature).toBeUndefined();
    expect(r.baseUrl).toBeDefined();
  });

  it("manifest 非法 → found:true + rejectedReason", async () => {
    const r = await resolveWebext("src", deps({ not: "a manifest" }));
    expect(r.found).toBe(true);
    expect(r.rejectedReason).toContain("manifest 非法");
    expect(r.manifest).toBeUndefined();
  });

  it("代码源未签名/不受信 → found:true + rejectedReason", async () => {
    const base = { id: "acme", targetApiVersion: "^0.1.0", entry: "e.mjs", integrity: "sha384-x" };
    const r = await resolveWebext("src", deps(base)); // 无 signature
    expect(r.found).toBe(true);
    expect(r.rejectedReason).toBeDefined();
    expect(r.baseUrl).toBeUndefined();
  });
});
