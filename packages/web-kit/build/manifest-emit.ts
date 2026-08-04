/**
 * pi-web build — manifest 产出 + SRI + Ed25519 签名(webext-package-install 任务 1.2)。
 *
 * 计算 entry 的 SRI 摘要(sha384,base64),组装 `manifest.json`;可选用发布者 **Ed25519
 * 私钥**(base64 pkcs8)对规范化 manifest 字节签名(base64)。签名覆盖 integrity。
 * 验签在宿主服务端用对应 **公钥**(base64 raw)进行(见 extension-gate.verifySignature)。
 */
import { createHash, webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
  type WebExtensionCapability,
  type WebExtEntry,
} from "@blksails/pi-web-protocol";

export { canonicalManifestBytes };

const subtle = webcrypto.subtle;

/** 计算字节的 SRI 摘要字符串(`sha384-<base64>`)。 */
export function computeIntegrity(bytes: Uint8Array): string {
  const digest = createHash("sha384").update(bytes).digest("base64");
  return `sha384-${digest}`;
}

/**
 * 生成 Ed25519 签名密钥对。返回 base64:`publicKey`(raw,32 字节,进白名单/中心列表)、
 * `privateKey`(pkcs8,签名用,绝不分发)。供发布者、第一方默认密钥、测试使用。
 */
export async function generateSigningKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const kp = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = Buffer.from(await subtle.exportKey("raw", kp.publicKey)).toString(
    "base64",
  );
  const priv = Buffer.from(
    await subtle.exportKey("pkcs8", kp.privateKey),
  ).toString("base64");
  return { publicKey: pub, privateKey: priv };
}

/** 用 Ed25519 私钥(base64 pkcs8)对 manifest 规范化字节签名,返回 base64 签名。 */
export async function signManifest(
  m: Omit<WebExtensionManifest, "signature">,
  privateKeyB64: string,
): Promise<string> {
  const key = await subtle.importKey(
    "pkcs8",
    Buffer.from(privateKeyB64, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalManifestBytes(m));
  const sig = await subtle.sign({ name: "Ed25519" }, key, data);
  return Buffer.from(sig).toString("base64");
}

/**
 * 双入口协议(Phase 2,任务 6.2)下单个入口的产出输入:调用方给出该入口的相对路径、
 * 最终字节与所属宿主形态,integrity 由本模块从 `bytes` 现算——不接受调用方预算的
 * integrity,避免「字节已改写、integrity 未同步」的脱节重演(design.md「完整性重算」)。
 */
export interface WebExtEntryInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly realm: WebExtEntry["realm"];
}

export interface EmitManifestInput {
  readonly id: string;
  readonly targetApiVersion: string;
  readonly entry?: string;
  readonly entryBytes?: Uint8Array;
  readonly css?: string;
  readonly capabilities?: readonly WebExtensionCapability[];
  /**
   * 双入口协议(Phase 2):同源(分派)入口与隔离(自包含)入口的完整性描述集合。
   * **与 `entry`/`entryBytes` 相互独立**——`entries` 不参与推导顶层 `entry` 字段,
   * 顶层 `entry` 恒由调用方显式传入的 `entry`/`entryBytes` 决定。这保证「单入口字段
   * 必须继续指向分派入口产物、不得改指隔离入口」这一向后兼容约束不依赖调用顺序或
   * `entries` 数组内的元素顺序(design.md 任务 6.2 完成态)。
   */
  readonly entries?: readonly WebExtEntryInput[];
  /** Ed25519 私钥(base64 pkcs8);提供则对 manifest 签名。 */
  readonly signKey?: string;
}

export async function emitManifest(
  input: EmitManifestInput,
): Promise<WebExtensionManifest> {
  const base: Omit<WebExtensionManifest, "signature"> = {
    id: input.id,
    targetApiVersion: input.targetApiVersion,
    ...(input.entry !== undefined ? { entry: input.entry } : {}),
    ...(input.css !== undefined ? { css: input.css } : {}),
    ...(input.entry !== undefined && input.entryBytes !== undefined
      ? { integrity: computeIntegrity(input.entryBytes) }
      : {}),
    ...(input.capabilities !== undefined
      ? { capabilities: [...input.capabilities] }
      : {}),
    ...(input.entries !== undefined
      ? {
          entries: input.entries.map(
            (e): WebExtEntry => ({
              path: e.path,
              integrity: computeIntegrity(e.bytes),
              realm: e.realm,
            }),
          ),
        }
      : {}),
  };
  if (input.signKey !== undefined) {
    return { ...base, signature: await signManifest(base, input.signKey) };
  }
  return base;
}
