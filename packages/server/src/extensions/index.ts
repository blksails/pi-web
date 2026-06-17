/**
 * extension-management — 公共导出面。
 *
 * 经 http-api `createPiWebHandler` 的 `routes?` 注入接缝挂载的受控扩展管理路由集
 * (`GET/POST /extensions`、`DELETE /extensions/:extId`、`POST /sessions/:id/reload`),
 * 以及治理纯函数核心、CLI 适配器与安全接缝。消费上游契约(http-api / session-engine /
 * agent-source-resolver / @pi-web/protocol),不重定义。
 */
export { createExtensionRoutes } from "./routes.js";

export { checkAllowlist, DEFAULT_ALLOWLIST } from "./install/source-allowlist.js";
export {
  assembleInstallArgs,
  assembleRemoveArgs,
} from "./install/install-args.js";
export { landTrust } from "./install/trust-landing.js";

export {
  ChildProcessPiCli,
  PiCliNotFoundError,
  PiListError,
  parsePiList,
  resolvePiCliEntry,
  type ChildProcessPiCliOptions,
} from "./cli/pi-cli.js";

export {
  createDefaultAdminPolicy,
  defaultAdminPolicy,
  type DefaultAdminPolicyConfig,
} from "./security/admin-policy.js";
export {
  actorOf,
  buildAuditRecord,
  defaultOnAudit,
  redactReason,
} from "./security/audit.js";

export { makeListExtensionsHandler } from "./routes/list-extensions.js";
export {
  makeInstallExtensionHandler,
  type InstallExtensionDeps,
} from "./routes/install-extension.js";
export {
  makeRemoveExtensionHandler,
  type RemoveExtensionDeps,
} from "./routes/remove-extension.js";
export {
  defaultSessionReloader,
  makeReloadSessionHandler,
  ReloadNotConfiguredError,
  type ReloadSessionDeps,
} from "./routes/reload-session.js";

export {
  InstallExtensionRequestSchema,
  InstallResultResponseSchema,
  type InstallExtensionRequest,
  type InstallResultResponse,
} from "./ext.dto.js";

export type {
  AdminPolicy,
  AllowlistConfig,
  AllowlistDecision,
  AuditRecord,
  ExtManagementOptions,
  ExtScope,
  ExtSource,
  ExtSourceKind,
  InstallArgs,
  InstalledExtension,
  OnAudit,
  PiCli,
  PiCommandResult,
  SessionReloader,
} from "./ext.types.js";
