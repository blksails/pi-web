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
import {
  filterVisibleModels,
  type ProviderVisibilityConfig,
} from "../../model-catalog/visibility-filter.js";

interface HistoryAttachmentStore {
  readonly head: (id: string) => Promise<{ readonly sessionId: string } | undefined>;
  readonly presignUrl?: (id: string) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attachmentIdOf(value: Record<string, unknown>): string | undefined {
  for (const key of ["attachmentId", "outputAttachmentId", "inputAttachmentId"]) {
    const id = value[key];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

/**
 * 解析 server 注入的附件文本标记:
 * `[attachment id=att_… type=<mime> name=<name>]`
 * (与 `injectAttachmentRefs` / `buildAttachmentRefs` 同形)。
 */
const ATTACHMENT_REF_LINE_RE =
  /\[attachment id=(att_[^\s\]]+) type=([^\s\]]+) name=([^\]]*)\]/g;

/**
 * 用户消息历史:把文本里的附件引用标记展开为 `image` content 项(带 attachmentId),
 * 并剥离标记只留用户原文。这样后续 `refreshHistoryAttachmentUrls` 能补 displayUrl,
 * 前端 `agentMessagesToUiMessages` 能渲染为 file part——否则 CLI/`attachmentIds` 路径
 * 的用户气泡刷新后只剩纯文本,看起来「对话没有附件引用」。
 */
export function expandUserAttachmentTextRefs(
  messages: readonly unknown[],
): unknown[] {
  return messages.map((msg) => {
    if (!isRecord(msg) || msg["role"] !== "user") return msg;
    const content = msg["content"];

    const expandText = (
      text: string,
    ): { images: Record<string, unknown>[]; text: string } => {
      const images: Record<string, unknown>[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(ATTACHMENT_REF_LINE_RE.source, "g");
      while ((m = re.exec(text)) !== null) {
        images.push({
          type: "image",
          attachmentId: m[1],
          mimeType: m[2],
          name: m[3] ?? "",
        });
      }
      const cleaned = text
        .replace(ATTACHMENT_REF_LINE_RE, "")
        .replace(/^\n+/, "");
      return { images, text: cleaned };
    };

    if (typeof content === "string") {
      const { images, text } = expandText(content);
      if (images.length === 0) return msg;
      const parts: unknown[] = [...images];
      if (text.length > 0) parts.push({ type: "text", text });
      return { ...msg, content: parts };
    }

    if (!Array.isArray(content)) return msg;
    const next: unknown[] = [];
    let changed = false;
    for (const item of content) {
      if (!isRecord(item) || item["type"] !== "text" || typeof item["text"] !== "string") {
        next.push(item);
        continue;
      }
      const { images, text } = expandText(item["text"]);
      if (images.length === 0) {
        next.push(item);
        continue;
      }
      changed = true;
      next.push(...images);
      if (text.length > 0) next.push({ ...item, text });
    }
    return changed ? { ...msg, content: next } : msg;
  });
}

/**
 * 历史消息只保存 attachmentId 时，补一条新的签名 URL。
 * 原 URL 可能已过期；不在当前会话名下的附件不签发，避免跨会话泄露。
 */
async function refreshHistoryAttachmentUrls(
  messages: readonly unknown[],
  sessionId: string,
  attachments: HistoryAttachmentStore,
): Promise<unknown[]> {
  if (attachments.presignUrl === undefined) return [...messages];

  const ids = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!isRecord(value)) return;
    const id = attachmentIdOf(value);
    if (id !== undefined) ids.add(id);
    for (const child of Object.values(value)) collect(child);
  };
  collect(messages);

  const urls = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const attachment = await attachments.head(id);
        if (attachment?.sessionId === sessionId) {
          urls.set(id, await attachments.presignUrl!(id));
        }
      } catch {
        // 图片只是展示增强；历史消息本身仍照常返回。
      }
    }),
  );

  // toolResult 正文常以 markdown 保存旧签名 URL。按同一份已校验的 id→URL 映射重写
  // 字符串，保证通用文本渲染器与 details.assets 使用同一份当前签名；不为未知 id
  // 构造裸 raw URL，避免把安全校验降级成路径猜测。
  const rewriteText = (text: string): string =>
    text.replace(
      /(?:https?:\/\/[^\s)\]"'<>]+)?\/attachments\/(att_[A-Za-z0-9_-]+)\/raw(?:\?[^\s)\]"'<>]*)?/g,
      (match: string, id: string) => {
        const fresh = urls.get(id);
        if (fresh === undefined) return match;
        const marker = "/attachments/";
        const markerIndex = match.indexOf(marker);
        const freshMarkerIndex = fresh.indexOf(marker);
        return markerIndex < 0 || freshMarkerIndex < 0
          ? match
          : `${match.slice(0, markerIndex)}${fresh.slice(freshMarkerIndex)}`;
      },
    );

  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (typeof value === "string") return rewriteText(value);
    if (!isRecord(value)) return value;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewrite(child)]),
    ) as Record<string, unknown>;
    const id = attachmentIdOf(value);
    const url = id === undefined ? undefined : urls.get(id);
    if (url !== undefined) next["displayUrl"] = url;
    return next;
  };
  return messages.map(rewrite);
}

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

/**
 * 查询端点的公共骨架:取会话 → 转发一次 RPC → 提取 data → 投影为响应体。
 *
 * 六个查询端点(state/stats/messages/commands/models/fork-messages)原本各自把这五步抄了
 * 一遍,只差三处:调哪个方法、响应键名、要不要后处理。抽成高阶函数后,新增一个查询端点
 * 是加一个四行的调用,而不是再复制一遍 try/requireSession/dataOrError/jsonResponse/
 * mapEngineError。
 *
 * ★ `logs` 端点**刻意不走这里**:它不发 RPC(直读 ring buffer)且要解析三个查询参数,
 *   套进来只会让骨架为一个特例长出两个可选钩子。
 *
 * @param call    转发的会话方法。
 * @param project 把成功 data 投影为响应体。可 async(commands 端点要回填 webVisible)。
 */
function makeQueryHandler<T>(
  store: SessionStore,
  call: (session: PiSession) => Promise<RpcResponse>,
  project: (data: T) => Record<string, unknown> | Promise<Record<string, unknown>>,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const extracted = dataOrError<T>(await call(session));
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, await project(extracted.data));
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/state */
export function makeStateHandler(store: SessionStore): RouteHandler {
  return makeQueryHandler<unknown>(
    store,
    (s) => s.getState(),
    (state) => ({ state }),
  );
}

/** GET /sessions/:id/stats */
export function makeStatsHandler(store: SessionStore): RouteHandler {
  return makeQueryHandler<unknown>(
    store,
    (s) => s.getSessionStats(),
    (stats) => ({ stats }),
  );
}

/** GET /sessions/:id/messages */
export function makeMessagesQueryHandler(
  store: SessionStore,
  attachmentStore?: HistoryAttachmentStore,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      // 先展开 user 文本附件标记为 image content(带 attachmentId),再补签名 displayUrl。
      const expanded = expandUserAttachmentTextRefs(extracted.data.messages);
      const messages =
        attachmentStore !== undefined
          ? await refreshHistoryAttachmentUrls(
              expanded,
              ctx.sessionId ?? "",
              attachmentStore,
            )
          : expanded;
      return jsonResponse(200, { messages });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/commands */
export function makeCommandsHandler(store: SessionStore): RouteHandler {
  return makeQueryHandler<{ commands: unknown[] }>(
    store,
    (s) => s.getCommands(),
    // 据各扩展命令所属插件的 pi-web.json(web.commands)回填 webVisible(plugin-system-unification)。
    async ({ commands }) => ({ commands: await enrichWebVisibleCommands(commands) }),
  );
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
  readVisibility?: () => ProviderVisibilityConfig | undefined,
): RouteHandler {
  const hidden = parseHiddenProviders(env["PI_WEB_HIDE_PROVIDERS"]);
  return makeQueryHandler<{
    models: ReadonlyArray<{ readonly provider?: unknown; readonly id?: unknown }>;
  }>(
    store,
    (s) => s.getAvailableModels(),
    ({ models }) => {
      // 两层依次生效,语义不同不可合并:
      //  1. hidden(PI_WEB_HIDE_PROVIDERS)—— 部署方的**彻底禁用**,既有语义不动;
      //  2. visibility —— 使用者的**仅隐藏**,只收敛本清单的呈现。
      //     已被会话选中的模型继续可用(Req 2.4/4.7):本处只过滤"可选清单",
      //     不参与会话执行路径。
      const afterHidden = excludeProviderModels(models, hidden);
      return { models: filterVisibleModels(afterHidden, readVisibility?.()) };
    },
  );
}

/** GET /sessions/:id/fork-messages → get_fork_messages 的 `{ messages }`(Req 8.3)。 */
export function makeForkMessagesHandler(store: SessionStore): RouteHandler {
  return makeQueryHandler<{ messages: unknown[] }>(
    store,
    (s) => s.getForkMessages(),
    ({ messages }) => ({ messages }),
  );
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
