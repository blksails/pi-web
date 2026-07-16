/**
 * aigc-proxy · 凭据注入代理路由(Req 2.1–2.6, 4.2, 4.3)。
 *
 * `createAigcProxyRoutes` 产出的 `InjectedRoute[]` 挂载在 `/aigc-proxy/:provider/*`
 * (GET/POST/PUT/DELETE 各一条,同一 handler)。处理顺序严格如下,任一步失败即短路,
 * 不进入下一步(design.md「proxy-routes」组件块):
 *
 *   1. provider 查表(`lookupProvider`) —— 未登记 → 404,零上游请求(Req 2.2)
 *   2. Bearer token 提取 + 校验(`verifySessionToken`) —— 缺失/malformed/expired/
 *      bad-signature 一律 401,对外文案不区分原因(防探测,原因仅进日志),零上游请求
 *      (Req 3.3)
 *   3. 宿主真实 key 查 `env[entry.keyEnv]`(请求期即时读取,不缓存) —— 缺失 → 502,
 *      文案仅提示宿主未配置凭据,绝不包含 key 值或 env 变量名以外的敏感信息(Req 2.6, 4.2)
 *   4. 转发:请求 headers 剔除 `host`/`authorization`/`content-length`/逐跳头
 *      (`connection`/`keep-alive`/`transfer-encoding`/`upgrade`/`te`/`trailer`/`proxy-*`)
 *      后透传(`content-type`(含 multipart boundary)、`x-dashscope-async`、`accept` 等
 *      原样保留),注入 `authorization: Bearer <真实key>`;非 GET/HEAD 请求体以
 *      `duplex: "half"` 流式转发(Req 2.1, 2.4)
 *
 * 响应:`new Response(upstream.body, { status, headers })` 流式透传(不缓冲),响应
 * headers 同样剔除逐跳头与 `content-length`(流式体长度未知,交由运行时重算)。上游
 * 4xx/5xx 状态与体原样透传(Req 2.5)。`fetchImpl` 网络错误 → 502;
 * `AbortSignal.timeout` 触发(仅当 `timeoutMs` 配置)→ 504;错误体固定脱敏文案,绝不
 * 包含上游异常细节(Req 2.6)。
 *
 * 日志(`server:aigc-proxy` 命名空间):每请求一行,仅含 sessionId(token 校验产物;
 * 校验失败前记 "unknown")、provider、path、status、耗时;`authorization` 头与 token
 * 全文绝不落日志(Req 4.3)。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { errorResponse } from "../http/error-map.js";
import type {
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "../http/handler.types.js";
import { lookupProvider } from "./provider-registry.js";
import { verifySessionToken } from "./session-token.js";

/** 路由模板(尾段 `*` 通配,依赖 Router 的通配匹配能力)。 */
const ROUTE_PATH = "/aigc-proxy/:provider/*";

/** 本代理端点支持的 HTTP 方法(逐个精确注册,Router 按方法精确匹配)。 */
const SUPPORTED_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

/** 请求侧需剔除的固定头(大小写不敏感)。 */
const REQUEST_HEADERS_TO_STRIP = new Set(["host", "authorization", "content-length"]);

/** 逐跳头(大小写不敏感,`proxy-*` 前缀另行判断)。 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

function isHopByHopOrProxyHeader(lowerName: string): boolean {
  return HOP_BY_HOP_HEADERS.has(lowerName) || lowerName.startsWith("proxy-");
}

/** 对外统一 401 文案(不区分缺失/malformed/expired/bad-signature,防探测)。 */
const UNAUTHORIZED_MESSAGE = "Invalid or expired credentials.";

/**
 * 从请求路径解析 `:provider` 段与其后的余段(`rest`)。
 *
 * 与 `attachment-routes.ts` 的 `parseAttachmentId` 同惯例:直接在 `pathname` 里定位
 * `aigc-proxy` 字面段,对任意 basePath 前缀健壮(不依赖 Router 是否配置了 `basePath`),
 * 也不依赖 Router 向 `RequestContext` 透出非 `id` 的 `params`(`RequestContext` 只带
 * `sessionId`)。
 *
 * @returns 解析不出(未出现 `aigc-proxy` 段或其后缺 provider 段)返回 `undefined`。
 */
function parseProviderAndRest(
  url: URL,
): { readonly provider: string; readonly rest: string } | undefined {
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const anchorIdx = segments.indexOf("aigc-proxy");
  if (anchorIdx < 0) return undefined;
  const providerRaw = segments[anchorIdx + 1];
  if (providerRaw === undefined || providerRaw.length === 0) return undefined;
  const rest = segments
    .slice(anchorIdx + 2)
    .map((s) => decodeURIComponent(s))
    .join("/");
  return { provider: decodeURIComponent(providerRaw), rest };
}

/** 提取 `Authorization: Bearer <token>` 中的 token;缺失/形状不符返回 undefined。 */
function extractBearerToken(headers: Headers): string | undefined {
  const raw = headers.get("authorization");
  if (raw === null) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1];
}

/** 过滤请求 headers:剔除 host/authorization/content-length/逐跳头,其余原样透传。 */
function filterRequestHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (REQUEST_HEADERS_TO_STRIP.has(lower) || isHopByHopOrProxyHeader(lower)) return;
    out.set(name, value);
  });
  return out;
}

/** 过滤响应 headers:剔除 content-length(流式体长度未知)与逐跳头。 */
function filterResponseHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === "content-length" || isHopByHopOrProxyHeader(lower)) return;
    out.set(name, value);
  });
  return out;
}

/** `createAigcProxyRoutes` 的注入依赖。 */
export interface CreateAigcProxyRoutesDeps {
  /** secret 解析结果(装配期注入,与 token 签发同源;便于测试直接传固定值)。 */
  readonly secret: string | Buffer;
  /** 测试接缝:缺省 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 测试接缝:缺省 `process.env`(真实 key 请求期即时读取,不缓存)。 */
  readonly env?: Record<string, string | undefined>;
  /** 可选转发超时(毫秒);缺省不设额外超时,交上游语义。设置且触发 → 504。 */
  readonly timeoutMs?: number;
}

/**
 * 工厂:产出挂载于 `/aigc-proxy/:provider/*` 的注入路由数组(GET/POST/PUT/DELETE)。
 */
export function createAigcProxyRoutes(
  deps: CreateAigcProxyRoutesDeps,
): InjectedRoute[] {
  const { secret, fetchImpl = fetch, env = process.env, timeoutMs } = deps;
  const logger = createLogger({ namespace: "server:aigc-proxy" });

  const handler: RouteHandler = async (ctx: RequestContext): Promise<Response> => {
    const startedAt = Date.now();
    const parsed = parseProviderAndRest(ctx.url);
    let sessionId = "unknown";

    function logAndReturn(status: number, res: Response): Response {
      logger.info("aigc-proxy request", {
        sessionId,
        provider: parsed?.provider ?? "",
        path: ctx.url.pathname,
        status,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    // 1) provider 查表(未登记/解析不出 → 404,零上游请求,Req 2.2)。
    const entry = parsed !== undefined ? lookupProvider(parsed.provider) : undefined;
    if (parsed === undefined || entry === undefined) {
      return logAndReturn(
        404,
        errorResponse(404, "NOT_FOUND", "Unknown aigc-proxy provider."),
      );
    }

    // 2) Bearer token 提取 + 校验(缺失/malformed/expired/bad-signature → 401,
    //    对外文案统一,零上游请求,Req 3.3)。
    const token = extractBearerToken(ctx.req.headers);
    if (token === undefined) {
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }
    const verified = verifySessionToken({ token, secret });
    if (!verified.ok) {
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }
    sessionId = verified.sessionId;

    // 3) 宿主真实 key 查 env(请求期即时读取,不缓存;缺失 → 502,文案不含 key 值,
    //    Req 2.6, 4.2)。
    const realKey = env[entry.keyEnv];
    if (realKey === undefined || realKey.length === 0) {
      return logAndReturn(
        502,
        errorResponse(
          502,
          "BAD_GATEWAY",
          "Host has not configured credentials for this provider.",
        ),
      );
    }

    // 4) 转发:剔除固定头 + 逐跳头后透传,注入真实 key;非 GET/HEAD 请求体流式转发。
    const upstreamUrl = `${entry.upstreamBase}${parsed.rest.length > 0 ? `/${parsed.rest}` : ""}${ctx.url.search}`;
    const outHeaders = filterRequestHeaders(ctx.req.headers);
    outHeaders.set("authorization", `Bearer ${realKey}`);

    const method = ctx.req.method.toUpperCase();
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: outHeaders,
    };
    if (method !== "GET" && method !== "HEAD" && ctx.req.body !== null) {
      init.body = ctx.req.body;
      init.duplex = "half";
    }
    if (timeoutMs !== undefined) {
      init.signal = AbortSignal.timeout(timeoutMs);
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(upstreamUrl, init);
    } catch (err) {
      // AbortSignal.timeout 触发的中止表现为 DOMException("TimeoutError")(WHATWG fetch
      // 标准行为,Node 内置 undici 遵循同规范)→ 504;其余网络层错误 → 502。错误体固定
      // 脱敏文案,绝不透出上游异常细节(Req 2.6)。
      if (err instanceof Error && err.name === "TimeoutError") {
        return logAndReturn(
          504,
          errorResponse(504, "GATEWAY_TIMEOUT", "Upstream request timed out."),
        );
      }
      return logAndReturn(
        502,
        errorResponse(502, "BAD_GATEWAY", "Failed to reach upstream gateway."),
      );
    }

    // 上游 4xx/5xx 状态与体原样透传(Req 2.5);响应流式转发不缓冲(Req 2.4)。
    const resHeaders = filterResponseHeaders(upstream.headers);
    return logAndReturn(
      upstream.status,
      new Response(upstream.body, { status: upstream.status, headers: resHeaders }),
    );
  };

  return SUPPORTED_METHODS.map((method) => ({
    method,
    path: ROUTE_PATH,
    handler,
  }));
}
