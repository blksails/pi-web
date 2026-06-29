/**
 * http-api — 查询端点(Req 4.x)。
 *
 * `GET /sessions/:id/{state,stats,messages,commands}`:转发 `PiSession` 查询方法,
 * 把成功 `RpcResponse.data` 投影为 `@blksails/pi-web-protocol` 的对应响应 DTO 形状返回。
 * 不重定义响应形状(Req 4.5)。会话不存在→404(router 已校验,此处兜底)。
 */
import type { LogLevel, RpcResponse } from "@blksails/pi-web-protocol";
import { LogLevelSchema } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import {
  parseHiddenProviders,
  excludeProviderModels,
} from "../../config/model-options-filter.js";
import { enrichWebVisibleCommands } from "../../plugin/enrich-web-visible.js";

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/** 提取成功响应的 data;失败→统一 502 上游错误。 */
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

/** GET /sessions/:id/state */
export function makeStateHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getState();
      const extracted = dataOrError<unknown>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { state: extracted.data });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/stats */
export function makeStatsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getSessionStats();
      const extracted = dataOrError<unknown>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { stats: extracted.data });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** 命令标记读取器:按会话标识返回 `piweb.command` 标记(epoch ms `ts` + 原始命令 `text`)。 */
export type CommandMarkerLoader = (
  id: string,
) => Promise<ReadonlyArray<{ readonly text: string; readonly ts: number }>>;

/** 把命令标记 `text` 包装为一条 user AgentMessage(与历史 user 消息同形,前端渲染为普通气泡)。 */
function markerToMessage(text: string, ts: number): Record<string, unknown> {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  };
}

/** 取消息的数值 timestamp(epoch ms);缺失/非数值→undefined(交由调用方退化处理)。 */
function messageTimestamp(msg: unknown): number | undefined {
  const t = (msg as { timestamp?: unknown } | null)?.timestamp;
  return typeof t === "number" && Number.isFinite(t) ? t : undefined;
}

/**
 * 把命令标记按 timestamp **稳定合并**进消息序列(R13.3):
 *  - 全部消息均带数值 ts → 升序稳定合并;同 ts 时消息在前、标记在后(命令在该消息之后执行)。
 *  - 任一消息缺数值 ts(无法可靠定位)→ 退化为把全部标记追加到末尾(绝不丢失标记,顺序退化但安全)。
 * 仅影响返回序列,不改写底层 message log。
 */
export function mergeCommandMarkers(
  messages: readonly unknown[],
  markers: ReadonlyArray<{ readonly text: string; readonly ts: number }>,
): unknown[] {
  if (markers.length === 0) return [...messages];

  const allHaveTs = messages.every((m) => messageTimestamp(m) !== undefined);
  if (!allHaveTs) {
    // 退化:无法可靠按 ts 定位 → 标记追加末尾(按 ts 升序保持彼此相对序)。
    const tail = [...markers]
      .sort((a, b) => a.ts - b.ts)
      .map((mk) => markerToMessage(mk.text, mk.ts));
    return [...messages, ...tail];
  }

  // kind:0=消息(同 ts 在前),kind:1=标记(同 ts 在后);seq 保持各自相对稳定序。
  type Row = { t: number; kind: 0 | 1; seq: number; item: unknown };
  const rows: Row[] = [];
  messages.forEach((m, i) =>
    rows.push({ t: messageTimestamp(m)!, kind: 0, seq: i, item: m }),
  );
  markers.forEach((mk, j) =>
    rows.push({
      t: mk.ts,
      kind: 1,
      seq: j,
      item: markerToMessage(mk.text, mk.ts),
    }),
  );
  rows.sort((a, b) => a.t - b.t || a.kind - b.kind || a.seq - b.seq);
  return rows.map((r) => r.item);
}

/**
 * GET /sessions/:id/messages
 * 转发 `get_messages`;若注入了 `loadCommandMarkers`,把该会话的 `piweb.command` 标记按时间序
 * 合并进返回序列(plugin-system-unification R13——纯命令冷恢复仍可见)。标记读取失败不致命:
 * 退化为仅返回 agent 消息(历史不因审计读失败而 500)。
 */
export function makeMessagesQueryHandler(
  store: SessionStore,
  loadCommandMarkers?: CommandMarkerLoader,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      let messages = extracted.data.messages;
      if (loadCommandMarkers !== undefined) {
        try {
          const markers = await loadCommandMarkers(ctx.sessionId ?? "");
          messages = mergeCommandMarkers(messages, markers);
        } catch {
          // 审计标记读取失败 → 退化为仅 agent 消息(不影响主历史)。
        }
      }
      return jsonResponse(200, { messages });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/commands */
export function makeCommandsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getCommands();
      const extracted = dataOrError<{ commands: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      // 据各扩展命令所属插件的 pi-plugin.json(web.commands)回填 webVisible(plugin-system-unification)。
      const commands = await enrichWebVisibleCommands(extracted.data.commands);
      return jsonResponse(200, { commands });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * GET /sessions/:id/models → get_available_models 的 `{ models }`(Req 4.1)。
 *
 * 与 `/config/models` 同样尊重 `PI_WEB_HIDE_PROVIDERS`(逗号分隔)部署期开关:剔除被隐藏
 * provider 的模型,使聊天区模型选择器与设置页下拉对齐(同一隐藏名单)。env 可注入便于测试。
 */
export function makeModelsHandler(
  store: SessionStore,
  env: NodeJS.ProcessEnv = process.env,
): RouteHandler {
  const hidden = parseHiddenProviders(env["PI_WEB_HIDE_PROVIDERS"]);
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getAvailableModels();
      const extracted = dataOrError<{
        models: ReadonlyArray<{ readonly provider?: unknown }>;
      }>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, {
        models: excludeProviderModels(extracted.data.models, hidden),
      });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/fork-messages → get_fork_messages 的 `{ messages }`(Req 8.3)。 */
export function makeForkMessagesHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getForkMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { messages: extracted.data.messages });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * GET /sessions/:id/logs?level=&limit=&since=
 * 读取会话 ring buffer，返回 GetLogsResponse `{ entries }`（Req 4.2 / 4.3）。
 * 查询参数全部可选:level(LogLevel)、limit(integer)、since(epoch ms)。
 * 会话不存在 → 404。
 */
export function makeLogsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const params = ctx.url.searchParams;

      // Parse level.
      let level: LogLevel | undefined;
      const levelRaw = params.get("level");
      if (levelRaw !== null) {
        const parsed = LogLevelSchema.safeParse(levelRaw);
        if (!parsed.success) {
          return errorResponse(400, "INVALID_PARAM", `Invalid level: "${levelRaw}".`);
        }
        level = parsed.data;
      }

      // Parse limit.
      let limit: number | undefined;
      const limitRaw = params.get("limit");
      if (limitRaw !== null) {
        const n = Number(limitRaw);
        if (!Number.isInteger(n) || n < 0) {
          return errorResponse(400, "INVALID_PARAM", `Invalid limit: "${limitRaw}".`);
        }
        limit = n;
      }

      // Parse since.
      let since: number | undefined;
      const sinceRaw = params.get("since");
      if (sinceRaw !== null) {
        const n = Number(sinceRaw);
        if (!Number.isFinite(n)) {
          return errorResponse(400, "INVALID_PARAM", `Invalid since: "${sinceRaw}".`);
        }
        since = n;
      }

      const entries = session.getLogs({ level, limit, since });
      return jsonResponse(200, { entries });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}
