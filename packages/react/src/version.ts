/**
 * protocolVersion 兼容判定 — 以 @blksails/pi-web-protocol 的 protocolVersion 为唯一基准。
 *
 * SSE 帧 / REST 响应携带的版本经此判定;不兼容 → PiProtocolVersionError。
 * 兼容策略:SemVer major 相同即兼容(0.x 视 minor 为 break 仍按 major=0 宽松,
 * 这里采用 major 相同判定,与 protocol 当前 0.1.0 一致)。
 */
import { protocolVersion } from "@blksails/pi-web-protocol";
import { PiProtocolVersionError } from "./client/errors.js";

/** 解析 SemVer 主版本号;无法解析返回 null。 */
function majorOf(version: string): number | null {
  const m = /^(\d+)\./.exec(version);
  if (m === null || m[1] === undefined) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/** 本层基准协议版本(来自 @blksails/pi-web-protocol)。 */
export const baseProtocolVersion: string = protocolVersion;

/** 给定版本是否与本层基准兼容(主版本相同)。无法解析视为不兼容。 */
export function isProtocolVersionCompatible(received: string): boolean {
  const a = majorOf(received);
  const b = majorOf(baseProtocolVersion);
  if (a === null || b === null) return false;
  return a === b;
}

/**
 * 断言版本兼容;不兼容抛 PiProtocolVersionError。
 * received 为 undefined 时视为"未承载版本",放行(由上游契约决定是否必带)。
 */
export function assertProtocolVersion(received: string | undefined): void {
  if (received === undefined) return;
  if (!isProtocolVersionCompatible(received)) {
    throw new PiProtocolVersionError(received, baseProtocolVersion);
  }
}
