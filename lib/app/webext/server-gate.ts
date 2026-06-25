/**
 * server-gate — 服务端纯加密校验(webext-package-install 任务 2.2)。
 *
 * 与 `@blksails/pi-web-react` 的 extension-gate 同语义,但**不依赖 react 包**(其 index
 * 会拖入客户端 hook,污染服务端 bundle)。服务端验签用 Ed25519 公钥(无机密);版本
 * 兼容判定与浏览器侧一致。SRI 仍由浏览器侧 extension-gate 执行。
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

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(v: string): SemVer | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (m === null) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** targetApiVersion(range)是否兼容宿主版本(caret/精确/通配),与浏览器侧一致。 */
export function isApiCompatible(range: string, hostVersion: string): boolean {
  const r = range.trim();
  if (r === "" || r === "*") return true;
  const host = parseSemVer(hostVersion);
  if (host === undefined) return false;
  const caret = r.startsWith("^");
  const spec = parseSemVer(caret ? r.slice(1) : r);
  if (spec === undefined) return false;
  const hostGe =
    host.major > spec.major ||
    (host.major === spec.major &&
      (host.minor > spec.minor ||
        (host.minor === spec.minor && host.patch >= spec.patch)));
  if (!caret) {
    return (
      host.major === spec.major &&
      host.minor === spec.minor &&
      host.patch === spec.patch
    );
  }
  if (spec.major >= 1) return host.major === spec.major && hostGe;
  return host.major === 0 && host.minor === spec.minor && hostGe;
}
