/**
 * declaration-validators — `AgentDefinition` 里 pi-web 自有声明字段的**权威校验与归一化**。
 *
 * 自 `agent-loader.ts` 原样析出(SRP:装载用户模块 与 校验其声明 是两件事)。
 * 行为逐字保持;`agent-loader.ts` 继续 re-export 本模块的公开符号。
 *
 * 共同约定:
 *  - 校验发生在**装配期、子进程内**,失败一律抛 {@link InvalidAgentDefinitionError} →
 *    runner 在 ready 之前退出 → 会话创建失败。**绝不静默忽略非法声明**。
 *  - 只做**形状**校验。需要宿主上下文的校验(如 attachmentProfile 是否命中宿主拓扑白名单)
 *    由 runner 装配期另行执行 —— loader 阶段尚不便读取那些 env 的语义权威。
 *  - 未声明(`undefined`)一律原样返回 `undefined` / 空数组,使存量 agent 逐字段零变化。
 */
import type {
  AgentAttachmentCatalogDecl,
  AgentDefinition,
  AgentRouteHandler,
} from "@blksails/pi-web-core/agent-definition.js";
import type { AgentRouteMethod } from "@blksails/pi-web-protocol";

/** Thrown when a user entry's default export cannot be normalized. */
export class InvalidAgentDefinitionError extends Error {
  constructor(
    public readonly agentPath: string,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid agent definition at "${agentPath}": ${reason}`, options);
    this.name = "InvalidAgentDefinitionError";
  }
}

/**
 * 归一化后的单条 agent route 声明(spec agent-declared-routes)。
 *
 * 与作者声明面(`AgentRouteDecl`)的差别:`methods` 已补缺省(`["GET"]`)且必填。
 * 纯数据投影(name/methods/description)与 protocol 的 `AgentRouteDeclDto` 一致;
 * `handler` 仅存活于子进程内(归一化发生在子进程,函数不过进程边界——下游
 * wiring 消费 handler,装配期声明帧只取纯数据投影)。
 */
export interface NormalizedAgentRouteDecl {
  readonly name: string;
  readonly methods: readonly AgentRouteMethod[];
  readonly description?: string;
  readonly handler: AgentRouteHandler;
}

/** route 名称格式(Req 1.2):小写字母/数字开头,仅含小写字母/数字/连字符。 */
const ROUTE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** route 允许的 HTTP 方法白名单(Req 1.2)。 */
const ALLOWED_ROUTE_METHODS: ReadonlySet<string> = new Set(["GET", "POST"]);

/**
 * 错误文案里的类型名。`typeof null === "object"` 会把「传了 null」说成「传了 object」,
 * 对着错误信息排查的人会被直接带偏,故单列。四处诊断共用。
 */
function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/**
 * 权威校验并归一化 `AgentDefinition.routes`(spec agent-declared-routes,Req 1.2/1.3)。
 *
 * 规则:名称匹配 {@link ROUTE_NAME_PATTERN}、同一定义内唯一、methods ⊆ {GET, POST}
 * 且非空(空集合的 route 永不可达,视为声明错误而非静默忽略)、handler 必须是函数
 * (归一化产物携带 handler 引用,下游 wiring 依赖);`methods` 缺省补 `["GET"]`。
 *
 * 非法声明抛 {@link InvalidAgentDefinitionError},消息含 route 名称与失败原因
 * (→ runner 启动失败 → 会话创建失败,而非静默忽略)。无声明返回空数组。
 */
export function normalizeAgentRoutes(
  routes: AgentDefinition["routes"],
  agentPath: string,
): readonly NormalizedAgentRouteDecl[] {
  if (routes === undefined) {
    return [];
  }
  const fail = (routeName: unknown, reason: string): never => {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid routes declaration: route ${JSON.stringify(routeName)}: ${reason}`,
    );
  };
  if (!Array.isArray(routes)) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid routes declaration: "routes" must be an array (got ${typeof routes})`,
    );
  }

  const seen = new Set<string>();
  return routes.map((decl, index): NormalizedAgentRouteDecl => {
    if (typeof decl !== "object" || decl === null) {
      return fail(index, `declaration at index ${index} must be an object (got ${typeName(decl)})`);
    }
    const { name, methods, description, handler } = decl;

    if (typeof name !== "string" || !ROUTE_NAME_PATTERN.test(name)) {
      return fail(
        name ?? index,
        "name must be a non-empty string matching ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits and hyphens, starting with a letter or digit)",
      );
    }
    if (seen.has(name)) {
      return fail(name, "duplicate route name within one agent definition");
    }
    seen.add(name);

    let normalizedMethods: readonly AgentRouteMethod[];
    if (methods === undefined) {
      normalizedMethods = ["GET"];
    } else {
      if (!Array.isArray(methods) || methods.length === 0) {
        return fail(name, 'methods must be a non-empty array of "GET" / "POST" (omit the field to default to ["GET"])');
      }
      for (const method of methods) {
        if (typeof method !== "string" || !ALLOWED_ROUTE_METHODS.has(method)) {
          return fail(name, `method ${JSON.stringify(method)} is not allowed (allowed methods: GET, POST)`);
        }
      }
      normalizedMethods = [...new Set(methods)];
    }

    if (typeof handler !== "function") {
      return fail(name, `handler must be a function (got ${typeName(handler)})`);
    }

    return {
      name,
      methods: normalizedMethods,
      ...(description !== undefined ? { description } : {}),
      handler,
    };
  });
}

/**
 * 权威校验并归一化 `AgentDefinition.attachmentProfile`(spec agent-attachment-profile,
 * Req 1.1/1.3)——**形状**校验:非空字符串、与 route/后端名同规字符格式
 * ({@link ROUTE_NAME_PATTERN})。白名单(是否命中宿主拓扑)不在此校验,由 runner 在装配期
 * 另行对照 `parseBackendsEnv` 执行(loader 阶段尚不便读取拓扑 env 的语义权威,归属见
 * design.md §runner)。
 *
 * 非法形状抛 {@link InvalidAgentDefinitionError};未声明返回 `undefined`。
 */
export function normalizeAttachmentProfile(
  attachmentProfile: AgentDefinition["attachmentProfile"],
  agentPath: string,
): string | undefined {
  if (attachmentProfile === undefined) return undefined;
  if (
    typeof attachmentProfile !== "string" ||
    !ROUTE_NAME_PATTERN.test(attachmentProfile)
  ) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid attachmentProfile declaration: must be a non-empty string matching ^[a-z0-9][a-z0-9-]*$ (got ${JSON.stringify(attachmentProfile)})`,
    );
  }
  return attachmentProfile;
}

/**
 * 权威校验 `AgentDefinition.attachmentCatalog`(spec agent-attachment-catalog,Req 1.1/1.2)——
 * **形状**校验:声明存在时 `list`/`resolve` 均必须为函数。白名单/子进程侧行为不在此校验。
 *
 * 非法形状抛 {@link InvalidAgentDefinitionError};未声明返回 `undefined`。
 */
export function normalizeAttachmentCatalog(
  attachmentCatalog: AgentDefinition["attachmentCatalog"],
  agentPath: string,
): AgentAttachmentCatalogDecl | undefined {
  if (attachmentCatalog === undefined) return undefined;
  if (typeof attachmentCatalog !== "object" || attachmentCatalog === null) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid attachmentCatalog declaration: must be an object with "list" and "resolve" handlers (got ${typeName(
        attachmentCatalog,
      )})`,
    );
  }
  const { list, resolve } = attachmentCatalog;
  if (typeof list !== "function") {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid attachmentCatalog declaration: "list" must be a function (got ${typeof list})`,
    );
  }
  if (typeof resolve !== "function") {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid attachmentCatalog declaration: "resolve" must be a function (got ${typeof resolve})`,
    );
  }
  return { list, resolve };
}
