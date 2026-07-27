/**
 * desktop-cloud-login · auth 模块 barrel。
 *
 * ⚠ 仅重导出 **pi-SDK-free** 的部分(credential 解析 / 登录态 / 注入路由 + 类型),可安全经
 * server 主 barrel 重导出。`egress-model-source`(引 pi SDK 值 AuthStorage/ModelRegistry)**不在此**,
 * 由 runner 装配层(option-mapper)按子路径直接引入。
 */
export * from "./credential.js";
export * from "./auth-session-state.js";
export * from "./auth-routes.js";
// egress 模型描述(pi-SDK-free 纯类型);工厂本体 egress-model-source 不在此。
export * from "./egress-model.js";
// desktop-hybrid-agent-sources:capabilities 客户端(pi-SDK-free)。
export {
  createDesktopCapabilitiesClient,
  deriveCapabilitiesUrlFromEgressBase,
  deriveLoginUrlFromEgressBase,
  resolveDesktopCapabilitiesUrl,
  CapabilitiesLoadError,
  type DesktopCapabilitiesClient,
  type DesktopCapabilitiesClientOptions,
  type CapabilitiesFetch,
} from "./desktop-capabilities-client.js";
// desktop-account-login:账号密码登录客户端(pi-SDK-free,只用 fetch)。
export {
  createCloudLoginClient,
  CLOUD_LOGIN_REQUEST_TIMEOUT_MS,
  type CloudLoginClient,
  type CloudLoginClientOptions,
  type CloudLoginFailure,
  type CloudLoginFetch,
  type CloudLoginResult,
} from "./cloud-login-client.js";
