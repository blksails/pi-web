/**
 * http-api — protocolVersion 握手/承载(单一来源:@blksails/pi-web-protocol,Req 7.3)。
 *
 * 客户端可经 `X-Pi-Protocol-Version` 请求头声明期望版本;不兼容时返回协商错误
 * (426,Req 7.2)。兼容判定:按 SemVer 主版本一致即兼容(MAJOR 相同)。
 */
import { protocolVersion } from "@blksails/pi-web-protocol";
import { errorResponse, PROTOCOL_VERSION_HEADER } from "./error-map.js";

function major(version: string): string | undefined {
  const parts = version.split(".");
  return parts.length === 3 ? parts[0] : undefined;
}

/** 客户端声明版本是否与服务端兼容(MAJOR 相同)。 */
export function isCompatible(clientVersion: string): boolean {
  const c = major(clientVersion);
  const s = major(protocolVersion);
  if (c === undefined || s === undefined) return false;
  return c === s;
}

/**
 * 校验请求声明的 protocolVersion;不兼容返回 426 协商响应,否则返回 undefined。
 * 未声明视为放行(无强制握手)。
 */
export function checkVersion(req: Request): Response | undefined {
  const declared = req.headers.get(PROTOCOL_VERSION_HEADER);
  if (declared === null || declared.length === 0) return undefined;
  if (isCompatible(declared)) return undefined;
  return errorResponse(
    426,
    "PROTOCOL_VERSION_MISMATCH",
    `Incompatible protocolVersion "${declared}"; server requires "${protocolVersion}".`,
  );
}

export { protocolVersion };
