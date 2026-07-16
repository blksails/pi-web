/**
 * llm-gateway · 网关路由:门控、换钥与透传/流式(design.md LlmGatewayRoutes,
 * Req 3.1-3.8)。
 *
 * `createLlmGatewayRoutes` 产出挂载于 `/llm-gateway/:provider/*` 的 `InjectedRoute[]`
 * (仅 GET/POST 两条,同一 handler)。**方法门控无需 handler 内代码**:Router 对已注册路径
 * 的其余方法(PUT/DELETE/…)本就按「路径命中、方法不符 → 405」处理(`http/router.ts`),
 * 未匹配任何已注册方法时 handler 根本不会被调用——天然满足「失败路径零上游请求」。
 *
 * handler 内门控顺序(任一步失败即短路,不进入下一步,Req 3.2/3.7):
 *   1. provider 查表(`lookupLlmGatewayProvider`) —— 未登记/路径解析不出 → 404,零上游请求
 *   2. Bearer token 提取 —— 缺失/格式不符 → 401(与校验失败同一对外文案,防探测)
 *   3. `verifyScopedToken({ expectedScope: "llm:" + provider })` —— malformed/expired/
 *      bad-signature → 401;scope-mismatch → 403(与 401 文案不同,面别不符是可诊断的
 *      客户端配置错误,非探测风险)
 *   4. `entry.keyEnvCandidates` 按序即时读取宿主 `env`(不缓存)—— 全部缺失 → 502,
 *      文案不含 key 值/env 变量名以外的敏感信息
 *
 * 换钥转发(Req 3.4-3.6):请求 body 以 `ctx.req.arrayBuffer()` 缓冲后转发,绝不手动
 * `set("content-length", …)`(fetch 对定长 `ArrayBuffer` body 自动携带正确头;手动设置
 * 会与自动追加重复,undici≥8 混搭下触发 `UND_ERR_INVALID_ARG` → 502,fetch-bridge 血泪
 * 教训);响应体 `new Response(upstream.body, …)` 非缓冲流式直通(SSE 长流边到边转发);
 * `ctx.req.signal` 联动可选 `timeoutMs`(`AbortSignal.any`)传播 client abort 与超时至
 * 上游 fetch;上游 4xx/5xx 状态与体原样透传;上游 fetch 抛错 → 502(超时触发则 504)固定
 * 脱敏文案,真实 errName/causeCode/causeStack 仅落服务端日志(`server:llm-gateway`),
 * 每请求另记 `{sessionId, provider, status, durationMs}`,绝不落 key/token 明文。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { errorResponse } from "../http/error-map.js";
import type {
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "../http/handler.types.js";
import { verifyScopedToken } from "../tokens/index.js";
import { lookupLlmGatewayProvider } from "./provider-registry.js";
import type { LlmGatewayProviderTable } from "./provider-registry.js";

/** 路由模板(尾段 `*` 通配,依赖 Router 的通配匹配能力)。 */
const ROUTE_PATH = "/llm-gateway/:provider/*";

/** 本端点支持的 HTTP 方法(逐个精确注册,同一 handler;Router 对其余方法自动 405)。 */
const SUPPORTED_METHODS = ["GET", "POST"] as const;

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
 * 与 `attachment-routes.ts`/(已摘除的)`aigc-proxy/proxy-routes.ts` 同惯例:直接在
 * `pathname` 里定位 `llm-gateway` 字面段,对任意 basePath 前缀健壮,也不依赖 Router 向
 * `RequestContext` 透出非 `id`/`sessionId` 的 `params`(`RequestContext` 只带 `sessionId`)。
 *
 * @returns 解析不出(未出现 `llm-gateway` 段或其后缺 provider 段)返回 `undefined`。
 */
function parseProviderAndRest(
  url: URL,
): { readonly provider: string; readonly rest: string } | undefined {
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const anchorIdx = segments.indexOf("llm-gateway");
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

/** `createLlmGatewayRoutes` 的注入依赖。 */
export interface CreateLlmGatewayRoutesDeps {
  /** secret 解析结果(装配期以 `resolveLlmGatewaySecret` 得出,便于测试直接传固定值)。 */
  readonly secret: string | Buffer;
  /** provider 登记表(装配期以 `resolveLlmGatewayProviderTable` 得出)。 */
  readonly registry: LlmGatewayProviderTable;
  /** 测试接缝:缺省 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 测试接缝:缺省 `process.env`(真实 key 请求期即时读取,不缓存)。 */
  readonly env?: Record<string, string | undefined>;
  /** 可选转发超时(毫秒);触发时经 `AbortSignal.timeout` 中止上游 fetch → 504。 */
  readonly timeoutMs?: number;
}

/**
 * 工厂:产出挂载于 `/llm-gateway/:provider/*` 的注入路由数组(GET/POST)。
 */
export function createLlmGatewayRoutes(
  deps: CreateLlmGatewayRoutesDeps,
): InjectedRoute[] {
  const { secret, registry, fetchImpl = fetch, env = process.env } = deps;
  const logger = createLogger({ namespace: "server:llm-gateway" });

  const handler: RouteHandler = async (ctx: RequestContext): Promise<Response> => {
    const startedAt = Date.now();
    const parsed = parseProviderAndRest(ctx.url);
    let sessionId = "unknown";

    function logAndReturn(status: number, res: Response): Response {
      // 每请求完整埋点(design.md Monitoring):{sessionId, provider, status, durationMs}。
      // 上游 fetch 抛错分支另记一条含 errName/causeCode/causeStack 的错误日志(见下方
      // catch 分支),不落 key/token 明文。
      logger.info("llm-gateway request", {
        sessionId,
        provider: parsed?.provider ?? "",
        status,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    // 1) provider 查表(未登记/解析不出 → 404,零上游请求)。
    const entry =
      parsed !== undefined ? lookupLlmGatewayProvider(registry, parsed.provider) : undefined;
    if (parsed === undefined || entry === undefined) {
      return logAndReturn(
        404,
        errorResponse(404, "NOT_FOUND", "Unknown llm-gateway provider."),
      );
    }

    // 2) Bearer token 提取(缺失/格式不符 → 401,零上游请求)。
    const token = extractBearerToken(ctx.req.headers);
    if (token === undefined) {
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }

    // 3) scope 校验:malformed/expired/bad-signature → 401;scope-mismatch → 403(零上游请求)。
    const verified = verifyScopedToken({
      token,
      expectedScope: `llm:${parsed.provider}`,
      secret,
    });
    if (!verified.ok) {
      if (verified.reason === "scope-mismatch") {
        return logAndReturn(403, errorResponse(403, "FORBIDDEN", "Token scope mismatch."));
      }
      return logAndReturn(401, errorResponse(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE));
    }
    sessionId = verified.sessionId;

    // 4) 宿主真实 key 按 keyEnvCandidates 顺序即时读取(不缓存;全皆缺 → 502,文案不含 key,
    //    零上游请求)。
    const realKey = entry.keyEnvCandidates
      .map((name) => env[name])
      .find((v): v is string => v !== undefined && v.length > 0);
    if (realKey === undefined) {
      return logAndReturn(
        502,
        errorResponse(
          502,
          "BAD_GATEWAY",
          "Host has not configured credentials for this provider.",
        ),
      );
    }

    // 5) 换钥转发。
    const upstreamUrl = `${entry.upstreamBase}${parsed.rest.length > 0 ? `/${parsed.rest}` : ""}${ctx.url.search}`;
    const outHeaders = filterRequestHeaders(ctx.req.headers);
    outHeaders.set("authorization", `Bearer ${realKey}`);

    const method = ctx.req.method.toUpperCase();
    const init: RequestInit = {
      method,
      headers: outHeaders,
    };
    if (method !== "GET" && method !== "HEAD" && ctx.req.body !== null) {
      // 缓冲转发(design.md/fetch-bridge 教训):fetch 对定长 `ArrayBuffer` body 自动携带
      // 正确的 `Content-Length`;绝不手动 `set("content-length", …)`,否则与自动追加的头
      // 重复,undici≥8 混搭下触发 `UND_ERR_INVALID_ARG` → 502。缓冲后 body 非流,故也
      // 无需 `duplex: "half"`。
      init.body = await ctx.req.arrayBuffer();
    }

    // abort 传播:client 中断(`ctx.req.signal`)与可选 `timeoutMs` 均需联动上游 fetch。
    // 分别持有超时 signal 的引用,便于 catch 分支区分「client abort → 502」与
    // 「超时 abort → 504」。
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
      const causeStack =
        err instanceof Error && typeof err.stack === "string"
          ? err.stack.split("\n").slice(0, 5).join("\n")
          : undefined;
      logger.error("llm-gateway upstream fetch failed", {
        sessionId,
        provider: parsed.provider,
        errName,
        causeCode,
        causeStack,
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

    // 上游 4xx/5xx 状态与体原样透传;响应体 `new Response(upstream.body, …)` 为非缓冲
    // 流式直通(SSE 长流边到边转发,不整体缓冲)。
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
