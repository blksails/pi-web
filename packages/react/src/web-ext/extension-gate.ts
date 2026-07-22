/**
 * extension-gate — 宿主侧扩展安全门(任务 3.1 / Req 1.5, 6.5, 7.x;webext-package-install 任务 1.1)。
 *
 * 加载代码 bundle 前的强制校验:
 *   1. SRI 完整性:重算 entry 字节的 sha384,与 manifest.integrity 比对(无需机密,浏览器侧执行)。
 *   2. 签名 ∈ 白名单:用白名单 **Ed25519 公钥** 验证签名(任一命中即受信);因公钥验签
 *      不暴露任何机密,且签名覆盖 integrity,故验签放在 **服务端**,浏览器侧以
 *      `signaturePreVerified` 跳过本步、仅做 SRI。
 * 任一不通过返回带 reason 的拒绝;宿主据此回退默认 UI 并记审计。
 *
 * ⚠️ 曾有第三道「targetApiVersion 兼容宿主 web-kit 版本」的版本门控,已整条移除
 * (宿主版本长期自述失真、minor 从未真正充当保护边界)。`manifest.targetApiVersion`
 * 字段保留于协议中但不再被校验。
 *
 * 跨运行时:使用 Web Crypto(`globalThis.crypto.subtle`)。SRI(sha384)浏览器与 Node 均可用;
 * Ed25519 验签在 Node(服务端)执行。
 */
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";

export interface GateOptions {
  /** 受信发布者 Ed25519 公钥白名单(base64 raw)。空数组 + requireSignature=false 时跳过验签。 */
  readonly whitelist: readonly string[];
  /** 是否强制要求签名(git source 加载代码 bundle 时应为 true)。 */
  readonly requireSignature: boolean;
  /**
   * 签名已由服务端预先校验(浏览器侧应置 true):置 true 时跳过签名分支,但 **仍执行 SRI**。
   * 用于「签名服务端验 / SRI 浏览器验」拆分:服务端验签后下发去签名的已背书 manifest,
   * 浏览器仅凭 integrity 做 SRI,验签机密不入浏览器。
   */
  readonly signaturePreVerified?: boolean;
}

export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha384Base64(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-384", bytes as unknown as BufferSource);
  return bytesToBase64(new Uint8Array(digest));
}

/** 计算字节的 SRI(`sha384-<base64>`)。 */
export async function computeSri(bytes: Uint8Array): Promise<string> {
  return `sha384-${await sha384Base64(bytes)}`;
}

export async function verifyIntegrity(
  manifest: WebExtensionManifest,
  entryBytes: Uint8Array,
): Promise<boolean> {
  if (manifest.integrity === undefined) return false;
  return (await computeSri(entryBytes)) === manifest.integrity;
}

/**
 * 验签:白名单任一 **Ed25519 公钥**(base64 raw)验证 `manifest.signature`(base64)
 * 对规范化字节(`canonicalManifestBytes`,排除 signature)的签名通过即受信。
 * 公钥验签不暴露机密,应在服务端调用。
 */
export async function verifySignature(
  manifest: WebExtensionManifest,
  whitelist: readonly string[],
): Promise<boolean> {
  if (manifest.signature === undefined) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64ToBytes(manifest.signature);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(canonicalManifestBytes(manifest));
  for (const pub of whitelist) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        base64ToBytes(pub) as unknown as BufferSource,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        sigBytes as unknown as BufferSource,
        data as unknown as BufferSource,
      );
      if (ok) return true;
    } catch {
      // 无效公钥/算法不支持 → 跳过该条
    }
  }
  return false;
}

/**
 * 综合校验。声明式扩展(无 entry/无需 bundle)可跳过 SRI/签名直接受信。
 * 代码扩展:必须 SRI 通过;若 requireSignature 或带 signature,则验签必须通过且 ∈ 白名单。
 */
export async function verifyExtension(input: {
  readonly manifest: WebExtensionManifest;
  readonly entryBytes?: Uint8Array;
  readonly opts: GateOptions;
}): Promise<GateResult> {
  const { manifest, entryBytes, opts } = input;

  const isCode = manifest.entry !== undefined;
  if (!isCode) return { ok: true }; // 纯声明:无 bundle,跳过 SRI/签名

  if (entryBytes === undefined) {
    return { ok: false, reason: "代码扩展缺少 entry 字节,无法校验 SRI" };
  }
  if (!(await verifyIntegrity(manifest, entryBytes))) {
    return { ok: false, reason: "SRI 完整性校验失败(integrity 与 entry 字节不一致)" };
  }

  // 签名已由服务端预校验:跳过签名分支(SRI 已在上方执行)。
  if (opts.signaturePreVerified !== true) {
    if (opts.requireSignature || manifest.signature !== undefined) {
      if (manifest.signature === undefined) {
        return { ok: false, reason: "要求签名但 manifest 未签名" };
      }
      if (!(await verifySignature(manifest, opts.whitelist))) {
        return { ok: false, reason: "签名不在白名单内或验签失败" };
      }
    }
  }

  return { ok: true };
}
