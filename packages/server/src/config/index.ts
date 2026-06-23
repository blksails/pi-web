/**
 * config — 公共导出面(codec、secret-merge、路由注入)。
 */
export { ConfigCodec } from "./config-codec.js";
export {
  maskSecrets,
  mergeSecrets,
  isSecretMask,
  type SecretMask,
} from "./secret-merge.js";
export {
  createConfigRoutes,
  type ConfigRoutesOptions,
  type ConfigAdminPolicy,
} from "./config-routes.js";
export type { ModelOption, ModelOptions } from "./model-options.types.js";
// 注意:listModelOptions(import pi SDK)刻意**不**走此 barrel,经子路径
// `@pi-web/server/model-options` 导出,以保持 Next serverExternalPackages 对 pi SDK
// 的 external 隔离(与 ./trust 同策略;否则 pi SDK 被打进路由 bundle → node:fs 崩溃)。
export {
  createSandboxProjectRoutes,
  type SandboxProjectRoutesOptions,
  type SandboxAdminPolicy,
} from "./sandbox-project-routes.js";
export {
  createExtensionsConfigRoutes,
  settingsToForm,
  applyFormToSettings,
  type ExtensionsConfigRoutesOptions,
  type ExtensionsAdminPolicy,
} from "./extensions-config-routes.js";
