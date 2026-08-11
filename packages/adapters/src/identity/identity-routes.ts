/**
 * 身份 HTTP 面：password / SMS / WeChat + OTP send + WeChat start/poll + bind phone。
 */
import { errorResponse, jsonResponse } from "@blksails/pi-web-core/http/index.js";
import type { InjectedRoute } from "@blksails/pi-web-core/http/index.js";
import type { CapabilityTenant } from "@blksails/pi-web-core/capability/types.js";
import type { CloudDesktopAuthClient } from "../auth/cloud-desktop-auth-client.js";
import type { AuthSessionState } from "../auth/auth-session-state.js";
import type {
  IdentityCredentials,
  IdentityExchangeFailure,
  IdentityProvider,
  IdentityState,
} from "./types.js";

export type IdentityView =
  | {
      readonly state: "authenticated";
      readonly tenant: CapabilityTenant;
      readonly canExchange: boolean;
      readonly methods?: ReadonlyArray<"password" | "sms" | "wechat">;
    }
  | {
      readonly state: "anonymous";
      readonly canExchange: boolean;
      readonly methods?: ReadonlyArray<"password" | "sms" | "wechat">;
    };

export interface IdentityRoutesOptions {
  readonly provider: IdentityProvider;
  /** 多方法云端客户端；提供则挂 OTP / WeChat 路由。 */
  readonly desktopAuth?: CloudDesktopAuthClient;
  /** 绑手机需要当前凭据。 */
  readonly authState?: AuthSessionState;
}

function toView(
  state: IdentityState,
  canExchange: boolean,
  methods: ReadonlyArray<"password" | "sms" | "wechat">,
): IdentityView {
  return state.kind === "authenticated"
    ? { state: "authenticated", tenant: state.tenant, canExchange, methods }
    : { state: "anonymous", canExchange, methods };
}

function statusOf(reason: IdentityExchangeFailure): number {
  switch (reason) {
    case "invalid-request":
      return 400;
    case "invalid-credentials":
    case "no-membership":
      return 401;
    case "cloud-unreachable":
    case "capabilities-failed":
      return 502;
  }
}

const MESSAGE: Readonly<Record<IdentityExchangeFailure, string>> = {
  "invalid-request": "Invalid login request.",
  "invalid-credentials": "Invalid credentials.",
  "no-membership": "This account has no tenant membership.",
  "cloud-unreachable": "Cannot reach the cloud service.",
  "capabilities-failed": "Signed in, but capability grants could not be loaded.",
};

function parseExchangeBody(raw: unknown): IdentityCredentials | { error: "invalid" } {
  if (typeof raw !== "object" || raw === null) return { error: "invalid" };
  const body = raw as Record<string, unknown>;
  const method = typeof body.method === "string" ? body.method : "password";

  if (method === "password" || method === undefined) {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if ((!email && !phone) || (email && phone) || !password) return { error: "invalid" };
    return email
      ? { method: "password", email, password }
      : { method: "password", phone, password };
  }
  if (method === "sms") {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!phone || !code) return { error: "invalid" };
    return { method: "sms", phone, code };
  }
  if (method === "wechat") {
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const credential =
      typeof body.credential === "string" ? body.credential.trim() : undefined;
    if (!state && !credential) return { error: "invalid" };
    return { method: "wechat", state: state || "from-credential", credential };
  }
  return { error: "invalid" };
}

export function createIdentityRoutes(
  opts: IdentityRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const { provider, desktopAuth, authState } = opts;
  const canExchange = typeof provider.exchange === "function";
  const methods: Array<"password" | "sms" | "wechat"> = ["password"];
  if (desktopAuth !== undefined) {
    methods.push("sms", "wechat");
  }

  const get: InjectedRoute = {
    method: "GET",
    path: "/identity",
    handler: async () => {
      let state: IdentityState;
      try {
        state = await provider.current();
      } catch {
        state = { kind: "anonymous" };
      }
      return jsonResponse(200, { ...toView(state, canExchange, methods) });
    },
  };

  const exchange: InjectedRoute = {
    method: "POST",
    path: "/identity/exchange",
    handler: async (ctx) => {
      if (provider.exchange === undefined) {
        return errorResponse(
          405,
          "EXCHANGE_UNSUPPORTED",
          "This host does not support credential exchange.",
        );
      }

      let raw: unknown;
      try {
        raw = await ctx.req.json();
      } catch {
        return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
      }
      const parsed = parseExchangeBody(raw);
      if ("error" in parsed) {
        return errorResponse(400, "INVALID_REQUEST", MESSAGE["invalid-request"]);
      }

      const result = await provider.exchange(parsed);
      if (!result.ok) {
        return errorResponse(statusOf(result.reason), "EXCHANGE_FAILED", MESSAGE[result.reason], [
          result.reason,
        ]);
      }
      return jsonResponse(200, { ...toView(result.state, canExchange, methods) });
    },
  };

  const revoke: InjectedRoute = {
    method: "DELETE",
    path: "/identity",
    handler: async () => {
      if (provider.revoke === undefined) {
        return errorResponse(
          405,
          "REVOKE_UNSUPPORTED",
          "This host does not support revoking identity.",
        );
      }
      await provider.revoke();
      return jsonResponse(200, { ...toView({ kind: "anonymous" }, canExchange, methods) });
    },
  };

  const routes: InjectedRoute[] = [get, exchange, revoke];

  if (desktopAuth !== undefined) {
    routes.push({
      method: "POST",
      path: "/identity/otp/send",
      handler: async (ctx) => {
        let raw: unknown;
        try {
          raw = await ctx.req.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
        }
        const phone =
          typeof raw === "object" &&
          raw !== null &&
          typeof (raw as { phone?: unknown }).phone === "string"
            ? (raw as { phone: string }).phone
            : "";
        const result = await desktopAuth.sendOtp(phone);
        if (!result.ok) {
          const status =
            result.reason === "rate-limited"
              ? 429
              : result.reason === "invalid-request"
                ? 400
                : 502;
          return errorResponse(status, "OTP_SEND_FAILED", result.reason ?? "failed");
        }
        return jsonResponse(200, { ok: true });
      },
    });

    routes.push({
      method: "POST",
      path: "/identity/wechat/start",
      handler: async () => {
        const started = await desktopAuth.startWechat();
        if (!started.ok) {
          return errorResponse(502, "WECHAT_START_FAILED", started.reason);
        }
        return jsonResponse(200, {
          state: started.state,
          appid: started.appid,
          redirectUri: started.redirectUri,
          qrConnectUrl: started.qrConnectUrl,
          expiresAt: started.expiresAt,
        });
      },
    });

    routes.push({
      method: "GET",
      path: "/identity/wechat/poll",
      handler: async (ctx) => {
        const url = new URL(ctx.req.url);
        const state = url.searchParams.get("state")?.trim() ?? "";
        if (!state) {
          return errorResponse(400, "INVALID_REQUEST", "state required");
        }
        const polled = await desktopAuth.pollWechat(state);
        if (!polled.ok) {
          return errorResponse(502, "WECHAT_POLL_FAILED", polled.reason);
        }
        if (polled.status === "ready") {
          // 不把 token 回给渲染层之外的调用方以外——exchange 会用 state 再取。
          // 这里直接返回 status ready，由客户端用 exchange({method:wechat,state}) 落态。
          // 但 poll 会消耗 token，所以这里需要把 credential 交给 exchange。
          // 为避免双次 poll 丢 token：ready 时把 credential 一并返回给同源 server 代理的 UI，
          // 随后 exchange 用 credential 字段。UI 不持久化。
          return jsonResponse(200, {
            status: "ready",
            credential: polled.credential,
          });
        }
        if (polled.status === "error") {
          return jsonResponse(200, { status: "error", error: polled.error });
        }
        return jsonResponse(200, { status: polled.status });
      },
    });
  }

  if (desktopAuth !== undefined && authState !== undefined) {
    routes.push({
      method: "POST",
      path: "/identity/phone/bind/send",
      handler: async (ctx) => {
        const cred = authState.currentCredential();
        if (!cred) return errorResponse(401, "UNAUTHORIZED", "Not logged in.");
        let raw: unknown;
        try {
          raw = await ctx.req.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
        }
        const phone =
          typeof raw === "object" &&
          raw !== null &&
          typeof (raw as { phone?: unknown }).phone === "string"
            ? (raw as { phone: string }).phone
            : "";
        const result = await desktopAuth.bindPhoneSend(cred, phone);
        if (!result.ok) {
          return errorResponse(400, "BIND_SEND_FAILED", result.reason ?? "failed");
        }
        return jsonResponse(200, { ok: true });
      },
    });
    routes.push({
      method: "POST",
      path: "/identity/phone/bind/verify",
      handler: async (ctx) => {
        const cred = authState.currentCredential();
        if (!cred) return errorResponse(401, "UNAUTHORIZED", "Not logged in.");
        let raw: unknown;
        try {
          raw = await ctx.req.json();
        } catch {
          return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
        }
        const o = raw as { phone?: unknown; code?: unknown };
        const phone = typeof o.phone === "string" ? o.phone : "";
        const code = typeof o.code === "string" ? o.code : "";
        const result = await desktopAuth.bindPhoneVerify(cred, phone, code);
        if (!result.ok) {
          return errorResponse(400, "BIND_VERIFY_FAILED", result.reason ?? "failed");
        }
        return jsonResponse(200, { ok: true });
      },
    });
  }

  return routes;
}
