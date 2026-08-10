/**
 * 桌面身份实现 —— 账号密码 / 短信 / 微信换身份
 * (spec: desktop-account-login + phone/wechat transplant)。
 *
 * 组合:CloudLoginClient|CloudDesktopAuthClient → loadStatic → AuthSessionState
 * 顺序不可换:能力先于落态,禁半登录。
 */
import type { AuthSessionState } from "../auth/auth-session-state.js";
import type { CloudLoginClient } from "../auth/cloud-login-client.js";
import type { CloudDesktopAuthClient } from "../auth/cloud-desktop-auth-client.js";
import type { DesktopCapabilitiesClient } from "../auth/desktop-capabilities-client.js";
import { HOST_CONTRACT_VERSION } from "@blksails/pi-web-core/host-contract-version.js";
import type { CapabilityTenant } from "@blksails/pi-web-core/capability/types.js";
import type {
  IdentityCredentials,
  IdentityExchangeResult,
  IdentityProvider,
  IdentityState,
} from "./types.js";

export interface DesktopPasswordIdentityProviderOptions {
  /** 密码登录客户端；可与 desktopAuth 并存（优先 desktopAuth）。 */
  readonly loginClient: CloudLoginClient;
  /** 多方法桌面登录客户端（SMS / WeChat）；缺省时仅 password。 */
  readonly desktopAuth?: CloudDesktopAuthClient;
  readonly capabilitiesClient: DesktopCapabilitiesClient;
  /** 进程内凭据权威(与会话 spawn、既有 /auth/* 端点共用同一实例)。 */
  readonly authState: AuthSessionState;
  /** Best-effort notification after the process credential changes. */
  readonly onCredentialChanged?: (credential: string | undefined) => void;
}

export function createDesktopPasswordIdentityProvider(
  opts: DesktopPasswordIdentityProviderOptions,
): IdentityProvider {
  const { loginClient, desktopAuth, capabilitiesClient, authState, onCredentialChanged } =
    opts;

  function notifyCredentialChanged(credential: string | undefined): void {
    try {
      onCredentialChanged?.(credential);
    } catch {
      // Runner notification must not turn a successful login/logout into failure.
    }
  }

  let cachedTenant: CapabilityTenant | undefined;
  let cachedFor: string | undefined;

  function forget(): void {
    cachedTenant = undefined;
    cachedFor = undefined;
  }

  return {
    contractVersion: HOST_CONTRACT_VERSION,

    async current(): Promise<IdentityState> {
      const cred = authState.currentCredential();
      if (cred === undefined) {
        forget();
        return { kind: "anonymous" };
      }
      if (cachedFor !== cred || cachedTenant === undefined) {
        try {
          const snapshot = await capabilitiesClient.loadStatic();
          if (snapshot.tenant === undefined) return { kind: "anonymous" };
          cachedTenant = snapshot.tenant;
          cachedFor = cred;
        } catch {
          return { kind: "anonymous" };
        }
      }
      return { kind: "authenticated", tenant: cachedTenant };
    },

    async exchange(credentials: IdentityCredentials): Promise<IdentityExchangeResult> {
      let credential: string | undefined;

      if (credentials.method === "password") {
        const login = await (desktopAuth ?? loginClient).login({
          email: credentials.email,
          password: credentials.password,
        });
        if (!login.ok) return { ok: false, reason: login.reason };
        credential = login.credential;
      } else if (credentials.method === "sms") {
        if (desktopAuth === undefined) return { ok: false, reason: "invalid-request" };
        const login = await desktopAuth.verifyOtp(credentials.phone, credentials.code);
        if (!login.ok) return { ok: false, reason: login.reason };
        credential = login.credential;
      } else if (credentials.method === "wechat") {
        if (
          credentials.credential !== undefined &&
          credentials.credential.trim().length > 0
        ) {
          credential = credentials.credential.trim();
        } else if (desktopAuth !== undefined) {
          const polled = await desktopAuth.pollWechat(credentials.state);
          if (!polled.ok) return { ok: false, reason: polled.reason };
          if (polled.status !== "ready") {
            return { ok: false, reason: "invalid-credentials" };
          }
          credential = polled.credential;
        } else {
          return { ok: false, reason: "invalid-request" };
        }
      } else {
        return { ok: false, reason: "invalid-request" };
      }

      capabilitiesClient.clearCache();

      let snapshot: Awaited<ReturnType<DesktopCapabilitiesClient["loadStatic"]>>;
      try {
        snapshot = await capabilitiesClient.loadStatic(credential);
      } catch {
        capabilitiesClient.clearCache();
        return { ok: false, reason: "capabilities-failed" };
      }

      const set = authState.set(credential);
      if (!set.ok) {
        capabilitiesClient.clearCache();
        forget();
        return { ok: false, reason: "capabilities-failed" };
      }

      notifyCredentialChanged(credential);

      if (snapshot.tenant === undefined) {
        const fallback = tenantFromAuthSnapshot(authState);
        if (fallback === undefined) return { ok: true, state: { kind: "anonymous" } };
        cachedTenant = fallback;
        cachedFor = credential;
        return { ok: true, state: { kind: "authenticated", tenant: fallback } };
      }

      cachedTenant = snapshot.tenant;
      cachedFor = credential;
      return { ok: true, state: { kind: "authenticated", tenant: snapshot.tenant } };
    },

    async revoke(): Promise<void> {
      authState.clear();
      capabilitiesClient.clearCache();
      forget();
      notifyCredentialChanged(undefined);
    },
  };
}

function tenantFromAuthSnapshot(authState: AuthSessionState): CapabilityTenant | undefined {
  const snap = authState.snapshot();
  if (!snap.loggedIn) return undefined;
  return { userId: snap.userId, companyId: snap.companyId, role: "" };
}
