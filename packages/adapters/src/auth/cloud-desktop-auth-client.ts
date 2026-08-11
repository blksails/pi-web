/**
 * 桌面云端登录族客户端：password / SMS OTP / WeChat poll（同 pi-clouds /api/desktop/*）。
 * 不写凭据进日志。
 */
import { createLogger } from "@blksails/pi-web-logger";
import {
  CLOUD_LOGIN_REQUEST_TIMEOUT_MS,
  type CloudLoginFailure,
  type CloudLoginFetch,
  type CloudLoginInput,
  type CloudLoginResult,
} from "./cloud-login-client.js";

const logger = createLogger({ namespace: "server:auth:cloud-desktop" });

export type { CloudLoginFailure, CloudLoginResult };

export interface CloudDesktopAuthClientOptions {
  /** 完整 login URL，如 https://host/api/desktop/login */
  readonly loginUrl: string;
  readonly fetchImpl?: CloudLoginFetch;
  readonly timeoutMs?: number;
}

export interface OtpSendResult {
  readonly ok: boolean;
  readonly reason?: CloudLoginFailure | "rate-limited";
}

export type WechatStartResult =
  | {
      readonly ok: true;
      readonly state: string;
      readonly appid: string;
      readonly redirectUri: string;
      readonly qrConnectUrl: string;
      readonly expiresAt: number;
    }
  | {
      readonly ok: false;
      readonly reason: CloudLoginFailure;
    }

export type WechatPollResult =
  | { readonly ok: true; readonly status: "pending" }
  | { readonly ok: true; readonly status: "ready"; readonly credential: string }
  | { readonly ok: true; readonly status: "error"; readonly error: string }
  | { readonly ok: true; readonly status: "claimed" | "unknown" }
  | { readonly ok: false; readonly reason: CloudLoginFailure };

function siblingUrl(loginUrl: string, suffix: string): string {
  // .../login → .../<suffix>
  return loginUrl.replace(/\/login\/?$/i, `/${suffix}`);
}

export interface CloudDesktopAuthClient {
  login(input: CloudLoginInput): Promise<CloudLoginResult>;
  sendOtp(phone: string): Promise<OtpSendResult>;
  verifyOtp(phone: string, code: string): Promise<CloudLoginResult>;
  startWechat(): Promise<WechatStartResult>;
  pollWechat(state: string): Promise<WechatPollResult>;
  bindPhoneSend(credential: string, phone: string): Promise<OtpSendResult>;
  bindPhoneVerify(
    credential: string,
    phone: string,
    code: string,
  ): Promise<{ ok: boolean; reason?: CloudLoginFailure }>;
}

export function createCloudDesktopAuthClient(
  opts: CloudDesktopAuthClientOptions,
): CloudDesktopAuthClient {
  const timeoutMs = opts.timeoutMs ?? CLOUD_LOGIN_REQUEST_TIMEOUT_MS;
  const fetchImpl: CloudLoginFetch | undefined =
    opts.fetchImpl ??
    ((globalThis as { fetch?: CloudLoginFetch }).fetch as CloudLoginFetch | undefined);
  const loginUrl = opts.loginUrl.trim();

  async function request(
    url: string,
    init: {
      method: string;
      body?: string;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; text: string } | undefined> {
    if (!url || fetchImpl === undefined) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
        ...init.headers,
      };
      if (init.body !== undefined) headers["content-type"] = "application/json";
      const res = await fetchImpl(url, {
        method: init.method,
        headers,
        body: init.body ?? "",
        signal: controller.signal,
      });
      return { status: res.status, text: await res.text() };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  function parseToken(status: number, text: string): CloudLoginResult {
    if (status === 401) return { ok: false, reason: "invalid-credentials" };
    if (status === 403) return { ok: false, reason: "no-membership" };
    if (status === 400 || status === 422) return { ok: false, reason: "invalid-request" };
    if (status < 200 || status >= 300) return { ok: false, reason: "cloud-unreachable" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "cloud-unreachable" };
    }
    const obj =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { token?: unknown; credential?: unknown })
        : {};
    const credential = typeof obj.token === "string" ? obj.token : obj.credential;
    if (typeof credential !== "string" || credential.trim().length === 0) {
      return { ok: false, reason: "cloud-unreachable" };
    }
    return { ok: true, credential: credential.trim() };
  }

  return {
    async login(input) {
      const email = input.email?.trim();
      const phone = input.phone?.trim();
      const password = input.password;
      if ((!email && !phone) || (email && phone) || !password) {
        return { ok: false, reason: "invalid-request" };
      }
      const res = await request(loginUrl, {
        method: "POST",
        body: JSON.stringify(email ? { email, password } : { phone, password }),
      });
      if (!res) {
        logger.warn("cloud login request failed");
        return { ok: false, reason: "cloud-unreachable" };
      }
      const result = parseToken(res.status, res.text);
      if (result.ok) logger.info("cloud login succeeded");
      else logger.warn("cloud login failed", { reason: result.reason });
      return result;
    },

    async sendOtp(phone) {
      const p = phone.trim();
      if (!p) return { ok: false, reason: "invalid-request" };
      const res = await request(siblingUrl(loginUrl, "otp/send"), {
        method: "POST",
        body: JSON.stringify({ phone: p }),
      });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      if (res.status === 429) return { ok: false, reason: "rate-limited" };
      if (res.status === 400) return { ok: false, reason: "invalid-request" };
      // 503 sms-not-configured / 5xx → 可重试的云端侧问题
      if (res.status === 503 || res.status >= 500) {
        return { ok: false, reason: "cloud-unreachable" };
      }
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, reason: "cloud-unreachable" };
      }
      return { ok: true };
    },

    async verifyOtp(phone, code) {
      const p = phone.trim();
      const c = code.trim();
      if (!p || !c) return { ok: false, reason: "invalid-request" };
      const res = await request(siblingUrl(loginUrl, "otp/verify"), {
        method: "POST",
        body: JSON.stringify({ phone: p, code: c }),
      });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      return parseToken(res.status, res.text);
    },

    async startWechat() {
      const res = await request(siblingUrl(loginUrl, "wechat/start"), {
        method: "POST",
        body: "{}",
      });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, reason: "cloud-unreachable" };
      }
      try {
        const o = JSON.parse(res.text) as {
          state?: string;
          appid?: string;
          redirectUri?: string;
          qrConnectUrl?: string;
          expiresAt?: number;
        };
        if (
          typeof o.state === "string" &&
          typeof o.appid === "string" &&
          typeof o.redirectUri === "string" &&
          typeof o.qrConnectUrl === "string"
        ) {
          return {
            ok: true,
            state: o.state,
            appid: o.appid,
            redirectUri: o.redirectUri,
            qrConnectUrl: o.qrConnectUrl,
            expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : Date.now() + 600_000,
          };
        }
      } catch {
        // fallthrough
      }
      return { ok: false, reason: "cloud-unreachable" };
    },

    async pollWechat(state) {
      const s = state.trim();
      if (!s) return { ok: false, reason: "invalid-request" };
      const url = `${siblingUrl(loginUrl, "wechat/poll")}?state=${encodeURIComponent(s)}`;
      const res = await request(url, { method: "GET" });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      if (res.status === 404) return { ok: true, status: "unknown" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        return { ok: false, reason: "cloud-unreachable" };
      }
      const o = parsed as { status?: string; token?: string; error?: string };
      if (o.status === "pending") return { ok: true, status: "pending" };
      if (o.status === "claimed") return { ok: true, status: "claimed" };
      if (o.status === "error") {
        return { ok: true, status: "error", error: o.error ?? "error" };
      }
      if (o.status === "ready" && typeof o.token === "string" && o.token.trim()) {
        return { ok: true, status: "ready", credential: o.token.trim() };
      }
      return { ok: false, reason: "cloud-unreachable" };
    },

    async bindPhoneSend(credential, phone) {
      const p = phone.trim();
      if (!p || !credential.trim()) return { ok: false, reason: "invalid-request" };
      const res = await request(siblingUrl(loginUrl, "otp/bind/send"), {
        method: "POST",
        body: JSON.stringify({ phone: p }),
        headers: { authorization: `Bearer ${credential.trim()}` },
      });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      if (res.status === 401) return { ok: false, reason: "invalid-credentials" };
      if (res.status === 400) return { ok: false, reason: "invalid-request" };
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, reason: "cloud-unreachable" };
      }
      return { ok: true };
    },

    async bindPhoneVerify(credential, phone, code) {
      const p = phone.trim();
      const c = code.trim();
      if (!p || !c || !credential.trim()) return { ok: false, reason: "invalid-request" };
      const res = await request(siblingUrl(loginUrl, "otp/bind/verify"), {
        method: "POST",
        body: JSON.stringify({ phone: p, code: c }),
        headers: { authorization: `Bearer ${credential.trim()}` },
      });
      if (!res) return { ok: false, reason: "cloud-unreachable" };
      if (res.status === 401) return { ok: false, reason: "invalid-credentials" };
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, reason: "cloud-unreachable" };
      }
      return { ok: true };
    },
  };
}
