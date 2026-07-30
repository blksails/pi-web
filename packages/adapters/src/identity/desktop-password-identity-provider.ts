/**
 * 桌面身份实现 —— 账号密码换身份(spec: desktop-account-login,任务 4.1;
 * Req 2.1/2.6/4.1/4.2/5.1/7.1/7.2)。
 *
 * 组合三个既有件,自身只负责**顺序**与**状态一致性**:
 *
 *   CloudLoginClient(换凭据) → DesktopCapabilitiesClient.loadStatic(换授予) → AuthSessionState(落凭据)
 *
 * ## ★ 这个顺序不可换
 *
 * 若先落凭据再取授予,`loadStatic()` 失败时就产生了「有凭据、无授予」的半登录态:
 * UI 显示已登录,线上源却空、模型清单却是本地的,用户无从判断该重试还是该重登。
 * 契约 §4.2「失败即拒绝」正是为消灭这个中间态。故本实现在授予到手**之后**才写入
 * `AuthSessionState` —— 失败时对用户即「登录未成功」,可原样重试。
 *
 * 代价是这个凭据在云端已经签发却被本地丢弃。这是可接受的:凭据本身带 exp,
 * 丢弃不产生泄漏,而半登录态产生的故障会散落到后续每一处消费方。
 */
import type { AuthSessionState } from "../auth/auth-session-state.js";
import type { CloudLoginClient } from "../auth/cloud-login-client.js";
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
  readonly loginClient: CloudLoginClient;
  readonly capabilitiesClient: DesktopCapabilitiesClient;
  /** 进程内凭据权威(与会话 spawn、既有 /auth/* 端点共用同一实例)。 */
  readonly authState: AuthSessionState;
}

export function createDesktopPasswordIdentityProvider(
  opts: DesktopPasswordIdentityProviderOptions,
): IdentityProvider {
  const { loginClient, capabilitiesClient, authState } = opts;

  /**
   * 最近一次成功 `loadStatic()` 得到的身份,与 `authState` 的凭据**同生共死**。
   *
   * 之所以缓存而不是每次 `current()` 都去打云端:`current()` 会被前端频繁调用
   * (每次挂载、每次刷新信号),让它打网络会把登录态查询变成一个可能失败的操作,
   * 而 Req 1.6 要求身份探测失败也不能阻断启动。
   */
  let cachedTenant: CapabilityTenant | undefined;
  /** 缓存所绑定的凭据。凭据一变(切号/登出/过期),缓存即失效。 */
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
        // 未登录或凭据已过期 —— 正常态,不是错误(端口不变式 1)。
        forget();
        return { kind: "anonymous" };
      }
      if (cachedFor !== cred || cachedTenant === undefined) {
        // 凭据有效但没有身份缓存:发生在「桌面壳经 env 播种了凭据、但本进程尚未做过
        // 一次授予加载」的启动路径上。此处补一次加载,失败则降级为 anonymous ——
        // current() 不抛(不变式 1)。
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
      if (credentials.method !== "password") {
        return { ok: false, reason: "invalid-request" };
      }
      const login = await loginClient.login({
        email: credentials.email,
        password: credentials.password,
      });
      if (!login.ok) return { ok: false, reason: login.reason };

      // 切号:先让授予缓存失效,否则 loadStatic 会命中**上一个账号**的缓存
      // (缓存按凭据绑定,但此刻 authState 里还是旧凭据 —— 必须显式清)。
      capabilitiesClient.clearCache();

      // 用**新**凭据显式取授予 —— 此刻它还没写进 authState(见顶部顺序说明)。
      let snapshot: Awaited<ReturnType<DesktopCapabilitiesClient["loadStatic"]>>;
      try {
        snapshot = await capabilitiesClient.loadStatic(login.credential);
      } catch {
        // ★ 不写入 authState —— 对用户即「登录未成功」,状态与调用前一致(端口后置条件)。
        capabilitiesClient.clearCache();
        return { ok: false, reason: "capabilities-failed" };
      }

      const set = authState.set(login.credential);
      if (!set.ok) {
        // 云端签发了本地判定为非法/已过期的凭据 —— 归入 capabilities-failed:
        // 不是用户的账号密码错(那已经通过了),是云端与本地对凭据的理解不一致。
        capabilitiesClient.clearCache();
        forget();
        return { ok: false, reason: "capabilities-failed" };
      }

      if (snapshot.tenant === undefined) {
        // 授予加载成功但没有 tenant:身份缺失,展示层无从显示「我是谁」。
        // 按 Req 4.3 这是「单项缺失 → 降级」,故仍算登录成功,只是 state 为 anonymous 的
        // 反面——这里选择用凭据 payload 的身份兜底(Req 5.3「退回最小身份信息」)。
        const fallback = tenantFromAuthSnapshot(authState);
        if (fallback === undefined) return { ok: true, state: { kind: "anonymous" } };
        cachedTenant = fallback;
        cachedFor = login.credential;
        return { ok: true, state: { kind: "authenticated", tenant: fallback } };
      }

      cachedTenant = snapshot.tenant;
      cachedFor = login.credential;
      return { ok: true, state: { kind: "authenticated", tenant: snapshot.tenant } };
    },

    async revoke(): Promise<void> {
      // 三者缺一即残留:清凭据不清授予缓存 → 下一个用户读到上一个用户的 token(Req 7.2)。
      authState.clear();
      capabilitiesClient.clearCache();
      forget();
    },
  };
}

/** 凭据 payload 兜底身份(Req 5.3):没有 tenant 授予时展示可得的最小信息。 */
function tenantFromAuthSnapshot(authState: AuthSessionState): CapabilityTenant | undefined {
  const snap = authState.snapshot();
  if (!snap.loggedIn) return undefined;
  return { userId: snap.userId, companyId: snap.companyId, role: "" };
}
