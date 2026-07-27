/**
 * 身份 HTTP 面(spec: desktop-account-login,任务 5.1;Req 1.3/1.4/2.2-2.5/5.1-5.3/7.1/8.2)。
 *
 *   GET    /identity           → 当前身份投影 IdentityView
 *   POST   /identity/exchange  → 账号密码换身份。400/401/502
 *   DELETE /identity           → 放弃身份(登出)。实现不支持时 405
 *
 * 经 `createPiWebHandler` 的 routes 注入 seam 挂载(与 createAuthRoutes 并列),`/api` 下可达。
 *
 * ## ★ canExchange 是**派生**的,不是实现声明的(design.md D2)
 *
 * 端口用「`exchange` 方法是否存在」表达是否支持交换。UI 隔着 HTTP 看不到方法,故需要一个
 * 布尔投影 —— 但这个布尔**必须由本层从方法存在性算出**,不能让实现在返回值里另行声明。
 * 两个事实源必然会漂移:实现声明 `true` 却没实现方法,类型挡不住,只在用户点「登录」
 * 那一刻炸。派生则永远一致。
 *
 * ## 脱敏纪律(Req 8.2)
 *
 * 响应体只回 {@link IdentityView} —— 没有 credential、没有 password、没有任何授予 token。
 * 密码只出现在请求体的解析过程中,不回显、不入日志。
 */
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import type { CapabilityTenant } from "../capability/types.js";
import type { IdentityExchangeFailure, IdentityProvider, IdentityState } from "./types.js";

/**
 * 身份的 HTTP 投影。
 *
 * `canExchange` 告诉 UI「这里是否该渲染登录表单」—— 它替代了「我是不是桌面」这个问题,
 * 这正是 Req 1.5 要消灭的判断。
 */
export type IdentityView =
  | {
      readonly state: "authenticated";
      readonly tenant: CapabilityTenant;
      readonly canExchange: boolean;
    }
  | { readonly state: "anonymous"; readonly canExchange: boolean };

export interface IdentityRoutesOptions {
  readonly provider: IdentityProvider;
}

function toView(state: IdentityState, canExchange: boolean): IdentityView {
  return state.kind === "authenticated"
    ? { state: "authenticated", tenant: state.tenant, canExchange }
    : { state: "anonymous", canExchange };
}

/**
 * 失败类别 → HTTP 状态。
 *
 * `capabilities-failed` 用 **502** 而非 500:失败源在上游云端而非本地缺陷,且用户
 * 原样重试有可能成功。用 500 会让运维把它当成 pi-web 的 bug 去查。
 */
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
  "invalid-request": "Email and password are required.",
  "invalid-credentials": "Invalid email or password.",
  "no-membership": "This account has no tenant membership.",
  "cloud-unreachable": "Cannot reach the cloud service.",
  "capabilities-failed": "Signed in, but capability grants could not be loaded.",
};

export function createIdentityRoutes(
  opts: IdentityRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const { provider } = opts;
  // 派生一次即固定:端口对象在装配后不会长出新方法。
  const canExchange = typeof provider.exchange === "function";

  const get: InjectedRoute = {
    method: "GET",
    path: "/identity",
    handler: async () => {
      // current() 契约上不抛;此处仍兜一层,避免第三方实现违约时整个端点 500 ——
      // 「身份探测失败」对用户的处置与「未登录」相同(Req 1.6)。
      let state: IdentityState;
      try {
        state = await provider.current();
      } catch {
        state = { kind: "anonymous" };
      }
      return jsonResponse(200, { ...toView(state, canExchange) });
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
      if (typeof raw !== "object" || raw === null) {
        return errorResponse(400, "INVALID_REQUEST", MESSAGE["invalid-request"], [
          "email",
          "password",
        ]);
      }
      const body = raw as { email?: unknown; password?: unknown; method?: unknown };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      // 密码不 trim:前后空格可能是密码本身的一部分。
      const password = typeof body.password === "string" ? body.password : "";
      const missing: string[] = [];
      if (email.length === 0) missing.push("email");
      if (password.length === 0) missing.push("password");
      if (missing.length > 0) {
        return errorResponse(400, "INVALID_REQUEST", MESSAGE["invalid-request"], missing);
      }

      const result = await provider.exchange({ method: "password", email, password });
      if (!result.ok) {
        return errorResponse(statusOf(result.reason), "EXCHANGE_FAILED", MESSAGE[result.reason], [
          result.reason,
        ]);
      }
      return jsonResponse(200, { ...toView(result.state, canExchange) });
    },
  };

  const revoke: InjectedRoute = {
    method: "DELETE",
    path: "/identity",
    handler: async () => {
      if (provider.revoke === undefined) {
        // 身份来自外部会话的宿主无从「放弃」它 —— 这是正常的,不是缺陷(Req 1.4/6.3)。
        return errorResponse(
          405,
          "REVOKE_UNSUPPORTED",
          "This host does not support revoking identity.",
        );
      }
      await provider.revoke();
      return jsonResponse(200, { ...toView({ kind: "anonymous" }, canExchange) });
    },
  };

  return [get, exchange, revoke];
}
