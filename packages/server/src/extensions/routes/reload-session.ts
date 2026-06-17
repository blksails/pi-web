/**
 * extension-management — POST /sessions/:id/reload(会话扩展重载,Req 4.x/7.1/7.2/6.x）。
 *
 * 经 http-api Router,`:id` 会话不存在时 Router 已返回 404(Req 4.2);本处理器额外:
 *   - adminPolicy 管理员门控(非管理员 401/403,Req 7.1/7.2)。
 *   - 防御性二次检索(不存在 → 404)。
 *   - 状态判定:已停止 → 409(不尝试重载,Req 4.3)。
 *   - 经 `trust-landing` 计算该会话来源的信任片段,委托注入的 `SessionReloader` 以重启
 *     子进程 / `new_session` 重建运行时(重启编排归 session-engine,本层仅消费,Req 4.1)。
 *   - 重载完成 → ack;不静默丢弃请求(以 ack 或错误明确收束,Req 4.4/4.5)。
 */
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RequestContext, RouteHandler } from "../../http/index.js";
import type { SessionStore } from "../../session/index.js";
import type {
  AdminPolicy,
  SessionReloader,
  TrustDecision,
} from "../ext.types.js";
import { landTrust } from "../install/trust-landing.js";

/** 默认重载接缝未配置:显式 501,而非静默丢弃(Req 4.5)。 */
export class ReloadNotConfiguredError extends Error {
  readonly code = "RELOAD_NOT_CONFIGURED" as const;
  constructor() {
    super(
      "Session reload is not configured; host must inject a SessionReloader (restart/new_session orchestration belongs to session-engine).",
    );
    this.name = "ReloadNotConfiguredError";
  }
}

/** 默认重载接缝:未配置即显式失败(不静默)。 */
export const defaultSessionReloader: SessionReloader = (): Promise<void> => {
  return Promise.reject(new ReloadNotConfiguredError());
};

export interface ReloadSessionDeps {
  readonly store: SessionStore;
  readonly adminPolicy: AdminPolicy;
  readonly reloadSession: SessionReloader;
  readonly trustPolicy: (source: string) => TrustDecision;
}

export function makeReloadSessionHandler(
  deps: ReloadSessionDeps,
): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    // 管理员门控。
    if (!deps.adminPolicy(ctx.auth)) {
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Admin authentication required.")
        : errorResponse(403, "FORBIDDEN", "Admin authorization denied.");
    }

    const sessionId = ctx.sessionId ?? "";
    const session = deps.store.get(sessionId);
    if (session === undefined) {
      return errorResponse(
        404,
        "SESSION_NOT_FOUND",
        `Session "${sessionId}" not found.`,
      );
    }

    // 已停止 → 409,不尝试重载。
    if (session.status !== "active") {
      return errorResponse(
        409,
        "SESSION_STOPPED",
        `Session "${sessionId}" is not active; cannot reload.`,
      );
    }

    // 信任落地:按会话来源 + 模式计算信任片段(消费 trustPolicy/applyTrust)。
    const fragment = landTrust(sessionId, session.mode, deps.trustPolicy);

    try {
      await deps.reloadSession(session, fragment);
    } catch (err) {
      if (err instanceof ReloadNotConfiguredError) {
        return errorResponse(501, err.code, err.message);
      }
      const summary = err instanceof Error ? err.message : "reload failed";
      return errorResponse(500, "RELOAD_FAILED", summary);
    }

    return jsonResponse(200, { ok: true, reloaded: sessionId });
  };
}
