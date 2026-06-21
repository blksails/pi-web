/**
 * http-api — 触发符补全端点(completion-provider-framework)。
 *
 *   GET /sessions/:id/completion/triggers        → { triggers }
 *   GET /sessions/:id/completion?trigger=&q=      → { items, groups }
 *
 * 与类型无关:按归一化 trigger 经注册表分发到 provider。会话经 requireSession 解析
 * (不存在/越权→404,镜像 query-routes);CompletionCtx 由会话 cwd + 鉴权 userId 组装。
 */
import type { CompletionResponse } from "@pi-web/protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import type { CompletionRegistry, CompletionCtx } from "../../completion/index.js";
import { jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

function completionCtx(
  session: PiSession,
  ctx: RequestContext,
): CompletionCtx {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    userId: ctx.auth.userId ?? "",
  };
}

/** GET /sessions/:id/completion/triggers → 活跃触发符并集 + 提取规则。 */
export function makeCompletionTriggersHandler(
  store: SessionStore,
  registry: CompletionRegistry,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      requireSession(store, ctx); // 鉴权 + 存在性
      return jsonResponse(200, { triggers: registry.triggers() });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/completion?trigger=&q= → 候选 + 分组。 */
export function makeCompletionHandler(
  store: SessionStore,
  registry: CompletionRegistry,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const trigger = ctx.url.searchParams.get("trigger") ?? "";
      const query = ctx.url.searchParams.get("q") ?? "";
      if (trigger === "") {
        const empty: CompletionResponse = { items: [], groups: [] };
        return jsonResponse(200, empty);
      }
      const res = await registry.query(
        trigger,
        query,
        completionCtx(session, ctx),
      );
      return jsonResponse(200, res);
    } catch (err) {
      return mapEngineError(err);
    }
  };
}
