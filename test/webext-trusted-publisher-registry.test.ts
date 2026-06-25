/**
 * trusted-publisher-registry — 信任根/回退/吊销过期/本地覆盖（webext-package-install 任务 2.1 / 5.1）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  createTrustedPublisherRegistry,
  signTrustedPublishersList,
  type TrustedPublishersList,
  type TrustedPublisher,
} from "../lib/app/webext/trusted-publisher-registry.js";

const subtle = webcrypto.subtle;
let rootPubB64: string;
let rootPrivB64: string;
let pubA: TrustedPublisher;
let pubB: TrustedPublisher;

async function genEd25519(): Promise<{ pub: string; priv: string }> {
  const kp = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    pub: Buffer.from(await subtle.exportKey("raw", kp.publicKey)).toString("base64"),
    priv: Buffer.from(await subtle.exportKey("pkcs8", kp.privateKey)).toString("base64"),
  };
}

beforeAll(async () => {
  const root = await genEd25519();
  rootPubB64 = root.pub;
  rootPrivB64 = root.priv;
  pubA = { id: "pub-a", publicKey: (await genEd25519()).pub };
  pubB = { id: "pub-b", publicKey: (await genEd25519()).pub };
});

async function signedList(
  publishers: TrustedPublisher[],
  extra: { version?: number; expiresAt?: string } = {},
  priv = rootPrivB64,
): Promise<TrustedPublishersList> {
  return signTrustedPublishersList(
    {
      version: extra.version ?? 1,
      issuedAt: "2026-01-01T00:00:00Z",
      ...(extra.expiresAt !== undefined ? { expiresAt: extra.expiresAt } : {}),
      publishers,
    },
    priv,
  );
}

describe("TrustedPublisherRegistry", () => {
  it("中心列表根验签通过 → 采信，source=central", async () => {
    const central = await signedList([pubA, pubB]);
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json" },
      { fetchList: async () => central },
    );
    const r = await reg.refresh();
    expect(r).toMatchObject({ ok: true, source: "central", count: 2 });
    expect([...reg.publicKeys()].sort()).toEqual([pubA.publicKey, pubB.publicKey].sort());
  });

  it("根验签失败 → 不采信，回退出厂快照", async () => {
    const { priv: roguePriv } = await genEd25519();
    const tampered = await signedList([pubA], {}, roguePriv); // 非根私钥签
    const snapshot = await signedList([pubB]);
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json", snapshot },
      { fetchList: async () => tampered },
    );
    const r = await reg.refresh();
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ fellBackTo: "snapshot" });
    expect(reg.publicKeys()).toEqual([pubB.publicKey]); // 用快照,不用被篡改列表
  });

  it("拉取异常 → 回退缓存", async () => {
    const cached = await signedList([pubA]);
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json" },
      {
        fetchList: async () => {
          throw new Error("network down");
        },
        readCache: async () => cached,
      },
    );
    const r = await reg.refresh();
    expect(r).toMatchObject({ ok: false, fellBackTo: "cache" });
    expect(reg.publicKeys()).toEqual([pubA.publicKey]);
  });

  it("过期列表不采信", async () => {
    const expired = await signedList([pubA], { expiresAt: "2020-01-01T00:00:00Z" });
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json", now: () => Date.parse("2026-06-25T00:00:00Z") },
      { fetchList: async () => expired },
    );
    const r = await reg.refresh();
    expect(r.ok).toBe(false);
    expect(reg.publicKeys()).toEqual([]); // 无快照/缓存 → 空集
  });

  it("revoked 发布者与 localRevoke 被剔除，localAdd 被并入", async () => {
    const localOnly = { id: "pub-local", publicKey: (await genEd25519()).pub };
    const central = await signedList([pubA, { ...pubB, revoked: true }]);
    const reg = createTrustedPublisherRegistry(
      {
        rootPublicKey: rootPubB64,
        centralUrl: "https://x/list.json",
        localAdd: [localOnly],
        localRevoke: ["pub-a"],
      },
      { fetchList: async () => central },
    );
    await reg.refresh();
    // pubB revoked 剔除, pubA 被 localRevoke 剔除, 仅剩 localAdd
    expect(reg.publishers().map((p) => p.id)).toEqual(["pub-local"]);
  });

  it("固定版本不符 → 不采信中心列表", async () => {
    const central = await signedList([pubA], { version: 5 });
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json", pinnedVersion: 3 },
      { fetchList: async () => central },
    );
    const r = await reg.refresh();
    expect(r.ok).toBe(false);
    expect(reg.publicKeys()).toEqual([]);
  });

  it("无任何有效来源 → 绝不 fail-open（空集，仅本地）", async () => {
    const localOnly = { id: "pub-local", publicKey: (await genEd25519()).pub };
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json", localAdd: [localOnly] },
      {
        fetchList: async () => {
          throw new Error("down");
        },
      },
    );
    const r = await reg.refresh();
    expect(r).toMatchObject({ ok: false, fellBackTo: "none" });
    expect(reg.publishers().map((p) => p.id)).toEqual(["pub-local"]); // 仅本地,绝不放全部
  });

  it("disableCentral → 仅用（经校验的）快照", async () => {
    const snapshot = await signedList([pubA]);
    const reg = createTrustedPublisherRegistry(
      { rootPublicKey: rootPubB64, centralUrl: "https://x/list.json", disableCentral: true, snapshot },
      {
        fetchList: async () => {
          throw new Error("should not be called");
        },
      },
    );
    const r = await reg.refresh();
    expect(r).toMatchObject({ ok: true, source: "disabled" });
    expect(reg.publicKeys()).toEqual([pubA.publicKey]);
  });
});
