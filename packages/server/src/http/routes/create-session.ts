/**
 * http-api — POST /sessions(Req 2.1/2.2/2.5)。
 *
 * 校验建会话 DTO → 经注入 resolver 解析 source → 经注入 createChannel 构造通道 →
 * `SessionManager.createSession` → `{ sessionId }`。停机(manager 不再接受新会话)→ 503;
 * 缺 `source`/类型错 → 400(含字段路径)。http-api 不 spawn、不解析、不持有会话状态。
 */
import { randomUUID } from "node:crypto";
import { CreateSessionRequestSchema } from "@blksails/pi-web-protocol";
import type { ResolvedSource } from "../../agent-source/index.js";
import { AgentSourceResolver } from "../../agent-source/index.js";
import type { SessionChannel, SessionManager } from "../../session/index.js";
import { jsonResponse, mapEngineError, errorResponse } from "../error-map.js";
import type {
  CreateChannelOpts,
  RequestContext,
  ResumeMeta,
  RouteHandler,
} from "../handler.types.js";
import { validateBody } from "../validate.js";

export interface CreateSessionDeps {
  readonly manager: SessionManager;
  readonly resolver?: {
    resolve: (
      source: string | undefined,
      opts?: { cwd?: string; trust?: boolean },
    ) => Promise<ResolvedSource>;
  };
  readonly createChannel?: (
    resolved: ResolvedSource,
    opts: CreateChannelOpts,
  ) => SessionChannel;
  /** 冷会话恢复读取器;未注入时恢复请求一律视为"会话不存在"。 */
  readonly loadResumeMeta?: (id: string) => Promise<ResumeMeta | undefined>;
}

export function makeCreateSessionHandler(deps: CreateSessionDeps): RouteHandler {
  const resolver = deps.resolver ?? AgentSourceResolver;
  return async (ctx: RequestContext): Promise<Response> => {
    if (!deps.manager.isAccepting()) {
      return errorResponse(
        503,
        "SHUTTING_DOWN",
        "Server is shutting down; not accepting new sessions.",
      );
    }

    const parsed = await validateBody(ctx.req, CreateSessionRequestSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;

    const createChannel = deps.createChannel;
    if (createChannel === undefined) {
      return errorResponse(
        500,
        "NO_CHANNEL_FACTORY",
        "Server is not configured to create session channels.",
      );
    }

    // ── 恢复分支:POST /sessions { resumeId } ─────────────────────────────
    // 复用本端点(不新增 /sessions/:id/resume,以绕过 router 的 :id 存在性 404)。
    if (body.resumeId !== undefined) {
      const id = body.resumeId;
      // 幂等:同会话已在内存活跃则直接复用,不重建(Req 3.4)。
      if (deps.manager.getStore().get(id) !== undefined) {
        return jsonResponse(201, { sessionId: id });
      }
      if (deps.loadResumeMeta === undefined) {
        return errorResponse(404, "SESSION_NOT_FOUND", `Session "${id}" not found.`);
      }
      const meta = await deps.loadResumeMeta(id);
      if (meta === undefined) {
        return errorResponse(404, "SESSION_NOT_FOUND", `Session "${id}" not found.`);
      }
      try {
        // 权威 cwd 取自持久化 header;source/model 取自创建元数据(cli 模式 source 为
        // undefined,由 resolver 据 cwd 判定 cli)。agent 端据 --session-id 加载历史(Req 3.1/3.3)。
        const resolved = await resolver.resolve(meta.source, { cwd: meta.cwd });
        const channel = createChannel(resolved, {
          sessionId: id,
          source: meta.source,
          ...(meta.model !== undefined ? { model: meta.model } : {}),
        });
        deps.manager.createSession({ resolved, channel, id });
        return jsonResponse(201, { sessionId: id });
      } catch (err) {
        return mapEngineError(err);
      }
    }

    // ── 新建分支 ──────────────────────────────────────────────────────────
    try {
      // 主进程主导 sessionId,下传给 agent(--session-id)以对齐持久化文件 id(Req 2.2)。
      const sessionId = randomUUID();
      const resolveOpts: { cwd?: string; trust?: boolean } = {};
      if (body.cwd !== undefined) resolveOpts.cwd = body.cwd;
      if (body.trust !== undefined) resolveOpts.trust = body.trust;
      const resolved = await resolver.resolve(body.source, resolveOpts);
      const channel = createChannel(resolved, {
        sessionId,
        source: body.source,
        ...(body.model !== undefined ? { model: body.model } : {}),
      });
      deps.manager.createSession({ resolved, channel, id: sessionId });
      return jsonResponse(201, { sessionId });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}
