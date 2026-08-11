/**
 * 身份获取端口 P5(spec: desktop-account-login;契约 §6)—— 模块出口。
 *
 * pi-SDK-free:类型零运行期依赖;实现与路由只依赖 `../auth/*` 与 `../http/*`,
 * 均不触及 pi SDK,可安全经 server 主 barrel 重导出。
 */
export type {
  IdentityCredentials,
  IdentityExchangeFailure,
  IdentityExchangeResult,
  IdentityEmailPasswordCredentials,
  IdentityPasswordCredentials,
  IdentityPhonePasswordCredentials,
  IdentitySmsCredentials,
  IdentityWechatCredentials,
  IdentityProvider,
  IdentityState,
} from "./types.js";

export {
  createDesktopPasswordIdentityProvider,
  type DesktopPasswordIdentityProviderOptions,
} from "./desktop-password-identity-provider.js";

export {
  createSessionIdentityProvider,
  type SessionIdentityProviderOptions,
} from "./session-identity-provider.js";

export {
  createIdentityRoutes,
  type IdentityRoutesOptions,
  type IdentityView,
} from "./identity-routes.js";
