/**
 * desktop-cloud-login · 鉴权 HTTP 端点(design.md §Components/auth-routes,Req 1.3/2.5/6.2/6.3)。
 *
 *   POST   /auth/session { credential }  → 设置(或切号替换)登录态。非法 400 / 过期 401。
 *   DELETE /auth/session                 → 清除登录态(登出)。
 *   GET    /auth/me                      → 当前登录态投影(不含凭据明文)。
 *
 * 经 `createPiWebHandler` 的 routes 注入 seam 挂载(与 createConfigRoutes 并列),`/api` 下可达。
 * 凭据明文绝不回显、绝不入日志(Req 5.2)。
 */
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import type { AuthSessionState, AuthSnapshot } from "./auth-session-state.js";

export interface AuthRoutesOptions {
  /** 进程内登录态(装配处单实例;与会话 spawn 读同一实例)。 */
  readonly state: AuthSessionState;
}

export function createAuthRoutes(
  opts: AuthRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const { state } = opts;

  const setSession: InjectedRoute = {
    method: "POST",
    path: "/auth/session",
    handler: async (ctx) => {
      let raw: unknown;
      try {
        raw = await ctx.req.json();
      } catch {
        return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
      }
      if (typeof raw !== "object" || raw === null) {
        return errorResponse(400, "INVALID_REQUEST", "Missing credential.", ["credential"]);
      }
      const credential = (raw as Record<string, unknown>).credential;
      if (typeof credential !== "string" || credential.trim().length === 0) {
        return errorResponse(400, "INVALID_REQUEST", "Missing credential.", ["credential"]);
      }
      const result = state.set(credential);
      if (!result.ok) {
        return result.reason === "expired"
          ? errorResponse(401, "CREDENTIAL_EXPIRED", "Credential is expired.")
          : errorResponse(400, "INVALID_CREDENTIAL", "Credential is not valid.", ["credential"]);
      }
      // 回体为登录态投影(不含凭据明文)。
      const body = state.snapshot();
      return jsonResponse(200, { ...body });
    },
  };

  const clearSession: InjectedRoute = {
    method: "DELETE",
    path: "/auth/session",
    handler: async () => {
      state.clear();
      return jsonResponse(200, { ok: true });
    },
  };

  const me: InjectedRoute = {
    method: "GET",
    path: "/auth/me",
    handler: async () => {
      const body: AuthSnapshot = state.snapshot();
      return jsonResponse(200, { ...body });
    },
  };

  return [setSession, clearSession, me];
}
