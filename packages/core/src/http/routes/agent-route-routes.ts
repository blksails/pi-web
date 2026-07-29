/**
 * http-api — agent 声明式 routes 端点(spec agent-declared-routes task 3.2)。
 *
 *   GET       /sessions/:id/agent-routes         → 路由清单(无声明→空数组,Req 2.5)
 *   GET|POST  /sessions/:id/agent-routes/:name   → 调用一次声明 route(同步响应,Req 2.1/3.2)
 *
 * 检查顺序(design「契约:HTTP API」;会话 404/401/403 由 Router 既有 `:id` 门承担,
 * 本模块不自建鉴权,Req 4.1):
 *   门控(env 关断→404)→ 名称 404 → 方法 405 → Content-Length 413 → POST 非法 JSON 400
 *   → invokeAgentRoute → 200 / 502(ok:false)/ 504(超时)。
 *
 * 错误码字典(design D6):ROUTE_NOT_FOUND / METHOD_NOT_ALLOWED / INVALID_BODY /
 * PAYLOAD_TOO_LARGE / ROUTE_HANDLER_ERROR / ROUTE_TIMEOUT;错误体复用 `errorResponse`
 * 结构 `{ error: { code, message } }`。
 *
 * env(本特性全部 env 统一在本模块读取;session 层不读 env):
 * - `PI_WEB_AGENT_ROUTES_DISABLED === "1"` → 全部 agent-route 端点 404(默认开启,
 *   Req 4.3)。按请求时读取(服务端权威门控;bash-route 先例是禁用时不泄露存在性,
 *   本处同样返回通用 404 `NOT_FOUND`)。
 * - `PI_WEB_AGENT_ROUTE_TIMEOUT_MS`:转发超时毫秒,经参数传入 `invokeAgentRoute`;
 *   未设置/非法传 undefined(session 层代码默认 20s 生效,Req 3.4)。
 * - `PI_WEB_AGENT_ROUTE_BODY_LIMIT`:请求体上限字节,默认 1 MiB(Req 4.2)。
 *
 * 语义裁量(在单测固化):
 * - GET 调用忽略请求体(不读,body 以 undefined 传入)。
 * - POST 空 body 宽松放行(body=undefined 传入处理器);非空但非法 JSON → 400
 *   `INVALID_BODY`(Req 3.6 只约束「不是合法 JSON」,不强制 Content-Type 头 ——
 *   与既有 validateBody 先例一致,curl 无头调用不受阻)。
 * - 413 先按 Content-Length 头提前拒(不读 body,attachment-routes 先例);头缺失/
 *   不可信时读后按实际字节数兜底复核。
 * - 成功响应体 = 处理器返回的**原始 JSON**(可为对象/数组/标量,design「200 handler
 *   返回的 JSON」),不包 jsonResponse 信封;协议版本仅经响应头承载。
 */
import { protocolVersion } from "@blksails/pi-web-protocol";
import type { AgentRouteMethod } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { AgentRouteTimeoutError } from "../../session/session.errors.js";
import {
  errorResponse,
  jsonResponse,
  mapEngineError,
  PROTOCOL_VERSION_HEADER,
} from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";

/** 请求体上限默认值(字节,1 MiB;可经 `PI_WEB_AGENT_ROUTE_BODY_LIMIT` 覆盖)。 */
export const DEFAULT_AGENT_ROUTE_BODY_LIMIT_BYTES = 1024 * 1024;

/** 运维关断 env(`"1"` 关断;默认开启,Req 4.3)。 */
export const AGENT_ROUTES_DISABLED_ENV = "PI_WEB_AGENT_ROUTES_DISABLED";
/** 转发超时 env(毫秒;未设置走 session 层默认 20s)。 */
export const AGENT_ROUTE_TIMEOUT_ENV = "PI_WEB_AGENT_ROUTE_TIMEOUT_MS";
/** 请求体上限 env(字节)。 */
export const AGENT_ROUTE_BODY_LIMIT_ENV = "PI_WEB_AGENT_ROUTE_BODY_LIMIT";

/** 门控:请求时读 env,关断→true(默认开启)。 */
function routesDisabled(): boolean {
  return process.env[AGENT_ROUTES_DISABLED_ENV] === "1";
}

/** 解析正整数 env;未设置/非法返回 undefined(调用方给默认)。 */
function positiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 门控关断时的通用 404(不泄露端点存在性,bash-route 同语义)。 */
function gateClosed(): Response {
  return errorResponse(404, "NOT_FOUND", "Not found.");
}

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/**
 * 从路径提取 `:name` 段。Router 的 `RequestContext` 只透出 `sessionId`(不透出
 * 全量 params),且本 spec 不动 Router 本体,故从 `ctx.url.pathname` 末段自行解析
 * (路径模板固定 `/sessions/:id/agent-routes/:name`,name 恒为末段;与 Router 的
 * 参数解码语义一致地 decodeURIComponent)。
 */
function routeNameFromPath(ctx: RequestContext): string {
  const segments = ctx.url.pathname.split("/").filter((s) => s.length > 0);
  return decodeURIComponent(segments[segments.length - 1] ?? "");
}

/** 处理器返回的原始 JSON 作为响应体(undefined 归一 null;协议版本走响应头)。 */
function rawJsonResponse(result: unknown): Response {
  const h = new Headers();
  h.set("Content-Type", "application/json");
  h.set(PROTOCOL_VERSION_HEADER, protocolVersion);
  return new Response(JSON.stringify(result ?? null), {
    status: 200,
    headers: h,
  });
}

/**
 * GET /sessions/:id/agent-routes → 该会话装配期声明的路由清单(纯数据投影)。
 * 无声明返回 `{ routes: [] }` 而非错误(Req 2.5)。
 */
export function makeAgentRoutesListHandler(store: SessionStore): RouteHandler {
  return (ctx): Promise<Response> => {
    if (routesDisabled()) {
      return Promise.resolve(gateClosed());
    }
    try {
      const session = requireSession(store, ctx);
      return Promise.resolve(
        jsonResponse(200, { routes: session.agentRoutes }),
      );
    } catch (err) {
      return Promise.resolve(mapEngineError(err));
    }
  };
}

/**
 * GET|POST /sessions/:id/agent-routes/:name → 转发一次 route 调用并同步返回。
 *
 * 同一 handler 注册到 GET 与 POST 两个方法(create-handler):Router 对未注册方法
 * 只有「整路径无方法命中→405」,route 级方法白名单(声明 methods 集合)必须在本
 * handler 内检查,才能对「路径存在但该 route 未声明此方法」给出 405(Req 2.3)。
 */
export function makeAgentRouteInvokeHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    // 1) 门控:关断→404,先于一切读取/解析(Req 4.3)。
    if (routesDisabled()) {
      return gateClosed();
    }
    try {
      const session = requireSession(store, ctx);
      const name = routeNameFromPath(ctx);

      // 2) 名称:未声明→404(Req 2.2;handler 只能经声明绑定被调用,Req 4.4)。
      const route = session.agentRoutes.find((r) => r.name === name);
      if (route === undefined) {
        return errorResponse(
          404,
          "ROUTE_NOT_FOUND",
          `Agent route "${name}" is not declared by this session's agent.`,
        );
      }

      // 3) 方法:不在该 route 声明集合→405(Req 2.3)。Router 只注册了 GET/POST,
      //    其余方法在 Router 层已 405;此处窄化并做 route 级白名单。
      const method = ctx.req.method.toUpperCase();
      if (
        (method !== "GET" && method !== "POST") ||
        !route.methods.some((m) => m === method)
      ) {
        return errorResponse(
          405,
          "METHOD_NOT_ALLOWED",
          `Method ${method} not allowed on agent route "${name}".`,
        );
      }
      const routeMethod: AgentRouteMethod = method;

      const bodyLimit =
        positiveIntEnv(AGENT_ROUTE_BODY_LIMIT_ENV) ??
        DEFAULT_AGENT_ROUTE_BODY_LIMIT_BYTES;

      // 4) + 5) 请求体(仅 POST;GET 忽略 body 不读):413 提前拒 → 读后兜底复核
      //    → 非法 JSON 400;空 body 宽松放行(body=undefined)。
      let body: unknown;
      if (routeMethod === "POST") {
        // 4) Content-Length 提前拒(不读 body,Req 4.2;attachment-routes 先例)。
        const contentLength = ctx.req.headers.get("content-length");
        if (contentLength !== null) {
          const declared = Number(contentLength);
          if (Number.isFinite(declared) && declared > bodyLimit) {
            return payloadTooLarge(bodyLimit);
          }
        }
        let text: string;
        try {
          text = await ctx.req.text();
        } catch {
          return invalidBody();
        }
        // Content-Length 缺失/不可信时按实际字节数兜底复核(Req 4.2)。
        if (Buffer.byteLength(text, "utf8") > bodyLimit) {
          return payloadTooLarge(bodyLimit);
        }
        // 5) 非空但非法 JSON → 400,不进入转发(Req 3.6)。
        if (text.length > 0) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            return invalidBody();
          }
        }
      }

      // 查询参数投影(同名多值:后值覆盖前值,取扁平 Record 契约,Req 3.1)。
      const query: Record<string, string> = {};
      ctx.url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      // 6) 转发:超时值(env)以参数传入;未设置传 undefined → session 层默认 20s。
      const frame = await session.invokeAgentRoute(
        name,
        {
          method: routeMethod,
          query,
          ...(body !== undefined ? { body } : {}),
        },
        positiveIntEnv(AGENT_ROUTE_TIMEOUT_ENV),
      );

      // 7) ok:false → 502,错误消息带处理器侧 message(Req 3.3)。
      if (!frame.ok) {
        return errorResponse(
          502,
          "ROUTE_HANDLER_ERROR",
          frame.error?.message ?? `Agent route "${name}" handler failed.`,
        );
      }
      return rawJsonResponse(frame.result);
    } catch (err) {
      // 8) 超时 → 504 ROUTE_TIMEOUT(Req 3.4);其余走既有引擎错误映射(会话已停→409 等)。
      if (err instanceof AgentRouteTimeoutError) {
        return errorResponse(504, err.code, err.message);
      }
      return mapEngineError(err);
    }
  };
}

function payloadTooLarge(limit: number): Response {
  return errorResponse(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request body exceeds the maximum allowed size of ${limit} bytes.`,
  );
}

function invalidBody(): Response {
  return errorResponse(
    400,
    "INVALID_BODY",
    "Request body is not valid JSON.",
  );
}
