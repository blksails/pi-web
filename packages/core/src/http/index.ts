/**
 * http-api — 公共导出面。
 *
 * 框架无关入口 `createPiWebHandler(opts)` 返回标准 Web Fetch 处理器;消费 session-engine
 * 的会话抽象与 @blksails/pi-web-protocol 的 REST DTO / SSE 帧 / protocolVersion,不重定义上游契约。
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
export { createBashRoutes, makeBashHandler } from "./routes/bash-routes.js";

// ───────── 配置相关路由(spec: kernel-boundary-decoupling,任务 3.1/3.2)─────────
// 这 5 个路由此前住在 `config/` 下并由 `config/index.ts` 导出。它们是**路由**而非配置域
// 逻辑,放在 config 下会让 config 反向依赖 http(而 http → config 本就存在,构成双向依赖)。
// 迁入 `http/routes/` 后方向变为单向。★ 导出从 config barrel 挪到此处:主 barrel 对两者
// 都是 `export *`,故主入口符号集合**逐字不变**(改动前后各导出一次符号清单比对为准)。
export {
  createConfigRoutes,
  type ConfigRoutesOptions,
  type ConfigAdminPolicy,
} from "./routes/config-routes.js";
export {
  createSandboxProjectRoutes,
  type SandboxProjectRoutesOptions,
  type SandboxAdminPolicy,
} from "./routes/sandbox-project-routes.js";
export {
  createExtensionsConfigRoutes,
  settingsToForm,
  applyFormToSettings,
  type ExtensionsConfigRoutesOptions,
  type ExtensionsAdminPolicy,
} from "./routes/extensions-config-routes.js";
export {
  createMcpConfigRoutes,
  type McpConfigRoutesOptions,
  type McpAdminPolicy,
} from "./routes/mcp-config-routes.js";
export {
  createSourceSettingsRoutes,
  resolveSourceSettingsFromPackageDir,
  resolveSourceSettingsFromPackageDirs,
  validateFormValues,
  SOURCE_SETTINGS_DISABLED_ENV,
  SOURCE_SETTINGS_BODY_LIMIT_ENV,
  DEFAULT_SOURCE_SETTINGS_BODY_LIMIT_BYTES,
  type SourceSettingsRoutesOptions,
  type SourceSettingsAdminPolicy,
  type ResolvedSourceSettings,
} from "./routes/source-settings-routes.js";
