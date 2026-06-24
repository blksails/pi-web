/**
 * http-api — 公共导出面。
 *
 * 框架无关入口 `createPiWebHandler(opts)` 返回标准 Web Fetch 处理器;消费 session-engine
 * 的会话抽象与 @blksails/protocol 的 REST DTO / SSE 帧 / protocolVersion,不重定义上游契约。
 */
export {
  createPiWebHandler,
  createPiWebHandlerBundle,
  type PiWebHandlerBundle,
} from "./create-handler.js";
export type {
  PiWebHandler,
  PiWebHandlerOptions,
  RequestContext,
  RouteHandler,
  InjectedRoute,
  SseOptions,
  CreateChannelOpts,
  ResumeMeta,
} from "./handler.types.js";
export {
  type AuthContext,
  type AuthReject,
  type AuthResolver,
  type AuthorizeSession,
  defaultAuthResolver,
  defaultAuthorizeSession,
  isAuthReject,
} from "./auth.js";
export {
  encodeFrame,
  encodeHeartbeat,
  encodeEndFrame,
} from "./sse-encoder.js";
export {
  PROTOCOL_VERSION_HEADER,
  errorResponse,
  jsonResponse,
  mapEngineError,
  type ErrorBody,
} from "./error-map.js";
export { checkVersion, isCompatible } from "./version.js";
export { Router, type RouterDeps, type RouteSpec } from "./router.js";
export {
  createAttachmentRoutes,
  makeUploadAttachmentHandler,
  makeRawAttachmentHandler,
  RAW_ATTACHMENT_ROUTE,
  UPLOAD_ATTACHMENT_ROUTE,
  DEFAULT_MAX_UPLOAD_BYTES,
  type UploadHandlerOptions,
} from "./routes/attachment-routes.js";
