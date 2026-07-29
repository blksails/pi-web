/**
 * http-api — bang shell 命令执行端点(spec bang-shell-command)。
 *
 * `POST /sessions/:id/bash`:把命令转发到会话 agent 既有 bash 能力,以同步响应体返回
 * 结构化 `BashResult`(输出/退出码/取消/截断/完整输出路径)。
 *
 * 安全门控(后端权威,requirements 5.1/5.2/5.4):禁用时在**读取/解析请求体之前**返回
 * 404(不泄露端点存在性)。启用由部署级 `PI_WEB_BASH_ENABLED` 决定(经装配层传入
 * `enabled`),与前端体验开关故意分离——前端被改/绕过仍被此处拒。
 *
 * 任意 shell 执行属高危能力,故默认关闭由 `resolveBashEnabled` 推导。
 */
import { z } from "zod";
import type { BashResult, RpcResponse } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type {
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "../handler.types.js";
import { validateBody } from "../validate.js";

/** HTTP 请求体形状:命令 + 是否排除上下文(`!!`)。 */
const BashHttpRequestSchema = z.object({
  command: z.string(),
  excludeFromContext: z.boolean().optional(),
});

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/** 提取成功响应的 data;失败→统一 502 上游错误(镜像 query-routes/command-routes)。 */
function dataOrError<T>(
  res: RpcResponse,
): { ok: true; data: T } | { ok: false; response: Response } {
  if (res.success && "data" in res) {
    return { ok: true, data: (res as { data: T }).data };
  }
  const message =
    !res.success && "error" in res ? res.error : "Upstream command failed.";
  return {
    ok: false,
    response: errorResponse(502, "UPSTREAM_ERROR", message),
  };
}

/**
 * POST /sessions/:id/bash → PiSession.bash。
 * @param opts.enabled 服务端权威启用门控;false 时一律 404(在解析 body 前)。
 */
export function makeBashHandler(
  store: SessionStore,
  opts: { enabled: boolean },
): RouteHandler {
  return async (ctx): Promise<Response> => {
    // 权威门控:禁用时直接 404(不泄露存在性),且在读取/解析 body 之前(无副作用)。
    if (!opts.enabled) {
      return errorResponse(404, "NOT_FOUND", "Not found.");
    }
    const parsed = await validateBody(ctx.req, BashHttpRequestSchema);
    if (!parsed.ok) return parsed.response;
    const { command, excludeFromContext } = parsed.value;
    if (command.trim() === "") {
      return errorResponse(
        400,
        "INVALID_COMMAND",
        "command must be a non-empty string.",
      );
    }
    try {
      const session = requireSession(store, ctx);
      const res = await session.bash(
        command,
        excludeFromContext !== undefined ? { excludeFromContext } : {},
      );
      const extracted = dataOrError<BashResult>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { result: extracted.data });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * 注入式 bash 路由(经 `createPiWebHandler` 的 `routes:` 接缝注入)。
 * 由装配层传入权威 `enabled`(`resolveBashEnabled()` 结果)。
 */
export function createBashRoutes(
  store: SessionStore,
  opts: { enabled: boolean },
): InjectedRoute[] {
  return [
    {
      method: "POST",
      path: "/sessions/:id/bash",
      handler: makeBashHandler(store, opts),
    },
  ];
}
