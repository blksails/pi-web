/**
 * http-api — Router:方法+路径分发(含 `:id` 提取)、auth 调用点、外部路由合并。
 *
 * - 解析 `req.method` 与 `new URL(req.url).pathname`(去 basePath)匹配端点表;不匹配
 *   路径→404(Req 1.4),路径匹配方法不符→405(Req 1.5)。
 * - 提取 `:id` 注入 `RequestContext`;`:id` 端点经 `store.get(id)` 校验存在(不存在→404,
 *   Req 2.4)。
 * - 分发前调用 `authResolver`(拒绝→401,Req 8.4)与 `authorizeSession`(false→403,
 *   Req 8.5);未注入→默认放行(Req 8.3)。版本不兼容→426(Req 7.2)。
 * - 合并 `opts.routes` 外部注入路由与内置端点表:精确 `path`+`method` 冲突时内置优先,
 *   外部路由不能覆盖/遮蔽内置端点(Req 1.7)。
 */
import type {
  AuthResolver,
  AuthorizeSession,
} from "./auth.js";
import { defaultAuthResolver, defaultAuthorizeSession, isAuthReject } from "./auth.js";
import { errorResponse } from "./error-map.js";
import type { InjectedRoute, RouteHandler } from "./handler.types.js";
import type { SessionStore } from "../session/index.js";
import { checkVersion } from "./version.js";

/** 一条已编译的路由:方法 + 路径段(`:param` 表参数)+ 处理器。 */
interface CompiledRoute {
  readonly method: string;
  readonly segments: ReadonlyArray<string>;
  readonly handler: RouteHandler;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function compile(
  method: string,
  path: string,
  handler: RouteHandler,
): CompiledRoute {
  return { method: method.toUpperCase(), segments: splitPath(path), handler };
}

/** 路由表条目(供 create-handler 声明内置端点)。 */
export interface RouteSpec {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandler;
}

export interface RouterDeps {
  readonly store: SessionStore;
  readonly builtins: ReadonlyArray<RouteSpec>;
  readonly injected?: ReadonlyArray<InjectedRoute>;
  readonly authResolver?: AuthResolver;
  readonly authorizeSession?: AuthorizeSession;
  readonly basePath?: string;
}

interface MatchResult {
  readonly route: CompiledRoute;
  readonly params: Readonly<Record<string, string>>;
}

export class Router {
  private readonly routes: ReadonlyArray<CompiledRoute>;
  private readonly store: SessionStore;
  private readonly authResolver: AuthResolver;
  private readonly authorizeSession: AuthorizeSession;
  private readonly baseSegments: ReadonlyArray<string>;

  constructor(deps: RouterDeps) {
    this.store = deps.store;
    this.authResolver = deps.authResolver ?? defaultAuthResolver;
    this.authorizeSession = deps.authorizeSession ?? defaultAuthorizeSession;
    this.baseSegments = deps.basePath ? splitPath(deps.basePath) : [];

    const builtins = deps.builtins.map((r) =>
      compile(r.method, r.path, r.handler),
    );
    // 内置路由对精确 path+method 冲突优先:仅纳入与内置不冲突的外部路由(Req 1.7)。
    const builtinKeys = new Set(
      builtins.map((r) => `${r.method} ${r.segments.join("/")}`),
    );
    const injected = (deps.injected ?? [])
      .map((r) => compile(r.method, r.path, r.handler))
      .filter(
        (r) => !builtinKeys.has(`${r.method} ${r.segments.join("/")}`),
      );
    // 内置在前(匹配优先)。
    this.routes = [...builtins, ...injected];
  }

  /**
   * 匹配路径模板(段数相等,字面段相等,`:param` 段捕获)。
   *
   * 模板尾段为字面量 `*` 时视为通配段(Req 2.3):放宽段数约束为
   * `segments.length >= route.segments.length - 1`(`*` 可匹配零段),其余实际段
   * 逐段 `decodeURIComponent` 后以 `/` 连接存入 `params["*"]`。`*` 仅在尾段位置生效;
   * 中段出现的 `*` 仍按字面量比较(向后兼容)。
   */
  private matchPath(
    route: CompiledRoute,
    segments: ReadonlyArray<string>,
  ): Readonly<Record<string, string>> | undefined {
    const lastTmpl = route.segments[route.segments.length - 1];
    const isWildcard = route.segments.length > 0 && lastTmpl === "*";

    if (isWildcard) {
      const fixedLen = route.segments.length - 1;
      if (segments.length < fixedLen) return undefined;
    } else if (route.segments.length !== segments.length) {
      return undefined;
    }

    const params: Record<string, string> = {};
    const fixedCount = isWildcard ? route.segments.length - 1 : route.segments.length;
    for (let i = 0; i < fixedCount; i += 1) {
      const tmpl = route.segments[i];
      const actual = segments[i];
      if (tmpl === undefined || actual === undefined) return undefined;
      if (tmpl.startsWith(":")) {
        params[tmpl.slice(1)] = decodeURIComponent(actual);
      } else if (tmpl !== actual) {
        return undefined;
      }
    }

    if (isWildcard) {
      params["*"] = segments
        .slice(fixedCount)
        .map((s) => decodeURIComponent(s))
        .join("/");
    }

    return params;
  }

  /** 去 basePath 前缀;不匹配前缀返回 undefined。 */
  private stripBase(
    segments: ReadonlyArray<string>,
  ): ReadonlyArray<string> | undefined {
    if (this.baseSegments.length === 0) return segments;
    if (segments.length < this.baseSegments.length) return undefined;
    for (let i = 0; i < this.baseSegments.length; i += 1) {
      if (segments[i] !== this.baseSegments[i]) return undefined;
    }
    return segments.slice(this.baseSegments.length);
  }

  async route(req: Request): Promise<Response> {
    const versionError = checkVersion(req);
    if (versionError !== undefined) return versionError;

    const url = new URL(req.url);
    const rawSegments = splitPath(url.pathname);
    const segments = this.stripBase(rawSegments);
    if (segments === undefined) {
      return errorResponse(404, "NOT_FOUND", "No route matches this path.");
    }

    const method = req.method.toUpperCase();
    let pathMatched = false;
    let matched: MatchResult | undefined;
    for (const route of this.routes) {
      const params = this.matchPath(route, segments);
      if (params === undefined) continue;
      pathMatched = true;
      if (route.method === method) {
        matched = { route, params };
        break;
      }
    }

    if (matched === undefined) {
      if (pathMatched) {
        return errorResponse(
          405,
          "METHOD_NOT_ALLOWED",
          `Method ${method} not allowed on this path.`,
        );
      }
      return errorResponse(404, "NOT_FOUND", "No route matches this path.");
    }

    const sessionId = matched.params["id"];

    // 鉴权解析(Req 8.4)。
    const authResult = await this.authResolver(req);
    if (isAuthReject(authResult)) {
      return errorResponse(401, "UNAUTHORIZED", "Authentication rejected.");
    }

    // `:id` 端点存在性校验(Req 2.4)。
    if (sessionId !== undefined && this.store.get(sessionId) === undefined) {
      return errorResponse(
        404,
        "SESSION_NOT_FOUND",
        `Session "${sessionId}" not found.`,
      );
    }

    // 会话级授权(Req 8.5)。
    if (sessionId !== undefined) {
      const allowed = await this.authorizeSession({
        auth: authResult,
        sessionId,
        req,
      });
      if (!allowed) {
        return errorResponse(403, "FORBIDDEN", "Authorization denied.");
      }
    }

    return matched.route.handler({
      req,
      auth: authResult,
      url,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }
}
