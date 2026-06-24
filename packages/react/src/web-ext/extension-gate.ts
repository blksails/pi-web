/**
 * extension-gate — 宿主侧扩展安全门(任务 3.1 / Req 1.5, 6.5, 7.x)。
 *
 * 加载代码 bundle 前的强制校验:
 *   1. SRI 完整性:重算 entry 字节的 sha384,与 manifest.integrity 比对。
 *   2. 签名 ∈ 白名单:用白名单密钥重算 HMAC-SHA256 验签(任一命中即受信)。
 *   3. targetApiVersion 兼容宿主 web-kit 版本(caret/精确语义)。
 * 任一不通过返回带 reason 的拒绝;宿主据此回退默认 UI 并记审计。
 *
 * 跨运行时:使用 Web Crypto(`globalThis.crypto.subtle`),浏览器与 Node 22 均可用。
 */
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";

export interface GateOptions {
  /** 受信签名密钥白名单(HMAC 共享密钥)。空数组 + requireSignature=false 时跳过验签。 */
  readonly whitelist: readonly string[];
  /** 是否强制要求签名(git source 加载代码 bundle 时应为 true)。 */
  readonly requireSignature: boolean;
  /** 宿主 `@blksails/pi-web-kit` 版本(用于 targetApiVersion 兼容判定)。 */
  readonly hostApiVersion: string;
}

export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
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

async function hmacBase64(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64(new Uint8Array(sig));
}

/** 验签:白名单任一密钥重算 HMAC 命中即受信。 */
export async function verifySignature(
  manifest: WebExtensionManifest,
  whitelist: readonly string[],
): Promise<boolean> {
  if (manifest.signature === undefined) return false;
  const data = canonicalManifestBytes(manifest);
  for (const secret of whitelist) {
    if ((await hmacBase64(secret, data)) === manifest.signature) return true;
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

/**
 * targetApiVersion(range)是否兼容宿主版本。支持 `^M.m.p`、精确 `M.m.p`、`*`/``。
 * caret 语义:major>=1 同 major 且 host>=range;major==0 同 minor 且 host>=range。
 */
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
  // 0.x:同 minor 且 host >= spec
  return host.major === 0 && host.minor === spec.minor && hostGe;
}

/**
 * 综合校验。声明式扩展(无 entry/无需 bundle)可跳过 SRI/签名,只校验版本。
 * 代码扩展:必须 SRI 通过;若 requireSignature 或带 signature,则验签必须通过且 ∈ 白名单。
 */
export async function verifyExtension(input: {
  readonly manifest: WebExtensionManifest;
  readonly entryBytes?: Uint8Array;
  readonly opts: GateOptions;
}): Promise<GateResult> {
  const { manifest, entryBytes, opts } = input;

  if (!isApiCompatible(manifest.targetApiVersion, opts.hostApiVersion)) {
    return {
      ok: false,
      reason: `targetApiVersion ${manifest.targetApiVersion} 与宿主 web-kit ${opts.hostApiVersion} 不兼容`,
    };
  }

  const isCode = manifest.entry !== undefined;
  if (!isCode) return { ok: true }; // 纯声明:无 bundle,跳过 SRI/签名

  if (entryBytes === undefined) {
    return { ok: false, reason: "代码扩展缺少 entry 字节,无法校验 SRI" };
  }
  if (!(await verifyIntegrity(manifest, entryBytes))) {
    return { ok: false, reason: "SRI 完整性校验失败(integrity 与 entry 字节不一致)" };
  }

  if (opts.requireSignature || manifest.signature !== undefined) {
    if (manifest.signature === undefined) {
      return { ok: false, reason: "要求签名但 manifest 未签名" };
    }
    if (!(await verifySignature(manifest, opts.whitelist))) {
      return { ok: false, reason: "签名不在白名单内或验签失败" };
    }
  }

  return { ok: true };
}
