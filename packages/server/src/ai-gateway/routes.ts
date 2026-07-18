/**
 * ai-gateway · 主对话转发路由(design.md §2.3,Req Story 2)。
 *
 * `createAiGatewayRoutes` 产出挂载于 `/ai-gateway/*`(单段通配,无 `:provider`)的
 * `InjectedRoute[]`(仅 GET/POST 两条,同一 handler),与 `createLlmGatewayRoutes`
 * 同构但差异点如下:
 *
 * handler 内门控顺序(任一步失败即短路,不进入下一步,失败路径零上游请求):
 *   1. 子路径白名单(`ALLOWED_PATHS` 前缀匹配)—— 未命中 → 404
 *   2. Bearer token 提取 —— 缺失/格式不符 → 401(与校验失败同一对外文案,防探测)
 *   3. `verifyScopedToken({ expectedScope: "ai-gateway" })` —— malformed/expired/
 *      bad-signature → 401;scope-mismatch → 403
 *   4. `KeyResolver.resolve()` —— 解析不出凭据 → 502,文案不含 env 变量名以外的敏感信息
 *
 * 换钥转发:剔除 host/authorization/content-length + 逐跳头;请求 body 以
 * `ctx.req.arrayBuffer()` 缓冲后转发(绝不手动设 content-length,fetch-bridge 血泪教训);
 * 响应体 `new Response(upstream.body, …)` 非缓冲流式直通(SSE 长流边到边转发);
 * `AbortSignal.any([ctx.req.signal, timeoutSignal?])` 联动客户端断开与超时。
 *
 * 限额标注(Req 2.5):上游 429/402 时读 `X-RateLimit-Scope`/`X-RateLimit-Period`,在
 * 响应头附加 `x-pi-gateway-limit: scope=<s>;period=<p>`(状态码与 body 原样透传)。
 *
 * 日志(Req 2.7):`server:ai-gateway` logger,`{sessionId, path, model, status,
 * durationMs}`;model 从请求体浅解析(失败记 "-"),绝不落 key/token 明文。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { errorResponse } from "../http/error-map.js";
import type {
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "../http/handler.types.js";
import { verifyScopedToken } from "../tokens/index.js";
import type { KeyResolver } from "./key-resolver.js";

/** 路由模板(尾段 `*` 通配)。 */
const ROUTE_PATH = "/ai-gateway/*";

/** 本端点支持的 HTTP 方法。 */
const SUPPORTED_METHODS = ["GET", "POST"] as const;

/** 子路径白名单(前缀匹配)。未命中 → 404,零上游请求(Req 2.2)。 */
const ALLOWED_PATH_PREFIXES = [
  "v1/chat/completions",
  "v1/messages",
  "v1/models",
  "v1/images/",
  "dashscope/api/v1/tasks/",
] as const;

/** scoped token 的作用域(所有 ai-gateway 子路径共用同一 scope)。 */
const EXPECTED_SCOPE = "ai-gateway";

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

/** 限额标注响应头名。 */
const RATE_LIMIT_HEADER = "x-pi-gateway-limit";

/**
 * 从请求路径解析 `ai-gateway` 段之后的余段(不含前导斜杠)。
 *
 * 与 `llm-gateway/gateway-routes.ts` 同惯例:直接在 `pathname` 里定位字面段,对任意
 * basePath 前缀健壮。
 *
 * @returns 未出现 `ai-gateway` 段时返回 `undefined`。
 */
function parseRest(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const anchorIdx = segments.indexOf("ai-gateway");
  if (anchorIdx < 0) return undefined;
  return segments
    .slice(anchorIdx + 1)
    .map((s) => decodeURIComponent(s))
    .join("/");
}

/** 子路径是否命中白名单前缀。 */
function isAllowedPath(rest: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((prefix) => rest.startsWith(prefix));
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

/**
 * 429/402 限额标注(Req 2.5):读上游 `X-RateLimit-Scope`/`X-RateLimit-Period`,附加归一化
 * `x-pi-gateway-limit: scope=<s>;period=<p>` 响应头(缺失的一侧省略该字段;两侧皆缺 →
 * 不附加任何值)。
 */
function annotateRateLimitHeaders(status: number, source: Headers, target: Headers): void {
  if (status !== 429 && status !== 402) return;
  const scope = source.get("x-ratelimit-scope");
  const period = source.get("x-ratelimit-period");
  const parts: string[] = [];
  if (scope !== null) parts.push(`scope=${scope}`);
  if (period !== null) parts.push(`period=${period}`);
  if (parts.length > 0) target.set(RATE_LIMIT_HEADER, parts.join(";"));
}

/** 从请求体浅解析 `model` 字段(仅用于日志);解析失败/无该字段 → `"-"`。 */
function parseModelForLog(bodyText: string | undefined): string {
  if (bodyText === undefined || bodyText.length === 0) return "-";
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "model" in parsed &&
      typeof (parsed as { model?: unknown }).model === "string"
    ) {
      return (parsed as { model: string }).model;
    }
  } catch {
    // 解析失败:记 "-",不抛。
  }
  return "-";
}

/** `createAiGatewayRoutes` 的注入依赖。 */
export interface CreateAiGatewayRoutesDeps {
  /** 网关 base URL(不含尾斜杠,来自 `resolveAiGatewayConfig`)。 */
  readonly baseUrl: string;
  /** scoped token 校验 secret。 */
  readonly secret: string | Buffer;
  /** Key 解析器(P0 `EnvKeyResolver`)。 */
  readonly keyResolver: KeyResolver;
  /** 测试接缝:缺省 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 可选转发超时(毫秒);触发时经 `AbortSignal.any` 中止上游 fetch → 504。 */
  readonly timeoutMs?: number;
}

/**
 * 工厂:产出挂载于 `/ai-gateway/*` 的注入路由数组(GET/POST)。
 */
export function createAiGatewayRoutes(deps: CreateAiGatewayRoutesDeps): InjectedRoute[] {
  const { baseUrl, secret, keyResolver, fetchImpl = fetch } = deps;
  const logger = createLogger({ namespace: "server:ai-gateway" });

  const handler: RouteHandler = async (ctx: RequestContext): Promise<Response> => {
    const startedAt = Date.now();
    const rest = parseRest(ctx.url);
    let sessionId = "unknown";
    let model = "-";

    function logAndReturn(status: number, res: Response): Response {
      logger.info("ai-gateway request", {
        sessionId,
        path: rest ?? "",
        model,
        status,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    // 1) 子路径白名单(未命中 → 404,零上游请求)。
    if (rest === undefined || !isAllowedPath(rest)) {
      return logAndReturn(404, errorResponse(404, "NOT_FOUND", "Unknown ai-gateway path."));
    }

    // 2) Bearer token 提取(缺失/格式不符 → 401,零上游请求)。
    const token = extractBearerToken(ctx.req.headers);
    if (token === undefined) {
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }

    // 3) scope 校验:malformed/expired/bad-signature → 401;scope-mismatch → 403(零上游请求)。
    const verified = verifyScopedToken({
      token,
      expectedScope: EXPECTED_SCOPE,
      secret,
    });
    if (!verified.ok) {
      if (verified.reason === "scope-mismatch") {
        return logAndReturn(403, errorResponse(403, "FORBIDDEN", "Token scope mismatch."));
      }
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }
    sessionId = verified.sessionId;

    // 4) KeyResolver 解析真实 key(解析不出 → 502,文案不含敏感信息,零上游请求)。
    const realKey = await keyResolver.resolve({});
    if (realKey === undefined) {
      return logAndReturn(
        502,
        errorResponse(
          502,
          "BAD_GATEWAY",
          "Host has not configured credentials for ai-gateway.",
        ),
      );
    }

    // 5) 换钥转发。
    const upstreamUrl = `${baseUrl}/${rest}${ctx.url.search}`;
    const outHeaders = filterRequestHeaders(ctx.req.headers);
    outHeaders.set("authorization", `Bearer ${realKey}`);

    const method = ctx.req.method.toUpperCase();
    const init: RequestInit = {
      method,
      headers: outHeaders,
    };
    let bodyTextForLog: string | undefined;
    if (method !== "GET" && method !== "HEAD" && ctx.req.body !== null) {
      // 缓冲转发(design.md/fetch-bridge 教训):绝不手动 set("content-length", …)。
      const buf = await ctx.req.arrayBuffer();
      init.body = buf;
      // model 浅解析仅用于日志,解析失败不影响转发本体。
      try {
        bodyTextForLog = new TextDecoder().decode(buf);
      } catch {
        bodyTextForLog = undefined;
      }
    }
    model = parseModelForLog(bodyTextForLog);

    // abort 联动:client 中断与可选 timeoutMs 均需联动上游 fetch(Req 2.6)。
    const timeoutSignal =
      deps.timeoutMs !== undefined ? AbortSignal.timeout(deps.timeoutMs) : undefined;
    init.signal =
      timeoutSignal !== undefined
        ? AbortSignal.any([ctx.req.signal, timeoutSignal])
        : ctx.req.signal;

    let upstream: Response;
    try {
      upstream = await fetchImpl(upstreamUrl, init);
    } catch (err) {
      const errName = err instanceof Error ? err.name : typeof err;
      const cause = err instanceof Error ? err.cause : undefined;
      const causeCode =
        cause !== undefined &&
        cause !== null &&
        typeof cause === "object" &&
        "code" in cause
          ? (cause as { code?: unknown }).code
          : undefined;
      logger.error("ai-gateway upstream fetch failed", {
        sessionId,
        path: rest,
        errName,
        causeCode,
      });
      if (timeoutSignal?.aborted === true) {
        return logAndReturn(
          504,
          errorResponse(504, "GATEWAY_TIMEOUT", "Upstream gateway request timed out."),
        );
      }
      return logAndReturn(
        502,
        errorResponse(502, "BAD_GATEWAY", "Failed to reach upstream gateway."),
      );
    }

    // 429/402 限额标注(Req 2.5);状态码与 body 原样透传。
    const resHeaders = filterResponseHeaders(upstream.headers);
    annotateRateLimitHeaders(upstream.status, upstream.headers, resHeaders);

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
