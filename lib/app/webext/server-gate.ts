/**
 * server-gate — 服务端纯加密校验(webext-package-install 任务 2.2)。
 *
 * 与 `@blksails/pi-web-react` 的 extension-gate 同语义,但**不依赖 react 包**(其 index
 * 会拖入客户端 hook,污染服务端 bundle)。服务端验签用 Ed25519 公钥(无机密)。
 * SRI 仍由浏览器侧 extension-gate 执行。版本兼容门控已整条移除(两侧一致)。
 */
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";

const subtle = webcrypto.subtle;

/** 白名单任一 Ed25519 公钥(base64 raw)验 manifest 签名通过即受信。 */
export async function verifyManifestSignature(
  manifest: WebExtensionManifest,
  publicKeys: readonly string[],
): Promise<boolean> {
  if (manifest.signature === undefined) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(manifest.signature, "base64");
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(canonicalManifestBytes(manifest));
  for (const pub of publicKeys) {
    try {
      const key = await subtle.importKey(
        "raw",
        Buffer.from(pub, "base64"),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (await subtle.verify({ name: "Ed25519" }, key, sig, data)) return true;
    } catch {
      // 无效公钥/算法 → 跳过
    }
  }
  return false;
}
