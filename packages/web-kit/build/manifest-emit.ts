/**
 * pi-web build — manifest 产出 + SRI(任务 2.4 / Req 6.1, 7.2)。
 *
 * 计算 entry 的 SRI 摘要(sha384,base64),组装 `manifest.json`;可选用配置私钥对
 * 规范化 manifest 字节签名(HMAC-SHA256,base64)。签名校验在宿主安全门。
 */
import { createHash, createHmac } from "node:crypto";
import {
  canonicalManifestBytes,
  type WebExtensionManifest,
  type WebExtensionCapability,
} from "@pi-web/protocol";

export { canonicalManifestBytes };

/** 计算字节的 SRI 摘要字符串(`sha384-<base64>`)。 */
export function computeIntegrity(bytes: Uint8Array): string {
  const digest = createHash("sha384").update(bytes).digest("base64");
  return `sha384-${digest}`;
}

/** 用私钥(HMAC 密钥)对 manifest 规范化字节签名。 */
export function signManifest(
  m: Omit<WebExtensionManifest, "signature">,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalManifestBytes(m))
    .digest("base64");
}

export interface EmitManifestInput {
  readonly id: string;
  readonly targetApiVersion: string;
  readonly entry?: string;
  readonly entryBytes?: Uint8Array;
  readonly css?: string;
  readonly capabilities?: readonly WebExtensionCapability[];
  /** 提供则签名。 */
  readonly signSecret?: string;
}

export function emitManifest(input: EmitManifestInput): WebExtensionManifest {
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
  };
  if (input.signSecret !== undefined) {
    return { ...base, signature: signManifest(base, input.signSecret) };
  }
  return base;
}
