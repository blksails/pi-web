/**
 * 错误类型 — 下游请求层(request/pi-client)与版本层(version)共享的错误面。
 *
 * - PiHttpError:非 2xx 响应归一(状态码 + 可选协议错误体 { code, message, fields? })。
 * - PiProtocolVersionError:收到的 protocolVersion 与本层基准不兼容。
 *
 * 仅依赖标准 Error;不引入任何后端对象或非浏览器 API。
 */

/** 协议错误体形状(http-api 非 2xx 响应可能携带)。 */
export interface PiErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly fields?: Record<string, unknown>;
}

/** 非 2xx HTTP 响应归一为可辨识错误,携带状态码与协议错误体字段。 */
export class PiHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly fields: Record<string, unknown> | undefined;
  readonly body: PiErrorBody | undefined;

  constructor(status: number, body?: PiErrorBody) {
    super(body?.message ?? `pi http error ${status}`);
    this.name = "PiHttpError";
    this.status = status;
    this.code = body?.code;
    this.fields = body?.fields;
    this.body = body;
    Object.setPrototypeOf(this, PiHttpError.prototype);
  }
}

/** protocolVersion 与本层基准不兼容。 */
export class PiProtocolVersionError extends Error {
  readonly received: string;
  readonly expected: string;

  constructor(received: string, expected: string) {
    super(
      `incompatible protocolVersion: received "${received}", expected "${expected}"`,
    );
    this.name = "PiProtocolVersionError";
    this.received = received;
    this.expected = expected;
    Object.setPrototypeOf(this, PiProtocolVersionError.prototype);
  }
}
