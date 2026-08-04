import { describe, expect, it, beforeAll, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  computeSri,
  verifyIntegrity,
  verifySignature,
  verifyExtension,
} from "../../src/web-ext/extension-gate.js";
import {
  loadExtension,
  selectManifestEntry,
  type LoaderDeps,
} from "../../src/web-ext/extension-loader.js";
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
      ...extra,
    };
  }

  it("纯声明扩展(无 entry)直接放行", async () => {
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
      opts: { whitelist: [], requireSignature: false, signaturePreVerified: true },
    });
    expect(okR.ok).toBe(true);
    // SRI 仍生效:篡改字节 → 拒绝
    const badR = await verifyExtension({
      manifest: base,
      entryBytes: Buffer.from("tampered"),
      opts: { whitelist: [], requireSignature: false, signaturePreVerified: true },
    });
    expect(badR.ok).toBe(false);
  });

  it("entryIntegrity 覆盖:按显式给定值校验 SRI,而非 manifest.integrity(6.3 双入口消费)", async () => {
    // manifest.integrity 指向另一份字节(same-origin 分派产物的 SRI);
    // 调用方传入的 entryIntegrity 指向当前实际字节的 SRI(隔离入口的 SRI)。
    const isolatedBytes = Buffer.from("export default {manifestId:'iso'}", "utf8");
    const isolatedIntegrity = await computeSri(isolatedBytes);
    const base = await codeManifest(); // manifest.integrity = entry(同源字节)的 SRI
    const r = await verifyExtension({
      manifest: base,
      entryBytes: isolatedBytes,
      opts: { whitelist: [], requireSignature: false, signaturePreVerified: true },
      entryIntegrity: isolatedIntegrity,
    });
    expect(r.ok).toBe(true);
    // 反证:同一 entryIntegrity 但字节被篡改 → 拒绝(证明覆盖值确被真正校验,而非旁路)。
    const tampered = await verifyExtension({
      manifest: base,
      entryBytes: Buffer.from("tampered"),
      opts: { whitelist: [], requireSignature: false, signaturePreVerified: true },
      entryIntegrity: isolatedIntegrity,
    });
    expect(tampered.ok).toBe(false);
    // 反证:若不传 entryIntegrity,同样的 isolatedBytes 对不上 manifest.integrity → 拒绝
    // (证明缺省确实回落 manifest.integrity,而非恒放行)。
    const withoutOverride = await verifyExtension({
      manifest: base,
      entryBytes: isolatedBytes,
      opts: { whitelist: [], requireSignature: false, signaturePreVerified: true },
    });
    expect(withoutOverride.ok).toBe(false);
  });
});

describe("selectManifestEntry / loadExtension — 消费方按宿主形态选择入口(6.3, Req 2.6)", () => {
  const opts = { whitelist: [], requireSignature: false };

  async function dualEntryManifest(): Promise<{
    manifest: WebExtensionManifest;
    sameOriginBytes: Uint8Array;
    isolatedBytes: Uint8Array;
    sameOriginIntegrity: string;
    isolatedIntegrity: string;
  }> {
    const sameOriginBytes = Buffer.from("export default {manifestId:'acme-so'}", "utf8");
    const isolatedBytes = Buffer.from("export default {manifestId:'acme-iso'}", "utf8");
    const sameOriginIntegrity = await computeSri(sameOriginBytes);
    const isolatedIntegrity = await computeSri(isolatedBytes);
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      // entry 继续指向旧宿主可用的分派产物(design.md F4 硬约束)。
      entry: "dispatch.mjs",
      integrity: sameOriginIntegrity,
      entries: [
        { path: "dispatch.mjs", integrity: sameOriginIntegrity, realm: "same-origin" },
        { path: "isolated.mjs", integrity: isolatedIntegrity, realm: "isolated" },
      ],
    };
    return { manifest, sameOriginBytes, isolatedBytes, sameOriginIntegrity, isolatedIntegrity };
  }

  it("双入口清单:selectManifestEntry 按 realm 分别取到各自入口", async () => {
    const { manifest, sameOriginIntegrity, isolatedIntegrity } = await dualEntryManifest();
    expect(selectManifestEntry(manifest, "same-origin")).toEqual({
      path: "dispatch.mjs",
      integrity: sameOriginIntegrity,
    });
    expect(selectManifestEntry(manifest, "isolated")).toEqual({
      path: "isolated.mjs",
      integrity: isolatedIntegrity,
    });
  });

  it("单入口旧清单:entries 缺失,任一宿主形态均回落 entry/integrity", async () => {
    const integrity = await computeSri(entry);
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "e.mjs",
      integrity,
    };
    expect(selectManifestEntry(manifest, "same-origin")).toEqual({ path: "e.mjs", integrity });
    expect(selectManifestEntry(manifest, "isolated")).toEqual({ path: "e.mjs", integrity });
  });

  it("双入口清单 + same-origin 宿主:loadExtension 取同源入口字节,isolated 字节即便被 fetch 也不通过其 SRI", async () => {
    const { manifest, sameOriginBytes } = await dualEntryManifest();
    const fetchBytes = vi.fn(async (url: string) =>
      url.endsWith("dispatch.mjs") ? sameOriginBytes : Buffer.from("wrong-branch"),
    );
    const importModule = vi.fn(async () => ({ default: { manifestId: "acme" } }));
    const deps: LoaderDeps = { fetchBytes, importModule };
    const r = await loadExtension({
      manifest,
      baseUrl: "/ext/acme/",
      opts,
      deps,
      // 缺省即 "same-origin",此处显式传入以文档化断言意图。
      hostRealm: "same-origin",
    });
    expect(r.status).toBe("loaded");
    expect(fetchBytes).toHaveBeenCalledWith("/ext/acme/dispatch.mjs");
    expect(importModule).toHaveBeenCalledWith("/ext/acme/dispatch.mjs");
  });

  it("双入口清单 + isolated 宿主:loadExtension 取隔离入口(与 manifest.entry 不同的路径与字节)", async () => {
    const { manifest, isolatedBytes } = await dualEntryManifest();
    const fetchBytes = vi.fn(async (url: string) =>
      url.endsWith("isolated.mjs") ? isolatedBytes : Buffer.from("wrong-branch"),
    );
    const importModule = vi.fn(async () => ({ default: { manifestId: "acme" } }));
    const deps: LoaderDeps = { fetchBytes, importModule };
    const r = await loadExtension({
      manifest,
      baseUrl: "/ext/acme/",
      opts,
      deps,
      hostRealm: "isolated",
    });
    expect(r.status).toBe("loaded");
    expect(fetchBytes).toHaveBeenCalledWith("/ext/acme/isolated.mjs");
    expect(importModule).toHaveBeenCalledWith("/ext/acme/isolated.mjs");
  });

  it("单入口旧清单:hostRealm 不影响结果,行为与改动前逐字节一致", async () => {
    const integrity = await computeSri(entry);
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "e.mjs",
      integrity,
    };
    for (const hostRealm of ["same-origin", "isolated"] as const) {
      const fetchBytes = vi.fn(async () => entry);
      const importModule = vi.fn(async () => ({ default: { manifestId: "acme" } }));
      const r = await loadExtension({
        manifest,
        baseUrl: "/ext/acme/",
        opts,
        deps: { fetchBytes, importModule },
        hostRealm,
      });
      expect(r.status).toBe("loaded");
      expect(fetchBytes).toHaveBeenCalledWith("/ext/acme/e.mjs");
    }
  });
});
