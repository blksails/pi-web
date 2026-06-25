/**
 * http-api — 引擎错误 → HTTP 状态码映射 + 统一错误响应构造。
 *
 * 已知的 `session-engine` 错误映射到具体状态码而非统一 500(Req 9.2):
 *   SessionStoppedError      → 409
 *   SessionNotFoundError     → 404
 *   UnknownExtensionUIError  → 409
 *   MissingInputError        → 400
 *   未知                      → 500(不泄露 env/凭据/堆栈,Req 9.3)
 *
 * 协议版本承载于响应头/体(Req 7.1)。版本来源唯一为 `@blksails/pi-web-protocol`(Req 7.3)。
 */
import { protocolVersion } from "@blksails/pi-web-protocol";
import {
  MissingInputError,
  SessionNotFoundError,
  SessionStoppedError,
  UnknownExtensionUIError,
} from "../session/index.js";

/** 协议版本响应头名(REST 响应承载,Req 7.1)。 */
export const PROTOCOL_VERSION_HEADER = "X-Pi-Protocol-Version";

/** 统一错误体形状(Req 9.1)。 */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fields?: ReadonlyArray<string>;
  };
  readonly protocolVersion: string;
}

/** 校验错误的字段路径项(由 validate.ts 产出)。 */
export interface FieldIssue {
  readonly path: string;
}

function baseHeaders(): Headers {
  const h = new Headers();
  h.set("Content-Type", "application/json");
  h.set(PROTOCOL_VERSION_HEADER, protocolVersion);
  return h;
}

/** 构造统一错误 `Response`(注入 protocolVersion 头/体)。 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: ReadonlyArray<string>,
): Response {
  const body: ErrorBody = {
    error: fields !== undefined ? { code, message, fields } : { code, message },
    protocolVersion,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(),
  });
}

/** 构造 JSON 成功 `Response`,承载 protocolVersion 头与体字段。 */
export function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
): Response {
  const body = { ...payload, protocolVersion };
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(),
  });
}

/**
 * 把上游会话层抛出的错误映射为对应 HTTP 状态码与错误响应。
 * 未知错误兜底 500,响应体仅含通用消息,不泄露 env/凭据/堆栈细节(Req 9.3)。
 */
export function mapEngineError(err: unknown): Response {
  if (err instanceof SessionStoppedError) {
    return errorResponse(409, err.code, err.message);
  }
  if (err instanceof SessionNotFoundError) {
    return errorResponse(404, err.code, err.message);
  }
  if (err instanceof UnknownExtensionUIError) {
    return errorResponse(409, err.code, err.message);
  }
  if (err instanceof MissingInputError) {
    return errorResponse(400, err.code, err.message);
  }
  // 未映射错误兜底 500。响应不泄露细节,但把根因打到**服务端 stderr**,否则线上/CI 无从排障。
  console.error("[pi-web] 未映射的会话层错误:", err);
  return errorResponse(500, "INTERNAL", "Internal server error.");
}
