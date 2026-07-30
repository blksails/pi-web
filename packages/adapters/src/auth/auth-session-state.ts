/**
 * desktop-cloud-login · 进程内登录态(design.md §Data Models,Req 2.2/4.4/5.2/6.2)。
 *
 * pi-web server 进程内「当前桌面凭据 + 用户身份」的权威可变态(非持久;keychain 是 at-rest
 * 副本,`~/.pi/agent` 不受影响)。登录=set(新身份替换旧,支持切号);登出=clear。
 *
 * **脱敏纪律**:凭据明文只在本模块内部与 spawn env 下发时流转,绝不进日志/历史/附件
 * (Req 5.2)。`snapshot()` 供 UI 展示的投影**不含**凭据明文。
 */
import {
  credentialStatus,
  parseDesktopCredential,
  type CredentialStatus,
  type DesktopCredentialPayload,
} from "./credential.js";

/** 供 UI/端点展示的登录态投影(不含凭据明文)。 */
export type AuthSnapshot =
  | { readonly loggedIn: false }
  | {
      readonly loggedIn: true;
      readonly userId: string;
      readonly companyId: string;
      readonly exp: number;
      readonly status: CredentialStatus;
    };

/** 设置登录态的结果。 */
export type SetCredentialResult =
  | { readonly ok: true; readonly payload: DesktopCredentialPayload }
  | { readonly ok: false; readonly reason: "invalid" | "expired" };

interface LoggedIn {
  readonly credential: string;
  readonly payload: DesktopCredentialPayload;
}

/**
 * 进程内登录态。单实例由装配处(pi-handler)持有,鉴权端点写、会话 spawn 读。
 */
export class AuthSessionState {
  #current: LoggedIn | undefined;
  readonly #now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.#now = opts.now ?? (() => Date.now());
  }

  /**
   * 设置(或切号替换)当前登录凭据。
   *
   * - 结构非法 → `{ ok:false, reason:"invalid" }`,不改变现态。
   * - 已过期 → `{ ok:false, reason:"expired" }`,不改变现态。
   * - 合法且在期 → 替换现态,返回 `{ ok:true, payload }`。
   */
  set(credential: string): SetCredentialResult {
    const payload = parseDesktopCredential(credential);
    if (payload === undefined) return { ok: false, reason: "invalid" };
    if (credentialStatus(payload, this.#now()) === "expired") {
      return { ok: false, reason: "expired" };
    }
    this.#current = { credential: credential.trim(), payload };
    return { ok: true, payload };
  }

  /** 清除登录态(登出);后续会话回退未登录行为。 */
  clear(): void {
    this.#current = undefined;
  }

  /** 是否处于**有效**(存在且未过期)登录态。 */
  isValid(): boolean {
    if (this.#current === undefined) return false;
    return credentialStatus(this.#current.payload, this.#now()) === "valid";
  }

  /**
   * 取当前有效凭据明文(供会话 spawn 下发 runner env)。仅在有效登录态返回,过期/未登录
   * 返回 `undefined`(过期凭据不下发,Req 3.7)。
   */
  currentCredential(): string | undefined {
    if (this.#current === undefined) return undefined;
    if (credentialStatus(this.#current.payload, this.#now()) !== "valid") return undefined;
    return this.#current.credential;
  }

  /** UI/端点展示投影(不含凭据明文)。 */
  snapshot(): AuthSnapshot {
    if (this.#current === undefined) return { loggedIn: false };
    const { payload } = this.#current;
    return {
      loggedIn: true,
      userId: payload.userId,
      companyId: payload.companyId,
      exp: payload.exp,
      status: credentialStatus(payload, this.#now()),
    };
  }
}
