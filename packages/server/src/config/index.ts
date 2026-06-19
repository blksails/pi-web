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
