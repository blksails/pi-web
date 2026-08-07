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
// egress-model 的**纯类型**已归位到 capability(spec: core-package-extraction 任务 4.1):
// capability 是 core 层契约,auth 是适配器;类型放在契约侧,方向才是 adapters→core。
// 此处原样 re-export,本 barrel 的导出面逐字不变。
export * from "@blksails/pi-web-core/capability/egress-model.js";
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
  // spec publish-grant-issuance / publish-key-lifecycle / publish-execution:
  // 应用层(lib/app)要按这两个类型接发布链路,故一并导出。
  type PublishGrant,
  type RegisterPublishKeyOutcome,
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
// phone/wechat 桌面登录族
export {
  createCloudDesktopAuthClient,
  type CloudDesktopAuthClient,
  type CloudDesktopAuthClientOptions,
  type OtpSendResult,
  type WechatStartResult,
  type WechatPollResult,
} from "./cloud-desktop-auth-client.js";
// desktop-account-login Req 11/12:桌面壳标记 + 凭据交接端点(壳经受 token 保护的回环端点取)。
export * from "./desktop-marker.js";
export {
  createShellCredentialRoutes,
  resolveShellToken,
  SHELL_TOKEN_ENV,
  type ShellCredentialRoutesOptions,
} from "./shell-credential-route.js";
